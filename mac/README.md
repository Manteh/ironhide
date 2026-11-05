# IronHide for macOS

A native Mac app: a small Rust (Tauri 2) shell around the existing IronHide web UI and Node daemon.

- The window is a WKWebView showing the daemon's UI (`http://127.0.0.1:7676`). Home, Library, Search, Title, Friends, Profile, Settings and watch rooms are the same `web/` code, nothing is duplicated.
- The app starts the daemon (`node src/daemon.js`) when it launches and stops it when you quit. If a daemon is already running on the port, the app attaches to it and leaves it alone on quit.
- Playback: **mpv** (native, fullscreen, HEVC/4K/DTS) is the daemon's existing player and stays the recommended way to watch. The web player also works inside the window (WKWebView decodes H.264/HEVC through VideoToolbox).
- Native menu: Go ▸ Home / Continue / Shelf / Friends / Profile / Search (⌘1–5, ⌘K), Settings (⌘,), Reload (⌘R), full screen.

## Requirements

- macOS 12+, Xcode command line tools
- Rust (`rustup`), and the Tauri CLI: `cargo install tauri-cli --version "^2" --locked`
- Node.js (Homebrew `node`), mpv at `/Applications/mpv.app`, ffmpeg for the web player

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
