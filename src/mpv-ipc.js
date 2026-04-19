import { connect } from 'net';
import { existsSync } from 'fs';

const SOCKET_PATH = '/tmp/ironhide-mpv.sock';

function sendCommand(command) {
  return new Promise((resolve, reject) => {
    if (!existsSync(SOCKET_PATH)) {
      reject(new Error('mpv not running'));
      return;
    }

    const client = connect(SOCKET_PATH);
    let data = '';

    client.setTimeout(2000);

    client.on('connect', () => {
      client.write(JSON.stringify({ command }) + '\n');
    });

    client.on('data', (chunk) => {
      data += chunk.toString();
      const lines = data.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if ('error' in parsed) {
            client.end();
            if (parsed.error === 'success') {
              resolve(parsed.data);
            } else {
              reject(new Error(parsed.error));
            }
            return;
          }
        } catch {}
      }
    });

    client.on('timeout', () => { client.end(); reject(new Error('timeout')); });
    client.on('error', (err) => { reject(err); });
  });
}

async function getProperty(name) {
  return sendCommand(['get_property', name]);
}

async function setProperty(name, value) {
  return sendCommand(['set_property', name, value]);
}

// ── Status ──

export async function getNowPlaying() {
  try {
    const [pos, duration, paused, title, trackList, volume, muted, fullscreen, speed] = await Promise.all([
      getProperty('time-pos').catch(() => null),
      getProperty('duration').catch(() => null),
      getProperty('pause').catch(() => null),
      getProperty('media-title').catch(() => null),
      getProperty('track-list').catch(() => []),
      getProperty('volume').catch(() => 100),
      getProperty('mute').catch(() => false),
      getProperty('fullscreen').catch(() => false),
      getProperty('speed').catch(() => 1),
    ]);

    if (pos === null && duration === null) return null;

    const percent = duration > 0 ? (pos / duration * 100) : 0;

    const audioTracks = (trackList || [])
      .filter(t => t.type === 'audio')
      .map(t => ({
        id: t.id,
        selected: t.selected || false,
        language: t.metadata?.language || t.lang || 'unknown',
        codec: t.codec || '',
        channels: t['demux-channel-count'] || 0,
        title: t.metadata?.title || t.metadata?.name || '',
      }));

    const subTracks = (trackList || [])
      .filter(t => t.type === 'sub')
      .map(t => ({
        id: t.id,
        selected: t.selected || false,
        language: t.metadata?.language || t.lang || 'unknown',
        title: t.metadata?.title || t.metadata?.name || '',
        external: t.external || false,
      }));

    const selectedAudio = audioTracks.find(t => t.selected);
    const selectedSub = subTracks.find(t => t.selected);

    return {
      playing: !paused,
      position: pos || 0,
      duration: duration || 0,
      percent,
      title: title || 'Unknown',
      volume,
      muted,
      fullscreen,
      speed,
      audio: selectedAudio ? `${selectedAudio.language} ${selectedAudio.codec} ${selectedAudio.channels}ch` : 'unknown',
      subtitle: selectedSub ? `${selectedSub.language}${selectedSub.external ? ' (external)' : ''}` : 'none',
      audioTracks,
      subTracks,
    };
  } catch {
    return null;
  }
}

// ── Playback Control ──

export async function togglePause() {
  const paused = await getProperty('pause');
  await setProperty('pause', !paused);
  return !paused ? 'paused' : 'playing';
}

export async function pause() {
  await setProperty('pause', true);
}

export async function resume() {
  await setProperty('pause', false);
}

export async function stop() {
  await sendCommand(['quit']);
}

// ── Seeking ──

export async function seek(seconds) {
  await sendCommand(['seek', seconds, 'relative']);
}

export async function seekAbsolute(seconds) {
  await sendCommand(['seek', seconds, 'absolute']);
}

export async function seekPercent(percent) {
  await sendCommand(['seek', percent, 'absolute-percent']);
}

// ── Volume ──

export async function setVolume(vol) {
  await setProperty('volume', Math.max(0, Math.min(150, vol)));
}

export async function adjustVolume(delta) {
  const current = await getProperty('volume');
  await setProperty('volume', Math.max(0, Math.min(150, current + delta)));
  return current + delta;
}

export async function toggleMute() {
  const muted = await getProperty('mute');
  await setProperty('mute', !muted);
  return !muted ? 'muted' : 'unmuted';
}

// ── Tracks ──

export async function setAudioTrack(id) {
  await setProperty('aid', id);
}

export async function setSubtitleTrack(id) {
  await setProperty('sid', id);
}

export async function disableSubtitles() {
  await setProperty('sid', 'no');
}

// ── Display ──

export async function toggleFullscreen() {
  const fs = await getProperty('fullscreen');
  await setProperty('fullscreen', !fs);
  return !fs ? 'fullscreen' : 'windowed';
}

export async function setSpeed(speed) {
  await setProperty('speed', speed);
}

// ── Screenshot ──

export async function screenshot() {
  await sendCommand(['screenshot', 'video']);
  return 'screenshot saved';
}

// ── Util ──

export function isMpvRunning() {
  if (!existsSync(SOCKET_PATH)) return false;
  // File exists but might be stale — try connecting
  try {
    const client = connect(SOCKET_PATH);
    return new Promise((resolve) => {
      client.setTimeout(500);
      client.on('connect', () => { client.end(); resolve(true); });
      client.on('error', () => { resolve(false); });
      client.on('timeout', () => { client.end(); resolve(false); });
    });
  } catch {
    return false;
  }
}

export async function cleanupStaleSocket() {
  if (existsSync(SOCKET_PATH) && !(await isMpvRunning())) {
    const { unlinkSync } = await import('fs');
    try { unlinkSync(SOCKET_PATH); } catch {}
  }
}
