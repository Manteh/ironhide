// IronHide for macOS: a thin native shell. It owns the window, starts (or attaches to) the
// IronHide daemon, shows the existing web UI from it, and stops the daemon it started on quit.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{
    menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    window::Color,
    AppHandle, Manager, RunEvent, TitleBarStyle, Url, WebviewUrl, WebviewWindowBuilder,
};

/// Makes the page feel like an app instead of a browser tab (only runs on the IronHide daemon's pages).
const NATIVE_JS: &str = r#"(() => {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  const css = `
    html { overscroll-behavior: none; }
    body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    input, textarea, [contenteditable], .selectable { -webkit-user-select: text; user-select: text; }
    ::-webkit-scrollbar { width: 14px; height: 14px; background: transparent; }
    ::-webkit-scrollbar-corner { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 10px; border: 4px solid transparent; background-clip: content-box; min-height: 40px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.3); background-clip: content-box; }
  `;
  const add = () => { const s = document.createElement('style'); s.textContent = css; document.documentElement.appendChild(s); };
  document.documentElement ? add() : document.addEventListener('DOMContentLoaded', add);
})();"#;

/// The daemon child, only set when this app started it (an already-running daemon is left alone).
struct Daemon(Mutex<Option<Child>>);

fn port() -> u16 {
    std::env::var("IRONHIDE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(7676)
}

fn healthy(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_millis(900)));
    if s.write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut body = String::new();
    let _ = s.read_to_string(&mut body);
    body.contains("\"service\":\"ironhide\"")
}

/// Folder holding src/, web/, node_modules/ and package.json.
fn find_root(app: &AppHandle) -> Option<PathBuf> {
    let ok = |p: &Path| p.join("src/daemon.js").exists() && p.join("web/index.html").exists();
    if let Ok(r) = std::env::var("IRONHIDE_ROOT") {
        let p = PathBuf::from(r);
        if ok(&p) { return Some(p); }
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().ok();
    // Dev builds run the live repo so edits to web/ and src/ show up on reload.
    if cfg!(debug_assertions) {
        if let Some(p) = repo.as_ref().filter(|p| ok(p)) { return Some(p.clone()); }
    }
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("ironhide");
        if ok(&p) { return Some(p); }
    }
    repo.filter(|p| ok(p))
}

fn find_node() -> Option<PathBuf> {
    if let Ok(n) = std::env::var("IRONHIDE_NODE") {
        return Some(PathBuf::from(n));
    }
    let home = std::env::var("HOME").unwrap_or_default();
    for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if Path::new(c).exists() { return Some(c.into()); }
    }
    // nvm / fnm / volta installs live under the home folder; ask a login shell as a last resort.
    let v = format!("{home}/.volta/bin/node");
    if Path::new(&v).exists() { return Some(v.into()); }
    let out = Command::new("/bin/zsh").args(["-lc", "command -v node"]).output().ok()?;
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!p.is_empty() && Path::new(&p).exists()).then(|| p.into())
}

fn log_path() -> PathBuf {
    let dir = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/Logs/IronHide");
    let _ = fs::create_dir_all(&dir);
    dir.join("daemon.log")
}

fn log_tail(n: usize) -> String {
    let t = fs::read_to_string(log_path()).unwrap_or_default();
    let lines: Vec<&str> = t.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

fn js_str(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', " "))
}

fn splash(app: &AppHandle, f: &str, msg: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("window.{f} && window.{f}({})", js_str(msg)));
    }
}

fn start_daemon(app: &AppHandle) -> Result<(), String> {
    let p = port();
    if healthy(p) {
        return Ok(()); // attach to the daemon that is already running
    }
    let root = find_root(app).ok_or("Cannot find the IronHide files (src/ and web/). Set IRONHIDE_ROOT.")?;
    let node = find_node().ok_or("Node.js was not found. Install it (brew install node) or set IRONHIDE_NODE.")?;
    let log = OpenOptions::new().create(true).append(true).open(log_path()).map_err(|e| e.to_string())?;
    let log2 = log.try_clone().map_err(|e| e.to_string())?;
    let path = format!("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{}", std::env::var("PATH").unwrap_or_default());
    let mut cmd = Command::new(&node);
    cmd.arg("src/daemon.js")
        .current_dir(&root)
        .env("PATH", path)
        // The Samsung TV bridge stays off unless you opt in with IRONHIDE_TV_BRIDGE=1.
        .env("IRONHIDE_NO_BRIDGE", if std::env::var("IRONHIDE_TV_BRIDGE").as_deref() == Ok("1") { "" } else { "1" })
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log2));
    let child = cmd.spawn().map_err(|e| format!("Could not start Node: {e}"))?;
    *app.state::<Daemon>().0.lock().unwrap() = Some(child);
    Ok(())
}

fn boot(app: AppHandle) {
    thread::spawn(move || {
        splash(&app, "__ihStatus", "Starting the IronHide service…");
        if let Err(e) = start_daemon(&app) {
            splash(&app, "__ihError", &e);
            return;
        }
        let p = port();
        let t0 = Instant::now();
        while !healthy(p) {
            // the daemon exited on its own: show why
            let exited = app.state::<Daemon>().0.lock().unwrap().as_mut().and_then(|c| c.try_wait().ok().flatten());
            if exited.is_some() || t0.elapsed() > Duration::from_secs(30) {
                let _ = File::open(log_path());
                splash(&app, "__ihError", &format!("The service did not start. {}", log_tail(3)));
                return;
            }
            thread::sleep(Duration::from_millis(120));
        }
        if let Some(w) = app.get_webview_window("main") {
            let url: Url = format!("http://127.0.0.1:{p}/").parse().unwrap();
            let _ = w.navigate(url);
        }
    });
}

fn go(app: &AppHandle, hash: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("if(location.port==='{}')location.hash={}", port(), js_str(hash)));
    }
}

fn stop_daemon(app: &AppHandle) {
    if let Some(mut c) = app.state::<Daemon>().0.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Daemon(Mutex::new(None)))
        .setup(|app| {
            let h = app.handle();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("IronHide")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 600.0)
                .center()
                .background_color(Color(13, 13, 14, 255))
                // title bar takes the window colour and the title is hidden, like Discord
                .title_bar_style(TitleBarStyle::Transparent)
                .hidden_title(true)
                .disable_drag_drop_handler()
                .initialization_script(NATIVE_JS)
                .build()?;
            let nav = |id: &str, label: &str, key: &str| MenuItemBuilder::with_id(id, label).accelerator(key).build(h);
            let app_menu = SubmenuBuilder::new(h, "IronHide")
                .about(Some(AboutMetadata::default()))
                .separator()
                .item(&nav("settings", "Settings…", "Cmd+,")?)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit = SubmenuBuilder::new(h, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
            let go_menu = SubmenuBuilder::new(h, "Go")
                .item(&nav("home", "Home", "Cmd+1")?)
                .item(&nav("resume", "Continue watching", "Cmd+2")?)
                .item(&nav("shelf", "Shelf", "Cmd+3")?)
                .item(&nav("friends", "Friends", "Cmd+4")?)
                .item(&nav("profile", "Profile", "Cmd+5")?)
                .separator()
                .item(&nav("search", "Search", "Cmd+K")?)
                .build()?;
            let view = SubmenuBuilder::new(h, "View")
                .item(&nav("reload", "Reload", "Cmd+R")?)
                .item(&PredefinedMenuItem::fullscreen(h, None)?)
                .build()?;
            let window = SubmenuBuilder::new(h, "Window").minimize().maximize().separator().close_window().build()?;
            let menu = MenuBuilder::new(h).items(&[&app_menu, &edit, &go_menu, &view, &window]).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, ev| match ev.id().as_ref() {
                "home" => go(app, "#/"),
                "resume" => go(app, "#/continue"),
                "shelf" => go(app, "#/shelf"),
                "friends" => go(app, "#/friends"),
                "profile" => go(app, "#/profile"),
                "settings" => go(app, "#/settings"),
                "search" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.eval("document.getElementById('nSearch')?.click()");
                    }
                }
                "reload" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.eval("location.reload()");
                    }
                }
                _ => {}
            });
            boot(h.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build IronHide");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_daemon(app);
        }
    });
}
