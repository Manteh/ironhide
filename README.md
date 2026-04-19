# IronHide

CLI movie/TV streamer + Claude Code MCP server. Search for any movie or TV show and stream it instantly in mpv via Real-Debrid. Control everything through natural language in Claude.

```
play Inception
play 3 Body Problem season 1 episode 3 in Dolby Vision
resume where I left off
pause / skip forward 5 minutes
cast to TV
```

## What it does

- Searches movies and TV shows via TMDB
- Fetches cached torrent streams via Torrentio + Real-Debrid (instant, no seeding)
- Plays in mpv with full IPC control (pause, seek, volume, audio/subtitle track switching)
- Saves watch history with resume-from-position
- Builds a taste profile from 1–5 star ratings for recommendations
- Fetches subtitles automatically from OpenSubtitles
- Casts to Samsung TV via native TizenBrew app or DLNA fallback

## Setup

### Prerequisites

- macOS (Apple Silicon or Intel)
- [Claude Code](https://claude.ai/code)
- A [Real-Debrid](https://real-debrid.com) account (~3€/mo) — gives instant access to pre-cached torrents
- A free [TMDB API key](https://www.themoviedb.org/settings/api)

### Install

```bash
git clone https://github.com/YOUR_USERNAME/ironhide
cd ironhide
./setup.sh
```

The setup script will:
1. Install `mpv` and `molten-vk` via Homebrew
2. Run `brew link molten-vk` — **critical on macOS**: without this, mpv plays audio but shows no video window (MoltenVK/Vulkan ICD not found)
3. Write the recommended `~/.config/mpv/mpv.conf` (`vo=gpu-next` for correct Dolby Vision rendering)
4. Prompt for your TMDB and Real-Debrid API keys and save to `~/.config/ironhide/config.json`
5. Register the MCP server in `~/.mcp.json` for Claude Code

Then **restart Claude Code**.

### Manual MCP registration

If you prefer to register manually, add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "ironhide": {
      "command": "node",
      "args": ["/path/to/ironhide/mcp/server.js"]
    }
  }
}
```

### Config file

API keys live in `~/.config/ironhide/config.json` (never committed to git):

```json
{
  "tmdb_api_key": "your_tmdb_key",
  "rd_api_key": "your_real_debrid_key"
}
```

You can also set them as environment variables: `TMDB_API_KEY`, `RD_API_KEY`.

## Usage in Claude Code

Once the MCP server is registered, just talk to Claude:

```
play Inception
play The Boys season 5 episode 3
resume True Detective
pause
skip forward 10 minutes
what am I watching?
cast to TV
rate it 4 stars, great atmosphere but slow ending
what should I watch tonight?
```

## mpv.conf recommendations

```
vo=gpu-next        # use libplacebo renderer — correct Dolby Vision color decoding
hwdec=videotoolbox # hardware decode on Apple Silicon
cache=yes
demuxer-max-bytes=512MiB
network-timeout=60
```

`vo=gpu` (the default) causes purple/green color corruption on Dolby Vision streams on macOS. Use `gpu-next`.

## Known macOS quirks

| Issue | Cause | Fix |
|-------|-------|-----|
| Audio plays, no video window | `molten-vk` installed but not linked — Vulkan loader can't find MoltenVK | `brew link molten-vk` |
| Purple/green colors on DV content | `vo=gpu` doesn't handle DV correctly | Set `vo=gpu-next` in mpv.conf |

## MCP tools

| Tool | What it does |
|------|-------------|
| `ironhide_search` | Search by title, returns IMDB IDs + latest episode for TV |
| `ironhide_streams` | List streams with quality, size, seeders, DV/HDR flags |
| `ironhide_play` | Play a stream by index, optionally resume from saved position |
| `ironhide_nowplaying` | Live mpv status via IPC socket |
| `ironhide_status` | Check finished / next episode / pending rating |
| `ironhide_history` | Watch history with resume positions |
| `ironhide_control` | Pause, seek, volume, tracks, fullscreen, speed, screenshot |
| `ironhide_resume` | Instant resume using saved stream URL |
| `ironhide_rate` | Save 1–5 star rating + liked/disliked aspects |
| `ironhide_taste` | Taste profile for personalized recommendations |
| `ironhide_cast_tv` | Cast to Samsung TV |
| `ironhide_tv_control` | Control TV playback |

## Layout

```
bin/ironhide.js       CLI entrypoint
mcp/server.js         MCP server (stdio transport)
src/
  config.js           Loads API keys from ~/.config/ironhide/config.json
  tmdb.js             TMDB search + IMDB ID lookup
  torrentio.js        Torrentio + Real-Debrid streams
  player.js           mpv spawn + progress tracking
  mpv-ipc.js          mpv IPC socket control
  dlna.js             DLNA casting to TV
  tizen-bridge.js     WebSocket bridge for native Samsung TV app
  history.js          Watch history persistence
  taste.js            Ratings + taste profile
  preferences.js      Learned quality preferences
  subtitles.js        OpenSubtitles lookup
  ui.js               Language codes + CLI helpers
setup.sh              One-command setup script
```

## CLI

```bash
ironhide "Blade Runner 2049"
ironhide "The Bear" --tv -s 1 -e 1
ironhide "Dune" ltu    # prefer Lithuanian audio
```
