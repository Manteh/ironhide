#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Daemon(Mutex<Option<Child>>);

fn root(app: &AppHandle) -> Option<PathBuf> {
    let ok = |p: &Path| p.join("src/daemon.js").exists() && p.join("web/index.html").exists();
    if let Ok(r) = std::env::var("IRONHIDE_ROOT") {
        let p = PathBuf::from(r);
        if ok(&p) { return Some(p); }
    }
    let p = app.path().resource_dir().ok()?.join("ironhide");
    ok(&p).then_some(p)
}

fn healthy(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn start_daemon(app: &AppHandle) -> Result<Child, String> {
    let root = root(app).ok_or("Cannot find the bundled Orbie service")?;
    let node = root.join("bin/node.exe");
    if !node.exists() { return Err("The bundled Node runtime is missing".into()); }
    let bin = root.join("bin");
    Command::new(node)
        .arg("src/daemon.js")
        .current_dir(&root)
        .env("PATH", format!("{};{}", bin.display(), std::env::var("PATH").unwrap_or_default()))
        .env("IRONHIDE_BIN", &bin)
        .env("IRONHIDE_NO_BRIDGE", "1")
        .env("IRONHIDE_OWNER", "app")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start Orbie service: {e}"))
}

fn main() {
    tauri::Builder::default()
        .manage(Daemon(Mutex::new(None)))
        .setup(|app| {
            let port = std::env::var("IRONHIDE_PORT").ok().and_then(|x| x.parse().ok()).unwrap_or(7676u16);
            let child = start_daemon(app.handle())?;
            *app.state::<Daemon>().0.lock().unwrap() = Some(child);
            let handle = app.handle().clone();
            thread::spawn(move || {
                for _ in 0..100 {
                    if healthy(port) {
                        let _ = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(format!("http://127.0.0.1:{port}/").parse().unwrap()))
                            .title("Orbie")
                            .inner_size(1280.0, 820.0)
                            .min_inner_size(960.0, 620.0)
                            .build();
                        return;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Orbie")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Daemon>().0.lock().unwrap().take() { let _ = child.kill(); }
            }
        });
}
