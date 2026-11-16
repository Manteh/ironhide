# Orbie for macOS

A native Mac app: a small Rust (Tauri 2) shell around the existing Orbie web UI and Node daemon.

- The window is a WKWebView showing the daemon's UI (`http://127.0.0.1:7676`). Home, Library, Search, Title, Friends, Profile, Settings and watch rooms are the same `web/` code, nothing is duplicated.
- The app starts the daemon (`node src/daemon.js`, in its own process group) when it launches and stops it, and everything it started, when you quit. If the app crashes or is force-quit, the daemon notices within two seconds and exits by itself. A daemon you started yourself (CLI, MCP server, `npm start`) is attached to and left running; one left behind by an earlier app is replaced.
- Only one copy of the app runs: opening it again brings the window forward.
- Playback: **mpv plays inside the app window** (libmpv, OpenGL, VideoToolbox hardware decoding, so 4K HEVC works). When you press Play, the daemon hands the stream to the app instead of starting an external mpv; The video is drawn natively under the page; while it plays the page is transparent and `web/js/appplayer.js` draws the controls (seek bar with hover time and chapters, volume, speed, audio/subtitle tracks, a Picture panel with brightness, contrast, saturation, gamma, hue, presets, deband, smooth motion and HDR tone mapping, aspect ratio, screenshot). Keys: Space, arrows, `f` full screen, `w` picture in picture (a small always-on-top mini player), `m` mute, `[` `]` speed, `p` picture, `a` audio, `c` subtitles, Esc (close panel, leave full screen, then close), `q` close. Picture settings are remembered. If the app is not open, the daemon starts the external mpv as before. The web player still works too.
- Window header: an integrated bar (traffic lights, back/forward/reload, page name, search, friends, settings, your profile). Drag it to move the window, double-click to zoom.
- Native menu: Go ▸ Home / Continue / Shelf / Friends / Profile / Search (⌘1–5, ⌘K), Playback ▸ Play/Pause (⌘P), ±10 s (⌘← ⌘→), Mute, Picture in Picture, Screenshot, Stop (⌘.), Settings (⌘,), Reload (⌘R), full screen, Orbie ▸ Check for Updates….
- Media keys, AirPods, the Touch Bar and Control Center's Now Playing control the in-app player while something plays.
- The window remembers its size and place. Updates: a card appears when a new release is out; Update runs the installer, which quits, replaces and reopens the app.

## Requirements

- macOS 12+, Xcode command line tools
- Rust (`rustup`), and the Tauri CLI: `cargo install tauri-cli --version "^2" --locked`
- Node.js (Homebrew `node`), `brew install mpv` (dev builds link `/opt/homebrew/lib/libmpv.dylib`; mpv.app is still used when the app is closed), ffmpeg for the web player
- Release builds carry their own Node, libmpv, ffmpeg and ffprobe and need nothing installed. They need **macOS 15** or later, because the bundled Homebrew libraries are built for it.

## Run (development)

```bash
cd mac
cargo tauri dev
```

Dev builds run the live repo, so edits to `web/` show after ⌘R and edits to `src/` after the daemon restarts.

## Build the app

```bash
cd mac
cargo tauri build --bundles app
```

The app is written to `mac/src-tauri/target/release/bundle/macos/Orbie.app`. For a self-contained release zip use `mac/scripts/release.sh`: it bundles Node, libmpv, ffmpeg and only the npm packages the service imports, saves the Updates numbers, starts the bundled service once to check it, and signs the app (ad hoc).

The version lives in `package.json` (`tauri.conf.json` points at it); `src-tauri/Cargo.toml` must say the same, and release.sh stops if it doesn't.

## Settings and environment

| Variable | Effect |
| --- | --- |
| `IRONHIDE_PORT` | Daemon port (default 7676) |
| `IRONHIDE_ROOT` | Use this folder for `src/` and `web/` instead of the bundled/repo copy |
| `IRONHIDE_NODE` | Path to the `node` binary |
| `IRONHIDE_TV_BRIDGE=1` | Start the Samsung TV bridge (off by default in the app) |

Daemon log: `~/Library/Logs/IronHide/daemon.log`. Your data stays in `~/.config/ironhide`.

## Why this shape

See [DESIGN.md](DESIGN.md).

## Security

- The daemon listens on 127.0.0.1 only, accepts only loopback `Host` names (no DNS rebinding) and refuses requests and WebSocket connections from other sites. Pages it serves carry a Content-Security-Policy (no inline script).
- The page can call the native commands only from `http://127.0.0.1:<port>`. `player_cmd` and `player_set` accept playback commands and picture/sound properties only: nothing that runs programs, loads scripts or writes files.
- `/tmp/ironhide-app.sock` is owner-only, takes web URLs only and only the mpv options the daemon sends.

## Known limits

- Tested with a real mouse and keys on a real 4K HEVC remux: play, controls fade in on mouse move, Picture presets and sliders (mpv's brightness, contrast and saturation changed), reset, audio and subtitle track switching, speed, seek by click with hover time, pause, fullscreen button and Esc. Not tested: volume, aspect ratio, chapters, screenshot, audio/subtitle delay. Once the app quit by itself right after a seek click, then Space, then `f`; I could not reproduce it. Your Settings → Playback → Player must be mpv for Play to use the in-app player.
- HDR output to XDR displays is not possible with the current player: libmpv's render API draws with OpenGL only. It would need mpv's own Metal/`gpu-next` window inside ours, which libmpv does not support for embedding today.

## Your mpv settings

The embedded player reads your `~/.config/mpv/mpv.conf` (scaling, dithering, tone mapping, cache, audio, subtitle style) and skips only the options that describe a standalone window or another video output (`vo`, `gpu-api`, `force-window`, `keep-open`, `script-opts`, ...). Your Nitrate presets and key nudges (Ctrl and Shift with the arrows, `z`/`x` audio delay) are built into the player. It cannot use `vo=gpu-next` or HDR output to the XDR display: libmpv's render API draws with OpenGL only.
