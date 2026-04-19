#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchMedia, getImdbId, getLatestEpisode } from "../src/tmdb.js";
import { getStreams } from "../src/torrentio.js";
import { fetchSubtitles } from "../src/subtitles.js";
import { parseLangs } from "../src/ui.js";
import { addToHistory, getHistory, getLastWatched, updateLatestProgress } from "../src/history.js";
import { playDetached, readProgress, formatTime } from "../src/player.js";
import { learnQuality, getQualityPreference, getGlobalPreference } from "../src/preferences.js";
import { addRating, getTasteProfile, getRatings } from "../src/taste.js";
import {
  getNowPlaying, isMpvRunning,
  togglePause, pause, resume, stop,
  seek, seekAbsolute, seekPercent,
  setVolume, adjustVolume, toggleMute,
  setAudioTrack, setSubtitleTrack, disableSubtitles,
  toggleFullscreen, setSpeed, screenshot,
} from "../src/mpv-ipc.js";
import {
  castStream, isTVAvailable, isProxyRunning,
  tvPause as dlnaPause, tvPlay as dlnaPlay, tvStop as dlnaStop,
  tvSeek as dlnaSeek, tvSeekViaProxy, tvGetPosition, tvGetTransportState,
  tvSetVolume as dlnaSetVolume, tvGetVolume as dlnaGetVolume,
  stopProxy, hmsToSeconds, secondsToHMS,
} from "../src/dlna.js";
import { spawn } from "child_process";
import {
  startBridge, isTVConnected, isTVConnectedAsync,
  tvPlay as nativePlay, tvPause as nativePause, tvResume as nativeResume,
  tvStop as nativeStop, tvSeek as nativeSeek, tvGetStatus as nativeGetStatus,
  getLastPosition, onTVEvent,
  startProxy as startTizenProxy, stopProxy as stopTizenProxy,
} from "../src/tizen-bridge.js";

// Start the Tizen WebSocket bridge (TV app connects here)
startBridge();

const server = new McpServer({
  name: "ironhide",
  version: "1.0.0",
});

// Appended to every tool response that expects user interaction
const UX_RULE = "\n\nRULE: You MUST use AskUserQuestion for ANY question you ask the user. NEVER ask questions as plain text. NEVER end a message with a '?' — always use AskUserQuestion with selectable options instead.";

// Tool 1: Search for movies/TV shows
server.registerTool(
  "ironhide_search",
  {
    description: "Search for movies or TV shows by title. Returns matching titles with TMDB IDs, IMDB IDs, ratings. For TV shows, also returns the latest aired episode so you don't need to ask the user. If only one strong match exists, you can skip asking the user to pick and go straight to ironhide_streams.",
    inputSchema: {
      query: z.string().describe("Movie or TV show title to search for"),
      type: z.enum(["movie", "tv"]).default("movie").describe("Search for movies or TV shows"),
    },
  },
  async ({ query, type }) => {
    const results = await searchMedia(query, type);
    if (results.length === 0) {
      return { content: [{ type: "text", text: "No results found." }] };
    }

    // Get IMDB IDs + latest episode info in parallel
    const enriched = await Promise.all(
      results.slice(0, 8).map(async (r) => {
        const [imdbId, latestEp] = await Promise.all([
          getImdbId(r.id, type).catch(() => null),
          type === "tv" ? getLatestEpisode(r.id).catch(() => null) : null,
        ]);
        // Check watch history
        const lastWatched = imdbId ? await getLastWatched(imdbId).catch(() => null) : null;
        return { ...r, imdbId, latestEp, lastWatched };
      })
    );

    const lines = enriched.map((r, i) => {
      let line = `${i + 1}. ${r.title} (${r.year}) ★${r.rating} [TMDB:${r.id}] [IMDB:${r.imdbId || "N/A"}]\n   ${r.overview}`;
      if (r.latestEp) {
        line += `\n   Latest episode: S${String(r.latestEp.season).padStart(2, "0")}E${String(r.latestEp.episode).padStart(2, "0")} "${r.latestEp.name}" (aired ${r.latestEp.airDate})`;
      }
      if (r.lastWatched) {
        const when = r.lastWatched.watchedAt.slice(0, 10);
        const pct = r.lastWatched.percent;
        const completed = pct != null && pct >= 90;
        const statusLabel = completed ? "Completed" : pct != null ? `${pct.toFixed(0)}% watched (not finished)` : "watched (no progress data)";
        const resumeInfo = (!completed && r.lastWatched.position) ? ` [resumeFrom:${r.lastWatched.position.toFixed(0)}]` : "";
        if (r.lastWatched.season) {
          line += `\n   Last: S${String(r.lastWatched.season).padStart(2, "0")}E${String(r.lastWatched.episode).padStart(2, "0")} on ${when} — ${statusLabel}${resumeInfo}`;
        } else {
          line += `\n   Last: ${when} — ${statusLabel}${resumeInfo}`;
        }
      }
      return line;
    });

    const text = lines.join("\n\n");
    return { content: [{ type: "text", text: text + UX_RULE }] };
  }
);

// Tool 2: Get available streams for a title
server.registerTool(
  "ironhide_streams",
  {
    description: "Get available torrent streams for a movie or TV episode. Returns streams sorted by quality. RD (Real-Debrid) streams are instant. Default language is English — only pass preferLang if user explicitly asks for a different language (e.g. Lithuanian = 'LT').",
    inputSchema: {
      imdbId: z.string().describe("IMDB ID (e.g. tt0499549)"),
      title: z.string().describe("Title of the movie or show"),
      type: z.enum(["movie", "tv"]).default("movie"),
      season: z.coerce.number().optional().describe("Season number (TV only)"),
      episode: z.coerce.number().optional().describe("Episode number (TV only)"),
      preferLang: z.string().optional().describe("Only set if user explicitly wants non-English audio (e.g. LT for Lithuanian, SE for Swedish). Omit for English."),
    },
  },
  async ({ imdbId, title, type, season, episode, preferLang }) => {
    const [torrentioStreams, subs] = await Promise.all([
      getStreams(imdbId, type, season, episode),
      fetchSubtitles(imdbId, season, episode).catch(() => []),
    ]);

    let streams = [...torrentioStreams];

    // Deprioritize DUAL/dubbed releases (often default to non-English audio)
    const isDual = (q) => /\bDUAL\b|DUBBED|\bDUB\b/i.test(q);

    streams.sort((a, b) => {
      if (preferLang) {
        const aLangs = parseLangs(a.quality);
        const bLangs = parseLangs(b.quality);
        const aHas = aLangs.includes(preferLang) || aLangs.includes("MULTI");
        const bHas = bLangs.includes(preferLang) || bLangs.includes("MULTI");
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
      }
      // Push DUAL/dubbed releases down
      const aDual = isDual(a.quality);
      const bDual = isDual(b.quality);
      if (aDual && !bDual) return 1;
      if (!aDual && bDual) return -1;
      if (a.isRD && !b.isRD) return -1;
      if (!a.isRD && b.isRD) return 1;
      if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes;
      return b.seeds - a.seeds;
    });

    streams = streams.slice(0, 20);

    if (streams.length === 0) {
      return { content: [{ type: "text", text: "No streams found." }] };
    }

    const lines = streams.map((s, i) => {
      const langs = parseLangs(s.quality);
      const langStr = langs.length > 0 ? langs.join(" ") : "";
      const rd = s.isRD ? "⚡RD" : "   ";
      return `${String(i + 1).padStart(2)}. ${rd} ↑${String(s.seeds).padStart(4)} ${s.size.padStart(10)} ${langStr.padEnd(12)} ${s.quality.slice(0, 60)}`;
    });

    const subInfo = subs.length > 0
      ? `\nSubtitles available: ${subs.map((s) => s.lang).join(", ")}`
      : "\nNo subtitles found.";

    // Get quality preference for smart auto-pick
    const titlePref = await getQualityPreference(imdbId).catch(() => null);
    const globalPref = await getGlobalPreference().catch(() => null);

    let prefInfo = "";
    if (titlePref) {
      const minGB = (titlePref.minSize / 1e9).toFixed(1);
      const maxGB = (titlePref.maxSize / 1e9).toFixed(1);
      prefInfo = `\nUser's preference for this title: ${titlePref.resolution}, typical size ${minGB}-${maxGB} GB. Pick a stream matching this.`;
    } else if (globalPref && globalPref.totalPicks >= 3) {
      const avgGB = (globalPref.avgSize / 1e9).toFixed(1);
      prefInfo = `\nUser's general preference: ${globalPref.resolution}, avg size ~${avgGB} GB. Pick a stream matching this.`;
    }

    const text = `Found ${torrentioStreams.length} from Torrentio\n\n${lines.join("\n")}${subInfo}${prefInfo}\n\nUse ironhide_play with the stream index to start playback.`;

    globalStreams = streams;
    globalSubs = subs;
    globalMeta = { title, imdbId, type, season, episode };

    return { content: [{ type: "text", text }] };
  }
);

let globalStreams = [];
let globalSubs = [];
let globalMeta = {};
let globalPlaybackStatus = null; // null = idle, { status, progress, nextEpisode }
let pendingRating = null; // set when mpv closes, cleared after user rates
let mpvWasRunning = false; // tracks if mpv was running on last poll

// ── Active mpv monitor ──
// Polls every 3 seconds. When mpv disappears, captures final state.
function startMpvMonitor() {
  setInterval(async () => {
    const running = await isMpvRunning();

    if (running && !mpvWasRunning) {
      // mpv just started
      mpvWasRunning = true;
    }

    if (!running && mpvWasRunning) {
      // mpv just closed — capture state
      mpvWasRunning = false;

      // Read progress from fixed progress file
      const { readFile, unlink } = await import("fs/promises");
      const { join } = await import("path");
      const { tmpdir } = await import("os");
      const progressPath = join(tmpdir(), "ironhide-progress.json");

      let progress = null;
      try {
        const data = await readFile(progressPath, "utf-8");
        progress = JSON.parse(data.trim());
      } catch {}

      if (progress) {
        await updateLatestProgress(progress).catch(() => {});
      }

      const completed = progress && progress.percent >= 90;
      const meta = globalMeta;

      // Set playback status
      if (completed && meta.type === "tv" && meta.season && meta.episode) {
        globalPlaybackStatus = {
          status: "completed",
          progress,
          title: meta.title,
          imdbId: meta.imdbId,
          season: meta.season,
          episode: meta.episode,
          nextEpisode: { season: meta.season, episode: meta.episode + 1 },
        };
      } else if (progress) {
        globalPlaybackStatus = {
          status: completed ? "completed" : "stopped",
          progress,
          title: meta.title,
          imdbId: meta.imdbId,
          season: meta.season,
          episode: meta.episode,
          nextEpisode: null,
        };
      }

      // Set pending rating if watched enough
      if (progress && progress.percent > 20 && meta.title) {
        const ep = meta.season ? ` S${String(meta.season).padStart(2, "0")}E${String(meta.episode).padStart(2, "0")}` : "";
        pendingRating = {
          imdbId: meta.imdbId,
          title: `${meta.title}${ep}`,
          type: meta.type,
          percent: progress.percent,
        };
      }
    }
  }, 3000);
}

startMpvMonitor();

// Tool 3: Play a stream
server.registerTool(
  "ironhide_play",
  {
    description: "Play a stream from the most recent ironhide_streams results. Opens mpv for playback. Automatically saves to watch history with progress tracking. Pass resumeFrom (in seconds) to continue from where the user left off.",
    inputSchema: {
      index: z.coerce.number().describe("Stream number from ironhide_streams results (1-based)"),
      resumeFrom: z.coerce.number().optional().describe("Resume playback from this position in seconds. Get this from ironhide_history (the position field)."),
    },
  },
  async ({ index, resumeFrom }) => {
    if (globalStreams.length === 0) {
      return { content: [{ type: "text", text: "No streams loaded. Run ironhide_streams first." }] };
    }

    const stream = globalStreams[index - 1];
    if (!stream) {
      return { content: [{ type: "text", text: `Invalid index. Pick 1-${globalStreams.length}.` }] };
    }

    // When mpv exits, update history and check if episode completed
    const onFinish = async (progress) => {
      if (progress) {
        await updateLatestProgress(progress).catch(() => {});
      }

      const completed = progress && progress.percent >= 90;

      // If TV episode completed, prepare next episode info
      if (completed && globalMeta.type === "tv" && globalMeta.season && globalMeta.episode) {
        const nextEp = globalMeta.episode + 1;
        globalPlaybackStatus = {
          status: "completed",
          progress,
          title: globalMeta.title,
          imdbId: globalMeta.imdbId,
          season: globalMeta.season,
          episode: globalMeta.episode,
          nextEpisode: { season: globalMeta.season, episode: nextEp },
        };
      } else if (progress) {
        globalPlaybackStatus = {
          status: completed ? "completed" : "stopped",
          progress,
          title: globalMeta.title,
          imdbId: globalMeta.imdbId,
          season: globalMeta.season,
          episode: globalMeta.episode,
          nextEpisode: null,
        };
      }

      // Flag for rating prompt — only if watched enough (>20%)
      if (progress && progress.percent > 20) {
        const ep = globalMeta.season ? ` S${String(globalMeta.season).padStart(2, "0")}E${String(globalMeta.episode).padStart(2, "0")}` : "";
        pendingRating = {
          imdbId: globalMeta.imdbId,
          title: `${globalMeta.title}${ep}`,
          type: globalMeta.type,
          percent: progress.percent,
        };
      }
    };

    const result = await playDetached(stream, globalSubs, onFinish, resumeFrom);

    if (result.status === "not_cached") {
      return { content: [{ type: "text", text: "⏳ Not cached on Real-Debrid yet. Pick another stream." }] };
    }

    if (result.status === "error") {
      return { content: [{ type: "text", text: "Failed to launch player." }] };
    }

    // Learn quality preference from this pick
    if (globalMeta.imdbId) {
      await learnQuality(globalMeta.imdbId, stream).catch(() => {});
    }

    // Save to history with stream info for instant resume
    await addToHistory({
      title: globalMeta.title || stream.quality.slice(0, 40),
      imdbId: globalMeta.imdbId || "",
      type: globalMeta.type || "movie",
      season: globalMeta.season,
      episode: globalMeta.episode,
      quality: stream.quality.slice(0, 80),
      streamUrl: stream.url || null,
      streamMagnet: stream.magnet || null,
      streamTorrentLink: stream.torrentLink || null,
      streamIsRD: stream.isRD || false,
    }).catch(() => {});

    // Reset playback status
    globalPlaybackStatus = null;

    // Wait a moment then verify mpv actually started
    await new Promise(r => setTimeout(r, 1500));
    const running = await isMpvRunning();
    const np = running ? await getNowPlaying().catch(() => null) : null;

    const langs = parseLangs(stream.quality);
    const langInfo = langs.length > 0 ? ` | Audio: ${langs.join(", ")}` : "";
    const subInfo = globalSubs.length > 0 ? ` | Subs: ${globalSubs.map((s) => s.lang).join(", ")}` : "";
    const mode = stream.isRD ? "Real-Debrid (instant)" : "torrent stream";
    const watcherHint = `\n\nIMPORTANT: You MUST now run this background task to detect when mpv closes:\nBash(command: "while echo '{}' | nc -U -w1 /tmp/ironhide-mpv.sock >/dev/null 2>&1; do sleep 2; done; rm -f /tmp/ironhide-mpv.sock; echo IRONHIDE_MPV_CLOSED", run_in_background: true)\nWhen notified it completed, call ironhide_status and proactively ask the user to rate what they watched.`;

    if (np && np.duration > 0) {
      return {
        content: [{
          type: "text",
          text: `▶ Now playing via ${mode}\n${stream.quality.slice(0, 80)}\n${stream.size}${langInfo}${subInfo}\n\nmpv is running and playback confirmed.${watcherHint}`,
        }],
      };
    } else if (running) {
      return {
        content: [{
          type: "text",
          text: `▶ Launched via ${mode}\n${stream.quality.slice(0, 80)}\n${stream.size}${langInfo}${subInfo}\n\nmpv is starting up — buffering may take a moment.${watcherHint}`,
        }],
      };
    } else {
      return {
        content: [{
          type: "text",
          text: `⚠ mpv failed to start or exited immediately. The stream may be unavailable. Try another stream.`,
        }],
      };
    }
  }
);

// Tool 4: Check playback status (for auto-next episode)
server.registerTool(
  "ironhide_status",
  {
    description: "Check if the current/last playback has finished. Returns completion status and next episode info if applicable. Call this after playing a TV episode to detect when the user finishes and offer the next episode. If status is 'playing' (mpv still open), wait and check again later.",
    inputSchema: {},
  },
  async () => {
    if (!globalPlaybackStatus) {
      // Check if mpv is actually running
      if (await isMpvRunning()) {
        const np = await getNowPlaying().catch(() => null);
        if (np) {
          const pos = formatTime(np.position);
          const dur = formatTime(np.duration);
          const pct = np.percent.toFixed(0);
          const state = np.playing ? "▶ Playing" : "⏸ Paused";
          return { content: [{ type: "text", text: `Status: ${state}\nTitle: ${np.title}\nPosition: ${pos} / ${dur} (${pct}%)` }] };
        }
        return { content: [{ type: "text", text: "Status: mpv is running but no playback info available" }] };
      }
      return { content: [{ type: "text", text: "Status: idle — mpv is not running, nothing is playing" }] };
    }

    const s = globalPlaybackStatus;
    const pct = s.progress?.percent?.toFixed(0) || "0";
    const watched = s.progress ? formatTime(s.progress.position) : "?";
    const total = s.progress ? formatTime(s.progress.duration) : "?";

    let text = `Status: ${s.status}\nTitle: ${s.title}\nWatched: ${watched} / ${total} (${pct}%)`;

    if (s.nextEpisode) {
      text += `\n\nEpisode completed! Next up: S${String(s.nextEpisode.season).padStart(2, "0")}E${String(s.nextEpisode.episode).padStart(2, "0")}`;
      text += `\nIMDB: ${s.imdbId}`;
      text += `\n\nAsk the user if they want to watch the next episode. If yes, call ironhide_streams with the next season/episode, then ironhide_play.`;
    } else if (s.status === "stopped") {
      text += `\n\nUser stopped before finishing (${pct}%). Position saved for resume.`;
    } else if (s.status === "completed" && !s.nextEpisode) {
      text += `\n\nMovie completed!`;
    }

    // Include pending rating info
    if (pendingRating) {
      text += `\n\n⭐ RATING NEEDED: Ask the user to rate "${pendingRating.title}" using AskUserQuestion. Use ironhide_rate with their rating afterward.`;
      text += `\nIMDB for rating: ${pendingRating.imdbId}`;
    }

    // Clear status after reading
    globalPlaybackStatus = null;

    return { content: [{ type: "text", text: text + UX_RULE }] };
  }
);

// Tool: Now Playing — live mpv status via IPC socket
server.registerTool(
  "ironhide_nowplaying",
  {
    description: "Get real-time playback status from mpv. Shows what's currently playing, position, whether paused or playing, current audio/subtitle track. Returns null if mpv is not running. Use this to check on the user's viewing session.",
    inputSchema: {},
  },
  async () => {
    if (!await isMpvRunning()) {
      return { content: [{ type: "text", text: "mpv is not running. No active playback." }] };
    }

    const np = await getNowPlaying();
    if (!np) {
      return { content: [{ type: "text", text: "mpv socket exists but could not get playback info." }] };
    }

    const status = np.playing ? "▶ Playing" : "⏸ Paused";
    const pos = formatTime(np.position);
    const dur = formatTime(np.duration);
    const pct = np.percent.toFixed(0);
    const remaining = formatTime(np.duration - np.position);

    let text = `${status}: ${np.title}\n`;
    text += `Position: ${pos} / ${dur} (${pct}%) — ${remaining} remaining\n`;
    text += `Audio: ${np.audio}\n`;
    text += `Subtitle: ${np.subtitle}\n`;

    if (np.audioTracks.length > 1) {
      text += `\nAudio tracks available:\n`;
      np.audioTracks.forEach(t => {
        const sel = t.selected ? "→ " : "  ";
        text += `${sel}${t.id}. ${t.language} ${t.codec} ${t.channels}ch ${t.title}\n`;
      });
    }

    if (np.subTracks.length > 0) {
      text += `\nSubtitle tracks available:\n`;
      np.subTracks.forEach(t => {
        const sel = t.selected ? "→ " : "  ";
        text += `${sel}${t.id}. ${t.language} ${t.title}${t.external ? " (external)" : ""}\n`;
      });
    }

    return { content: [{ type: "text", text }] };
  }
);

// Tool: Control mpv player
server.registerTool(
  "ironhide_control",
  {
    description: `Control the mpv player remotely. Available actions:
- pause / play / toggle — pause or resume playback
- stop — quit mpv
- seek_forward / seek_back — skip forward/back by given seconds (default 30)
- seek_to — jump to a specific time in seconds
- seek_percent — jump to a percentage (e.g. 50 for halfway)
- volume_up / volume_down — adjust volume by given amount (default 10)
- volume_set — set volume to exact level (0-150)
- mute — toggle mute
- audio_track — switch audio track by ID number
- subtitle_track — switch subtitle track by ID number
- subtitles_off — disable subtitles
- fullscreen — toggle fullscreen
- speed — set playback speed (e.g. 1.5, 2.0, 0.5)
- screenshot — take a screenshot

Use ironhide_nowplaying first to see available tracks before switching audio/subtitle.`,
    inputSchema: {
      action: z.enum([
        "pause", "play", "toggle",
        "stop",
        "seek_forward", "seek_back", "seek_to", "seek_percent",
        "volume_up", "volume_down", "volume_set", "mute",
        "audio_track", "subtitle_track", "subtitles_off",
        "fullscreen",
        "speed",
        "screenshot",
      ]).describe("The control action to perform"),
      value: z.number().optional().describe("Value for the action: seconds for seek, volume level, track ID, speed multiplier, etc."),
    },
  },
  async ({ action, value }) => {
    if (!await isMpvRunning()) {
      return { content: [{ type: "text", text: "mpv is not running." }] };
    }

    try {
      let result;
      switch (action) {
        case "pause":
          await pause();
          result = "⏸ Paused";
          break;
        case "play":
          await resume();
          result = "▶ Playing";
          break;
        case "toggle":
          result = (await togglePause()) === "paused" ? "⏸ Paused" : "▶ Playing";
          break;
        case "stop":
          await stop();
          result = "⏹ Stopped";
          break;
        case "seek_forward":
          await seek(value || 30);
          result = `⏩ Skipped forward ${value || 30}s`;
          break;
        case "seek_back":
          await seek(-(value || 30));
          result = `⏪ Skipped back ${value || 30}s`;
          break;
        case "seek_to":
          if (value == null) return { content: [{ type: "text", text: "Need a value (seconds) for seek_to" }] };
          await seekAbsolute(value);
          result = `Jumped to ${formatTime(value)}`;
          break;
        case "seek_percent":
          if (value == null) return { content: [{ type: "text", text: "Need a value (0-100) for seek_percent" }] };
          await seekPercent(value);
          result = `Jumped to ${value}%`;
          break;
        case "volume_up":
          const newUp = await adjustVolume(value || 10);
          result = `🔊 Volume: ${Math.round(newUp)}%`;
          break;
        case "volume_down":
          const newDown = await adjustVolume(-(value || 10));
          result = `🔉 Volume: ${Math.round(newDown)}%`;
          break;
        case "volume_set":
          if (value == null) return { content: [{ type: "text", text: "Need a value (0-150) for volume_set" }] };
          await setVolume(value);
          result = `🔊 Volume set to ${value}%`;
          break;
        case "mute":
          result = (await toggleMute()) === "muted" ? "🔇 Muted" : "🔊 Unmuted";
          break;
        case "audio_track":
          if (value == null) return { content: [{ type: "text", text: "Need a track ID. Use ironhide_nowplaying to see available tracks." }] };
          await setAudioTrack(value);
          result = `🔊 Switched to audio track ${value}`;
          break;
        case "subtitle_track":
          if (value == null) return { content: [{ type: "text", text: "Need a track ID. Use ironhide_nowplaying to see available tracks." }] };
          await setSubtitleTrack(value);
          result = `💬 Switched to subtitle track ${value}`;
          break;
        case "subtitles_off":
          await disableSubtitles();
          result = "💬 Subtitles disabled";
          break;
        case "fullscreen":
          result = (await toggleFullscreen()) === "fullscreen" ? "🖥 Fullscreen" : "🪟 Windowed";
          break;
        case "speed":
          if (value == null) return { content: [{ type: "text", text: "Need a speed value (e.g. 1.5, 2.0, 0.5)" }] };
          await setSpeed(value);
          result = `⚡ Speed: ${value}x`;
          break;
        case "screenshot":
          result = await screenshot();
          result = "📸 Screenshot saved";
          break;
        default:
          result = `Unknown action: ${action}`;
      }
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool: Instant resume from history — no search needed
server.registerTool(
  "ironhide_resume",
  {
    description: "Instantly resume a title from watch history. Uses the saved stream URL/magnet — no need to search for streams again. Much faster than the search→streams→play flow. Use this when the user wants to continue something they've already watched.",
    inputSchema: {
      imdbId: z.string().describe("IMDB ID from watch history"),
    },
  },
  async ({ imdbId }) => {
    const entry = await getLastWatched(imdbId);
    if (!entry) {
      return { content: [{ type: "text", text: "Not found in watch history." }] };
    }

    const hasStream = entry.streamUrl || entry.streamMagnet || entry.streamTorrentLink;
    if (!hasStream) {
      return { content: [{ type: "text", text: `Found "${entry.title}" in history but no saved stream. Use ironhide_streams to find a new one.` }] };
    }

    // Build a stream object from history
    const stream = {
      isRD: entry.streamIsRD || false,
      url: entry.streamUrl,
      magnet: entry.streamMagnet,
      torrentLink: entry.streamTorrentLink,
      quality: entry.quality,
    };

    const resumeFrom = (entry.percent < 90 && entry.position > 0) ? entry.position : 0;

    // Set globalMeta so the background monitor knows what's playing
    globalMeta = {
      title: entry.title,
      imdbId: entry.imdbId,
      type: entry.type,
      season: entry.season,
      episode: entry.episode,
    };

    // Fetch subtitles in parallel
    const subs = await fetchSubtitles(entry.imdbId, entry.season, entry.episode).catch(() => []);

    const onFinish = async (progress) => {
      if (progress) {
        await updateLatestProgress(progress).catch(() => {});
      }
    };

    const result = await playDetached(stream, subs, onFinish, resumeFrom);

    if (result.status === "not_cached") {
      return { content: [{ type: "text", text: "⏳ Stream no longer cached on Real-Debrid. Use ironhide_streams to find a new one." }] };
    }

    if (result.status === "error") {
      return { content: [{ type: "text", text: "Failed to launch player." }] };
    }

    // Save fresh history entry
    await addToHistory({
      ...entry,
      watchedAt: undefined,
    }).catch(() => {});

    const ep = entry.season ? ` S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}` : "";
    const resumeInfo = resumeFrom > 0 ? ` from ${formatTime(resumeFrom)}` : "";
    const subInfo = subs.length > 0 ? ` | Subs: ${subs.map(s => s.lang).join(", ")}` : "";

    const watcherHint = `\n\nIMPORTANT: You MUST now run this background task to detect when mpv closes:\nBash(command: "while echo '{}' | nc -U -w1 /tmp/ironhide-mpv.sock >/dev/null 2>&1; do sleep 2; done; rm -f /tmp/ironhide-mpv.sock; echo IRONHIDE_MPV_CLOSED", run_in_background: true)\nWhen notified it completed, call ironhide_status and proactively ask the user to rate what they watched.`;

    return {
      content: [{
        type: "text",
        text: `▶ Resuming ${entry.title}${ep}${resumeInfo}\n${entry.quality}${subInfo}\n\nmpv is opening.${watcherHint}`,
      }],
    };
  }
);

// Tool: Watch history
server.registerTool(
  "ironhide_history",
  {
    description: "Get the user's watch history. Shows recently watched movies/TV episodes with dates and how much was watched. Use this to suggest 'continue watching' or to know what they've already seen.",
    inputSchema: {
      limit: z.number().default(10).describe("Number of history entries to return"),
    },
  },
  async ({ limit }) => {
    const history = await getHistory(limit);
    if (history.length === 0) {
      return { content: [{ type: "text", text: "No watch history yet." }] };
    }

    const lines = history.map((h) => {
      const date = h.watchedAt.slice(0, 10);
      const ep = h.season ? ` S${String(h.season).padStart(2, "0")}E${String(h.episode).padStart(2, "0")}` : "";
      let progress = "";
      if (h.percent != null) {
        const completed = h.percent >= 90;
        if (completed) {
          progress = ` — COMPLETED`;
          if (h.duration) progress += ` (${formatTime(h.duration)})`;
        } else {
          progress = ` — ${h.percent.toFixed(0)}% watched`;
          if (h.duration) progress += ` (${formatTime(h.position)} / ${formatTime(h.duration)}) NOT FINISHED`;
        }
      } else {
        progress = ` — no progress data`;
      }
      const resumeInfo = (h.position && h.percent < 90) ? ` [resumeFrom:${h.position.toFixed(0)}]` : "";
      return `${date}  ${h.title}${ep}${progress}  [${h.imdbId}]${resumeInfo}`;
    });

    return { content: [{ type: "text", text: lines.join("\n") + UX_RULE }] };
  }
);

// Tool: Cast to Samsung TV
server.registerTool(
  "ironhide_cast_tv",
  {
    description: "Cast a stream to the Samsung TV instead of playing on Mac. Only works with Real-Debrid cached streams. If the IronHide TizenBrew app is connected, plays natively on the TV with full codec support and seeking. Falls back to DLNA proxy if the app isn't running. Use this when the user says 'play on TV', 'cast to TV', 'put it on the big screen', etc.",
    inputSchema: {
      index: z.number().describe("Stream number from ironhide_streams results (1-based)"),
    },
  },
  async ({ index }) => {
    if (globalStreams.length === 0) {
      return { content: [{ type: "text", text: "No streams loaded. Run ironhide_streams first." }] };
    }

    const stream = globalStreams[index - 1];
    if (!stream) {
      return { content: [{ type: "text", text: `Invalid index. Pick 1-${globalStreams.length}.` }] };
    }

    if (!stream.isRD) {
      return { content: [{ type: "text", text: "TV casting only works with ⚡RD streams. Pick a Real-Debrid cached stream." }] };
    }

    try {
      const title = globalMeta.title || 'IronHide';
      const ep = globalMeta.season ? ` S${String(globalMeta.season).padStart(2, "0")}E${String(globalMeta.episode).padStart(2, "0")}` : "";
      const fullTitle = `${title}${ep}`;

      // Resolve RD redirect to get direct URL
      const res = await fetch(stream.url, { redirect: 'manual' });
      const directUrl = res.headers.get('location');
      if (!directUrl) throw new Error('Could not resolve RD URL — stream may not be cached');

      // Save to history
      await addToHistory({
        title: globalMeta.title || stream.quality.slice(0, 40),
        imdbId: globalMeta.imdbId || "",
        type: globalMeta.type || "movie",
        season: globalMeta.season,
        episode: globalMeta.episode,
        quality: stream.quality.slice(0, 80),
        streamUrl: stream.url,
        streamIsRD: true,
      }).catch(() => {});

      // Learn quality preference
      if (globalMeta.imdbId) {
        await learnQuality(globalMeta.imdbId, stream).catch(() => {});
      }

      // Native TizenBrew app path (preferred)
      if (await isTVConnectedAsync()) {
        // Route through HLS proxy to transcode audio to AAC
        // (Samsung TV HTML5 player can't decode many audio codecs natively)
        const proxyUrl = await startTizenProxy(directUrl);
        await nativePlay(proxyUrl, fullTitle);

        const tvWatcherHint = `\n\nIMPORTANT: Do NOT start the mpv socket watcher. Instead start the TV watcher:\nBash(command: "node /Users/Manteh/ironhide/src/tv-watcher.js", run_in_background: true)\nWhen notified it completed (IRONHIDE_TV_STOPPED), call ironhide_tv_control(action: "status") to get final position, then ask for a rating.`;

        return {
          content: [{
            type: "text",
            text: `📺 Now playing natively on Samsung TV!\n${fullTitle}\n${stream.quality.slice(0, 80)}\n${stream.size}\n\nPlaying on OG Bobby TV via IronHide app (native AVPlayer — full codec support, seeking works). Use ironhide_tv_control to pause/play/seek.${tvWatcherHint}`,
          }],
        };
      }

      // Fallback: DLNA proxy path
      const tvAvail = await isTVAvailable();
      if (!tvAvail) {
        return { content: [{ type: "text", text: "Samsung TV not found on the network. Is it turned on? (IronHide TizenBrew app also not connected)" }] };
      }

      await castStream(stream, fullTitle);

      const tvWatcherHint = `\n\nIMPORTANT: Do NOT start the mpv socket watcher. Instead start the TV watcher:\nBash(command: "node /Users/Manteh/ironhide/src/tv-watcher.js", run_in_background: true)\nWhen notified it completed (IRONHIDE_TV_STOPPED), call ironhide_tv_control(action: "status") to get final position, then ask for a rating.`;

      return {
        content: [{
          type: "text",
          text: `📺 Now casting to Samsung TV (DLNA fallback — TizenBrew app not connected)\n${fullTitle}\n${stream.quality.slice(0, 80)}\n${stream.size}\n\nPlaying on OG Bobby TV. Use ironhide_tv_control to pause/play/seek/volume.${tvWatcherHint}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `TV cast failed: ${err.message}` }] };
    }
  }
);

// Tool: TV remote control
server.registerTool(
  "ironhide_tv_control",
  {
    description: `Control playback on the Samsung TV. Works with both native IronHide app (TizenBrew) and DLNA. Available actions:
- pause — pause playback
- play — resume playback
- stop — stop and disconnect
- seek — jump to time. Value can be absolute "H:MM:SS" or relative "+300" (forward 5min) / "-60" (back 1min)
- volume_set — set TV volume (value: 0-100) (DLNA only)
- status — get current playback state and position`,
    inputSchema: {
      action: z.enum(["pause", "play", "stop", "seek", "volume_set", "status"]).describe("TV control action"),
      value: z.string().optional().describe("Value: time for seek (HH:MM:SS or +/-seconds), number for volume"),
    },
  },
  async ({ action, value }) => {
    // Native TizenBrew app path
    if (await isTVConnectedAsync()) {
      try {
        switch (action) {
          case "pause":
            await nativePause();
            return { content: [{ type: "text", text: "📺 ⏸ TV paused (native)" }] };
          case "play":
            await nativeResume();
            return { content: [{ type: "text", text: "📺 ▶ TV playing (native)" }] };
          case "stop":
            await nativeStop();
            stopTizenProxy();
            return { content: [{ type: "text", text: "📺 ⏹ TV stopped (native)" }] };
          case "seek": {
            if (!value) return { content: [{ type: "text", text: "Need a time value (HH:MM:SS) or seconds offset like +300 or -60" }] };

            if (value.startsWith('+') || value.startsWith('-')) {
              const offsetMs = parseInt(value, 10) * 1000;
              await nativeSeek(offsetMs, true);
              return { content: [{ type: "text", text: `📺 Seeked ${value}s (native)` }] };
            } else {
              let ms;
              if (value.includes(':')) {
                ms = hmsToSeconds(value) * 1000;
              } else {
                ms = parseInt(value, 10) * 1000;
              }
              await nativeSeek(ms, false);
              return { content: [{ type: "text", text: `📺 Seeked to ${value} (native)` }] };
            }
          }
          case "volume_set":
            return { content: [{ type: "text", text: "Volume control not available via native app. Use the TV remote or Samsung TV MCP." }] };
          case "status": {
            const status = await nativeGetStatus(2000);
            const pos = secondsToHMS(Math.floor((status.position || 0) / 1000));
            const dur = secondsToHMS(Math.floor((status.duration || 0) / 1000));
            return {
              content: [{
                type: "text",
                text: `📺 TV Status (native): ${status.state}\nPosition: ${pos} / ${dur}${status.title ? `\nTitle: ${status.title}` : ''}${status.isBuffering ? '\nBuffering...' : ''}`,
              }],
            };
          }
        }
      } catch (err) {
        return { content: [{ type: "text", text: `TV control error (native): ${err.message}` }] };
      }
    }

    // DLNA fallback path
    try {
      switch (action) {
        case "pause":
          await dlnaPause();
          return { content: [{ type: "text", text: "📺 ⏸ TV paused" }] };
        case "play":
          await dlnaPlay();
          return { content: [{ type: "text", text: "📺 ▶ TV playing" }] };
        case "stop":
          await dlnaStop();
          return { content: [{ type: "text", text: "📺 ⏹ TV stopped, proxy closed" }] };
        case "seek": {
          if (!value) return { content: [{ type: "text", text: "Need a time value (HH:MM:SS) or seconds offset like +300 or -60" }] };

          let seekTime;
          if (value.startsWith('+') || value.startsWith('-')) {
            const pos = await tvGetPosition().catch(() => ({ position: '0:00:00' }));
            const currentSec = hmsToSeconds(pos.position);
            const newSec = Math.max(0, currentSec + parseInt(value, 10));
            seekTime = secondsToHMS(newSec);
          } else if (value.includes(':')) {
            seekTime = value;
          } else {
            seekTime = secondsToHMS(parseInt(value, 10));
          }

          // Use DLNA ABS_TIME seek (works on Samsung even if it returns error)
          await dlnaSeek(seekTime);
          // Verify
          await new Promise(r => setTimeout(r, 1000));
          const posAfter = await tvGetPosition().catch(() => ({ position: '?' }));
          return { content: [{ type: "text", text: `📺 Seeked to ${seekTime} (position: ${posAfter.position})` }] };
        }
        case "volume_set":
          if (!value) return { content: [{ type: "text", text: "Need a volume value (0-100)" }] };
          await dlnaSetVolume(parseInt(value, 10));
          return { content: [{ type: "text", text: `📺 Volume set to ${value}` }] };
        case "status": {
          const [state, pos, vol] = await Promise.all([
            tvGetTransportState(),
            tvGetPosition().catch(() => ({ position: '?', duration: '?' })),
            dlnaGetVolume().catch(() => '?'),
          ]);
          return {
            content: [{
              type: "text",
              text: `📺 TV Status: ${state.state}\nPosition: ${pos.position} / ${pos.duration}\nVolume: ${vol}`,
            }],
          };
        }
        default:
          return { content: [{ type: "text", text: `Unknown action: ${action}` }] };
      }
    } catch (err) {
      return { content: [{ type: "text", text: `TV control error: ${err.message}` }] };
    }
  }
);

// Tool: Rate a title
server.registerTool(
  "ironhide_rate",
  {
    description: "Save a rating for a movie or TV show the user just watched. Call this after asking the user for their rating via AskUserQuestion. The rating feeds into their taste profile for better recommendations.",
    inputSchema: {
      imdbId: z.string().describe("IMDB ID of the title"),
      title: z.string().describe("Title name"),
      type: z.enum(["movie", "tv"]).default("movie"),
      rating: z.number().min(1).max(5).describe("Rating from 1-5 stars"),
      liked: z.array(z.string()).optional().describe("What they liked, e.g. ['acting', 'visuals', 'story', 'soundtrack', 'action', 'humor', 'suspense', 'characters']"),
      disliked: z.array(z.string()).optional().describe("What they didn't like, e.g. ['pacing', 'ending', 'dialogue', 'predictable', 'too long', 'boring']"),
      notes: z.string().optional().describe("Free-form thoughts from the user"),
      genres: z.array(z.string()).optional().describe("Genres of the title, e.g. ['Action', 'Sci-Fi']. Get from TMDB if not provided."),
    },
  },
  async ({ imdbId, title, type, rating, liked, disliked, notes, genres }) => {
    await addRating({ imdbId, title, type, rating, liked, disliked, notes, genres });

    // Clear pending rating
    if (pendingRating?.imdbId === imdbId) {
      pendingRating = null;
    }

    const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
    let text = `${stars} Rated "${title}" ${rating}/5`;
    if (liked?.length) text += `\nLiked: ${liked.join(", ")}`;
    if (disliked?.length) text += `\nDisliked: ${disliked.join(", ")}`;
    if (notes) text += `\nNotes: ${notes}`;
    text += `\n\nSaved to taste profile!`;

    return { content: [{ type: "text", text }] };
  }
);

// Tool: Get taste profile for recommendations
server.registerTool(
  "ironhide_taste",
  {
    description: "Get the user's taste profile built from their ratings. Shows favorite genres, what they typically like/dislike in movies, recent favorites, and rating distribution. Use this to make better recommendations — tailor suggestions to their proven preferences.",
    inputSchema: {},
  },
  async () => {
    const profile = await getTasteProfile();
    if (!profile) {
      return { content: [{ type: "text", text: "No taste profile yet — the user hasn't rated anything. Ask them to rate something after watching!" }] };
    }

    let text = `Taste Profile (${profile.totalRatings} ratings, avg ${profile.avgRating}/5)\n`;

    if (profile.genreRanking.length > 0) {
      text += `\nGenre preferences (by avg rating):\n`;
      profile.genreRanking.slice(0, 8).forEach(g => {
        text += `  ${g.genre}: ${g.avg.toFixed(1)}/5 (${g.count} titles)\n`;
      });
    }

    if (profile.topLiked.length > 0) {
      text += `\nThings they love: ${profile.topLiked.map(l => `${l.tag} (${l.count}x)`).join(", ")}\n`;
    }

    if (profile.topDisliked.length > 0) {
      text += `Things they dislike: ${profile.topDisliked.map(d => `${d.tag} (${d.count}x)`).join(", ")}\n`;
    }

    if (profile.favorites.length > 0) {
      text += `\nRecent favorites (4-5★):\n`;
      profile.favorites.forEach(f => {
        const stars = "★".repeat(f.rating);
        text += `  ${stars} ${f.title}\n`;
      });
    }

    if (profile.disliked.length > 0) {
      text += `\nRecent dislikes (1-2★):\n`;
      profile.disliked.forEach(d => {
        const stars = "★".repeat(d.rating);
        text += `  ${stars} ${d.title}\n`;
      });
    }

    text += `\nUse this profile to recommend titles that match their preferences. Avoid genres and aspects they consistently dislike.`;

    return { content: [{ type: "text", text }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("IronHide MCP server running");
}

main().catch(console.error);
