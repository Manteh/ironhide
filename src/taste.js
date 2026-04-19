import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const TASTE_DIR = join(homedir(), '.config', 'ironhide');
const TASTE_FILE = join(TASTE_DIR, 'taste.json');

async function loadTaste() {
  try {
    const data = await readFile(TASTE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { ratings: [], preferences: {} };
  }
}

async function saveTaste(taste) {
  await mkdir(TASTE_DIR, { recursive: true });
  await writeFile(TASTE_FILE, JSON.stringify(taste, null, 2));
}

export async function addRating(entry) {
  const taste = await loadTaste();

  // Remove old rating for same title if exists
  taste.ratings = taste.ratings.filter(r => r.imdbId !== entry.imdbId);

  taste.ratings.push({
    imdbId: entry.imdbId,
    title: entry.title,
    type: entry.type,
    rating: entry.rating, // 1-5 stars
    liked: entry.liked || [],  // e.g. ["acting", "visuals", "story"]
    disliked: entry.disliked || [], // e.g. ["pacing", "ending"]
    notes: entry.notes || '',
    genres: entry.genres || [],
    ratedAt: new Date().toISOString(),
  });

  // Keep last 200 ratings
  if (taste.ratings.length > 200) {
    taste.ratings = taste.ratings.slice(-200);
  }

  // Update preference counters
  updatePreferences(taste, entry);

  await saveTaste(taste);
}

function updatePreferences(taste, entry) {
  const prefs = taste.preferences;

  // Track genre preferences weighted by rating
  if (!prefs.genres) prefs.genres = {};
  for (const genre of (entry.genres || [])) {
    if (!prefs.genres[genre]) prefs.genres[genre] = { score: 0, count: 0 };
    prefs.genres[genre].score += entry.rating;
    prefs.genres[genre].count += 1;
  }

  // Track what they like/dislike in general
  if (!prefs.liked) prefs.liked = {};
  for (const tag of (entry.liked || [])) {
    prefs.liked[tag] = (prefs.liked[tag] || 0) + 1;
  }

  if (!prefs.disliked) prefs.disliked = {};
  for (const tag of (entry.disliked || [])) {
    prefs.disliked[tag] = (prefs.disliked[tag] || 0) + 1;
  }

  // Track rating distribution
  if (!prefs.ratingDist) prefs.ratingDist = {};
  prefs.ratingDist[entry.rating] = (prefs.ratingDist[entry.rating] || 0) + 1;
}

export async function getTasteProfile() {
  const taste = await loadTaste();
  if (taste.ratings.length === 0) return null;

  const prefs = taste.preferences;

  // Top genres by avg score
  const genreRanking = Object.entries(prefs.genres || {})
    .map(([genre, data]) => ({ genre, avg: data.score / data.count, count: data.count }))
    .sort((a, b) => b.avg - a.avg);

  // Most liked aspects
  const topLiked = Object.entries(prefs.liked || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  // Most disliked aspects
  const topDisliked = Object.entries(prefs.disliked || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  // Recent high-rated titles
  const favorites = taste.ratings
    .filter(r => r.rating >= 4)
    .slice(-10)
    .reverse();

  // Recent low-rated
  const disliked = taste.ratings
    .filter(r => r.rating <= 2)
    .slice(-5)
    .reverse();

  return {
    totalRatings: taste.ratings.length,
    avgRating: (taste.ratings.reduce((s, r) => s + r.rating, 0) / taste.ratings.length).toFixed(1),
    genreRanking,
    topLiked,
    topDisliked,
    favorites,
    disliked,
    ratingDist: prefs.ratingDist || {},
  };
}

export async function getRatings(limit = 20) {
  const taste = await loadTaste();
  return taste.ratings.slice(-limit).reverse();
}

export async function getRating(imdbId) {
  const taste = await loadTaste();
  return taste.ratings.find(r => r.imdbId === imdbId) || null;
}
