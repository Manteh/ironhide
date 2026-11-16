// The menu bar icon: what's playing, play/pause, skip, next episode, and a way back to the window.
// Its menu items use the same ids as the Playback menu, so main.rs handles both in one place.

use std::sync::OnceLock;
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Wry,
};

struct Items { now: MenuItem<Wry>, toggle: MenuItem<Wry>, controls: Vec<MenuItem<Wry>> }
static ITEMS: OnceLock<Items> = OnceLock::new();

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, label: &str, on: bool| MenuItemBuilder::with_id(id, label).enabled(on).build(app);
    let now = item("tray-now", "Nothing playing", false)?;
    let toggle = item("pb-toggle", "Pause", false)?;
    let back = item("pb-back", "Back 10 Seconds", false)?;
    let fwd = item("pb-fwd", "Forward 10 Seconds", false)?;
    let next = item("tray-next", "Next Episode", false)?;
    let stop = item("pb-stop", "Stop", false)?;
    let show = item("tray-show", "Show Orbie", true)?;
    let quit = item("tray-quit", "Quit Orbie", true)?;
    let menu = MenuBuilder::new(app)
        .items(&[&now]).separator()
        .items(&[&toggle, &back, &fwd, &next, &stop]).separator()
        .items(&[&show, &quit])
        .build()?;
    let mut tray = TrayIconBuilder::with_id("ironhide").tooltip("Orbie").menu(&menu).show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
    tray.build(app)?;
    let _ = ITEMS.set(Items { now, toggle, controls: vec![back, fwd, next, stop] });
    Ok(())
}

/// What the in-app player is doing: Some((title, paused)) while it plays, None when it closes.
pub fn now_playing(state: Option<(&str, bool)>) {
    let Some(it) = ITEMS.get() else { return };
    match state {
        Some((title, paused)) => {
            let t: String = if title.chars().count() > 48 { format!("{}…", title.chars().take(47).collect::<String>()) } else { title.to_string() };
            let _ = it.now.set_text(format!("{} {}", if paused { "⏸" } else { "▶" }, if t.is_empty() { "Playing".into() } else { t }));
            let _ = it.toggle.set_text(if paused { "Play" } else { "Pause" });
            let _ = it.toggle.set_enabled(true);
            for c in &it.controls { let _ = c.set_enabled(true); }
        }
        None => {
            let _ = it.now.set_text("Nothing playing");
            let _ = it.toggle.set_text("Pause");
            let _ = it.toggle.set_enabled(false);
            for c in &it.controls { let _ = c.set_enabled(false); }
        }
    }
}
