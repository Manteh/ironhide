#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { searchMedia, getImdbId } from '../src/tmdb.js';
import { getStreams } from '../src/torrentio.js';
import { play, formatTime } from '../src/player.js';
import { addToHistory } from '../src/history.js';
import { fetchSubtitles } from '../src/subtitles.js';
import { spinner, selectTitle, selectStream, LANG_CODES, parseLangs } from '../src/ui.js';
import chalk from 'chalk';

const argv = yargs(hideBin(process.argv))
  .usage('Usage: ironhide <query> [lang] [options]')
  .option('tv', { type: 'boolean', description: 'Search for TV shows' })
  .option('s', { alias: 'season', type: 'number', description: 'Season number' })
  .option('e', { alias: 'episode', type: 'number', description: 'Episode number' })
  .demandCommand(1, 'Please provide a search query')
  .parse();

// Check if last positional arg is a language code
const args = argv._;
let preferredLang = null;
let query;

const lastArg = String(args[args.length - 1]).toLowerCase();
if (args.length > 1 && LANG_CODES[lastArg]) {
  preferredLang = LANG_CODES[lastArg];
  query = args.slice(0, -1).join(' ');
} else {
  query = args.join(' ');
}

const type = argv.tv ? 'tv' : 'movie';

async function main() {
  if (preferredLang) {
    console.log(chalk.dim(`Language preference: ${preferredLang}`));
  }

  // Search TMDB
  const s1 = spinner('Searching...');
  const results = await searchMedia(query, type);
  s1.stop();

  if (results.length === 0) {
    console.log(chalk.red('No results found.'));
    process.exit(1);
  }

  // Pick a title
  const title = await selectTitle(results);

  // Get IMDB ID
  const s2 = spinner('Fetching sources...');
  const imdbId = await getImdbId(title.id, type);

  if (!imdbId) {
    s2.stop();
    console.log(chalk.red('Could not find IMDB ID for this title.'));
    process.exit(1);
  }

  // Get streams from Torrentio + subtitles in parallel
  const [torrentioStreams, subs] = await Promise.all([
    getStreams(imdbId, type, argv.season, argv.episode),
    fetchSubtitles(imdbId, argv.season, argv.episode).catch(() => []),
  ]);
  s2.stop();

  // Sort
  const streams = [...torrentioStreams]
    .sort((a, b) => {
      // If language preference set, matching streams go first
      if (preferredLang) {
        const aLangs = parseLangs(a.quality);
        const bLangs = parseLangs(b.quality);
        const aHas = aLangs.includes(preferredLang) || aLangs.includes('MULTI');
        const bHas = bLangs.includes(preferredLang) || bLangs.includes('MULTI');
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
      }
      // RD before non-RD
      if (a.isRD && !b.isRD) return -1;
      if (!a.isRD && b.isRD) return 1;
      // Then by size
      if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes;
      return b.seeds - a.seeds;
    });

  if (streams.length === 0) {
    console.log(chalk.red('No streaming sources found.'));
    process.exit(1);
  }

  console.log(chalk.dim(`${torrentioStreams.length} from Torrentio`));

  const langNames = { lit: 'Lithuanian', eng: 'English', swe: 'Swedish' };
  if (subs.length > 0) {
    const loaded = subs.map(s => langNames[s.lang] || s.lang).join(', ');
    console.log(chalk.green(`✓ Subtitles: ${loaded}`));
  } else {
    console.log(chalk.dim('No subtitles found'));
  }

  // Pick a stream — retry if not cached on RD
  let done = false;
  while (!done) {
    const stream = await selectStream(streams);
    console.log(chalk.cyan(stream.isRD ? '⚡ Launching mpv (Real-Debrid)...' : '📡 Streaming via torrent...'));
    const result = await play(stream, subs);
    if (result.status === 'not_cached') {
      console.log(chalk.yellow('⏳ Not cached on Real-Debrid yet — pick another source'));
      continue;
    }

    // Save to history with progress
    const historyEntry = {
      title: title.title,
      imdbId,
      type,
      season: argv.season,
      episode: argv.episode,
      quality: stream.quality.slice(0, 80),
    };

    if (result.progress) {
      historyEntry.position = result.progress.position;
      historyEntry.duration = result.progress.duration;
      historyEntry.percent = result.progress.percent;
      const watched = formatTime(result.progress.position);
      const total = formatTime(result.progress.duration);
      const pct = result.progress.percent.toFixed(0);
      console.log(chalk.dim(`\nWatched ${watched} / ${total} (${pct}%)`));
    }

    await addToHistory(historyEntry).catch(() => {});
    done = true;
  }
}

main().catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
