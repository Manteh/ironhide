# Approach for the Mac app

**Recommendation: Tauri 2 around the existing `web/` UI, Node daemon as a sidecar, mpv for native playback.** This is what the first version does.

## Options

1. **Tauri + existing web UI (chosen).** One day of work, 100% feature parity (rooms, Friends, Settings, everything), tiny binary (a few MB, no bundled Chromium), startup and memory far below a browser tab. Rust owns the window, menu and process lifecycle.
2. **Tauri + a faster native player.** Worth doing later, not first. The web player is the weakest part (MSE, ffmpeg remux/transcode); mpv already exists in the daemon and plays everything the Mac can decode. Embedding libmpv into the window needs a native Metal/OpenGL child view layered under a transparent WKWebView, which is a project of its own. Until then "Play in mpv" opens its fullscreen window, as it does now.
3. **Fully native shell (SwiftUI/AppKit).** Best possible feel, but means rewriting Home, Library, Title, Friends, Profile, Settings, rooms and the spring-physics rail. Months, and two UIs to keep in step. Not justified for a private tool.

## WKWebView limits

- HEVC (VideoToolbox, hardware) and H.264 play; MSE exists (Safari/WKWebView, including ManagedMediaSource on newer macOS). The existing server-side remux/transcode path covers what it cannot play (DTS, TrueHD, some containers).
- 4K HDR/Dolby Vision, DTS and exact frame pacing are more reliable in mpv, so mpv stays the player for those.
- Rendering and animation run on Core Animation in the system WebKit, the same engine as Safari. It is typically smoother than an embedded Chromium and does not carry a second copy of a browser.

## The daemon

Kept as a **sidecar, not ported**. It is about 300 KB of JS (TorBox, Torrentio/Comet, history, social, webplay, mpv IPC) that works. Porting to Rust is a rewrite with no user-visible gain. The app finds Node, runs `src/daemon.js` with a clean environment, waits for `/api/health`, then navigates the window to it; on quit it kills only a daemon it started itself. The TV bridge is off unless `IRONHIDE_TV_BRIDGE=1`.

Later options: bundle a Node binary (or switch to Bun/`node --sea`) so the app has no Node requirement; a libmpv view for in-window playback; a tray icon and global media keys.
