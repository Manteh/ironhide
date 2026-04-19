import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';

export function spinner(text) {
  return ora({ text, color: 'cyan' }).start();
}

function parseResolution(name, quality) {
  // Torrentio: name field has "[RD+] Torrentio\n4k DV | HDR"
  const lines = name.split('\n');
  const fromName = lines[1]?.trim();
  if (fromName) return fromName;

  if (/2160p|4k|uhd/i.test(quality)) return '4K';
  if (/1080p/i.test(quality)) return '1080P';
  if (/720p/i.test(quality)) return '720P';
  if (/480p/i.test(quality)) return '480P';
  return '?';
}

function parseSource(quality) {
  // Extract source type from the quality/filename string
  if (/remux/i.test(quality)) return 'REMUX';
  if (/bluray|bdremux|bdrip/i.test(quality)) return 'BluRay';
  if (/web-?dl/i.test(quality)) return 'WEB-DL';
  if (/webrip/i.test(quality)) return 'WEBRip';
  if (/hdtv/i.test(quality)) return 'HDTV';
  if (/dvdrip/i.test(quality)) return 'DVDRip';
  return '';
}

function parseCodec(quality) {
  if (/hevc|h\.?265|x\.?265/i.test(quality)) return 'HEVC';
  if (/h\.?264|x\.?264|avc/i.test(quality)) return 'H.264';
  if (/av1/i.test(quality)) return 'AV1';
  return '';
}

function parseAudio(quality) {
  if (/atmos/i.test(quality)) return 'Atmos';
  if (/dts-?hd/i.test(quality)) return 'DTS-HD';
  if (/truehd/i.test(quality)) return 'TrueHD';
  if (/dts/i.test(quality)) return 'DTS';
  if (/aac/i.test(quality)) return 'AAC';
  return '';
}

// ISO 639-2/3 to internal short code (for --lang flag)
export const LANG_CODES = {
  'ltu': 'LT', 'lt': 'LT', 'lit': 'LT', 'lithuanian': 'LT',
  'eng': 'EN', 'en': 'EN', 'english': 'EN',
  'swe': 'SE', 'sv': 'SE', 'se': 'SE', 'swedish': 'SE',
  'rus': 'RU', 'ru': 'RU', 'russian': 'RU',
  'fre': 'FR', 'fr': 'FR', 'french': 'FR',
  'ger': 'DE', 'de': 'DE', 'german': 'DE',
  'spa': 'ES', 'es': 'ES', 'spanish': 'ES',
  'ita': 'IT', 'it': 'IT', 'italian': 'IT',
  'por': 'PT', 'pt': 'PT', 'portuguese': 'PT',
  'jpn': 'JP', 'ja': 'JP', 'japanese': 'JP',
  'chi': 'ZH', 'zh': 'ZH', 'chinese': 'ZH',
  'kor': 'KR', 'ko': 'KR', 'korean': 'KR',
  'pol': 'PL', 'pl': 'PL', 'polish': 'PL',
  'tur': 'TR', 'tr': 'TR', 'turkish': 'TR',
  'hin': 'HI', 'hi': 'HI', 'hindi': 'HI',
  'nor': 'NO', 'no': 'NO', 'norwegian': 'NO',
  'dan': 'DK', 'dk': 'DK', 'danish': 'DK',
  'fin': 'FI', 'fi': 'FI', 'finnish': 'FI',
  'dut': 'NL', 'nl': 'NL', 'dutch': 'NL',
  'ara': 'AR', 'ar': 'AR', 'arabic': 'AR',
  'ukr': 'UA', 'ua': 'UA', 'ukrainian': 'UA',
};

const LANG_MAP = {
  'en': 'EN', 'eng': 'EN', 'english': 'EN',
  'fr': 'FR', 'fre': 'FR', 'french': 'FR', 'fra': 'FR', 'vf': 'FR', 'vf2': 'FR', 'truefrench': 'FR',
  'de': 'DE', 'ger': 'DE', 'german': 'DE', 'deu': 'DE',
  'es': 'ES', 'spa': 'ES', 'spanish': 'ES', 'latino': 'ES', 'castellano': 'ES',
  'it': 'IT', 'ita': 'IT', 'italian': 'IT',
  'pt': 'PT', 'por': 'PT', 'portuguese': 'PT',
  'ru': 'RU', 'rus': 'RU', 'russian': 'RU',
  'ja': 'JP', 'jpn': 'JP', 'japanese': 'JP',
  'zh': 'ZH', 'chi': 'ZH', 'chinese': 'ZH',
  'ko': 'KR', 'kor': 'KR', 'korean': 'KR',
  'pl': 'PL', 'pol': 'PL', 'polish': 'PL',
  'cz': 'CZ', 'cze': 'CZ', 'czech': 'CZ',
  'hu': 'HU', 'hun': 'HU', 'hungarian': 'HU',
  'tr': 'TR', 'tur': 'TR', 'turkish': 'TR',
  'th': 'TH', 'tha': 'TH', 'thai': 'TH',
  'ua': 'UA', 'ukr': 'UA', 'ukrainian': 'UA',
  'hi': 'HI', 'hin': 'HI', 'hindi': 'HI',
  'sv': 'SE', 'swe': 'SE', 'swedish': 'SE',
  'lt': 'LT', 'lit': 'LT', 'ltu': 'LT', 'lithuanian': 'LT',
  'no': 'NO', 'nor': 'NO', 'norwegian': 'NO',
  'dk': 'DK', 'dan': 'DK', 'danish': 'DK',
  'fi': 'FI', 'fin': 'FI', 'finnish': 'FI',
  'nl': 'NL', 'dut': 'NL', 'dutch': 'NL',
  'ar': 'AR', 'ara': 'AR', 'arabic': 'AR',
  'multi': 'MULTI',
};

export function parseLangs(quality) {
  const found = new Set();
  // Split on dots, spaces, underscores
  const tokens = quality.split(/[\.\s_\-]+/).map(t => t.toLowerCase());
  for (const token of tokens) {
    if (LANG_MAP[token]) found.add(LANG_MAP[token]);
  }
  if (found.size === 0 && /multi/i.test(quality)) found.add('MULTI');
  return [...found];
}

export async function selectTitle(results) {
  console.log();
  const { choice } = await inquirer.prompt([{
    type: 'list',
    name: 'choice',
    message: 'Select a title:',
    loop: false,
    pageSize: 10,
    choices: results.map(r => ({
      name: `  ${chalk.bold.white(r.title)}  ${chalk.dim(r.year)}  ${chalk.yellow(`★ ${r.rating}`)}`,
      value: r,
    })),
  }]);
  return choice;
}

function pad(str, width) {
  return str + ' '.repeat(Math.max(0, width - str.length));
}

export async function selectStream(streams) {
  console.log();

  // Pre-compute columns
  const rows = streams.map(s => {
    const res = parseResolution(s.name, s.quality).toUpperCase() || '?';
    const source = parseSource(s.quality);
    const codec = parseCodec(s.quality);
    const audio = parseAudio(s.quality);
    const info = [res, source, codec, audio].filter(Boolean).join(' ');
    const langs = parseLangs(s.quality).join(' ');
    const tracker = 'TIO';
    return { stream: s, info, langs, tracker };
  });

  const maxInfo = Math.max(...rows.map(r => r.info.length), 4) + 2;
  const maxLangs = Math.max(...rows.map(r => r.langs.length), 2) + 2;
  const maxTracker = Math.max(...rows.map(r => r.tracker.length), 3) + 1;

  const { choice } = await inquirer.prompt([{
    type: 'list',
    name: 'choice',
    message: 'Select quality:',
    loop: false,
    pageSize: 15,
    choices: rows.map(({ stream: s, info, langs, tracker }) => {
      const c0 = chalk.blue(pad(tracker, maxTracker));
      const c1 = chalk.bold.white(pad(info, maxInfo));
      const c2 = chalk.magenta(pad(langs, maxLangs));
      const c3 = chalk.cyan(s.size.padStart(9));

      const seedColor = s.seeds > 200 ? chalk.green : s.seeds > 50 ? chalk.yellow : chalk.red;
      const seedStr = seedColor(`↑${String(s.seeds).padStart(4)}`);
      let prefix;
      if (s.isRD) {
        prefix = chalk.green('⚡') + seedStr + ' ';
      } else {
        prefix = ' ' + seedStr + ' ';
      }

      return {
        name: `${prefix}${c0}${c1}${c2}${c3}`,
        value: s,
      };
    }),
  }]);
  return choice;
}
