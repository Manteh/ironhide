// "Ask Orbie": talk (or type) to the app and it browses, shows trailers and plays for you.
//   stt   - speech to text: local whisper.cpp when this Mac has it, else OpenAI.
//   run   - one turn: the model thinks with tools. Data tools (find_titles) run here; screen tools (show_shelf, open_title,
//           play...) are streamed to the page as {t:'act'} lines and the page performs them. Spoken lines stream as {t:'say'}.
//   tts   - the voice, from OpenAI (the page plays it and the orb listens to it).
// Titles only ever come from TMDB through find_titles, so the model cannot invent something to play.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getConfig } from './config.js';
import { chart, shape, getJson, TMDB, tmdbKey } from './charts.js';
import { discoverFiltered, providers, THEMES } from './filters.js';
import { smartSearch } from './search.js';
import { getInfo, getTrailerComments } from './moviemeta.js';
import { getHistory, setEpisodesWatched } from './history.js';
import { recommend, recommendPool, personalize, tasteSummary, markSeen, notInterested, rate, invalidateRecommendations } from './recommend.js';
import { getWatchlist, getSettings } from './settings.js';
import { listFolders, addPreset, createFolder, findPreset, PRESETS } from './folders.js';
import { snapshot as socialSnapshot } from './social.js';

const OPENAI = process.env.ORBIE_OPENAI_BASE || 'https://api.openai.com/v1'; // the override is for tests
const key = () => getConfig().openai_api_key;
export const hasKey = () => !!key();
export const liveOn = () => getConfig().agent_live === true;
// what OpenAI actually said when a call failed (logged, and short enough to show)
async function why(r, what) {
  let msg = ''; try { const d = await r.clone().json(); msg = d?.error?.message || ''; } catch {}
  console.warn(`[agent] ${what} failed: ${r.status} ${msg}`.slice(0, 300));
  return `${msg.replace(/sk-[A-Za-z0-9_-]+/g, '***').slice(0, 110) || 'no details'} (${r.status})`;
}

// ---------- speech to text ----------
const WHISPER = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'].find(existsSync);
const WDIR = join(homedir(), '.cache', 'whisper-cpp');
const GOOD_MODELS = ['ggml-large-v3-turbo-q5_0.bin', 'ggml-large-v3-turbo.bin', 'ggml-small.en-q5_1.bin', 'ggml-small.en.bin', 'ggml-small-q5_1.bin', 'ggml-small.bin'].map((m) => join(WDIR, m));
const WMODEL_GOOD = GOOD_MODELS.find(existsSync);               // accurate enough to use first
const WMODEL = WMODEL_GOOD || [join(WDIR, 'ggml-base.en.bin')].find(existsSync); // the small one is only a last resort
async function localStt(wav) {
  const f = join(tmpdir(), `orbie-${randomBytes(6).toString('hex')}.wav`);
  await writeFile(f, wav);
  try {
    return await new Promise((res, rej) => execFile(WHISPER, ['-m', WMODEL, '-f', f, '-nt', '-np', '-l', 'en', '-t', '4', '--prompt', 'Movie and TV titles, actors, directors, genres, trailer, Netflix.'], { timeout: 20000 }, (e, out) => (e ? rej(e) : res(String(out).replace(/\[.*?\]/g, '').trim()))));
  } finally { unlink(f).catch(() => {}); }
}
export async function stt(wav) {
  if (wav.length < 44 + 16000 * 2 * 0.35) return ''; // under a third of a second: nothing was said (OpenAI answers 400 to very short audio)
  let err;
  if (WHISPER && WMODEL_GOOD) { try { const t = await localStt(wav); if (t) return t; } catch {} } // free and private, when a good model is installed
  if (key()) {
    for (const model of ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1']) {
      try {
        const fd = new FormData(); fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav'); fd.append('model', model); fd.append('language', 'en'); fd.append('temperature', '0');
        fd.append('prompt', 'A person talking to Orbie, a movie and TV app. Film and series titles, actors and directors, genres. Examples: Interstellar, The Dark Knight, Christopher Nolan, Zendaya, trailer, detective, Netflix.');
        const r = await fetch(`${OPENAI}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: fd, signal: AbortSignal.timeout(20000) });
        if (r.ok) return String((await r.json()).text || '').trim();
        err = `Could not transcribe: ${await why(r, `transcription (${model})`)}`;
        if (r.status === 401) { err = 'OpenAI refused the key.'; break; }
        if (r.status !== 404 && r.status !== 400) break; // try the next model only when this one is missing or unusable
      } catch (e) { err = 'Could not reach OpenAI to transcribe.'; break; }
    }
  }
  if (WHISPER && WMODEL && !WMODEL_GOOD) { try { const t = await localStt(wav); if (t) return t; } catch {} } // only the small model: used when OpenAI cannot be reached
  throw new Error(err || 'Add an OpenAI key in Settings → Connectors so Orbie can hear you.');
}

// ---------- the voice ----------
// ---------- a free voice: macOS's own, in the best female voice installed (Premium/Enhanced ones sound far better) ----------
let sayVoice = null;
const run1 = (cmd, args, input) => new Promise((res, rej) => { const p = execFile(cmd, args, { timeout: 20000, maxBuffer: 1 << 24 }, (e, out) => (e ? rej(e) : res(String(out)))); if (input != null) p.stdin.end(input); });
async function pickSayVoice() {
  if (sayVoice) return sayVoice;
  const forced = getConfig().tts_voice; if (forced) return (sayVoice = forced);
  let list = []; try { list = (await run1('say', ['-v', '?'])).split('\n').map((l) => /^(.+?)\s+(en_[A-Z]{2})\s/.exec(l)?.[1]?.trim()).filter(Boolean); } catch {}
  const fem = /^(ava|zoe|allison|samantha|susan|serena|kate|tessa|moira|karen|nicky|stephanie|joelle|evan_no)/i;
  const rank = (n) => (/premium/i.test(n) ? 0 : /enhanced/i.test(n) ? 3 : 6) + (fem.test(n) ? 0 : 2);
  return (sayVoice = [...list].sort((a, b) => rank(a) - rank(b))[0] || 'Samantha');
}
async function systemVoice(text, pick) {
  const voice = pick || await pickSayVoice(), f = join(tmpdir(), `orbie-say-${randomBytes(6).toString('hex')}.wav`);
  try {
    await run1('say', ['-v', voice, '-r', '195', '-o', f, '--file-format=WAVE', '--data-format=LEI16@24000', '-f', '-'], String(text).slice(0, 500));
    const buf = await (await import('node:fs/promises')).readFile(f), at = buf.indexOf('data');
    return { pcm: buf.subarray(at + 8) }; // 24 kHz 16-bit mono, the same as the other voice
  } finally { unlink(f).catch(() => {}); }
}
// ---------- the voice: the best one available, each falling back to the next ----------
const INSTR = 'You are Orbie: a calm, clever, warm woman in her thirties, a friend who knows films inside out. Natural, confident and quick, a little dry. Speak at a lively conversational pace with natural rhythm and no long pauses. Never salesy, never robotic.';
async function elevenVoice(text, voice) { // the most natural; Flash is the fast one. 24 kHz PCM comes back as it is made
  const c = getConfig(), vid = voice || c.eleven_voice || 'cgSgspJ2msm6clMCkdW9'; // "Sarah", a warm premade voice, free to use
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream?output_format=pcm_24000&optimize_streaming_latency=3`, { method: 'POST', headers: { 'xi-api-key': c.elevenlabs_api_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: String(text).slice(0, 500), model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.42, similarity_boost: 0.78, style: 0.25, use_speaker_boost: true } }), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(await why(r, 'elevenlabs voice'));
  return r;
}
async function azureVoice(text, voice) { // neural voices, streamed as raw 24 kHz PCM
  const c = getConfig(), m = /^([a-z0-9-]+):(.+)$/i.exec(String(c.azure_speech_key).trim()); if (!m) throw new Error('Azure key should look like region:key');
  const esc = String(text).slice(0, 500).replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
  const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${voice || c.azure_voice || 'en-US-AvaMultilingualNeural'}"><prosody rate="+6%">${esc}</prosody></voice></speak>`;
  const r = await fetch(`https://${m[1]}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': m[2], 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm', 'User-Agent': 'orbie' }, body: ssml, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(await why(r, 'azure voice'));
  return r;
}
async function openaiVoice(text, voice) {
  // tts-1 (the cheap, fast one) is the default; the newer voices (marin, cedar...) need gpt-4o-mini-tts and are picked on purpose
  const pick = voice || getConfig().openai_voice || 'nova', OLD = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  const VOICES = OLD.includes(pick) ? [['tts-1', pick]] : [['gpt-4o-mini-tts', pick], ['tts-1', 'nova']]; let last = '';
  for (const [model, voice] of VOICES) {
    const r = await fetch(`${OPENAI}/audio/speech`, { method: 'POST', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice, input: String(text).slice(0, 500), response_format: 'pcm', ...(model === 'gpt-4o-mini-tts' ? { instructions: INSTR } : { speed: 1.08 }) }), signal: AbortSignal.timeout(20000) });
    if (r.ok) return r;
    last = await why(r, `voice (${model}/${voice})`);
    if (r.status === 401 || r.status === 429) break; // no key, or no credit left: do not keep asking
  }
  throw new Error(last);
}
// written shorthand is turned into what a person would say (S2E9 is "season 2, episode 9", never "S two E nine")
export function speakable(t) {
  return String(t)
    .replace(/\bS(\d{1,2})\s?E(\d{1,3})\b/gi, 'season $1, episode $2').replace(/\bS(\d{1,2})\b(?=\W|$)/g, 'season $1')
    .replace(/\b(\d+)\.(\d+)\b/g, '$1 point $2')
    .replace(/\b(\d+(?:\.\d+)?)\/10\b/g, '$1 out of 10').replace(/\b(\d+)h\s?(\d+)m\b/g, '$1 hour $2 minutes').replace(/\b(\d+)\s?m\b(?=\W|$)/g, '$1 minutes')
    .replace(/\b2160p\b|\b4K\b/gi, 'four K').replace(/\b1080p\b/gi, 'ten eighty p').replace(/\bTMDB\b/g, 'T M D B').replace(/\bIMDb\b/g, 'I M D b').replace(/\bHDR\b/g, 'H D R')
    .replace(/\s*[—–]\s*/g, ', ').replace(/[“”]/g, '"');
}
const cool = new Map(); // a voice that ran out of credit (or refused the key) is skipped for a while, so every sentence does not wait on it first
const outOfCredit = (m) => /quota|credit|insufficient|billing|exceed|\(40[12]\)|\(429\)/i.test(String(m));
export async function ttsStream(text, over = {}) {
  text = speakable(text);
  const c = getConfig(), fns = { elevenlabs: elevenVoice, azure: azureVoice, openai: openaiVoice, system: systemVoice };
  if (over.engine && fns[over.engine]) return fns[over.engine](text, over.voice); // a preview from Settings: no fallback, so a problem shows
  if (over.engine === 'text' || c.agent_voice === 'text') return { silent: true };
  const want = c.agent_voice || (c.elevenlabs_api_key ? 'elevenlabs' : c.azure_speech_key ? 'azure' : key() ? 'openai' : 'system');
  const have = { elevenlabs: !!c.elevenlabs_api_key, azure: !!c.azure_speech_key, openai: !!key(), system: true };
  for (const p of [...new Set([want, 'elevenlabs', 'azure', 'openai', ...(c.agent_fallback === 'text' && want !== 'system' ? [] : ['system'])])]) {
    if (!have[p] || (cool.get(p) || 0) > Date.now()) continue;
    try { return await fns[p](text); }
    catch (e) { console.warn(`[agent] voice ${p} failed: ${String(e.message).slice(0, 160)}`); if (outOfCredit(e.message)) cool.set(p, Date.now() + 30 * 60e3); }
  }
  return c.agent_fallback === 'text' ? { silent: true } : systemVoice(text); // out of credit everywhere: the Mac's voice, or just the words
}

// the voices a person can pick from, per engine (premade/default ones, so no extra key permission is needed)
export const VOICES = {
  elevenlabs: [['21m00Tcm4TlvDq8ikWAM', 'Rachel', 'calm, American'], ['EXAVITQu4vr4xnSDxMaL', 'Sarah', 'soft, warm'], ['cgSgspJ2msm6clMCkdW9', 'Jessica', 'expressive, playful'], ['Xb7hH8MSUJpSbSDYk0k2', 'Alice', 'confident, British'], ['XrExE9yKIg1WjnnlVkGX', 'Matilda', 'warm, friendly'], ['pFZP5JQG7iQjIQuC4Bku', 'Lily', 'warm, British'], ['hpp4J3VqNfWAUOO0d1Us', 'Bella', 'bright, professional'],
    ['JBFqnCBsd6RMkjVDRZzb', 'George', 'warm, British male'], ['nPczCjzI2devNBz1zQrb', 'Brian', 'deep, American male'], ['onwK4e9ZLuTAKqWW03F9', 'Daniel', 'broadcaster, British male'], ['TX3LPaxmHKxFdv7VOQHJ', 'Liam', 'young, American male'], ['pNInz6obpgDQGcFmaJgB', 'Adam', 'deep male'], ['cjVigY5qzO86Huf0OWal', 'Eric', 'smooth male'], ['iP95p4xoKVk53GoZ742B', 'Chris', 'casual male']],
  azure: [['en-US-AvaMultilingualNeural', 'Ava', 'warm, natural'], ['en-US-EmmaMultilingualNeural', 'Emma', 'friendly'], ['en-US-JennyNeural', 'Jenny', 'clear, assistant'], ['en-US-AriaNeural', 'Aria', 'expressive'], ['en-US-MichelleNeural', 'Michelle', 'bright'], ['en-GB-SoniaNeural', 'Sonia', 'British'], ['en-GB-LibbyNeural', 'Libby', 'British, soft'], ['en-AU-NatashaNeural', 'Natasha', 'Australian'], ['en-IE-EmilyNeural', 'Emily', 'Irish'],
    ['en-US-AndrewMultilingualNeural', 'Andrew', 'warm male'], ['en-US-BrianMultilingualNeural', 'Brian', 'calm male'], ['en-US-GuyNeural', 'Guy', 'male'], ['en-US-DavisNeural', 'Davis', 'deep male'], ['en-GB-RyanNeural', 'Ryan', 'British male']],
  openai: [['nova', 'Nova', 'bright · cheap tts-1'], ['shimmer', 'Shimmer', 'soft · cheap tts-1'], ['alloy', 'Alloy', 'neutral · cheap tts-1'], ['fable', 'Fable', 'storyteller · cheap tts-1'], ['echo', 'Echo', 'male · cheap tts-1'], ['onyx', 'Onyx', 'deep male · cheap tts-1'],
    ['marin', 'Marin', 'most natural · costs a bit more'], ['cedar', 'Cedar', 'natural male · costs a bit more'], ['coral', 'Coral', 'friendly · costs a bit more'], ['sage', 'Sage', 'calm · costs a bit more'], ['verse', 'Verse', 'expressive · costs a bit more'], ['ballad', 'Ballad', 'gentle · costs a bit more'], ['ash', 'Ash', 'male · costs a bit more']],
};
export async function voiceMenu() {
  const c = getConfig(); let system = []; try { system = (await run1('say', ['-v', '?'])).split('\n').map((l) => /^(.+?)\s+(en_[A-Z]{2})\s/.exec(l)).filter(Boolean).map((m) => [m[1].trim(), m[1].trim().replace(/\s*\((Premium|Enhanced)\)/, ' · $1'), m[2]]); } catch {}
  return { fallback: c.agent_fallback, model: c.agent_model, engine: c.agent_voice || '', live: c.agent_live === true, have: { elevenlabs: !!c.elevenlabs_api_key, azure: !!c.azure_speech_key, openai: !!key(), system: true, text: true },
    current: { elevenlabs: c.eleven_voice || 'cgSgspJ2msm6clMCkdW9', azure: c.azure_voice || 'en-US-AvaMultilingualNeural', openai: c.openai_voice || 'nova', system: c.tts_voice || '' },
    lists: { text: [], elevenlabs: VOICES.elevenlabs, azure: VOICES.azure, openai: VOICES.openai, system: system.sort((a, b) => (/Premium|Enhanced/.test(b[1]) - /Premium|Enhanced/.test(a[1]))) } };
}

// ---------- tools ----------
const CHARTS = ['theaters', 'fresh', 'trending', 'popular', 'today', 'rising', 'for_you'];
const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const TOOLS = [
  fn('find_titles', 'Look up films and series. Use `query` for a title, person or description ("like Interstellar", "Christopher Nolan"); `chart` for what is on right now; otherwise filters. Returns numbered results with ids and, by itself, puts the best of them on screen as a shelf (set show false to just look up). You rarely need show_shelf after it.', {
    query: { type: 'string', description: 'a title or a description of a story, not a person' }, person: { type: 'string', description: 'an actor or director: returns their best known films and series' }, role: { type: 'string', enum: ['director', 'actor'], description: 'with person; director = films they directed' }, chart: { type: 'string', enum: CHARTS, description: 'theaters = in cinemas now, fresh = just released, for_you = picks from this person\'s taste' },
    type: { type: 'string', enum: ['movie', 'series'] }, genres: { type: 'array', items: { type: 'string' }, description: 'Action, Comedy, Crime, Drama, Horror, Mystery, Sci-Fi, Thriller...' }, exclude_genres: { type: 'array', items: { type: 'string' } },
    themes: { type: 'array', items: { type: 'string', enum: THEMES.map(([n]) => n) } }, year_from: { type: 'integer' }, year_to: { type: 'integer' }, min_rating: { type: 'number', description: 'TMDB rating 0-10' },
    countries: { type: 'array', items: { type: 'string' }, description: 'ISO codes like KR, FR' }, services: { type: 'array', items: { type: 'string' }, description: 'Netflix, Disney Plus, Max...' },
    sort: { type: 'string', enum: ['popular', 'rating', 'newest'] }, refresh: { type: 'boolean', description: 'true when asked to refresh, show different or new ones: never repeats a title already shown' }, style: { type: 'string', enum: ['top', 'gems', 'different', 'new'], description: 'with chart for_you: top = best matches, gems = well liked but lesser known, different = acclaimed outside their usual taste, new = recent releases' }, limit: { type: 'integer', description: 'how many titles; if the person asks for 10, pass 10 (up to 18); default 8' }, more: { type: 'boolean', description: 'true to ADD more titles to the shelf already on screen (the same search again, none repeated). Use this when asked for more, never repeat titles' }, shelf_title: { type: 'string', description: 'short title for the shelf that appears, e.g. "Detective picks"' }, show: { type: 'boolean', description: 'false to look something up without putting it on screen' },
  }),
  fn('show_shelf', 'Put a titled row of titles on screen (replaces the previous one). Pass imdbIds from find_titles, best first, 4 to 8 of them. Cards are then numbered 1.. in that order.', { title: { type: 'string' }, subtitle: { type: 'string' }, imdbIds: { type: 'array', items: { type: 'string' } } }, ['title', 'imdbIds']),
  fn('highlight', 'Point at one card on screen so the user sees which one you mean while you talk about it.', { n: { type: 'integer', description: 'card number, from 1' } }, ['n']),
  fn('open_title', "Open a title's page. Give a card number, an id, or just the title.", { imdbId: { type: 'string' }, n: { type: 'integer', description: 'the card number on screen' }, title: { type: 'string', description: 'the title, if it is not on screen' } }),
  fn('title_info', 'Facts about a title: story, cast, director, scores (IMDb, Rotten Tomatoes), awards, reviews and what people say under the trailer. Use it to answer questions about a title. Defaults to the open title page.', { imdbId: { type: 'string' }, n: { type: 'integer', description: 'or the card number on screen' }, title: { type: 'string' } }),
  fn('get_history', "What this person has watched lately, with how far they got and when. Use it for 'what did I watch', 'continue something', or to tailor picks."),
  fn('get_taste', "What this person likes: favourite genres, themes, people, how much the app knows."),
  fn('get_versions', 'The available versions (files) of a film or episode: resolution, size, HDR/Dolby, audio languages, cached or not, and which one is the best pick. This is what people mean by "versions", "files" or "qualities". Defaults to the open title; for a series pass season and episode (or the last one watched is used).', { imdbId: { type: 'string' }, n: { type: 'integer' }, title: { type: 'string' }, season: { type: 'integer' }, episode: { type: 'integer' } }),
  fn('open_versions', "Open the Versions picker on a title's page so the person can see and choose a version.", { imdbId: { type: 'string' }, n: { type: 'integer' }, title: { type: 'string' } }),
  fn('get_settings', "The person's settings: profile, appearance and playback preferences."),
  fn('change_settings', 'Change settings the way the person would in Settings. Only include what changes.', {
    playback: { type: 'object', properties: { quality: { type: 'string', enum: ['auto', '2160p', '1080p', '720p'] }, hdr: { type: 'string', enum: ['prefer', 'any', 'avoid'] }, remux: { type: 'string', enum: ['prefer', 'any', 'avoid'] }, cachedOnly: { type: 'boolean' }, autoNext: { type: 'boolean' }, autoSkipIntro: { type: 'boolean' }, notifyNewEpisodes: { type: 'boolean' }, ambientMode: { type: 'boolean' }, player: { type: 'string', enum: ['mpv', 'web'] } } },
    appearance: { type: 'object', properties: { theme: { type: 'string', enum: ['dark', 'midnight', 'light', 'system'] }, accent: { type: 'string', enum: ['auto', 'ember', 'indigo', 'orange', 'emerald', 'rose', 'sky'] }, density: { type: 'string', enum: ['comfortable', 'compact'] }, posterSize: { type: 'string', enum: ['xs', 's', 'm', 'l', 'xl'] }, layout: { type: 'string', enum: ['grid', 'detail', 'list'] }, motion: { type: 'string', enum: ['full', 'reduced'] } } } }),
  fn('rate_title', 'Rate titles 1 to 5 stars for the person (this teaches the recommendations). One or several.', { stars: { type: 'integer' }, imdbId: { type: 'string' }, n: { type: 'integer' }, title: { type: 'string' }, ns: { type: 'array', items: { type: 'integer' }, description: 'several card numbers' }, titles: { type: 'array', items: { type: 'string' } } }, ['stars']),
  fn('hide_title', 'Mark titles "Not for me" so they stop showing up. One or several at once (card numbers in ns, or names in titles).', { imdbId: { type: 'string' }, n: { type: 'integer' }, title: { type: 'string' }, ns: { type: 'array', items: { type: 'integer' } }, titles: { type: 'array', items: { type: 'string' } } }),
  fn('mark_watched', 'Mark titles as already seen (or one episode as watched). One or several at once: card numbers in ns, or names in titles. They are removed from the shelf and never suggested again; it says nothing about whether they were liked.', { imdbId: { type: 'string' }, n: { type: 'integer' }, title: { type: 'string' }, ns: { type: 'array', items: { type: 'integer' } }, titles: { type: 'array', items: { type: 'string' } }, season: { type: 'integer' }, episode: { type: 'integer' } }),
  fn('open_search', 'Open the search box with some text typed in.', { query: { type: 'string' } }, ['query']),
  fn('sort_versions', 'Sort the open Versions picker: best (default), largest, smallest, or seeders (most seeded first). Open the versions first.', { by: { type: 'string', enum: ['best', 'largest', 'smallest', 'seeders'] } }, ['by']),
  fn('filter_versions', 'Filter the open Versions picker. tier is the resolution group (all, 4k, 1080p, 720p, other); chips are the toggles shown (for example "Surround sound", "English audio", "Just this episode"); set each on or off.', { tier: { type: 'string' }, chips: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, on: { type: 'boolean' } }, required: ['name'] } } }),
  fn('play_version', 'Play one version from the open Versions picker: row is its position in the list as sorted (1 = first), or match is text from the row (a size like "2.34 GB", a release like "DSNP", "H.264", "English").', { row: { type: 'integer' }, match: { type: 'string' }, fullscreen: { type: 'boolean' } }),
  fn('add_collection', 'Add a collection (folder) to the shelf. A whole franchise with its watching order worked out when it is one we know (for example "The Lord of the Rings": the trilogy, The Hobbit, the series and the animated film, in release order and story order), or a collection of your own with the titles given. It opens afterwards so the person sees it.', { name: { type: 'string', description: 'the franchise or the collection name' }, titles: { type: 'array', items: { type: 'string' }, description: 'for a custom collection: the titles to put in it' } }, ['name']),
  fn('open_collection', 'Open one of the shelf collections (folders) so the person can see it.', { name: { type: 'string' } }, ['name']),
  fn('get_shelf', "The titles this person saved to their shelf (watch later)."),
  fn('get_friends', 'Friends: who is online, what they are watching, and any watch-together room.'),
  fn('point_at', 'Spotlight something on the app screen so the person sees it: a button, a section, a card or a piece of text (for example "Versions", "cast", "Rotten Tomatoes score", "Play"). Brings the app to the front, scrolls to it and highlights it. Use it whenever you talk about something on screen.', { what: { type: 'string', description: 'the words on or near the thing' } }, ['what']),
  fn('scroll', 'Scroll the screen (the open title page, or the app). Use `to` to jump to a section of a title page.', { direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom', 'left', 'right'], description: 'left and right scroll the shelf of picks sideways' }, to: { type: 'string', enum: ['comments', 'cast', 'reviews', 'similar', 'episodes'], description: 'section of the open title page' } }),
  fn('save_to_shelf', "Save a title to the person's shelf (watch later).", { imdbId: { type: 'string' }, n: { type: 'integer' }, title: { type: 'string' } }),
  fn('play_trailer', 'Play the trailer of the open title page. Open the title first.'),
  fn('go_back', 'Go back to where we were: closes the trailer and the title page and shows the shelf of picks again (if there is one). Use how trailer_only when the person only wants the trailer closed and to stay on the title page.', { how: { type: 'string', enum: ['to_shelf', 'trailer_only'] } }),
  fn('navigate', 'Go to a screen of the app.', { to: { type: 'string', enum: ['home', 'discover', 'collections', 'shelf', 'continue', 'taste', 'friends', 'profile', 'settings', 'updates', 'manifesto'] } }, ['to']),
  fn('play', 'Start playing a title (picks the best stream itself). Only when the user has clearly chosen it. A card number, an id or just the title works.', { imdbId: { type: 'string' }, n: { type: 'integer' }, title: { type: 'string' }, season: { type: 'integer' }, episode: { type: 'integer' }, fullscreen: { type: 'boolean' } }),
  fn('player_control', 'Control what is playing.', { action: { type: 'string', enum: ['pause', 'resume', 'seek', 'volume', 'mute', 'fullscreen', 'subtitles', 'close'] }, amount: { type: 'number', description: 'seconds for seek (negative = back); percent points for volume (negative = quieter)' } }, ['action']),
];
const UI_TOOLS = new Set(['sort_versions', 'filter_versions', 'play_version', 'point_at', 'change_settings', 'open_search', 'open_versions', 'scroll', 'save_to_shelf', 'show_shelf', 'highlight', 'open_title', 'play_trailer', 'go_back', 'navigate', 'play', 'player_control']);

// what Orbie (the app) is and does, so the voice can explain it and use it like its owner would
const KNOW = `ABOUT THE APP YOU ARE (Orbie)
Orbie is a private, invite-only Mac app for watching films and series. It finds a title, picks the best version (file) from the person's debrid service (TorBox), and plays it in its own player (or a web player); it can also cast to a Samsung TV. You ARE Orbie: speak as "I" about the app, never as a separate assistant.
Screens: Home ("For You": greeting, Resume, Continue watching, "Tonight I want" mood chips such as Tense, Adrenaline, Mind-bending, Scary, Cozy, Funny, Quick watch, Family, Binge, taste rows like "Because you loved ...", collection shelves). Tabs: For You, Collections (themed shelves: suspense, action, scary, sci-fi, animation, vibes, series, world cinema, countries, seasonal), Discover (filters: several genres with any/all and exclusions, release years, rating, IMDb and Rotten Tomatoes when an OMDb key is set, countries, themes like video games or superheroes, streaming-service logos), Today, Rising, New, Trending, Popular, In cinemas, Top rated, Hidden gems, Upcoming, Box office, Most watched, Surprise me, Shelf. Sidebar: Home, Search (also Cmd+K), Resume, Shelf (saved for later), Taste (the Taste Lab: swipe-rate cards, This-or-that duels, the board of favourites, stats), Friends (watch-together rooms, invites, who is online), Settings.
A title page has the backdrop, scores, cast, reviews, more like this, episodes with progress, a trailer, Play (best version), a Versions picker (resolution, size, HDR, audio languages, cached or not), Save, star rating with what stood out, and "Not for me".
The player: ambient mode (light around a smaller picture, key G), picture looks (Reference, Film, Dark room, Bright room, Shadow detail, Animation, Vivid), skip intro/recap/credits, speed, audio and subtitle tracks, picture-in-picture, chapters, volume, fullscreen.
Recommendations learn from ratings, what is watched and finished, the shelf, "Not for me" and duels, and show a match % and a reason.
Settings: Profile; Appearance (theme dark/midnight/light/system, accent, density, poster size, layout, motion); Playback (quality auto/2160p/1080p/720p, HDR, remux, cached only, auto next episode, auto skip intro, new-episode notifications, ambient mode, player mpv or web); Streams (languages, kinds of release to hide); Connectors (TorBox, TMDB, YouTube, OMDb, OpenAI keys); Friends; Nodes; Updates.
WHAT YOU CAN DO: everything the person can do by clicking, except entering keys or accounts: browse and filter, search, open titles and trailers, show versions and pick the best, play (fullscreen), control playback, read what is on screen, scroll, save to the shelf, rate, hide, mark watched, change settings, open any screen, read their history, taste, shelf and friends. You know what they like (given below). If asked how something works, explain it in your own words from this. Never say you cannot access something without trying the tool that does it.`;

const SYSTEM = `You are Orbie, the movie and TV app itself, speaking. Someone is sitting on a sofa with you on a big screen and talking to you. You control the app with tools while you talk.\n${KNOW}
- You are sitting in front of the TV with the person. You have real-time vision of what is currently on screen:
  • "cards": titles visible to the person (from the assistant shelf or the page in front of them, numbered 1..n)
  • "dossier": the title page currently open (its title, year, cast, synopsis, and versions)
  • "player": what is currently playing, position, duration, and paused state
- The person sees the screen clearly. When they say "that one", "the second one", "the horror movie", "the animated one", "who directed this", or "play the trailer", connect their intent to what is on screen right now!
- If a title page (dossier) is open on screen, words like "play", "play it", "trailer", "who is in this" refer to THAT open title directly.
- When asked to find or suggest titles by mood, vibe or description ("interesting detective movies coming out right now", "90s mind bending sci-fi"): use genres, themes, and chart fields (fresh, theaters, popular, for_you). Do not dump long sentences into query—query is for exact title names or people.
- The shelf of picks holds up to 10 cards across and scrolls sideways (scroll left or right); highlight scrolls to a card. Never say you cannot scroll the shelf.
- To show something in the app (the cast, the versions, a score, a section, a page), use scroll and point_at: they bring the app to the front, scroll and spotlight it. Do that instead of just describing it.
- Never write lists, numbering, bullets, dashes or symbols in what you say: only flowing sentences. To compare things, give the answer ("Age of Extinction is the lowest at 6.0 and Last Knight the highest at 6.1"), not a list of every item.
- Speak like a person: never say shorthand such as S2E9 or 1080p letter by letter; say "season 2, episode 9". Never read out a long list: for history or picks, mention the two or three that matter and sum up the rest ("mostly crime dramas lately").
- Act on your own. Do what they mean without asking permission; only ask first before something destructive (removing from history or the shelf, resetting settings, changing keys). Never say you did something unless the tool result says it worked, and read that result: if it says titles were removed, the shelf has changed; refill it with find_titles and more true.
- "I've seen these", "mark them as seen": mark_watched with ns (card numbers) or titles, all at once, then refill the shelf with new titles.
- The Versions picker can be sorted (best, largest, smallest, seeders), filtered (resolution group and the toggle chips) and a row can be played: use sort_versions, filter_versions and play_version, then read the screen text to tell them what is on top. Never say the picker cannot sort or filter.
- Collections on the shelf: add_collection adds a whole franchise in its watching order (it knows The Lord of the Rings, including The Hobbit and the series) or a custom one from titles; open_collection shows one. When they ask what order to watch something in, say it briefly (for a first watch: the order they were released) and offer to add it.
- Say as little as possible. The screen does the talking. When you just do something (open a title, trailer, go back, play, pause, skip, volume), say nothing at all, or at most two or three words.
- After a shelf appears, one short line (under 10 words), for example "Here you go." Do not describe the picks unless asked. Use show_shelf only to re-order or narrow what is already found.
- Only speak more when the user asked a question or asked for your opinion, and then one or two short sentences, under 20 words.
- Never ask follow-up questions or offer more ("Want a trailer?"). Never add commentary, recaps or tips nobody asked for. No filler like "Certainly".
- Sound like a friend: relaxed, direct, honest.
- To suggest things: find_titles (it puts the shelf on screen itself), then one short line. You may mention one or two by name.
- For an actor's or director's films use find_titles with the person field (role director for what they directed), not the query field.
- "The first one", "number 3", "that one", "the second": always pass n (the card number on screen), never the title field, and never guess a title. If you are not sure which card, ask.
- Picks must come from what the person likes. For "something for me", "surprise me", "picks" or any recommendation use chart for_you (ranked by their taste), narrowed with genres, type, years or a style (gems, different, new) when asked. Everything you find already leaves out what they have seen. When they say refresh, again, different or new ones, call find_titles with refresh true (same filters, or change the style): never show the same titles again, and check the new shelf really differs.
- Say in one short line why these fit them, from what you know about their taste.
- If the person asks for a number of picks, pass exactly that as limit and check that many appeared. To add more to a shelf, call find_titles again with more true: it adds new titles and never repeats. Never show a title twice.
- Only use titles and ids that find_titles returned. Never invent titles.
- "that one", "the second one", "the one with <actor>": resolve with the cards on screen (see the screen state). If it is truly unclear, ask a short question.
- Trailer: open_title then play_trailer. "Go back": go_back. Play only when they clearly pick one (play, with fullscreen true if asked).
- Controls (pause, skip, louder, subtitles, fullscreen): player_control. Scrolling and jumping to comments, cast or reviews on a title page: scroll. Questions about a title (story, cast, scores, what people say): title_info. "Versions", "files" or "qualities" of a film or episode (resolution, size, HDR, audio): get_versions, which also opens the Versions picker on screen so they can see it (open_versions opens it without looking anything up). What they watched or like: get_history, get_taste. Save for later: save_to_shelf. You can also read the saved shelf (get_shelf) and friends (get_friends), and everything visible on the screen is given to you as text. You can do all of these, so never say you cannot or that you do not have access: look it up with a tool or read the screen text first.
- Do the thing first. If something fails, say so plainly in one short sentence.
Current date: ${new Date().toISOString().slice(0, 10)}.`;

// ---------- one conversation (kept briefly, so "that one" and follow-ups work) ----------
let convo = { at: 0, turns: [], items: new Map(), seen: new Set() };
const fresh = () => { if (Date.now() - convo.at > 10 * 60e3) convo = { at: 0, turns: [], items: new Map(), seen: new Set() }; convo.at = Date.now(); };
const compact = (it, n) => ({ n, imdbId: it.imdbId, title: it.title, year: it.year, type: it.type, rating: it.rating || undefined, about: (it.overview || '').slice(0, 110) });

// a person's best known work (their directed films, or the films they acted in), most voted first, without documentaries and "Self" appearances
export async function filmography(name, role) {
  const found = (await getJson(`${TMDB}/search/person?api_key=${tmdbKey()}&query=${encodeURIComponent(name)}`).catch(() => ({}))).results || [];
  const p = found.find((x) => role === 'director' ? x.known_for_department === 'Directing' : true) || found[0]; if (!p) return [];
  const c = await getJson(`${TMDB}/person/${p.id}/combined_credits?api_key=${tmdbKey()}`).catch(() => ({}));
  const rows = role === 'director' ? (c.crew || []).filter((x) => x.job === 'Director') : (c.cast || []).filter((x) => !/self|himself|herself|archive/i.test(x.character || ''));
  const seen = new Set(), list = rows.filter((x) => x.poster_path && (x.media_type === 'movie' || x.media_type === 'tv') && (x.vote_count || 0) >= 400 && !(x.genre_ids || []).includes(99) && !seen.has(x.media_type + x.id) && seen.add(x.media_type + x.id))
    .sort((x, y) => (y.vote_count || 0) - (x.vote_count || 0)).slice(0, 14).map((x) => ({ ...x, _kind: x.media_type }));
  return shape(list.slice(0, 10), () => '');
}
// picks from your taste (the For You ranking), optionally narrowed (genre, type, years) or in a different mood (style)
async function forYou(a, lim) {
  const thisYear = new Date().getFullYear();
  let pool = await recommendPool();
  const filt = (l) => l.filter((x) => !convo.seen.has(x.imdbId) || !a.refresh)
    .filter((x) => (!a.type || x.type === a.type) && (!a.genres?.length || a.genres.some((g) => (x.genres || []).includes(g))) && (!a.exclude_genres?.length || !a.exclude_genres.some((g) => (x.genres || []).includes(g)))
      && (!a.year_from || +x.year >= a.year_from) && (!a.year_to || +x.year <= a.year_to) && (!a.min_rating || +x.rating >= a.min_rating));
  const style = (l) => (a.style === 'gems' ? l.filter((x) => (x.votes || 0) < 4000 && +x.rating >= 7.2) : a.style === 'different' ? l.filter((x) => x.explore) : a.style === 'new' ? l.filter((x) => +x.year >= thisYear - 1) : l.filter((x) => !x.explore).concat(l.filter((x) => x.explore).slice(0, 2)));
  let list = style(filt(pool));
  if (a.refresh && list.length < Math.min(lim, 6)) { pool = await recommendPool({ seed: Math.floor(Math.random() * 1e6), fresh: true }); list = style(filt(pool)); } // used up: build a new pool
  return list;
}
async function findTitles(a, region) {
  let list = [];
  const want = Math.min(18, Math.max(3, a.limit || 8)), lim = a.more ? Math.min(30, want + (convo.shown?.size || 0) + 4) : want; // "more" over-fetches, then drops what is already on screen
  if (a.person) {
    list = await filmography(a.person, a.role || '').catch(() => []);
    if (a.type) list = list.filter((t) => t.type === a.type);
  } else if (a.query) {
    let r = await smartSearch(a.query).catch(() => ({ titles: [] }));
    list = (r.titles || []).filter((t) => /^tt\d+$/.test(t.imdbId || ''));
    if (!list.length) {
      const qLower = a.query.toLowerCase();
      const isRecent = /\b(coming out|now playing|in cinemas?|in theaters?|new|fresh|latest|recent|202[4-6])\b/i.test(qLower);
      const genreMatch = /\b(detective|mystery|crime|noir|neo-noir|thriller|horror|action|comedy|sci-fi|adventure|drama|animation|fantasy|whodunit)\b/i.exec(qLower);
      if (isRecent) {
        list = (await chart('theaters', { type: a.type || '' }).catch(() => [])) || (await chart('fresh', { type: a.type || '' }).catch(() => [])) || [];
        if (genreMatch) {
          const gName = genreMatch[1] === 'detective' || genreMatch[1] === 'whodunit' ? 'mystery' : genreMatch[1];
          list = list.filter((t) => (t.genres || []).some((g) => g.toLowerCase().includes(gName)));
        }
      } else if (genreMatch) {
        const gName = genreMatch[1] === 'detective' || genreMatch[1] === 'whodunit' ? 'Mystery' : genreMatch[1];
        list = await discoverFiltered({ genres: gName, sort: 'popular', region, type: a.type || '' }).catch(() => []);
      }
    }
    if (a.type) list = list.filter((t) => (t.type === 'tv' ? 'series' : t.type) === a.type);
  } else if (a.chart === 'for_you') {
    list = await forYou(a, lim);
  } else if (a.chart && CHARTS.includes(a.chart)) {
    list = (await chart(a.chart, { type: a.type || '' }).catch(() => [])) || [];
  } else {
    const q = { type: a.type || '', genres: (a.genres || []).join(','), exclude: (a.exclude_genres || []).join(','), themes: (a.themes || []).join(','), yearFrom: a.year_from || '', yearTo: a.year_to || '', ratingMin: a.min_rating || '', countries: (a.countries || []).join(','), sort: a.sort || 'popular', region, mode: 'any', take: lim + 4 };
    if (a.services?.length) {
      const prov = await providers(region).catch(() => []);
      q.providers = a.services.map((s) => prov.find((p) => p.name.toLowerCase().includes(String(s).toLowerCase()))?.id).filter(Boolean).join(',');
    }
    if (a.refresh) q.page = 1 + Math.floor(Math.random() * 4); // a different page of results
    const constrained = a.countries?.length || a.themes?.length || a.services?.length || a.sort === 'rating' || a.sort === 'newest';
    const mine = constrained ? [] : await forYou(a, lim).catch(() => []); // their own taste-ranked picks that match (a genre, a decade...) come first
    const more = await personalize(await discoverFiltered(q).catch(() => []), { rerank: !constrained }); // then the wider catalogue, minus what they have seen
    const have = new Set(mine.map((x) => x.imdbId)); list = [...mine, ...more.filter((x) => !have.has(x.imdbId))];
  }
  if (!a.query && !a.person && a.chart && a.chart !== 'for_you') list = await personalize(list);
  if (a.refresh) list = list.filter((x) => !convo.seen.has(x.imdbId)); // a refresh never shows the same titles again
  if (a.more) list = list.filter((x) => !convo.shown?.has(x.imdbId));
  const seenIds = new Set(); list = list.filter((x) => x.imdbId && !seenIds.has(x.imdbId) && seenIds.add(x.imdbId)).slice(0, want);
  for (const it of list) { convo.items.set(it.imdbId, it); convo.seen.add(it.imdbId); }
  if (a.show !== false && list.length) { // what is on the shelf now, numbered as the person and the model see it
    const add = list.map((x) => ({ imdbId: x.imdbId, title: x.title, type: x.type, poster: x.poster, year: x.year }));
    const base = a.more ? (convo.turnShelf?.length ? convo.turnShelf : (convo.lastShelf || [])) : [];
    convo.turnShelf = convo.lastShelf = [...base, ...add.filter((x) => !base.some((b) => b.imdbId === x.imdbId))].map((x, i) => ({ ...x, n: i + 1 }));
  }
  return { list, out: { count: list.length, results: list.map((it, i) => compact(it, i + 1)) } };
}

async function histResult() {
  return (await getHistory(60).catch(() => [])).filter((h, i, all) => all.findIndex((x) => x.imdbId === h.imdbId && x.season === h.season && x.episode === h.episode) === i).slice(0, 25)
    .map((h) => ({ title: h.title, type: h.type, where: h.season ? `season ${h.season}, episode ${h.episode}` : undefined, watchedPercent: Math.round(h.percent || 0), when: String(h.watchedAt || '').slice(0, 10) }));
}
// a line about the person (name, settings, taste), refreshed every few minutes, given to the model every turn
let personCache = { at: 0, v: '' };
async function personLine() {
  if (Date.now() - personCache.at < 5 * 60e3) return personCache.v;
  const [st, t] = await Promise.all([getSettings().catch(() => ({})), tasteSummary().catch(() => ({}))]);
  const nm = (l, n) => (l || []).slice(0, n).map((x) => x.name).join(', ');
  const pb = st.playback || {};
  const v = `${st.profile?.name || 'The person'}. Plays in ${pb.player === 'web' ? 'the web player' : 'the Orbie player'}, quality ${pb.quality}, HDR ${pb.hdr}, ${pb.cachedOnly ? 'cached versions only' : 'any version'}, auto-next ${pb.autoNext ? 'on' : 'off'}, auto-skip intro ${pb.autoSkipIntro ? 'on' : 'off'}, ambient mode ${pb.ambientMode ? 'on' : 'off'}. Theme ${st.appearance?.theme}. Likes: ${nm(t.genres, 6) || 'still learning'}; themes: ${nm(t.themes, 6)}; people: ${nm(t.people, 5)}; tends to avoid: ${nm(t.avoid, 3) || 'nothing yet'}. Has watched ${t.watched ?? '?'} titles and rated ${t.rated ?? '?'}.`;
  personCache = { at: Date.now(), v }; return v;
}
// which title does a tool call mean? an id, a card number, a name (cards and earlier results first, then a search), or the open title page
async function resolveTitle(a, screen) {
  // numbers mean the shelf Orbie has just put up in this very turn, else the assistant shelf, else the page in front of them
  const turnCards = convo.turnShelf || [];
  const shelfCards = screen.shelfCards || screen.cards || [];
  const pageCards = screen.pageCards || [];
  const cards = turnCards.length ? turnCards : (shelfCards.length ? shelfCards : (pageCards.length ? pageCards : (convo.lastShelf || [])));

  const ORD = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10,
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    last: cards.length
  };

  const isGeneric = /^(this|that|it|this one|that one|the movie|the film|the show|current|this title)$/i.test(String(a.title || '').trim());
  let n = a.n;
  if (isGeneric) {
    a.title = undefined;
    if (screen.highlighted && cards[screen.highlighted - 1]) n = screen.highlighted;
  }

  const word = String(a.title || '').toLowerCase().replace(/^(the|number|no\.?|#)\s*/, '').replace(/\s*(one|pick|film|movie|show|card)$/, '').replace(/^(\d+)(st|nd|rd|th)$/, '$1').trim();
  if (!n && a.title && (ORD[word] || /^\d{1,2}$/.test(word))) n = ORD[word] || +word;

  const nm = (t) => String(t || '').toLowerCase().replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const named = a.title && !(ORD[word] || /^\d{1,2}$/.test(word)) ? nm(a.title) : '';
  const fits = (x) => !named || !x?.title || nm(x.title).includes(named) || named.includes(nm(x.title)) || named.split(' ').filter((w) => w.length > 2).every((w) => nm(x.title).includes(w));

  let it = n && cards[n - 1];
  if (it && !fits(it)) it = null; // a number that points at a different title than the one named is wrong: trust the name
  if (!it && a.imdbId) {
    it = convo.items.get(a.imdbId) || cards.find((x) => x.imdbId === a.imdbId) || { imdbId: a.imdbId };
    if (!fits(it)) it = null;
  }
  if (!it && a.title && !(ORD[word] || /^\d{1,2}$/.test(word))) {
    const t = String(a.title).toLowerCase().trim(), has = (x) => (x.title || '').toLowerCase();
    it = cards.find((x) => has(x) === t) || [...convo.items.values()].find((x) => has(x) === t) || cards.find((x) => has(x).includes(t)) || [...convo.items.values()].find((x) => has(x).includes(t));
    if (!it) {
      // Check if title refers to a genre, section, or type of an on-screen card
      const byAttr = cards.find((c) => {
        const g = (c.genre || c.genres || []).toString().toLowerCase();
        const sec = (c.section || '').toLowerCase();
        const typ = (c.type || '').toLowerCase();
        return g.includes(t) || sec.includes(t) || (t === 'animated' && g.includes('animation')) || (t === 'cartoon' && g.includes('animation')) || (t === 'series' && typ === 'series') || (t === 'movie' && typ === 'movie');
      });
      if (byAttr) it = byAttr;
    }
    if (!it) { // not on screen: search, but only accept a result that really looks like the name asked for
      const r = await smartSearch(a.title).catch(() => ({ titles: [] })), words = t.split(/\W+/).filter((w) => w.length > 2);
      it = (r.titles || []).find((x) => /^tt\d+$/.test(x.imdbId || '') && (has(x).includes(t) || t.includes(has(x)) || (words.length && words.every((w) => has(x).includes(w)))));
      if (it) convo.items.set(it.imdbId, it);
    }
  }

  // If still not resolved and a dossier or title page is open:
  if (!it && (!a.title || isGeneric) && !a.imdbId && !n) {
    const open = /(movie|series)\s+(tt\d+)/.exec(screen.titlePage || '');
    if (open) it = { imdbId: open[2], type: open[1], title: screen.dossier?.title };
    else if (screen.dossier?.imdbId) it = { imdbId: screen.dossier.imdbId, title: screen.dossier.title };
    else if (screen.player?.title) it = { title: screen.player.title };
  }
  return it || null;
}

// the model sometimes writes lists ("... 6.1 5. Transformers ..."): the numbering and symbols must never reach the voice or the subtitles
export const plain = (t) => String(t).replace(/[*_`#>]+/g, '').replace(/(^|\s)[-\u2022\u2013]\s+/g, '$1').replace(/(^|\s)\d{1,2}[.)]\s+(?=[A-Z\u201c"'(])/g, '$1').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s{2,}/g, ' ');
async function execTool(name, a, screen, region, emit) {
  console.log(`[agent] tool ${name} ${JSON.stringify(a).slice(0, 160)} (cards on screen: ${(screen.cards || []).length})`);
  let result;
        if (name === 'find_titles') {
          emit({ t: 'status', text: a.person ? `Looking up ${a.person}…` : a.query ? `Searching for “${a.query}”…` : a.chart === 'for_you' ? 'Picking for you…' : 'Searching…' });
          const r = await findTitles(a, region); result = r.out;
          // the shelf goes on screen straight away, no second model round trip
          if (r.list.length >= 1 && a.show !== false) {
            // the shelf gets exactly what was asked for; "more" adds new titles to it instead of replacing it
            if (!a.more) convo.shown = new Set(); r.list.forEach((x) => (convo.shown ||= new Set()).add(x.imdbId));
            emit({ t: 'act', name: 'show_shelf', args: { title: a.shelf_title || 'Orbie\u2019s picks', subtitle: '', imdbIds: r.list.map((x) => x.imdbId), items: r.list, append: !!a.more } });
            result.shownOnScreen = a.more ? `Added ${r.list.length} new titles to the shelf (none repeated).` : `All ${r.list.length} are now on screen as cards 1..${r.list.length} in this order.`;
          }
        }
        else if (name === 'title_info') {
          emit({ t: 'status', text: 'Reading up on it…' });
          const id = (await resolveTitle(a, screen))?.imdbId;
          if (!id) throw new Error('No title is open. Say which one.');
          const d = await getInfo(id); if (d?.error) throw new Error(d.error);
          let said = null; if (d.trailers?.length) { const cm = await getTrailerComments(d.trailers).catch(() => null); said = cm?.needsKey ? 'No YouTube key is set, so trailer comments are unavailable.' : (cm?.comments || []).slice(0, 6).map((x) => `${x.author}: ${x.text.slice(0, 160)}`); }
          result = { title: d.title, year: d.year, tagline: d.tagline, about: (d.overview || '').slice(0, 450), runtime: d.runtime, genres: d.genres, certification: d.certification, awards: d.awards,
            scores: (d.scores || []).map((s) => `${s.label} ${s.value}${s.max ? '/' + s.max : ''}`), directors: d.directors, cast: (d.cast || []).slice(0, 7).map((p) => p.character ? `${p.name} as ${p.character}` : p.name),
            reviews: (d.reviews || []).slice(0, 3).map((r) => `${r.author}${r.rating != null ? ' ' + r.rating + '/10' : ''}: ${String(r.text || r.content || '').replace(/\s+/g, ' ').slice(0, 220)}`), trailerComments: d.trailers?.length ? said : 'This title has no trailer on file, so there are no trailer comments.', status: d.status, nextEpisode: d.nextEpisode };
        }
        else if (name === 'get_history') { emit({ t: 'status', text: 'Checking your history…' }); result = await histResult(); }
        else if (name === 'get_versions') {
          emit({ t: 'status', text: 'Checking the versions…' });
          const it = await resolveTitle(a, screen); if (!it) throw new Error('Which title? I could not find it.');
          const type = it.type === 'series' || it.type === 'tv' ? 'series' : 'movie';
          let { season, episode } = a;
          if (type === 'series' && !(season && episode)) { const last = (await getHistory(200).catch(() => [])).find((h) => h.imdbId === it.imdbId && h.season); season = last ? ((last.percent || 0) >= 90 ? last.nextEp?.season || last.season : last.season) : 1; episode = last ? ((last.percent || 0) >= 90 ? last.nextEp?.episode || last.episode + 1 : last.episode) : 1; }
          const qs = new URLSearchParams({ imdbId: it.imdbId, type, title: it.title || '' }); if (type === 'series') { qs.set('season', season); qs.set('episode', episode); }
          const r = await fetch(`http://127.0.0.1:${process.env.IRONHIDE_PORT || 7676}/api/streams?${qs}`, { signal: AbortSignal.timeout(30000) });
          emit({ t: 'act', name: 'open_versions', args: { imdbId: it.imdbId, type, title: it.title } }); // asking about versions shows them: the picker opens while it answers
          const list = r.ok ? await r.json() : []; const cut = (v) => (typeof v === 'string' ? v.slice(0, 90) : Array.isArray(v) ? v.slice(0, 6) : v);
          result = { title: it.title, season, episode, count: list.length, versions: list.slice(0, 12).map((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !['index', 'isRD', 'sizeGb', 'broken'].includes(k) || k === 'index').map(([k, x]) => [k, cut(x)]))) };
        }
        else if (name === 'mark_watched' || name === 'hide_title' || name === 'rate_title') {
          // done here, for one title or several at once, and reported truthfully; the shelf drops them and recommendations refresh
          const refs = [{ imdbId: a.imdbId, n: a.n, title: a.title }, ...(a.imdbIds || []).map((imdbId) => ({ imdbId })), ...(a.ns || []).map((n) => ({ n })), ...(a.titles || []).map((title) => ({ title }))].filter((r) => r.imdbId || r.n || r.title);
          const items = []; for (const r of refs) { const it = await resolveTitle(r, screen); if (it && !items.some((x) => x.imdbId === it.imdbId)) items.push(it); }
          if (!items.length) throw new Error('Which titles do you mean?');
          const names = items.map((it) => it.title || it.imdbId);
          if (name === 'mark_watched') { if (a.season && a.episode) for (const it of items) await setEpisodesWatched(it.imdbId, it.title || '', [{ season: a.season, episode: a.episode }], true); else await markSeen(items.map((it) => it.imdbId)); }
          else if (name === 'hide_title') for (const it of items) await notInterested({ imdbId: it.imdbId, title: it.title || '' });
          else for (const it of items) await rate({ imdbId: it.imdbId, title: it.title || '', type: it.type === 'tv' || it.type === 'series' ? 'series' : 'movie', rating: Math.max(1, Math.min(5, a.stars | 0)) });
          invalidateRecommendations();
          if (name !== 'rate_title') emit({ t: 'act', name: 'drop_cards', args: { imdbIds: items.map((it) => it.imdbId) } });
          result = { done: true, titles: names, note: name === 'rate_title' ? 'Rated.' : 'They are gone from the shelf and will not be suggested again. To refill the shelf call find_titles again with more true.' };
        }
        else if (name === 'get_settings') { const st = await getSettings(); result = { name: st.profile?.name, playback: st.playback, appearance: st.appearance }; }
        else if (name === 'add_collection' || name === 'open_collection') {
          emit({ t: 'status', text: name === 'add_collection' ? 'Adding the collection…' : 'Opening the collection…' });
          let folder;
          if (name === 'open_collection') { const q = String(a.name || '').toLowerCase(); folder = (await listFolders()).find((f) => f.name.toLowerCase().includes(q) || q.includes(f.name.toLowerCase())); const pk = !folder && findPreset(a.name); if (pk) folder = (await listFolders()).find((f) => f.id === pk); if (!folder) throw new Error('No collection with that name. Add it first.'); }
          else {
            const pk = findPreset(a.name);
            if (pk) folder = await addPreset(pk);
            else { const items = []; for (const t of a.titles || []) { const it = await resolveTitle({ title: t }, screen); if (it?.imdbId && !items.some((x) => x.imdbId === it.imdbId)) items.push(it); } folder = await createFolder({ name: a.name, items }); }
          }
          emit({ t: 'act', name: 'open_collection', args: { id: folder.id } });
          result = { done: true, collection: folder.name, titles: (folder.orders?.[folder.order] || []).map((id) => folder.items.find((x) => x.imdbId === id)?.title).filter(Boolean), orders: Object.keys(folder.orders || {}), note: folder.orderNotes?.[folder.order] || '' };
        }
        else if (name === 'get_shelf') { emit({ t: 'status', text: 'Checking your shelf…' }); result = (await getWatchlist().catch(() => [])).slice(0, 40).map((w) => ({ title: w.title, type: w.type, year: w.year, imdbId: w.imdbId })); }
        else if (name === 'get_friends') {
          emit({ t: 'status', text: 'Checking on your friends…' });
          const sn = socialSnapshot(); result = { you: sn.you?.name, friends: (sn.friends || []).slice(0, 30).map((f) => ({ name: f.name, online: f.online, watching: f.status?.title || f.status || null })), room: sn.room ? { name: sn.room.name, code: sn.room.code, members: (sn.room.members || []).map((m) => m.n || m.name), watching: sn.room.media?.title || null } : null, waiting: (sn.incoming || []).length };
        }
        else if (name === 'get_taste') { emit({ t: 'status', text: 'Checking your taste…' }); const t = await tasteSummary().catch(() => ({})); result = { taste: JSON.stringify(t).slice(0, 1800) }; }
        else if (UI_TOOLS.has(name)) {
          const act = { ...a };
          if (name === 'show_shelf') {
            const items = (a.imdbIds || []).map((id) => convo.items.get(id)).filter(Boolean);
            if (!items.length) throw new Error('None of those ids came from find_titles');
            act.items = items; convo.shown = new Set(items.map((x) => x.imdbId)); convo.turnShelf = convo.lastShelf = items.map((x, i) => ({ imdbId: x.imdbId, title: x.title, type: x.type, poster: x.poster, year: x.year, n: i + 1 })); result = { shown: items.map((it, i) => compact(it, i + 1)) };
          } else if (name === 'open_title' || name === 'play' || name === 'save_to_shelf' || name === 'open_versions' || name === 'rate_title' || name === 'hide_title' || name === 'mark_watched') {
            const it = await resolveTitle(a, screen); if (!it) throw new Error('Which title? I could not find it.');
            Object.assign(act, { imdbId: it.imdbId, type: it.type, title: it.title, poster: it.poster, year: it.year });
          }
          emit({ t: 'act', name: name, args: act });
          result = result || { ok: true, ...(act.title ? { target: `${act.title}${act.year ? ' (' + act.year + ')' : ''}` } : {}) }; // what it really points at, so it can say the right thing
        } else result = { error: 'unknown tool' };
  return result;
}

// run one turn. emit(obj) sends a line to the page. screen = what the page is showing right now.
export async function run({ text, screen = {}, region = 'US' }, emit, signal) {
  if (!key()) { emit({ t: 'error', message: 'Add an OpenAI key in Settings → Connectors and I can get going.' }); return; }
  fresh(); convo.turnShelf = null; const T0 = Date.now(), tm = (w) => console.log(`[agent] ${w} +${Date.now() - T0}ms`);
  const ctx = `About this person: ${await personLine().catch(() => '')}\nThe person is looking at: ${screen.visibleToPerson || 'unknown'}\nScreen now: ${JSON.stringify({ view: screen.view, page: screen.page, cards: (screen.cards || []).slice(0, 12), highlighted: screen.highlighted || null, titlePage: screen.titlePage || null, trailerOpen: !!screen.trailerOpen, playing: screen.player || null })}\nReadable text of the app (${screen.appInFront ? 'what the person is looking at' : 'BEHIND you, blurred: the person cannot see this'}):\n${String(screen.text || '').slice(0, 3000)}`;
  const msgs = [{ role: 'system', content: SYSTEM }, ...convo.turns.slice(-5).flat(), { role: 'system', content: ctx }, { role: 'user', content: text }];
  const turn = [{ role: 'user', content: text }];
  const model = getConfig().agent_model;
  for (let step = 0; step < 6; step++) {
    let r;
    for (const m of [...new Set([model, 'gpt-4.1-mini', 'gpt-4o-mini'])]) {
      r = await fetch(`${OPENAI}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ model: m, messages: msgs, tools: TOOLS, stream: true, temperature: 0.4, max_tokens: 160 }) });
      if (r.ok || (r.status !== 404 && r.status !== 403)) break; // a missing model: try the next one
      console.warn(`[agent] model ${m} unavailable (${r.status})`);
    }
    if (!r.ok) { emit({ t: 'error', message: r.status === 401 ? 'OpenAI refused the key.' : r.status === 429 ? 'OpenAI says slow down or out of credit.' : `The model is not answering: ${await why(r, 'chat')}` }); return; }
    let buf = '', said = '', pending = '', calls = [];
    const flush = (force) => {
      for (;;) {
        const m = /^([\s\S]*?[.!?…])(\s+)/.exec(pending); // a sentence ends at punctuation followed by a space; at the end of a chunk it waits ("8." + "1" is a rating, not two sentences)
        if (m && (m[1].length > 14 || force)) { emit({ t: 'say', text: plain(m[1]).trim() }); said += m[1] + ' '; pending = pending.slice(m[0].length); } else break;
      }
      if (force && pending.trim()) { emit({ t: 'say', text: plain(pending).trim() }); said += pending + ' '; pending = ''; }
    };
    for await (const chunk of r.body) {
      buf += Buffer.from(chunk).toString('utf8');
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
        let d; try { d = JSON.parse(line.slice(5)).choices?.[0]?.delta; } catch { continue; }
        if (!d) continue;
        if (d.content) { pending += d.content; flush(false); }
        for (const tc of d.tool_calls || []) { const c = (calls[tc.index] ||= { id: '', name: '', args: '' }); if (tc.id) c.id = tc.id; if (tc.function?.name) c.name += tc.function.name; if (tc.function?.arguments) c.args += tc.function.arguments; }
      }
    }
    flush(true); tm(`model step ${step} done${calls.filter(Boolean).length ? ' (tools: ' + calls.filter(Boolean).map((x) => x.name).join(',') + ')' : ''}`);
    calls = calls.filter(Boolean);
    const asst = { role: 'assistant', content: said.trim() || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) } : {}) };
    msgs.push(asst); turn.push(asst);
    if (!calls.length) break;
    for (const c of calls) {
      let a = {}; try { a = JSON.parse(c.args || '{}'); } catch {}
      let result;
      try { result = await execTool(c.name, a, screen, region, emit);       } catch (e) { result = { error: String(e.message || e) }; }
      const m = { role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 6000) };
      msgs.push(m); turn.push(m);
    }
  }
  convo.turns.push(turn); tm('turn done');
  emit({ t: 'done' });
}

// ---------- live voice (OpenAI Realtime): hearing, thinking and speaking in one stream, so it answers fast and you can interrupt ----------
// The page sends its WebRTC offer here; this adds the instructions and tools and the key (which never reaches the page), and returns OpenAI's answer.
const rtTools = () => TOOLS.map((t) => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters }));
export async function rtConnect(offerSdp) {
  if (!key()) throw new Error('Add an OpenAI key in Settings → Connectors and I can get going.');
  fresh();
  const cfg = getConfig();
  const instructions = `${SYSTEM}
About this person: ${await personLine().catch(() => '')}
You are in a live voice conversation, so talk like a quick, natural person: contractions, short sentences, a little dry humour, never a list. Start answering the moment you know what is wanted. If the person talks over you, stop at once and listen. When you call tools, do not narrate them. Speak English unless they speak another language.`;
  const session = { type: 'realtime', model: cfg.realtime_model || 'gpt-realtime', instructions, tools: rtTools(), tool_choice: 'auto', max_output_tokens: 400,
    audio: { input: { noise_reduction: { type: 'far_field' }, transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' }, turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 200, silence_duration_ms: 450, create_response: true, interrupt_response: true } },
      output: { voice: cfg.realtime_voice || 'marin', speed: 1.08 } } };
  const fd = new FormData(); fd.set('sdp', offerSdp); fd.set('session', JSON.stringify(session));
  const r = await fetch(`${OPENAI}/realtime/calls`, { method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: fd, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(r.status === 401 ? 'OpenAI refused the key.' : `Live voice is not available: ${await why(r, 'realtime')}`);
  return await r.text();
}
// one tool call from the live voice: run it here, give back the result and whatever has to happen on screen
export async function toolCall({ name, args, screen, region }) {
  fresh(); convo.turnShelf = null; const events = [];
  let result; try { result = await execTool(String(name), args || {}, screen || {}, /^[A-Z]{2}$/.test(region) ? region : 'US', (o) => events.push(o)); } catch (e) { result = { error: String(e.message || e) }; }
  return { result, events };
}
