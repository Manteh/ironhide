// Orbie for macOS: a thin native shell. It owns the window, starts (or attaches to) the
// Orbie daemon, shows the existing web UI from it, and stops the daemon it started on quit.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod discord;
mod nav;
mod nowplaying;
mod player;
mod tray;

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicI32, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    ipc::CapabilityBuilder,
    menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    window::Color,
    AppHandle, Manager, RunEvent, TitleBarStyle, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}
const SIGKILL: i32 = 9;
const SIGTERM: i32 = 15;
/// The daemon's process group (its pid), so a panic hook can stop it too.
static DAEMON_PGID: AtomicI32 = AtomicI32::new(0);
static BOOTING: AtomicBool = AtomicBool::new(false);

/// Loads web/js/native.js into the Orbie daemon's pages (and nowhere else): the app-only look, link handling,
/// the player overlay, the window header and the update notice all live there, next to the rest of the UI.
const NATIVE_JS: &str = r#"(() => {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  const s = document.createElement('script'); s.src = '/js/native.js';
  (document.head || document.documentElement).appendChild(s);
})();"#;

/// The daemon child, only set when this app started it (an already-running daemon is left alone).
struct Daemon(Mutex<Option<Child>>);

fn port() -> u16 {
    std::env::var("IRONHIDE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(7676)
}

/// One small HTTP request to the daemon; the whole response, or None.
fn http(port: u16, method: &str, path: &str) -> Option<String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    s.write_all(format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).ok()?;
    let mut body = String::new();
    let _ = s.read_to_string(&mut body);
    Some(body)
}

/// The daemon's /api/health answer, when an Orbie daemon is listening.
fn health(port: u16) -> Option<serde_json::Value> {
    let r = http(port, "GET", "/api/health")?;
    // the body may come chunked (a length line before and after it): take the JSON object itself
    let body = r.split_once("\r\n\r\n")?.1;
    let (a, b) = (body.find('{')?, body.rfind('}')?);
    let v: serde_json::Value = serde_json::from_str(body.get(a..=b)?).ok()?;
    (v["service"] == "ironhide").then_some(v)
}
fn healthy(port: u16) -> bool { health(port).is_some() }

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

/// Keep the log small: past 5 MB it moves to daemon.log.1 (replacing the older one) and starts fresh.
fn rotate_log() {
    let p = log_path();
    if fs::metadata(&p).map(|m| m.len() > 5 * 1024 * 1024).unwrap_or(false) {
        let _ = fs::rename(&p, p.with_extension("log.1"));
    }
}

/// The app's own log, ~/Library/Logs/IronHide/app.log: starts and crashes (with where and why). Kept under 1 MB.
fn app_log(line: &str) {
    let p = log_path().with_file_name("app.log");
    if fs::metadata(&p).map(|m| m.len() > 1024 * 1024).unwrap_or(false) { let _ = fs::rename(&p, p.with_extension("log.1")); }
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    // UTC date and time without a date library (days-to-civil)
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let z = days + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153; let d = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 }; let y = yoe + era * 400 + (m <= 2) as i64;
    let stamp = format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC", rem / 3600, rem % 3600 / 60, rem % 60);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p) { let _ = writeln!(f, "{stamp}  {line}"); }
}

fn support_dir() -> PathBuf {
    let dir = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/Application Support/IronHide");
    let _ = fs::create_dir_all(&dir);
    dir
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
    if let Some(h) = health(p) {
        // Started by an Orbie app, but not by this one: left over from a crash or the copy an update just replaced
        // (only one app runs at a time). Ask it to go, then start our own. Anything else (the CLI, the MCP server, your own
        // `npm start`) is yours: attach to it and leave it running on quit.
        if h["owner"] != "app" { return Ok(()); }
        splash(app, "__ihStatus", "Replacing an older Orbie service…");
        let _ = http(p, "POST", "/api/shutdown");
        let t0 = Instant::now();
        while healthy(p) {
            if t0.elapsed() > Duration::from_secs(6) {
                if let Some(pid) = h["pid"].as_i64() { unsafe { kill(pid as i32, SIGKILL); } }
                thread::sleep(Duration::from_millis(300));
                break;
            }
            thread::sleep(Duration::from_millis(150));
        }
    }
    let root = find_root(app).ok_or("Cannot find the Orbie files (src/ and web/). Set IRONHIDE_ROOT.")?;
    // the release build carries its own Node, ffmpeg and ffprobe in <root>/bin (see mac/scripts/release.sh)
    let bundled_bin = root.join("bin");
    let bundled_node = bundled_bin.join("node");
    let node = if std::env::var("IRONHIDE_NODE").is_err() && bundled_node.exists() { bundled_node } else {
        find_node().ok_or("Node.js was not found. Install it (brew install node) or set IRONHIDE_NODE.")?
    };
    rotate_log();
    let log = OpenOptions::new().create(true).append(true).open(log_path()).map_err(|e| e.to_string())?;
    let log2 = log.try_clone().map_err(|e| e.to_string())?;
    let path = format!("{}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{}", bundled_bin.display(), std::env::var("PATH").unwrap_or_default());
    let mut cmd = Command::new(&node);
    cmd.arg("src/daemon.js")
        .current_dir(&root)
        .env("PATH", path)
        .env("IRONHIDE_BIN", &bundled_bin)
        // The Samsung TV bridge stays off unless you opt in with IRONHIDE_TV_BRIDGE=1.
        .env("IRONHIDE_NO_BRIDGE", if std::env::var("IRONHIDE_TV_BRIDGE").as_deref() == Ok("1") { "" } else { "1" })
        // ours: it stops when this app goes, and a later app may replace it (see the health check above)
        .env("IRONHIDE_OWNER", "app")
        .env("IRONHIDE_APP_VERSION", app.package_info().version.to_string())
        .env("IRONHIDE_APP_PATH", app_bundle().map(|p| p.display().to_string()).unwrap_or_default())
        // its own process group, so stopping it also stops the ffmpeg and helpers it started
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log2));
    let child = cmd.spawn().map_err(|e| format!("Could not start Node: {e}"))?;
    DAEMON_PGID.store(child.id() as i32, Ordering::Relaxed);
    *app.state::<Daemon>().0.lock().unwrap() = Some(child);
    Ok(())
}

/// Orbie.app, when running from a bundle.
fn app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors().find(|p| p.extension().map(|e| e == "app").unwrap_or(false)).map(Path::to_path_buf)
}

fn boot(app: AppHandle) {
    if BOOTING.swap(true, Ordering::SeqCst) { return; }
    thread::spawn(move || {
        let fail = |app: &AppHandle, msg: &str| { splash(app, "__ihError", msg); BOOTING.store(false, Ordering::SeqCst); };
        splash(&app, "__ihStatus", "Starting the Orbie service…");
        if let Err(e) = start_daemon(&app) {
            fail(&app, &e);
            return;
        }
        let p = port();
        let t0 = Instant::now();
        while !healthy(p) {
            // the daemon exited on its own: show why
            let exited = app.state::<Daemon>().0.lock().unwrap().as_mut().and_then(|c| c.try_wait().ok().flatten());
            if exited.is_some() || t0.elapsed() > Duration::from_secs(30) {
                stop_daemon(&app);
                fail(&app, &format!("The service did not start. {}", log_tail(3)));
                return;
            }
            thread::sleep(Duration::from_millis(120));
        }
        if let Some(w) = app.get_webview_window("main") {
            // replace the start-up screen rather than adding to history, so swiping back can't land on it
            // the start-up intro finishes and pushes through into the app; replacing (not adding to) history means
            // swiping back can't land on it
            let u = js_str(&format!("http://127.0.0.1:{p}/"));
            let _ = w.eval(&format!("window.__ihReady?__ihReady({u}):location.replace({u})"));
        }
        BOOTING.store(false, Ordering::SeqCst);
    });
}

// the splash screen's buttons when the service could not start
#[tauri::command]
fn retry_boot(app: AppHandle) { boot(app); }
#[tauri::command]
fn open_log() { let _ = Command::new("/usr/bin/open").arg("-a").arg("Console").arg(log_path()).spawn(); }

fn go(app: &AppHandle, hash: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("if(location.port==='{}')location.hash={}", port(), js_str(hash)));
    }
}

/// Stop the daemon we started and everything it started: ask nicely (it saves your place), then insist after 3 s.
fn stop_daemon(app: &AppHandle) {
    let child = app.state::<Daemon>().0.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(mut c) = child {
        let pg = c.id() as i32;
        unsafe { kill(-pg, SIGTERM); }
        let t0 = Instant::now();
        while c.try_wait().ok().flatten().is_none() && t0.elapsed() < Duration::from_secs(3) { thread::sleep(Duration::from_millis(50)); }
        unsafe { kill(-pg, SIGKILL); }
        let _ = c.wait();
        DAEMON_PGID.store(0, Ordering::Relaxed);
    }
}

// ---- window size and place, remembered between launches ----
fn window_file() -> PathBuf { support_dir().join("window.json") }

fn save_window(w: &tauri::WebviewWindow) {
    // not the tiny picture-in-picture window, not full screen, not minimized
    if player::in_pip() || w.is_fullscreen().unwrap_or(false) || w.is_minimized().unwrap_or(false) { return; }
    let (Ok(p), Ok(s), Ok(sc)) = (w.outer_position(), w.inner_size(), w.scale_factor()) else { return };
    let v = serde_json::json!({ "x": p.x as f64 / sc, "y": p.y as f64 / sc, "w": s.width as f64 / sc, "h": s.height as f64 / sc, "max": w.is_maximized().unwrap_or(false) });
    let _ = fs::write(window_file(), v.to_string());
}

fn restore_window(w: &tauri::WebviewWindow) {
    let Some(v) = fs::read_to_string(window_file()).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) else { return };
    let (Some(x), Some(y), Some(wd), Some(ht)) = (v["x"].as_f64(), v["y"].as_f64(), v["w"].as_f64(), v["h"].as_f64()) else { return };
    // only if that spot is still on a connected screen (an external display may be gone)
    let on_screen = w.available_monitors().unwrap_or_default().iter().any(|m| {
        let sc = m.scale_factor();
        let (mx, my, mw, mh) = (m.position().x as f64 / sc, m.position().y as f64 / sc, m.size().width as f64 / sc, m.size().height as f64 / sc);
        x + 80.0 > mx && x < mx + mw - 80.0 && y >= my - 10.0 && y < my + mh - 80.0
    });
    if !on_screen { return; }
    let _ = w.set_size(tauri::LogicalSize::new(wd.max(960.0), ht.max(600.0)));
    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
    if v["max"].as_bool() == Some(true) { let _ = w.maximize(); }
}

fn eval(app: &AppHandle, code: &str) {
    if let Some(w) = app.get_webview_window("main") { let _ = w.eval(code); }
}

// opens a web link in the user's default browser (only http and https, so a page can't launch anything else)
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) { return Err("only web links".into()); }
    std::process::Command::new("/usr/bin/open").arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    // A crash must not leave the service running: stop its process group before the default panic report.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // first write down what went wrong (the release build has no symbols, so this is the only clue)
        let msg = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_else(|| "(no message)".into());
        let place = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_else(|| "(unknown place)".into());
        let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
        app_log(&format!("CRASH in thread '{thread}' at {place}: {msg}\n{}", std::backtrace::Backtrace::force_capture()));
        let pg = DAEMON_PGID.load(Ordering::Relaxed);
        if pg > 0 { unsafe { kill(-pg, SIGTERM); } }
        player::cleanup();
        default_hook(info);
    }));
    app_log(&format!("start {} (pid {})", env!("CARGO_PKG_VERSION"), std::process::id()));
    // IRONHIDE_TEST_PANIC=1: crash on purpose right here, to check the crash log works
    if std::env::var("IRONHIDE_TEST_PANIC").as_deref() == Ok("1") { panic!("test crash (IRONHIDE_TEST_PANIC=1)"); }

    let app = tauri::Builder::default()
        // one Orbie at a time (they share the port and the player socket): opening it again brings this one forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
        }))
        .manage(Daemon(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![player::player_cmd, player::player_set, player::player_close, player::player_ambient, player::player_fullscreen, player::player_pip, player::player_drag, player::win_zoom, open_external, retry_boot, open_log])
        .setup(|app| {
            let h = app.handle();
            // The daemon's pages may use the player and window commands, and only from this exact address and port.
            // (Built here, not in capabilities/, because the port can be changed with IRONHIDE_PORT.)
            let mut cap = CapabilityBuilder::new("daemon-pages").remote(format!("http://127.0.0.1:{}/*", port())).window("main");
            for perm in ["allow-player-cmd", "allow-player-set", "allow-player-close", "allow-player-ambient", "allow-player-fullscreen", "allow-player-pip", "allow-player-drag", "allow-win-zoom", "allow-open-external"] {
                cap = cap.permission(perm);
            }
            app.add_capability(cap)?;

            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Orbie")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 600.0)
                .center()
                .background_color(Color(7, 7, 13, 255))
                // title bar takes the window colour and the title is hidden, like Discord
                .title_bar_style(TitleBarStyle::Overlay)
                .traffic_light_position(tauri::LogicalPosition::new(16.0, 15.0))
                .hidden_title(true)
                .disable_drag_drop_handler()
                .initialization_script(NATIVE_JS)
                .build()?;
            restore_window(&win);
            // the page learns about full screen from here, not by guessing from the window size
            let (h2, last_fs) = (h.clone(), std::sync::Arc::new(AtomicBool::new(false)));
            win.on_window_event(move |ev| match ev {
                WindowEvent::Resized(_) => {
                    let Some(w) = h2.get_webview_window("main") else { return };
                    let fs = w.is_fullscreen().unwrap_or(false);
                    if last_fs.swap(fs, Ordering::Relaxed) != fs { let _ = w.eval(&format!("window.__ihFs={fs};window.__ihp&&window.__ihp.fs&&window.__ihp.fs({fs})")); }
                }
                WindowEvent::CloseRequested { .. } => { if let Some(w) = h2.get_webview_window("main") { save_window(&w); } }
                _ => {}
            });
            player::setup(h);
            nowplaying::setup();
            // transparent web view background, so the video underneath shows through while playing
            if let Some(w) = h.get_webview_window("main") {
                let _ = w.with_webview(|wv| unsafe {
                    use objc2::{msg_send, runtime::AnyObject};
                    let view: *mut AnyObject = wv.inner().cast();
                    let no: *mut AnyObject = msg_send![objc2::class!(NSNumber), numberWithBool: false];
                    let key = objc2_foundation::NSString::from_str("drawsBackground");
                    let _: () = msg_send![view, setValue: no, forKey: &*key];
                    // WebKit holds pages to 60 frames a second even on a 120 Hz ProMotion screen ("prefer page rendering
                    // updates near 60fps"). Turn that off so animations and the frame clock run at the display's rate.
                    let cls = objc2::class!(WKPreferences);
                    let has: bool = msg_send![cls, respondsToSelector: objc2::sel!(_features)];
                    let config: *mut AnyObject = msg_send![view, configuration];
                    let prefs: *mut AnyObject = msg_send![config, preferences];
                    let can: bool = msg_send![prefs, respondsToSelector: objc2::sel!(_setEnabled:forFeature:)];
                    if has && can {
                        let feats: *mut AnyObject = msg_send![cls, _features];
                        let n: usize = msg_send![feats, count];
                        let want = objc2_foundation::NSString::from_str("PreferPageRenderingUpdatesNear60FPSEnabled");
                        for i in 0..n {
                            let f: *mut AnyObject = msg_send![feats, objectAtIndex: i];
                            let k: *mut AnyObject = msg_send![f, key];
                            let same: bool = msg_send![k, isEqualToString: &*want];
                            if same { let _: () = msg_send![prefs, _setEnabled: false, forFeature: f]; }
                        }
                    }
                });
            }
            nav::setup(h); // trackpad swipe and mouse side buttons go back and forward
            player::serve(h.clone());
            let nav = |id: &str, label: &str, key: &str| MenuItemBuilder::with_id(id, label).accelerator(key).build(h);
            let item = |id: &str, label: &str| MenuItemBuilder::with_id(id, label).build(h);
            let app_menu = SubmenuBuilder::new(h, "Orbie")
                .about(Some(AboutMetadata::default()))
                .item(&item("updates", "Check for Updates…")?)
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
                .separator()
                .item(&nav("go-back", "Back", "Cmd+[")?)
                .item(&nav("go-forward", "Forward", "Cmd+]")?)
                .build()?;
            // Space and the arrows stay with the page (they also type in fields); these are the menu versions
            let playback = SubmenuBuilder::new(h, "Playback")
                .item(&nav("pb-toggle", "Play / Pause", "Cmd+P")?)
                .item(&nav("pb-back", "Back 10 Seconds", "Cmd+Left")?)
                .item(&nav("pb-fwd", "Forward 10 Seconds", "Cmd+Right")?)
                .separator()
                .item(&nav("pb-mute", "Mute", "Cmd+Shift+M")?)
                .item(&nav("pb-pip", "Picture in Picture", "Cmd+Shift+P")?)
                .item(&nav("pb-shot", "Take Screenshot", "Cmd+Shift+S")?)
                .separator()
                .item(&nav("pb-stop", "Stop", "Cmd+.")?)
                .build()?;
            let view = SubmenuBuilder::new(h, "View")
                .item(&nav("reload", "Reload", "Cmd+R")?)
                .item(&nav("fps", "Show Frame Rate", "Cmd+Shift+F")?)
                .item(&PredefinedMenuItem::fullscreen(h, None)?)
                .build()?;
            let window = SubmenuBuilder::new(h, "Window").minimize().maximize().separator().close_window().build()?;
            let menu = MenuBuilder::new(h).items(&[&app_menu, &edit, &go_menu, &playback, &view, &window]).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, ev| match ev.id().as_ref() {
                "fps" => { if let Some(w) = app.get_webview_window("main") { let _ = w.eval("window.__ihFps&&__ihFps()"); } }
                "go-back" => nav::go(app, "back"),
                "go-forward" => nav::go(app, "forward"),
                "home" => go(app, "#/"),
                "resume" => go(app, "#/continue"),
                "shelf" => go(app, "#/shelf"),
                "friends" => go(app, "#/friends"),
                "profile" => go(app, "#/profile"),
                "settings" => go(app, "#/settings"),
                "search" => eval(app, "document.getElementById('nSearch')?.click()"),
                "reload" => eval(app, "location.reload()"),
                "updates" => eval(app, "window.__ihUpdate && window.__ihUpdate(true)"),
                "tray-show" => { if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); } }
                "tray-quit" => app.exit(0),
                "tray-next" => eval(app, "window.__ihNextEp && window.__ihNextEp()"),
                id if id.starts_with("pb-") && player::active() => match id {
                    "pb-toggle" => player::cmd(&["cycle", "pause"]),
                    "pb-back" => player::cmd(&["seek", "-10", "relative"]),
                    "pb-fwd" => player::cmd(&["seek", "10", "relative"]),
                    "pb-mute" => player::cmd(&["cycle", "mute"]),
                    "pb-shot" => player::cmd(&["screenshot", "window"]),
                    "pb-stop" => player::player_close(),
                    "pb-pip" => { if let Some(w) = app.get_webview_window("main") { player::toggle_pip(w, None); } }
                    _ => {}
                },
                _ => {}
            });
            tray::setup(h)?;
            boot(h.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Orbie");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { .. } => { if let Some(w) = app.get_webview_window("main") { save_window(&w); } }
        // orbie:// from the invite page: just come to the front. The page copied the code, and the welcome screen
        // reads the clipboard when it gets focus, so nothing from the link itself is trusted or passed on.
        RunEvent::Opened { .. } => { if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); } }
        RunEvent::Exit => {
            stop_daemon(app);
            player::cleanup();
        }
        _ => {}
    });
}
