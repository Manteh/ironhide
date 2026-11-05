// In-window mpv: libmpv renders with OpenGL into a native view that sits on top of the web UI.
// The daemon hands playback over through /tmp/ironhide-app.sock (one JSON line per play).
// The same mpv options, progress script and IPC socket are used as for the external mpv,
// so the web UI, MCP tools and watch history keep working unchanged.

use std::{
    ffi::{c_char, c_void, CString},
    io::{BufRead, BufReader, Write},
    os::unix::net::{UnixListener, UnixStream},
    sync::{
        atomic::{AtomicI32, AtomicUsize, Ordering},
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
    Redraw,
    Cmd(Vec<String>),
    Stop,
}

// state shared between the main thread (view events) and the playback thread
static TX: Mutex<Option<Sender<Msg>>> = Mutex::new(None);
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
        send(Msg::Redraw);
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
    content.addSubview(&view);
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
            if let Some(w) = view.window() { w.makeFirstResponder(Some(view)); }
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

/// One playback: owns the mpv core and the render loop until the file ends or is stopped.
fn play(app: &AppHandle, req: PlayReq, rx: Receiver<Msg>) -> Result<(), String> {
    for (k, v) in &req.env {
        std::env::set_var(k, v);
    }
    let args = req.args.clone();
    let mpv = Mpv::with_initializer(|i| {
        i.set_option("vo", "libmpv")?;
        i.set_option("hwdec", "videotoolbox")?;
        i.set_option("osc", "yes")?;
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
    let gl: &NSOpenGLContext = unsafe { &*(ctx_ptr as *const NSOpenGLContext) };
    gl.makeCurrentContext();

    let mut rc: RenderContext<'_> = mpv.create_render_context(vec![RenderParam::ApiType(RenderParamApiType::OpenGl), RenderParam::InitParams(OpenGLInitParams { get_proc_address: gl_proc, ctx: () })]).map_err(|e| format!("render: {e}"))?;
    let tx = TX.lock().unwrap().clone();
    if let Some(tx) = tx {
        rc.set_update_callback(move || { let _ = tx.send(Msg::Redraw); });
    }
    let events = mpv.create_client(None).map_err(|e| e.to_string())?;
    mpv.command("loadfile", &[&req.url, "replace"]).map_err(|e| format!("loadfile: {e}"))?;

    let mut shown = false;
    'run: loop {
        match rx.recv_timeout(Duration::from_millis(30)) {
            Ok(Msg::Redraw) | Err(RecvTimeoutError::Timeout) => {
                let (w, h) = (PX_W.load(Ordering::Relaxed), PX_H.load(Ordering::Relaxed));
                if w > 0 && h > 0 {
                    gl.makeCurrentContext();
                    if rc.render::<()>(0, w, h, true).is_ok() {
                        gl.flushBuffer();
                        rc.report_swap();
                    }
                }
            }
            Ok(Msg::Cmd(c)) => {
                let (name, rest) = c.split_first().ok_or("empty")?;
                let rest: Vec<&str> = rest.iter().map(|s| s.as_str()).collect();
                let _ = mpv.command(name, &rest);
            }
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => { let _ = mpv.command("quit", &[]); break 'run; }
        }
        if !shown && mpv.get_property::<bool>("pause") == Ok(false) && mpv.get_property::<f64>("duration").unwrap_or(0.0) > 0.0 {
            shown = true;
            show(app, true);
        }
        while let Some(ev) = events.wait_event(0.0) {
            match ev {
                Ok(Event::EndFile(_)) | Ok(Event::Shutdown) => break 'run,
                Err(_) => break 'run,
                _ => {}
            }
        }
    }
    drop(rc);
    Ok(())
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

/// Listen for play requests from the daemon.
pub fn serve(app: AppHandle) {
    let _ = std::fs::remove_file(APP_SOCK);
    let Ok(l) = UnixListener::bind(APP_SOCK) else { eprintln!("player: cannot listen on {APP_SOCK}"); return };
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
}

pub fn cleanup() {
    let _ = std::fs::remove_file(APP_SOCK);
}

#[allow(dead_code)]
fn _unused(_: *mut AnyObject, _: NSPoint) {}
