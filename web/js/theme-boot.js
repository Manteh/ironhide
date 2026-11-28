// Applies the cached appearance before first paint, so the theme doesn't flash. A plain (blocking) script on purpose.
try {
  var a = JSON.parse(localStorage.getItem('ih-appearance') || 'null');
  if (a) {
    var r = document.documentElement, t = a.theme;
    if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    r.dataset.theme = t; r.dataset.accent = a.accent; r.dataset.density = a.density;
    r.dataset.radius = a.radius; r.dataset.motion = a.motion; r.dataset.poster = a.posterSize; r.dataset.layout = a.layout || 'grid'; r.dataset.hero = a.showHero === false ? 'off' : 'on';
  }
} catch (e) {}
