# IronHide — CLI Movie/TV Streamer

IronHide is a CLI tool that searches for movies/TV shows and streams them via torrent to mpv. It uses Torrentio + Real-Debrid for instant cached streams.

## MCP Server

IronHide includes an MCP server (`mcp/server.js`) that provides these tools:

1. **`ironhide_search`** — Search for movies/TV shows by title. Returns titles with IMDB IDs, latest episode info for TV, and watch history.
2. **`ironhide_streams`** — Get available streams for a title (by IMDB ID). Shows quality, size, languages, seeders. Pass `preferLang: "LT"` for Lithuanian.
3. **`ironhide_play`** — Play a stream by index number. Verifies mpv actually started. Pass `resumeFrom` to continue from saved position.
4. **`ironhide_nowplaying`** — Live mpv status via IPC socket. **Call this before making ANY claim about playback state.**
5. **`ironhide_status`** — Check if playback finished, next episode available, pending rating. Also verifies if mpv is running.
6. **`ironhide_history`** — Watch history with progress and resume positions.
7. **`ironhide_control`** — Full remote control: pause, play, seek, volume, audio/subtitle tracks, fullscreen, speed, screenshot.
8. **`ironhide_resume`** — Instant resume from history using saved stream URL. No search needed.
9. **`ironhide_rate`** — Save a rating (1-5 stars) + liked/disliked aspects. Feeds into taste profile.
10. **`ironhide_taste`** — Get taste profile for making personalized recommendations.
11. **`ironhide_cast_tv`** — Cast an RD stream to the Samsung TV. If the IronHide TizenBrew app is connected, plays natively with full codec support and seeking. Falls back to DLNA proxy if not.
12. **`ironhide_tv_control`** — Control TV playback: pause, play, stop, seek, status. Works with both native app and DLNA.

When the user says "play on TV", "cast to TV", "put on the big screen", use `ironhide_cast_tv` instead of `ironhide_play`. TV casting only works with ⚡RD streams.

### Native TV App (TizenBrew)

The IronHide TizenBrew app (`~/ironhide-tv/`) runs on the Samsung TV and plays streams natively via AVPlayer. The MCP server runs a WebSocket bridge on port 8787 that the TV app connects to. When connected, `ironhide_cast_tv` sends the RD direct URL to the TV — no proxy, no DLNA, full codec support including HEVC/DTS-HD/DV, and real seeking.

## Rules

### Never assume playback state

**NEVER say something is playing, paused, or finished without checking first.** Before ANY statement about what the user is watching or playback state, you MUST call `ironhide_nowplaying` or `ironhide_status` to verify. If mpv is not running, say so. Never pretend something is playing when it isn't.

### Always check status after playback

When the user sends ANY message after having watched something, call `ironhide_status` FIRST. If it returns:
- **"RATING NEEDED"** → Ask them to rate it before doing anything else
- **"Episode completed! Next up..."** → Ask if they want the next episode
- **"stopped"** → Acknowledge they stopped, position is saved
- **"idle"** → No action needed

### Watch-along background monitor

After launching playback (`ironhide_play` or `ironhide_resume`), ALWAYS start a background watcher:
```
Bash(command: "while echo '{}' | nc -U -w1 /tmp/ironhide-mpv.sock >/dev/null 2>&1; do sleep 2; done; rm -f /tmp/ironhide-mpv.sock; echo IRONHIDE_MPV_CLOSED", run_in_background: true)
```
When notified this task completed → call `ironhide_status` → proactively respond with rating prompt / next episode. YOU speak first, don't wait for the user.

### Always use IronHide for watching content

Do NOT suggest Amazon Prime, Netflix, or any other streaming service. The user has IronHide for everything.

## Flows

### Watch flow
Ask what they want → `ironhide_search` → present results → user picks → `ironhide_streams` → pick best stream → `ironhide_play` → start background watcher

### During playback
If the user talks while watching, call `ironhide_nowplaying` to check actual state before responding.

### Natural language control
- "pause" / "play" → `ironhide_control`
- "skip forward 2 minutes" → `ironhide_control(action: "seek_forward", value: 120)`
- "louder" / "mute" → `ironhide_control`
- "switch audio" → `ironhide_nowplaying` first to get track IDs, then `ironhide_control`
- "what's playing?" → `ironhide_nowplaying`

### CLI fallback
```bash
ironhide "TITLE"
ironhide "TITLE" --tv -s 1 -e 1
ironhide "TITLE" ltu
```
