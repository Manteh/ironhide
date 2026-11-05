# IronHide for macOS

A native Mac app: a small Rust (Tauri 2) shell around the existing IronHide web UI and Node daemon.

- The window is a WKWebView showing the daemon's UI (`http://127.0.0.1:7676`). Home, Library, Search, Title, Friends, Profile, Settings and watch rooms are the same `web/` code, nothing is duplicated.
- The app starts the daemon (`node src/daemon.js`) when it launches and stops it when you quit. If a daemon is already running on the port, the app attaches to it and leaves it alone on quit.
- Playback: **mpv plays inside the app window** (libmpv, OpenGL, VideoToolbox hardware decoding, so 4K HEVC works). When you press Play, the daemon hands the stream to the app instead of starting an external mpv; The video is drawn natively under the page; while it plays the page is transparent and `web/js/appplayer.js` draws the controls (seek bar with hover time and chapters, volume, speed, audio/subtitle tracks, a Picture panel with brightness, contrast, saturation, gamma, hue, presets, deband, smooth motion and HDR tone mapping, aspect ratio, screenshot). Keys: Space, arrows, `f` full screen, `w` picture in picture (a small always-on-top mini player), `m` mute, `[` `]` speed, `p` picture, `a` audio, `c` subtitles, Esc (close panel, leave full screen, then close), `q` close. Picture settings are remembered. If the app is not open, the daemon starts the external mpv as before. The web player still works too.
- Native menu: Go ▸ Home / Continue / Shelf / Friends / Profile / Search (⌘1–5, ⌘K), Settings (⌘,), Reload (⌘R), full screen.

## Requirements

- macOS 12+, Xcode command line tools
- Rust (`rustup`), and the Tauri CLI: `cargo install tauri-cli --version "^2" --locked`
- Node.js (Homebrew `node`), `brew install mpv` (the app links `/opt/homebrew/lib/libmpv.dylib`; mpv.app is still used when the app is closed), ffmpeg for the web player

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

The app is written to `mac/src-tauri/target/release/bundle/macos/IronHide.app`. It bundles `src/`, `web/` and `node_modules/` inside the app and uses the Node.js installed on your Mac (set `IRONHIDE_NODE` to point to a different one).

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

## Known limits

- Tested with a real mouse and keys on a real 4K HEVC remux: play, controls fade in on mouse move, Picture presets and sliders (mpv's brightness, contrast and saturation changed), reset, audio and subtitle track switching, speed, seek by click with hover time, pause, fullscreen button and Esc. Not tested: volume, aspect ratio, chapters, screenshot, audio/subtitle delay. Once the app quit by itself right after a seek click, then Space, then `f`; I could not reproduce it. Your Settings → Playback → Player must be mpv for Play to use the in-app player.
- libmpv is not bundled inside the `.app`; it needs Homebrew's mpv installed.
- Run only one copy of the app at a time (they share `/tmp/ironhide-app.sock`).
