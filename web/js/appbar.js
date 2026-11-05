// Window header for the IronHide Mac app (see appbar.css).
(() => {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  if (!inv || window.__ihbar) return;
  window.__ihbar = true;
  const call = (c, a = {}) => inv(c, a).catch(() => {});
  const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    back: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'), fwd: svg('<path d="M9.5 5.5 16 12l-6.5 6.5"/>'),
    reload: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 4.5v4h-4"/>'),
    search: svg('<circle cx="11" cy="11" r="6.4"/><path d="m20 20-4.3-4.3"/>'),
    friends: svg('<circle cx="9" cy="8.6" r="3.2"/><path d="M3.2 19c.5-3.2 2.7-5 5.8-5s5.3 1.8 5.8 5"/><path d="M16 5.6a3 3 0 0 1 0 5.8M17.6 14.4c2 .5 3.2 2.2 3.6 4.6"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>'),
  };
  const bar = document.createElement('div');
  bar.id = 'ihbar';
  bar.innerHTML = `<div class="l"><button data-a="back" title="Back">${I.back}</button><button data-a="fwd" title="Forward">${I.fwd}</button><button data-a="reload" title="Reload (⌘R)">${I.reload}</button></div>
    <div class="c">IronHide</div>
    <div class="r"><button data-a="search" title="Search (⌘K)">${I.search}</button><button data-a="friends" title="Friends">${I.friends}</button><button data-a="settings" title="Settings (⌘,)">${I.gear}</button><i class="sep"></i><button class="me" data-a="profile" title="Your profile"><i></i><span></span></button></div>`;
  const q = (s) => bar.querySelector(s);

  const NAMES = [[/^#\/?$/, 'Home'], [/^#\/continue/, 'Continue watching'], [/^#\/shelf/, 'Shelf'], [/^#\/(friends|together)/, 'Friends'], [/^#\/profile/, 'Profile'], [/^#\/settings/, 'Settings'], [/^#\/search\//, 'Search'], [/^#\/feed\/([^?]*)/, null]];
  function title() {
    const h = location.hash || '#/';
    for (const [re, name] of NAMES) { const m = h.match(re); if (m) return name || decodeURIComponent(m[1]).replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
    return 'IronHide';
  }
  function paint() {
    q('.c').textContent = title();
    const nav = window.navigation;
    q('[data-a=back]').disabled = nav ? !nav.canGoBack : history.length <= 1;
    q('[data-a=fwd]').disabled = nav ? !nav.canGoForward : false;
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    ({ back: () => history.back(), fwd: () => history.forward(), reload: () => location.reload(),
       search: () => document.getElementById('nSearch')?.click(), friends: () => { location.hash = '#/friends'; },
       settings: () => { location.hash = '#/settings'; }, profile: () => { location.hash = '#/profile'; } })[b.dataset.a]?.();
  });
  // drag the window by the bar, double-click to zoom
  bar.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('button')) { if (e.detail >= 2) call('win_zoom'); else call('player_drag'); } });

  const mount = () => { if (!bar.isConnected) document.body.append(bar); paint(); };
  addEventListener('hashchange', () => setTimeout(paint, 0));
  addEventListener('popstate', paint);
  fetch('/api/settings').then((r) => r.json()).then((s) => {
    const p = s?.profile || {}, n = p.name || 'You';
    q('.me span').textContent = n; q('.me i').textContent = (n[0] || '?').toUpperCase();
    if (p.avatar?.c1) q('.me i').style.setProperty('--av1', p.avatar.c1); if (p.avatar?.c2) q('.me i').style.setProperty('--av2', p.avatar.c2);
  }).catch(() => {});
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);
  setInterval(paint, 1500);
})();
