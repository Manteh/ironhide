import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const BASE = 'https://opensubtitles-v3.strem.io';
const LANGS = ['lit', 'eng', 'swe'];

export async function fetchSubtitles(imdbId, season, episode) {
  let path;
  if (season != null && episode != null) {
    path = `subtitles/series/${imdbId}:${season}:${episode}.json`;
  } else {
    path = `subtitles/movie/${imdbId}.json`;
  }

  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) return [];

  const data = await res.json();
  if (!data.subtitles || data.subtitles.length === 0) return [];

  // Download first available subtitle for each preferred language
  const subPaths = [];
  for (const lang of LANGS) {
    const sub = data.subtitles.find(s => s.lang === lang);
    if (!sub?.url) continue;

    try {
      const subRes = await fetch(sub.url);
      const subText = await subRes.text();
      const subPath = join(tmpdir(), `ironhide-${imdbId}-${lang}.srt`);
      await writeFile(subPath, subText);
      subPaths.push({ lang, path: subPath });
    } catch {
      // skip failed downloads
    }
  }

  return subPaths;
}
