// In-window mpv: libmpv renders with OpenGL into a native view that sits on top of the web UI.
// The daemon hands playback over through /tmp/ironhide-app.sock (one JSON line per play).
// The same mpv options, progress script and IPC socket are used as for the external mpv,
// so the web UI, MCP tools and watch history keep working unchanged.

use std::{
    ffi::{c_char, c_void, CString},
    path::Path,
    io::{BufRead, BufReader, Write},
    os::unix::net::{UnixListener, UnixStream},
    sync::{
        atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering},
        mpsc::{channel, Receiver, RecvTimeoutError, Sender},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use libmpv2::{
    events::{Event, PropertyData},
    render::{OpenGLInitParams, RenderContext, RenderParam, RenderParamApiType},
    Format, Mpv,
};
use objc2::{define_class, msg_send, rc::Retained, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSEvent, NSOpenGLContext, NSOpenGLPixelFormat, NSView, NSWindow};
use objc2_foundation::{NSRect, NSSize};

use crate::nowplaying;
use tauri::{AppHandle, Manager};

#[link(name = "OpenGL", kind = "framework")]
extern "C" {}
extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

// Keep the display (and the Mac) awake while a video is open. libmpv's render API does not do this
// for an embedding app, so without it macOS dims and sleeps the screen after the idle timeout.
#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPMAssertionCreateWithName(kind: *const c_void, level: u32, name: *const c_void, id: *mut u32) -> i32;
    fn IOPMAssertionRelease(id: u32) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(alloc: *const c_void, s: *const c_char, enc: u32) -> *const c_void;
    fn CFRelease(o: *const c_void);
}
struct AwakeGuard(Vec<u32>);
impl AwakeGuard {
    fn new() -> Self {
        let mut ids = Vec::new();
        unsafe {
            let cf = |s: &str| { let c = CString::new(s).unwrap(); CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), 0x0800_0100) };
            let name = cf("Orbie is playing a video");
            for kind in ["PreventUserIdleDisplaySleep", "PreventUserIdleSystemSleep"] {
                let k = cf(kind);
                let mut id = 0u32;
                if IOPMAssertionCreateWithName(k, 255, name, &mut id) == 0 { ids.push(id); }
                CFRelease(k);
            }
            CFRelease(name);
        }
        AwakeGuard(ids)
    }
}
impl Drop for AwakeGuard {
    fn drop(&mut self) { for id in &self.0 { unsafe { IOPMAssertionRelease(*id); } } }
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
// The GL context may only be drawn into while the view is attached; attach, detach, resize and draw never overlap.
static ATTACHED: AtomicBool = AtomicBool::new(false);
static GL_LOCK: Mutex<()> = Mutex::new(());
// set when the picture must be drawn again even without a new video frame (resize, view attached)
static NEED_DRAW: AtomicBool = AtomicBool::new(false);
fn redraw() { NEED_DRAW.store(true, Ordering::Relaxed); wake(); }
fn wake() { if let Some(t) = RDX.lock().unwrap().as_ref() { let _ = t.send(()); } }
/// Something is playing right now (menus and media keys only act then).
pub fn active() -> bool { TX.lock().unwrap().is_some() }
static VIEW: AtomicUsize = AtomicUsize::new(0); // *NSView
static CTX: AtomicUsize = AtomicUsize::new(0); // *NSOpenGLContext
static PX_W: AtomicI32 = AtomicI32::new(0);
static PX_H: AtomicI32 = AtomicI32::new(0);

fn send(m: Msg) {
    if let Some(tx) = TX.lock().unwrap().as_ref() {
        let _ = tx.send(m);
    }
}
/// A command from the app itself (menus, media keys): trusted, not filtered.
pub fn cmd(parts: &[&str]) {
    send(Msg::Cmd(parts.iter().map(|s| s.to_string()).collect()));
}

// ---- what the page may ask mpv to do ----
// The page is a web page: if anything ever injected script into it, it must not be able to make mpv run programs,
// load scripts or write files. So it gets playback commands only, and properties that change the picture and sound.
fn prop_ok(p: &str) -> bool {
    if p.is_empty() || p.len() > 48 || !p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') { return false; } // also blocks options/..., file-local-options/...
    const EXACT: &[&str] = &["o", "vf", "af", "include", "config", "config-dir", "use-filedir-conf", "log-file", "record-file", "dump-stats", "playlist", "cookies-file", "glsl-shader-opts", "icc-profile", "hwdec-image-format"];
    const PREFIX: &[&str] = &["script", "input-", "load-", "ytdl", "stream-", "demuxer-lavf", "http-", "tls-", "external-file", "audio-file", "sub-file", "vf-", "af-", "lavfi", "watch-later", "screenshot-dir", "screenshot-template", "screenshot-sw", "network-", "cache-dir", "gpu-shader-cache", "icc-cache", "save-position", "resume-playback", "user-agent", "referrer"];
    !EXACT.contains(&p) && !PREFIX.iter().any(|x| p.starts_with(x))
}
fn arg_ok(a: &str) -> bool { a.len() <= 4096 && !a.contains('\0') }
fn page_cmd_ok(args: &[String]) -> bool {
    let Some((name, rest)) = args.split_first() else { return false };
    if !rest.iter().all(|a| arg_ok(a)) { return false; }
    let first = rest.first().map(String::as_str).unwrap_or("");
    match name.as_str() {
        "seek" | "revert-seek" | "frame-step" | "frame-back-step" | "sub-seek" | "sub-step" => rest.len() <= 3,
        "cycle" | "cycle-values" | "add" | "multiply" | "set" => prop_ok(first),
        "change-list" => first == "glsl-shaders" && rest.len() == 3 && !rest[2].contains("://"),
        "screenshot" => matches!(first, "" | "subtitles" | "video" | "window") && rest.len() <= 1,
        "keypress" | "keydown" | "keyup" => rest.len() == 1 && first.len() <= 24,
        _ => false,
    }
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "IHVideoView"]
    #[ivars = ()]
    struct VideoView;

    impl VideoView {
        // the page owns the keyboard (appplayer.js): one place decides what Space, f, Esc and q do
        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool { false }

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
            cmd(&["keydown", "MBTN_LEFT"]);
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
        if c != 0 && ATTACHED.load(Ordering::Relaxed) {
            let _g = GL_LOCK.lock().unwrap();
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
    // vsync: flip once per display refresh (without it frames tear and pacing jitters)
    let one: i32 = 1;
    let _: () = unsafe { msg_send![&*ctx, setValues: &one as *const i32, forParameter: 222isize] }; // NSOpenGLContextParameterSwapInterval
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
            {
                let _g = GL_LOCK.lock().unwrap();
                unsafe { ctx.setView(Some(view), MainThreadMarker::new().unwrap()) };
                ATTACHED.store(true, Ordering::Relaxed);
            }
            view.sync_size();
        } else {
            {
                let _g = GL_LOCK.lock().unwrap();
                ATTACHED.store(false, Ordering::Relaxed);
                ctx.clearDrawable();
            }
            view.setHidden(true);
            if let Some(w) = app2.get_webview_window("main") { let _ = w.set_focus(); }
        }
    });
}

// ---- ambient light: a tiny copy of what's on screen, for the glow around the picture (appplayer.js draws it) ----
// After each frame (at most ~20 times a second) the screen is scaled down on the GPU to 160x88, read back (56 KB),
// averaged to 40x22 and sent to the page as hex. Off unless the page turns it on.
static AMBI: AtomicBool = AtomicBool::new(false);
// the part of the screen the picture covers (x, y, w, h as fractions, top-left origin): only that is sampled,
// so a small picture still gets a detailed sample
static AMB_RECT: Mutex<[f64; 4]> = Mutex::new([0.0, 0.0, 1.0, 1.0]);
const AW: i32 = 160;
const AH: i32 = 88;
type GenF = unsafe extern "C" fn(i32, *mut u32);
type BindF = unsafe extern "C" fn(u32, u32);
type RbStoreF = unsafe extern "C" fn(u32, u32, i32, i32);
type FbRbF = unsafe extern "C" fn(u32, u32, u32, u32);
type BlitF = unsafe extern "C" fn(i32, i32, i32, i32, i32, i32, i32, i32, u32, u32);
type ReadF = unsafe extern "C" fn(i32, i32, i32, i32, u32, u32, *mut c_void);
type DelF = unsafe extern "C" fn(i32, *const u32);
type BufDataF = unsafe extern "C" fn(u32, isize, *const c_void, u32);
type MapF = unsafe extern "C" fn(u32, u32) -> *mut c_void;
type UnmapF = unsafe extern "C" fn(u32) -> u8;
// Two pixel buffers, used in turn: the GPU copies this sample into one in the background while we read the previous
// sample from the other. No stall waiting for the GPU (one sample, ~50 ms, of delay instead).
struct Ambient { pbo: [u32; 2], turn: usize, filled: bool, gen_buf: GenF, bind_buf: BindF, buf_data: BufDataF, map: MapF, unmap: UnmapF, del_buf: DelF, fbo: u32, rb: u32, gen_fb: GenF, gen_rb: GenF, bind_fb: BindF, bind_rb: BindF, store: RbStoreF, attach: FbRbF, blit: BlitF, read: ReadF, del_fb: DelF, del_rb: DelF, buf: Vec<u8> }
impl Ambient {
    fn new() -> Option<Self> {
        unsafe fn f<T>(name: &str) -> Option<T> {
            let p = gl_proc(&(), name);
            if p.is_null() { None } else { Some(std::mem::transmute_copy::<*mut c_void, T>(&p)) }
        }
        unsafe {
            Some(Ambient { pbo: [0, 0], turn: 0, filled: false, gen_buf: f("glGenBuffers")?, bind_buf: f("glBindBuffer")?, buf_data: f("glBufferData")?,
                map: f("glMapBuffer")?, unmap: f("glUnmapBuffer")?, del_buf: f("glDeleteBuffers")?, fbo: 0, rb: 0, gen_fb: f("glGenFramebuffers")?, gen_rb: f("glGenRenderbuffers")?, bind_fb: f("glBindFramebuffer")?, bind_rb: f("glBindRenderbuffer")?,
                store: f("glRenderbufferStorage")?, attach: f("glFramebufferRenderbuffer")?, blit: f("glBlitFramebuffer")?, read: f("glReadPixels")?,
                del_fb: f("glDeleteFramebuffers")?, del_rb: f("glDeleteRenderbuffers")?, buf: vec![0; (AW * AH * 4) as usize] })
        }
    }
    /// Scale the picture just drawn (part of the back buffer, w x h) down and return 40x22 RGB as hex, top row first,
    /// plus the black bars inside the film (letterbox) at the top and bottom, as fractions of the picture's height.
    fn sample(&mut self, w: i32, h: i32) -> Option<(String, f64, f64)> {
        const PACK: u32 = 0x88EB; // GL_PIXEL_PACK_BUFFER
        const FB: u32 = 0x8D40; const READ: u32 = 0x8CA8; const DRAW: u32 = 0x8CA9; const RB: u32 = 0x8D41;
        unsafe {
            if self.fbo == 0 {
                (self.gen_fb)(1, &mut self.fbo); (self.gen_rb)(1, &mut self.rb);
                (self.bind_rb)(RB, self.rb); (self.store)(RB, 0x8058 /* RGBA8 */, AW, AH);
                (self.bind_fb)(FB, self.fbo); (self.attach)(FB, 0x8CE0 /* COLOR_ATTACHMENT0 */, RB, self.rb);
            }
            (self.bind_fb)(READ, 0); (self.bind_fb)(DRAW, self.fbo);
            let [rx, ry, rw, rh] = *AMB_RECT.lock().unwrap_or_else(|e| e.into_inner());
            let (fw, fh) = (w as f64, h as f64);
            // OpenGL counts rows from the bottom
            let (x0, x1) = ((rx * fw).clamp(0.0, fw) as i32, ((rx + rw) * fw).clamp(0.0, fw) as i32);
            let (y0, y1) = (((1.0 - ry - rh) * fh).clamp(0.0, fh) as i32, ((1.0 - ry) * fh).clamp(0.0, fh) as i32);
            let (x1, y1) = (x1.max(x0 + 1), y1.max(y0 + 1));
            (self.blit)(x0, y0, x1, y1, 0, 0, AW, AH, 0x4000 /* COLOR_BUFFER_BIT */, 0x2601 /* LINEAR */);
            (self.bind_fb)(READ, self.fbo);
            if self.pbo[0] == 0 {
                (self.gen_buf)(2, self.pbo.as_mut_ptr());
                for b in self.pbo { (self.bind_buf)(PACK, b); (self.buf_data)(PACK, (AW * AH * 4) as isize, std::ptr::null(), 0x88E1 /* STREAM_READ */); }
            }
            // start this sample's copy (returns at once), then collect the previous one
            (self.bind_buf)(PACK, self.pbo[self.turn]);
            (self.read)(0, 0, AW, AH, 0x1908 /* RGBA */, 0x1401 /* UNSIGNED_BYTE */, std::ptr::null_mut());
            let prev = self.pbo[1 - self.turn];
            self.turn = 1 - self.turn;
            let had = self.filled;
            self.filled = true;
            let mut got = false;
            if had {
                (self.bind_buf)(PACK, prev);
                let ptr = (self.map)(PACK, 0x88B8 /* READ_ONLY */) as *const u8;
                if !ptr.is_null() { std::ptr::copy_nonoverlapping(ptr, self.buf.as_mut_ptr(), self.buf.len()); got = true; }
                (self.unmap)(PACK);
            }
            (self.bind_buf)(PACK, 0);
            (self.bind_fb)(FB, 0);
            if !got { return None; }
        }
        // letterbox bars: whole rows that are black all the way across, counted at full sample height (88 rows)
        let row_dark = |y: i32| {
            let (mut sum, mut max) = (0u32, 0u32);
            for x in 0..AW { let i = ((y * AW + x) * 4) as usize; let l = (self.buf[i] as u32 * 2 + self.buf[i + 1] as u32 * 5 + self.buf[i + 2] as u32) / 8; sum += l; max = max.max(l); }
            sum / AW as u32 <= 10 && max <= 34
        };
        let limit = AH / 4;
        let mut top = 0; while top < limit && row_dark(AH - 1 - top) { top += 1; } // GL rows: the top is the last row
        let mut bot = 0; while bot < limit && row_dark(bot) { bot += 1; }
        // 4x4 boxes -> 40x22; OpenGL rows start at the bottom
        let (ow, oh) = (AW / 4, AH / 4);
        let mut hex = String::with_capacity((ow * oh * 6) as usize);
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for oy in (0..oh).rev() {
            for ox in 0..ow {
                let mut c = [0u32; 3];
                for dy in 0..4 { for dx in 0..4 {
                    let i = (((oy * 4 + dy) * AW + ox * 4 + dx) * 4) as usize;
                    for k in 0..3 { c[k] += self.buf[i + k] as u32; }
                } }
                for k in 0..3 {
                    let v = (c[k] / 16) as usize;
                    hex.push(HEX[(v >> 4) & 0xf] as char);
                    hex.push(HEX[v & 0xf] as char);
                }
            }
        }
        Some((hex, top as f64 / AH as f64, bot as f64 / AH as f64))
    }
}
impl Drop for Ambient {
    fn drop(&mut self) { unsafe { if self.fbo != 0 { (self.del_fb)(1, &self.fbo); (self.del_rb)(1, &self.rb); } if self.pbo[0] != 0 { (self.del_buf)(2, self.pbo.as_ptr()); } } }
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

/// A play request from the socket. Anything on this Mac can connect to it, so only what the daemon really sends gets through:
/// a web URL, the options below (the progress script, languages, subtitles, title, start time) and the progress file.
fn parse_req(line: &str) -> Option<PlayReq> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let url = v["url"].as_str()?.to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) || !arg_ok(&url) { eprintln!("player: refused a non-web URL"); return None; }
    let mut args = Vec::new();
    for a in v["args"].as_array().into_iter().flatten().filter_map(|x| x.as_str()) {
        let b = a.trim_start_matches("--");
        let (k, val) = b.split_once('=').unwrap_or((b, "yes"));
        let ok = arg_ok(val) && match k {
            "really-quiet" | "pause" | "fullscreen" | "focus-on" | "alang" | "slang" | "sid" | "aid" | "force-media-title" => true,
            "start" => val.parse::<f64>().is_ok(),
            "input-ipc-server" => val == "/tmp/ironhide-mpv.sock",
            "script" => val.ends_with("/mpv-progress.lua") && Path::new(val).is_file(),
            "sub-file" => Path::new(val).is_file() && [".srt", ".vtt", ".ass", ".ssa", ".sub"].iter().any(|x| val.to_lowercase().ends_with(x)),
            _ => false, // cache and network tuning: the app sets its own
        };
        if ok { args.push(a.to_string()); } else { eprintln!("player: ignored option {k}"); }
    }
    let mut env = Vec::new();
    if let Some(p) = v["env"]["IRONHIDE_PROGRESS_FILE"].as_str() {
        let tmp = std::env::var("TMPDIR").unwrap_or_default();
        let in_tmp = p.starts_with("/tmp/") || p.starts_with("/private/tmp/") || (!tmp.is_empty() && p.starts_with(&tmp));
        if in_tmp && p.ends_with(".json") && !p.contains("..") && !p.contains(',') && !p.contains('=') { env.push(("IRONHIDE_PROGRESS_FILE".to_string(), p.to_string())); }
    }
    Some(PlayReq { url, args, env })
}

/// Apply the user's own mpv.conf to the embedded player. Options that describe a standalone window or a different
/// video output (vo, gpu-api, force-window, ...) are skipped: this player draws into the app window.
fn load_user_conf(i: &libmpv2::MpvInitializer) {
    let home = std::env::var("HOME").unwrap_or_default();
    let Ok(text) = std::fs::read_to_string(format!("{home}/.config/mpv/mpv.conf")) else { return };
    const SKIP: &[&str] = &["vo", "gpu-api", "gpu-context", "force-window", "script-opts", "keep-open", "osc", "osd-level", "fullscreen", "geometry", "autofit", "ontop", "input-ipc-server", "window-maximized", "macos-fs-animation-duration", "title", "screenshot-directory"];
    let mut lines: Vec<(String, String)> = Vec::new();
    for l in text.lines() {
        let l = l.split('#').next().unwrap_or("").trim();
        if l.is_empty() { continue; }
        let (k, v) = l.split_once('=').map(|(k, v)| (k.trim(), v.trim())).unwrap_or((l, "yes"));
        if SKIP.contains(&k) { continue; }
        lines.push((k.to_string(), v.trim_matches('"').to_string()));
    }
    // a profile goes first so the lines below can override what it sets
    lines.sort_by_key(|(k, _)| k != "profile");
    for (k, v) in lines { let _ = i.set_option(&k, v.as_str()); }
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
    let progress_file = req.env.iter().find(|(k, _)| k == "IRONHIDE_PROGRESS_FILE").map(|(_, v)| v.clone());
    let args = req.args.clone();
    let _awake = AwakeGuard::new(); // released when playback ends (drop)
    let mpv = Mpv::with_initializer(|i| {
        i.set_option("vo", "libmpv")?;
        i.set_option("hwdec", "videotoolbox")?;
        i.set_option("osc", "no")?;
        i.set_option("osd-level", "0")?;
        i.set_option("volume-max", "150")?;
        i.set_option("screenshot-directory", "~/Pictures")?;
        i.set_option("screenshot-template", "Orbie %F %P")?;
        i.set_option("input-default-bindings", "yes")?;
        i.set_option("input-vo-keyboard", "yes")?;
        i.set_option("keep-open", "no")?;
        i.set_option("hwdec-codecs", "all")?;
        // the progress script reads where to save from here (mpv-progress.lua)
        if let Some(p) = &progress_file { i.set_option("script-opts", format!("ironhide-progress-file={p}").as_str())?; }
        i.set_option("vd-lavc-dr", "yes")?;
        load_user_conf(&i); // your ~/.config/mpv/mpv.conf: scaling, dithering, HDR tone mapping, cache, audio, subtitles
        // Streaming over HTTPS from the debrid CDN: buffer far ahead (capped by bytes), keep a generous back-buffer so seeking
        // back is instant, seek inside what's already buffered without a request, reuse one keep-alive connection for the
        // range requests a seek makes (no new TLS handshake each time), read in bigger chunks, and reconnect if it drops.
        // tuning only: an option this mpv doesn't know is skipped, it never stops playback
        for (k, v) in [
            ("cache", "yes"), ("demuxer-seekable-cache", "yes"), ("demuxer-max-bytes", "1024MiB"), ("demuxer-max-back-bytes", "512MiB"),
            ("demuxer-readahead-secs", "120"), ("cache-secs", "120"), ("cache-pause-wait", "0.6"), ("stream-buffer-size", "4MiB"), ("network-timeout", "30"),
            // one list (the "-append" form only exists on mpv's command line, not for libmpv)
            ("demuxer-lavf-o", "multiple_requests=1,reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=4"),
        ] {
            if let Err(e) = i.set_option(k, v) { eprintln!("player: skipped option {k}: {e:?}"); }
        }
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
    let shown = AtomicBool::new(false); // the first frame is up (the stream really opened)
    let mut user_stop = false;
    let mut load_error: Option<String> = None;
    let (rdx_tx, rdx_rx) = channel::<()>();
    *RDX.lock().unwrap() = Some(rdx_tx.clone());
    let (ready_tx, ready_rx) = channel::<Result<(), String>>();
    let mut result: Result<(), String> = Ok(());

    thread::scope(|sc| {
        // ---- render thread ----
        let (mpv_r, stop_r, wake, app_r) = (&mpv, &stop, rdx_tx.clone(), app.clone());
        sc.spawn(move || {
            let gl: &NSOpenGLContext = unsafe { &*(ctx_ptr as *const NSOpenGLContext) };
            gl.makeCurrentContext();
            let mut amb: Option<Ambient> = None;
            let mut amb_at = Instant::now();
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
                // sleep until mpv says a frame is due or the view changed: nothing is drawn while paused and untouched
                match rdx_rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(()) => {}
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                while rdx_rx.try_recv().is_ok() {} // coalesce
                if stop_r.load(Ordering::Relaxed) { break; }
                let frame = rc.update().map(|f| (f as u64) & 1 != 0).unwrap_or(true); // MPV_RENDER_UPDATE_FRAME
                if !frame && !NEED_DRAW.swap(false, Ordering::Relaxed) { continue; }
                let (w, h) = (PX_W.load(Ordering::Relaxed), PX_H.load(Ordering::Relaxed));
                if w > 0 && h > 0 && ATTACHED.load(Ordering::Relaxed) {
                    let _g = GL_LOCK.lock().unwrap();
                    if ATTACHED.load(Ordering::Relaxed) {
                        gl.makeCurrentContext();
                        if rc.render::<()>(0, w, h, true).is_ok() {
                            if AMBI.load(Ordering::Relaxed) && amb_at.elapsed() >= Duration::from_millis(16) {
                                amb_at = Instant::now();
                                if amb.is_none() { amb = Ambient::new(); }
                                if let Some((hx, bt, bb)) = amb.as_mut().and_then(|a| a.sample(w, h)) { js(&app_r, &format!("window.__ihp&&window.__ihp.amb('{hx}',{},{},{bt:.4},{bb:.4})", AW / 4, AH / 4)); }
                            }
                            gl.flushBuffer();
                            rc.report_swap();
                        }
                    }
                }
            }
            // libmpv2's Drop frees the update callback BEFORE mpv_render_context_free, and that call keeps the
            // vo thread drawing until it lets go of the context, so a late frame would call the freed closure
            // (SIGBUS in the vo thread). Swap in a capture-free closure first: mpv switches callbacks under its
            // update lock, the old one (holding `wake`) is freed safely, and the new one is zero-sized, so the
            // "freed" pointer it leaves behind is still valid to call.
            rc.set_update_callback(|| {});
            drop(rc);
        });

        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => { result = Err(e); stop.store(true, Ordering::Relaxed); return; }
            Err(_) => { result = Err("render thread died".into()); stop.store(true, Ordering::Relaxed); return; }
        }
        if let Err(e) = mpv.0.command("loadfile", &[&req.url, "replace"]) { result = Err(format!("loadfile: {e}")); stop.store(true, Ordering::Relaxed); return; }
        crate::discord::start(); // "Watching ..." on Discord, if turned on
        crate::nav::player_open(app, true); // no swipe-to-go-back over the film

        // ---- state thread: own client handle; mpv tells us what changed, we push it to the page in small batches ----
        let poll_client = mpv.0.create_client(None).map(Sh);
        if let Ok(pc) = poll_client {
            let (stop, app, shown) = (&stop, app.clone(), &shown);
            sc.spawn(move || {
                let pc = pc;
                for (i, p) in PROPS.iter().chain(["track-list", "chapter-list"].iter()).enumerate() {
                    let _ = pc.0.observe_property(p, Format::String, i as u64 + 1);
                }
                let mut last: std::collections::HashMap<String, String> = std::collections::HashMap::new();
                let mut diff = serde_json::Map::new();
                let mut flushed = Instant::now();
                let mut np_dirty = false;
                while !stop.load(Ordering::Relaxed) {
                    match pc.0.wait_event(0.1) {
                        Some(Ok(Event::PropertyChange { name, change, .. })) => {
                            let v = match change { PropertyData::Str(s) | PropertyData::OsdStr(s) => s.to_string(), _ => continue };
                            let slow = matches!(name, "time-pos" | "demuxer-cache-time"); // the page interpolates these
                            let changed = match last.get(name) {
                                None => true,
                                Some(old) if slow => (old.parse::<f64>().unwrap_or(0.0) - v.parse::<f64>().unwrap_or(0.0)).abs() >= 1.0,
                                Some(old) => *old != v,
                            };
                            if !changed { continue; }
                            if matches!(name, "pause" | "media-title" | "duration") { np_dirty = true; }
                            let json = if matches!(name, "track-list" | "chapter-list") { serde_json::from_str(&v).unwrap_or(serde_json::Value::Null) } else { serde_json::Value::String(v.clone()) };
                            diff.insert(name.to_string(), json);
                            last.insert(name.to_string(), v);
                        }
                        Some(Ok(Event::PlaybackRestart)) => np_dirty = true, // after a seek: Control Center shows the new position
                        Some(Ok(Event::Shutdown)) => break,
                        _ => {}
                    }
                    let num = |k: &str| last.get(k).and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0);
                    if !shown.load(Ordering::Relaxed) {
                        if last.get("pause").map(String::as_str) == Some("no") && num("duration") > 0.0 {
                            shown.store(true, Ordering::Relaxed);
                            show(&app, true);
                            js(&app, "window.__ihp && window.__ihp.open()");
                            flushed = Instant::now() - Duration::from_secs(1);
                        } else { continue; }
                    }
                    if !diff.is_empty() && flushed.elapsed() >= Duration::from_millis(100) {
                        js(&app, &format!("window.__ihp && window.__ihp.state({})", serde_json::Value::Object(std::mem::take(&mut diff))));
                        flushed = Instant::now();
                    }
                    if np_dirty {
                        np_dirty = false;
                        let (title, dur, pos, paused) = (last.get("media-title").cloned().unwrap_or_default(), num("duration"), num("time-pos"), last.get("pause").map(String::as_str) == Some("yes"));
                        let pos = pc.0.get_property::<f64>("time-pos").unwrap_or(pos);
                        let t2 = title.clone();
                        crate::discord::update(&title, dur, pos, paused);
                        on_main(&app, move || nowplaying::update(&title, dur, pos, paused));
                        crate::tray::now_playing(Some((&t2, paused)));
                    }
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
                Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => { user_stop = true; let _ = mpv.0.command("quit", &[]); break 'run; }
                Err(RecvTimeoutError::Timeout) => {}
            }
            while let Some(ev) = events.0.wait_event(0.0) {
                match ev {
                    Ok(Event::EndFile(reason)) => { if reason as u64 == 4 { load_error = Some("mpv could not play it".into()); } break 'run; } // MPV_END_FILE_REASON_ERROR
                    Ok(Event::Shutdown) => break 'run,
                    Err(e) => { load_error = Some(format!("{e}")); break 'run; } // END_FILE with an error comes here
                    _ => {}
                }
            }
        }
        stop.store(true, Ordering::Relaxed);
        redraw();
        // ended before a single frame showed and nobody pressed stop: the stream never opened
        if result.is_ok() && !user_stop && (load_error.is_some() || !shown.load(Ordering::Relaxed)) {
            eprintln!("player: load failed: {}", load_error.as_deref().unwrap_or("ended before the first frame"));
            result = Err("The stream could not be opened. Try another version.".into());
        }
    });
    *RDX.lock().unwrap() = None;
    let msg = result.as_ref().err().map(|e| serde_json::Value::String(e.clone()).to_string()).unwrap_or_default();
    js(app, &format!("window.__ihp && window.__ihp.close({msg})"));
    on_main(app, nowplaying::clear);
    crate::discord::stop();
    crate::nav::player_open(app, false);
    crate::tray::now_playing(None);
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
    // only this user may connect (it lives in the shared /tmp, where the daemon and mpv tools expect it)
    { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(APP_SOCK, std::fs::Permissions::from_mode(0o600)); }
    OUR_INO.store(ino(), Ordering::Relaxed);
    thread::spawn(move || {
        for s in l.incoming().flatten() {
            let app = app.clone();
            // one playback at a time: a new request stops the current one, then takes over
            static BUSY: Mutex<()> = Mutex::new(());
            thread::spawn(move || {
                // read the request first, so a bare connection (the daemon checking we are here) costs nothing
                let mut line = String::new();
                if BufReader::new(&s).read_line(&mut line).unwrap_or(0) == 0 { return; }
                let Some(req) = parse_req(&line) else { return };
                send(Msg::Stop);
                let _g = BUSY.lock().unwrap_or_else(|e| e.into_inner());
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



// ---- commands the web player calls (window.__TAURI_INTERNALS__.invoke) ----
#[tauri::command]
pub fn player_cmd(args: Vec<String>) -> Result<(), String> {
    if !page_cmd_ok(&args) { return Err(format!("not allowed: {}", args.first().map(String::as_str).unwrap_or(""))); }
    send(Msg::Cmd(args));
    Ok(())
}
#[tauri::command]
pub fn player_set(name: String, value: String) -> Result<(), String> {
    if !prop_ok(&name) || !arg_ok(&value) { return Err(format!("not allowed: {name}")); }
    if name == "glsl-shaders" && value.contains("://") { return Err("not allowed: remote shaders".into()); }
    send(Msg::Cmd(vec!["set".into(), name, value]));
    Ok(())
}
#[tauri::command]
pub fn player_close() { send(Msg::Stop); }
/// The glow around the picture: start or stop sending the screen's colours to the page.
#[tauri::command]
pub fn player_ambient(on: bool, rect: Option<Vec<f64>>) {
    if let Some(r) = rect.filter(|r| r.len() == 4 && r.iter().all(|v| v.is_finite())) {
        *AMB_RECT.lock().unwrap_or_else(|e| e.into_inner()) = [r[0].clamp(0.0, 1.0), r[1].clamp(0.0, 1.0), r[2].clamp(0.0, 1.0), r[3].clamp(0.0, 1.0)];
    }
    AMBI.store(on, Ordering::Relaxed);
    redraw();
}
#[tauri::command]
pub fn player_fullscreen(window: tauri::WebviewWindow) {
    let f = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!f);
}

fn js(app: &AppHandle, code: &str) {
    if let Some(w) = app.get_webview_window("main") { let _ = w.eval(code); }
}

const PROPS: &[&str] = &[
    "video-params/aspect", "video-zoom", "video-pan-x", "video-pan-y",
    "pause", "time-pos", "duration", "volume", "mute", "speed", "media-title", "demuxer-cache-time", "paused-for-cache",
    "contrast", "brightness", "gamma", "saturation", "hue", "sub-delay", "audio-delay", "sub-scale", "sub-pos",
    "panscan", "video-aspect-override", "scale", "deband", "interpolation", "tone-mapping", "hwdec-current", "width", "height", "sid", "aid",
    // for the frame-rate overlay (Cmd+Shift+F); these only change when a frame is dropped or the display changes
    "container-fps", "display-fps", "frame-drop-count", "decoder-frame-drop-count",
];



// ---- picture in picture: the same window, shrunk and floated above everything ----
static PIP_SAVED: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>> = Mutex::new(None);

fn pip_enter(win: &tauri::WebviewWindow, aspect: Option<f64>) {
    if PIP.swap(1, Ordering::Relaxed) == 1 { return; }
    // leave full screen first and wait for the animation to finish (this runs on its own thread, never the main one)
    if win.is_fullscreen().unwrap_or(false) {
        let _ = win.set_fullscreen(false);
        let t0 = Instant::now();
        while win.is_fullscreen().unwrap_or(false) && t0.elapsed() < Duration::from_secs(3) { thread::sleep(Duration::from_millis(50)); }
        thread::sleep(Duration::from_millis(200));
    }
    if let (Ok(p), Ok(sz)) = (win.outer_position(), win.outer_size()) { *PIP_SAVED.lock().unwrap() = Some((p, sz)); }
    let _ = win.set_min_size(None::<tauri::LogicalSize<f64>>);
    let _ = win.set_always_on_top(true);
    let _ = win.set_visible_on_all_workspaces(true);
    let ar = aspect.filter(|a| *a > 0.5 && *a < 4.0).unwrap_or(16.0 / 9.0);
    let (lw, lh) = ((270.0 * ar).clamp(300.0, 640.0), 270.0);
    let _ = win.set_decorations(false); // no title bar: nothing between you and the picture
    let _ = win.set_shadow(true);
    let _ = win.set_size(tauri::LogicalSize::new(lw, lh));
    if let Ok(Some(m)) = win.current_monitor() {
        let sc = m.scale_factor();
        let (mx, my, mw, mh) = (m.position().x, m.position().y, m.size().width as i32, m.size().height as i32);
        let (w, h) = ((lw * sc) as i32, (lh * sc) as i32);
        let _ = win.set_position(tauri::PhysicalPosition::new(mx + mw - w - (24.0 * sc) as i32, my + mh - h - (60.0 * sc) as i32));
    }
    let _ = win.eval("window.__ihp && window.__ihp.pip(true)");
}

fn pip_leave(win: &tauri::WebviewWindow) {
    if PIP.swap(0, Ordering::Relaxed) == 0 { return; }
    let _ = win.set_always_on_top(false);
    let _ = win.set_visible_on_all_workspaces(false);
    let _ = win.set_decorations(true);
    let _ = win.set_title_bar_style(tauri::TitleBarStyle::Overlay);
    let _ = win.set_title("");
    let _ = win.set_min_size(Some(tauri::LogicalSize::new(960.0, 600.0)));
    if let Some((p, sz)) = PIP_SAVED.lock().unwrap().take() { let _ = win.set_size(sz); let _ = win.set_position(p); }
    let _ = win.eval("window.__ihp && window.__ihp.pip(false)");
}

fn pip_exit(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") { pip_leave(&w); }
}

#[tauri::command]
pub fn player_pip(window: tauri::WebviewWindow, aspect: Option<f64>) { toggle_pip(window, aspect); }

/// Picture in picture on or off (menu, page button, `w`).
pub fn toggle_pip(window: tauri::WebviewWindow, aspect: Option<f64>) {
    thread::spawn(move || if PIP.load(Ordering::Relaxed) == 1 { pip_leave(&window); } else { pip_enter(&window, aspect); });
}
pub fn in_pip() -> bool { PIP.load(Ordering::Relaxed) == 1 }

#[tauri::command]
pub fn player_drag(window: tauri::WebviewWindow) { let _ = window.start_dragging(); }

#[tauri::command]
pub fn win_zoom(window: tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) { let _ = window.unmaximize(); } else { let _ = window.maximize(); }
}
