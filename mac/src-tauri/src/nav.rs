// Back and forward through the app's pages the usual Mac ways: a three-finger swipe on the trackpad (macOS sends it as
// a swipe event), a two-finger swipe (WebKit's own gesture, with the page sliding along), the back/forward buttons on
// a mouse (buttons 4 and 5), and Go > Back / Forward (Cmd+[ and Cmd+]). All of it is off while the video player is open, so a swipe never leaves the film.

use std::sync::atomic::{AtomicBool, Ordering};

use block2::RcBlock;
use objc2::{msg_send, runtime::AnyObject};
use tauri::{AppHandle, Manager};

static PLAYING: AtomicBool = AtomicBool::new(false);

// NSEventTypeOtherMouseUp (buttons beyond left and right) and NSEventTypeSwipe (three-finger swipe)
const OTHER_MOUSE_UP: usize = 26;
const SWIPE: usize = 31;

/// Main thread, once, after the window is built.
pub fn setup(app: &AppHandle) {
    gestures(app, true);
    let app = app.clone();
    let block = RcBlock::new(move |ev: *mut AnyObject| -> *mut AnyObject {
        if ev.is_null() { return ev; }
        let kind: usize = unsafe { msg_send![ev, type] };
        let step = if kind == SWIPE {
            // fingers moving right (deltaX +1) goes back, like Safari
            let dx: f64 = unsafe { msg_send![ev, deltaX] };
            if dx > 0.0 { "back" } else if dx < 0.0 { "forward" } else { return ev }
        } else {
            let button: isize = unsafe { msg_send![ev, buttonNumber] };
            // 3 and 4 are the side buttons (counting from 0: left, right, middle)
            match button { 3 => "back", 4 => "forward", _ => return ev }
        };
        if PLAYING.load(Ordering::Relaxed) { return ev; }
        go(&app, step);
        std::ptr::null_mut() // handled: WebKit doesn't also see it
    });
    unsafe {
        let monitor: *mut AnyObject = msg_send![objc2::class!(NSEvent), addLocalMonitorForEventsMatchingMask: (1u64 << OTHER_MOUSE_UP) | (1u64 << SWIPE), handler: &*block];
        // kept for the life of the app
        if !monitor.is_null() { let _: *mut AnyObject = msg_send![monitor, retain]; }
    }
    std::mem::forget(block);
}

/// "back" or "forward", only within the app's own pages (never back to the start-up screen).
pub fn go(app: &AppHandle, step: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("if(location.protocol==='http:'&&!document.documentElement.classList.contains('ihp-on'))history.{step}()"));
    }
}

/// The player opened or closed: swipes navigate only when it's closed.
pub fn player_open(app: &AppHandle, open: bool) {
    PLAYING.store(open, Ordering::Relaxed);
    let a = app.clone();
    let _ = app.run_on_main_thread(move || gestures(&a, !open));
}

fn gestures(app: &AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.with_webview(move |wv| unsafe {
            let view: *mut AnyObject = wv.inner().cast();
            let _: () = msg_send![view, setAllowsBackForwardNavigationGestures: on];
        });
    }
}
