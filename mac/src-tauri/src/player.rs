// In-window mpv: libmpv renders with OpenGL into a native view that sits on top of the web UI.
// The daemon hands playback over through /tmp/ironhide-app.sock (one JSON line per play).
// The same mpv options, progress script and IPC socket are used as for the external mpv,
// so the web UI, MCP tools and watch history keep working unchanged.

use std::{
    ffi::{c_char, c_void, CString},
    io::{BufRead, BufReader, Write},
    os::unix::net::{UnixListener, UnixStream},
    sync::{
        atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering},
        mpsc::{channel, Receiver, RecvTimeoutError, Sender},
        Mutex,
    },
    thread,
    time::Duration,
};

use libmpv2::{
    events::Event,
    render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType},
    Mpv,
};
use objc2::{define_class, msg_send, rc::Retained, runtime::AnyObject, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSOpenGLContext, NSOpenGLPixelFormat, NSView, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::{AppHandle, Manager};

#[link(name = "OpenGL", kind = "framework")]
extern "C" {}
extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

pub const APP_SOCK: &str = "/tmp/ironhide-app.sock";

enum Msg {
    Cmd(Vec<String>),
    Stop,
}

// state shared between the main thread (view events) and the playback thread
static TX: Mutex<Option<Sender<Msg>>> = Mutex::new(None);
static RDX: Mutex<Option<Sender<()>>> = Mutex::new(None); // wakes the render thread (resize, new frame)
static PIP: AtomicI32 = AtomicI32::new(0);
fn redraw() { if let Some(t) = RDX.lock().unwrap().as_ref() { let _ = t.send(()); } }
static VIEW: AtomicUsize = AtomicUsize::new(0); // *NSView
static CTX: AtomicUsize = AtomicUsize::new(0); // *NSOpenGLContext
static PX_W: AtomicI32 = AtomicI32::new(0);
static PX_H: AtomicI32 = AtomicI32::new(0);

fn send(m: Msg) {
    if let Some(tx) = TX.lock().unwrap().as_ref() {
        let _ = tx.send(m);
    }
}
fn cmd(parts: &[&str]) {
    send(Msg::Cmd(parts.iter().map(|s| s.to_string()).collect()));
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "IHVideoView"]
    #[ivars = ()]
    struct VideoView;

    impl VideoView {
        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool { true }

        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool { true } // y grows downwards, like mpv

        #[unsafe(method(setFrameSize:))]
        fn set_frame_size(&self, size: NSSize) {
            let _: () = unsafe { msg_send![super(self), setFrameSize: size] };
            self.sync_size();
        }

        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, e: &NSEvent) { self.pointer(e); }
        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, e: &NSEvent) { self.pointer(e); }
        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, e: &NSEvent) {
            self.pointer(e);
            if e.clickCount() >= 2 { toggle_fullscreen(self); } else { cmd(&["keydown", "MBTN_LEFT"]); }
        }
        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, _e: &NSEvent) { cmd(&["keyup", "MBTN_LEFT"]); }
        #[unsafe(method(rightMouseDown:))]
        fn right_down(&self, _e: &NSEvent) { cmd(&["keypress", "MBTN_RIGHT"]); }
        #[unsafe(method(scrollWheel:))]
        fn scroll_wheel(&self, e: &NSEvent) {
            let dy = e.scrollingDeltaY();
            if dy > 0.5 { cmd(&["keypress", "WHEEL_UP"]); } else if dy < -0.5 { cmd(&["keypress", "WHEEL_DOWN"]); }
        }

        #[unsafe(method(keyDown:))]
        fn key_down(&self, e: &NSEvent) {
            let mods = e.modifierFlags();
            if mods.contains(NSEventModifierFlags::Command) { return; } // menu shortcuts
            let name: Option<String> = match e.keyCode() {
                49 => Some("SPACE".into()), 123 => Some("LEFT".into()), 124 => Some("RIGHT".into()),
                125 => Some("DOWN".into()), 126 => Some("UP".into()), 36 | 76 => Some("ENTER".into()),
                51 => Some("BS".into()), 48 => Some("TAB".into()),
                53 => { // Esc: leave full screen first, then close the player
                    if is_fullscreen(self) { toggle_fullscreen(self); } else { send(Msg::Stop); }
                    return;
                }
                _ => e.characters().map(|s| s.to_string()).filter(|s| !s.is_empty()),
            };
            let Some(mut k) = name else { return };
            match k.as_str() {
                "f" => { toggle_fullscreen(self); return; }
                "q" | "Q" => { send(Msg::Stop); return; }
                _ => {}
            }
            let special = k.len() > 1;
            if special && mods.contains(NSEventModifierFlags::Shift) { k = format!("Shift+{k}"); }
            if mods.contains(NSEventModifierFlags::Control) { k = format!("Ctrl+{k}"); }
            if mods.contains(NSEventModifierFlags::Option) { k = format!("Alt+{k}"); }
            send(Msg::Cmd(vec!["keypress".into(), k]));
        }
    }
);

impl VideoView {
    fn new(mtm: MainThreadMarker, frame: NSRect) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(());
        unsafe { msg_send![super(this), initWithFrame: frame] }
    }
    fn scale(&self) -> f64 {
        self.window().map(|w| w.backingScaleFactor()).unwrap_or(2.0)
    }
    fn sync_size(&self) {
        let b = self.bounds();
        let s = self.scale();
        PX_W.store((b.size.width * s) as i32, Ordering::Relaxed);
        PX_H.store((b.size.height * s) as i32, Ordering::Relaxed);
        let c = CTX.load(Ordering::Relaxed);
        if c != 0 {
            let ctx: &NSOpenGLContext = unsafe { &*(c as *const NSOpenGLContext) };
            ctx.update(MainThreadMarker::new().unwrap());
        }
        redraw();
    }
    fn pointer(&self, e: &NSEvent) {
        let p = self.convertPoint_fromView(e.locationInWindow(), None);
        let s = self.scale();
        send(Msg::Cmd(vec!["mouse".into(), ((p.x * s) as i64).to_string(), ((p.y * s) as i64).to_string()]));
    }
}

fn is_fullscreen(v: &VideoView) -> bool {
    v.window().map(|w| w.styleMask().0 & (1 << 14) != 0).unwrap_or(false) // NSWindowStyleMaskFullScreen
}
fn toggle_fullscreen(v: &VideoView) {
    if let Some(w) = v.window() {
        w.toggleFullScreen(None);
    }
}

/// Build the video view (hidden) and its OpenGL context. Runs on the main thread, once.
pub fn setup(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(nsw) = win.ns_window() else { return };
    let Some(mtm) = MainThreadMarker::new() else { return };
    let nswin: &NSWindow = unsafe { &*(nsw as *const NSWindow) };
    let Some(content) = nswin.contentView() else { return };
    let view = VideoView::new(mtm, content.bounds());
    view.setAutoresizingMask(objc2_app_kit::NSAutoresizingMaskOptions::ViewWidthSizable | objc2_app_kit::NSAutoresizingMaskOptions::ViewHeightSizable);
    let _: () = unsafe { msg_send![&*view, setWantsBestResolutionOpenGLSurface: true] };
    view.setHidden(true);
    // below the web view: the web view turns transparent while playing and draws the player controls on top
    content.addSubview_positioned_relativeTo(&view, objc2_app_kit::NSWindowOrderingMode::Below, None);
    // 3.2 core profile, double buffered (what libmpv's OpenGL renderer needs on macOS)
    let attrs: [u32; 8] = [99, 0x3200, 5, 73, 8, 24, 0, 0];
    let fmt = unsafe { NSOpenGLPixelFormat::initWithAttributes(mtm.alloc::<NSOpenGLPixelFormat>(), std::ptr::NonNull::new(attrs.as_ptr().cast_mut()).unwrap()) };
    let Some(fmt) = fmt else { eprintln!("player: no OpenGL pixel format"); return };
    let Some(ctx) = NSOpenGLContext::initWithFormat_shareContext(mtm.alloc::<NSOpenGLContext>(), &fmt, None) else { return };
    VIEW.store(Retained::into_raw(view) as usize, Ordering::Relaxed);
    CTX.store(Retained::into_raw(ctx) as usize, Ordering::Relaxed);
    nswin.setAcceptsMouseMovedEvents(true);
}

fn on_main(app: &AppHandle, f: impl FnOnce() + Send + 'static) {
    let _ = app.run_on_main_thread(f);
}

fn show(app: &AppHandle, visible: bool) {
    let app2 = app.clone();
    on_main(app, move || {
        let v = VIEW.load(Ordering::Relaxed);
        let c = CTX.load(Ordering::Relaxed);
        if v == 0 || c == 0 { return; }
        let view: &VideoView = unsafe { &*(v as *const VideoView) };
        let ctx: &NSOpenGLContext = unsafe { &*(c as *const NSOpenGLContext) };
        if visible {
            view.setHidden(false);
            unsafe { ctx.setView(Some(view), MainThreadMarker::new().unwrap()) };
            view.sync_size();
        } else {
            ctx.clearDrawable();
            view.setHidden(true);
            if let Some(w) = app2.get_webview_window("main") { let _ = w.set_focus(); }
        }
    });
}

fn gl_proc(_: &(), name: &str) -> *mut c_void {
    let Ok(c) = CString::new(name) else { return std::ptr::null_mut() };
    unsafe { dlsym(-2isize as *mut c_void, c.as_ptr()) } // RTLD_DEFAULT
}

struct PlayReq {
    url: String,
    args: Vec<String>,
    env: Vec<(String, String)>,
}

fn parse_req(line: &str) -> Option<PlayReq> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let strs = |k: &str| -> Vec<String> {
        v[k].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
    };
    let env = v["env"].as_object().map(|o| o.iter().filter_map(|(k, x)| x.as_str().map(|s| (k.clone(), s.to_string()))).collect()).unwrap_or_default();
    Some(PlayReq { url: v["url"].as_str()?.to_string(), args: strs("args"), env })
}

/// mpv's client handles are thread-safe; the Rust wrapper just does not say so.
struct Sh<T>(T);
unsafe impl<T> Send for Sh<T> {}
unsafe impl<T> Sync for Sh<T> {}

/// One playback. Three threads, so nothing can stall drawing:
///   render:  only draws frames (waits for "new frame" or a resize, then renders and flips)
///   state:   reads mpv's properties on its own client handle and pushes only what changed to the page
///   control: this thread, applies slider/keyboard commands and watches for the end of the file
fn play(app: &AppHandle, req: PlayReq, rx: Receiver<Msg>) -> Result<(), String> {
    for (k, v) in &req.env {
        std::env::set_var(k, v);
    }
    let args = req.args.clone();
    let mpv = Mpv::with_initializer(|i| {
        i.set_option("vo", "libmpv")?;
        i.set_option("hwdec", "videotoolbox")?;
        i.set_option("osc", "no")?;
        i.set_option("osd-level", "0")?;
        i.set_option("volume-max", "150")?;
        i.set_option("screenshot-directory", "~/Pictures")?;
        i.set_option("screenshot-template", "IronHide %F %P")?;
        i.set_option("input-default-bindings", "yes")?;
        i.set_option("input-vo-keyboard", "yes")?;
        i.set_option("keep-open", "no")?;
        for a in &args {
            let a = a.trim_start_matches("--");
            let (k, v) = a.split_once('=').unwrap_or((a, "yes"));
            let k = match k {
                "really-quiet" | "fullscreen" => continue, // the app window decides
                "script" => "scripts-append",
                "sub-file" => "sub-files-append",
                k => k,
            };
            let _ = i.set_option(k, v);
        }
        Ok(())
    })
    .map_err(|e| format!("mpv init: {e}"))?;
    let ctx_ptr = CTX.load(Ordering::Relaxed);
    if ctx_ptr == 0 { return Err("no video view".into()); }

    let mpv = Sh(mpv);
    let stop = AtomicBool::new(false);
    let (rdx_tx, rdx_rx) = channel::<()>();
    *RDX.lock().unwrap() = Some(rdx_tx.clone());
    let (ready_tx, ready_rx) = channel::<Result<(), String>>();
    let mut result: Result<(), String> = Ok(());

    thread::scope(|sc| {
        // ---- render thread ----
        let (mpv_r, stop_r, wake) = (&mpv, &stop, rdx_tx.clone());
        sc.spawn(move || {
            let gl: &NSOpenGLContext = unsafe { &*(ctx_ptr as *const NSOpenGLContext) };
            gl.makeCurrentContext();
            let mut rc: RenderContext<'_> = match mpv_r.0.create_render_context(vec![
                RenderParam::ApiType(RenderParamApiType::OpenGl),
                RenderParam::InitParams(OpenGLInitParams { get_proc_address: gl_proc, ctx: () }),
            ]) {
                Ok(r) => r,
                Err(e) => { let _ = ready_tx.send(Err(format!("render: {e}"))); return; }
            };
            rc.set_update_callback(move || { let _ = wake.send(()); });
            let _ = ready_tx.send(Ok(()));
            while !stop_r.load(Ordering::Relaxed) {
                match rdx_rx.recv_timeout(Duration::from_millis(33)) {
                    Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                while rdx_rx.try_recv().is_ok() {} // coalesce
                let (w, h) = (PX_W.load(Ordering::Relaxed), PX_H.load(Ordering::Relaxed));
                if w > 0 && h > 0 {
                    gl.makeCurrentContext();
                    if rc.render::<()>(0, w, h, true).is_ok() {
                        gl.flushBuffer();
                        rc.report_swap();
                    }
                }
            }
        });

        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => { result = Err(e); stop.store(true, Ordering::Relaxed); return; }
            Err(_) => { result = Err("render thread died".into()); stop.store(true, Ordering::Relaxed); return; }
        }
        if let Err(e) = mpv.0.command("loadfile", &[&req.url, "replace"]) { result = Err(format!("loadfile: {e}")); stop.store(true, Ordering::Relaxed); return; }

        // ---- state thread: own client handle, change-only pushes ----
        let poll_client = mpv.0.create_client(None).map(Sh);
        if let Ok(pc) = poll_client {
            let (stop, app) = (&stop, app.clone());
            sc.spawn(move || {
                let pc = pc;
                let mut last: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
                let (mut shown, mut tick) = (false, 0u32);
                while !stop.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(120));
                    if !shown && pc.0.get_property::<String>("pause").as_deref() == Ok("no") && pc.0.get_property::<f64>("duration").unwrap_or(0.0) > 0.0 {
                        shown = true;
                        show(&app, true);
                        js(&app, "window.__ihp && window.__ihp.open()");
                    }
                    if !shown { continue; }
                    let full = tick % 8 == 0; tick += 1;
                    let mut diff = serde_json::Map::new();
                    for p in PROPS {
                        let Ok(v) = pc.0.get_property::<String>(p) else { continue };
                        let slow = matches!(*p, "time-pos" | "demuxer-cache-time"); // the page interpolates these
                        let changed = match last.get(p) {
                            None => true,
                            Some(old) if slow => (old.parse::<f64>().unwrap_or(0.0) - v.parse::<f64>().unwrap_or(0.0)).abs() >= 1.0,
                            Some(old) => *old != v,
                        };
                        if changed { last.insert(p, v.clone()); diff.insert((*p).to_string(), serde_json::Value::String(v)); }
                    }
                    if full {
                        for p in ["track-list", "chapter-list"] {
                            if let Ok(v) = pc.0.get_property::<String>(p) {
                                if last.get(p) != Some(&v) {
                                    if let Ok(j) = serde_json::from_str::<serde_json::Value>(&v) { diff.insert(p.to_string(), j); }
                                    last.insert(if p == "track-list" { "track-list" } else { "chapter-list" }, v);
                                }
                            }
                        }
                    }
                    if !diff.is_empty() { js(&app, &format!("window.__ihp && window.__ihp.state({})", serde_json::Value::Object(diff))); }
                }
            });
        }

        // ---- control thread (this one) ----
        let events = match mpv.0.create_client(None) { Ok(e) => Sh(e), Err(e) => { result = Err(e.to_string()); stop.store(true, Ordering::Relaxed); return; } };
        'run: loop {
            match rx.recv_timeout(Duration::from_millis(40)) {
                Ok(Msg::Cmd(c)) => {
                    if let Some((name, rest)) = c.split_first() {
                        let rest: Vec<&str> = rest.iter().map(|s| s.as_str()).collect();
                        let _ = mpv.0.command(name, &rest);
                    }
                }
                Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => { let _ = mpv.0.command("quit", &[]); break 'run; }
                Err(RecvTimeoutError::Timeout) => {}
            }
            while let Some(ev) = events.0.wait_event(0.0) {
                match ev {
                    Ok(Event::EndFile(_)) | Ok(Event::Shutdown) => break 'run,
                    Err(_) => break 'run,
                    _ => {}
                }
            }
        }
        stop.store(true, Ordering::Relaxed);
        redraw();
    });
    *RDX.lock().unwrap() = None;
    js(app, "window.__ihp && window.__ihp.close()");
    pip_exit(app);
    result
}

fn handle(app: AppHandle, stream: UnixStream, req: PlayReq) {
    let (tx, rx) = channel();
    *TX.lock().unwrap() = Some(tx);
    let mut out = &stream;
    let _ = writeln!(out, "{{\"event\":\"started\"}}");
    let r = play(&app, req, rx);
    if let Err(e) = &r { eprintln!("player: {e}"); }
    *TX.lock().unwrap() = None;
    show(&app, false);
    let _ = writeln!(out, "{{\"event\":\"exit\"{}}}", r.err().map(|e| format!(",\"error\":{:?}", e)).unwrap_or_default());
}

static OUR_INO: AtomicUsize = AtomicUsize::new(0);

fn ino() -> usize {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(APP_SOCK).map(|m| m.ino() as usize).unwrap_or(0)
}

fn bind_and_accept(app: AppHandle) -> bool {
    let _ = std::fs::remove_file(APP_SOCK);
    let Ok(l) = UnixListener::bind(APP_SOCK) else { eprintln!("player: cannot listen on {APP_SOCK}"); return false };
    OUR_INO.store(ino(), Ordering::Relaxed);
    thread::spawn(move || {
        for s in l.incoming().flatten() {
            let app = app.clone();
            // one playback at a time: a new request waits for the current one to end
            static BUSY: Mutex<()> = Mutex::new(());
            thread::spawn(move || {
                // read the request first, so a bare connection (the daemon checking we are here) costs nothing
                let mut line = String::new();
                if BufReader::new(&s).read_line(&mut line).unwrap_or(0) == 0 { return; }
                let Some(req) = parse_req(&line) else { return };
                let _g = BUSY.lock().unwrap();
                handle(app, s, req);
            });
        }
    });
    true
}

/// Listen for play requests from the daemon. A watchdog re-creates the socket if another process removed it.
pub fn serve(app: AppHandle) {
    bind_and_accept(app.clone());
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        if ino() != OUR_INO.load(Ordering::Relaxed) { bind_and_accept(app.clone()); }
    });
}

/// Remove the socket on exit, but only if it is still ours (another app instance may own it now).
pub fn cleanup() {
    if ino() == OUR_INO.load(Ordering::Relaxed) { let _ = std::fs::remove_file(APP_SOCK); }
}

#[allow(dead_code)]
fn _unused(_: *mut AnyObject, _: NSPoint) {}


// ---- commands the web player calls (window.__TAURI_INTERNALS__.invoke) ----
#[tauri::command]
pub fn player_cmd(args: Vec<String>) { send(Msg::Cmd(args)); }
#[tauri::command]
pub fn player_set(name: String, value: String) { send(Msg::Cmd(vec!["set".into(), name, value])); }
#[tauri::command]
pub fn player_close() { send(Msg::Stop); }
#[tauri::command]
pub fn player_fullscreen(window: tauri::WebviewWindow) {
    let f = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!f);
}

fn js(app: &AppHandle, code: &str) {
    if let Some(w) = app.get_webview_window("main") { let _ = w.eval(code); }
}

const PROPS: &[&str] = &[
    "pause", "time-pos", "duration", "volume", "mute", "speed", "media-title", "demuxer-cache-time", "paused-for-cache",
    "contrast", "brightness", "gamma", "saturation", "hue", "sub-delay", "audio-delay", "sub-scale", "sub-pos",
    "panscan", "video-aspect-override", "deband", "interpolation", "tone-mapping", "hwdec-current", "width", "height", "sid", "aid",
];



// ---- picture in picture: the same window, shrunk and floated above everything ----
static PIP_SAVED: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>> = Mutex::new(None);

fn pip_enter(win: &tauri::WebviewWindow) {
    if PIP.swap(1, Ordering::Relaxed) == 1 { return; }
    if win.is_fullscreen().unwrap_or(false) { let _ = win.set_fullscreen(false); thread::sleep(Duration::from_millis(900)); }
    if let (Ok(p), Ok(sz)) = (win.outer_position(), win.outer_size()) { *PIP_SAVED.lock().unwrap() = Some((p, sz)); }
    let _ = win.set_min_size(None::<tauri::LogicalSize<f64>>);
    let _ = win.set_always_on_top(true);
    let _ = win.set_visible_on_all_workspaces(true);
    let _ = win.set_size(tauri::LogicalSize::new(440.0, 270.0));
    if let Ok(Some(m)) = win.current_monitor() {
        let sc = m.scale_factor();
        let (mx, my, mw, mh) = (m.position().x, m.position().y, m.size().width as i32, m.size().height as i32);
        let (w, h) = ((440.0 * sc) as i32, (270.0 * sc) as i32);
        let _ = win.set_position(tauri::PhysicalPosition::new(mx + mw - w - (24.0 * sc) as i32, my + mh - h - (60.0 * sc) as i32));
    }
    let _ = win.eval("window.__ihp && window.__ihp.pip(true)");
}

fn pip_leave(win: &tauri::WebviewWindow) {
    if PIP.swap(0, Ordering::Relaxed) == 0 { return; }
    let _ = win.set_always_on_top(false);
    let _ = win.set_visible_on_all_workspaces(false);
    let _ = win.set_min_size(Some(tauri::LogicalSize::new(960.0, 600.0)));
    if let Some((p, sz)) = PIP_SAVED.lock().unwrap().take() { let _ = win.set_size(sz); let _ = win.set_position(p); }
    let _ = win.eval("window.__ihp && window.__ihp.pip(false)");
}

fn pip_exit(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") { pip_leave(&w); }
}

#[tauri::command]
pub fn player_pip(window: tauri::WebviewWindow) {
    if PIP.load(Ordering::Relaxed) == 1 { pip_leave(&window); } else { pip_enter(&window); }
}
