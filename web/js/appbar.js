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
    gear: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
    play: svg('<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10-6.4a1 1 0 0 0 0-1.72l-10-6.4A1 1 0 0 0 8 5.6Z"/>'),
    bell: svg('<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>'),
    user: svg('<circle cx="12" cy="8.4" r="3.6"/><path d="M4.6 20c.6-3.8 3.4-6 7.4-6s6.8 2.2 7.4 6"/>'),
    palette: svg('<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.3 0 2-.9 2-1.9 0-1.5-1.2-1.6-1.2-2.8 0-.9.7-1.5 1.6-1.5H17a3.8 3.8 0 0 0 3.8-3.8C20.8 6.3 16.9 3.2 12 3.2Z"/><circle class="f" cx="7.8" cy="11" r="1"/><circle class="f" cx="10.2" cy="7.4" r="1"/><circle class="f" cx="14.4" cy="7.4" r="1"/>'),
    sliders: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9M4 12h3M11 12h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/><circle cx="9" cy="12" r="2"/>'),
    film: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M8 4.5v15M16 4.5v15M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5"/>'),
    plug: svg('<path d="M9 3.5V8M15 3.5V8M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0ZM12 17v3.5"/>'),
    nodes: svg('<circle cx="12" cy="5.5" r="2.3"/><circle cx="5.5" cy="18" r="2.3"/><circle cx="18.5" cy="18" r="2.3"/><path d="M11 7.7 6.6 15.9M13 7.7l4.4 8.2M8 18h8"/>'),
    bolt: svg('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z"/>'),
    info: svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r=".6"/>'),
  };
  const bar = document.createElement('div');
  bar.id = 'ihbar';
  bar.innerHTML = `<div class="l"><button data-a="back" title="Back">${I.back}</button><button data-a="fwd" title="Forward">${I.fwd}</button><button data-a="reload" title="Reload (⌘R)">${I.reload}</button></div>
    <div class="c">IronHide</div>
    <div class="r"><button data-a="search" title="Search (⌘K)">${I.search}</button><button class="pill" data-a="resume" title="Continue watching">${I.play}<span>Resume</span></button><button data-a="friends" title="Friends">${I.friends}<b class="dot" data-dot="friends"></b></button><button data-a="bell" title="What's new">${I.bell}<b class="dot warn sm" data-dot="bell"></b></button><button data-a="menu" title="Settings">${I.gear}</button><i class="sep"></i><button class="me" data-a="profile" title="Your profile"><i></i><span></span></button></div>`;
  const q = (s) => bar.querySelector(s);

  const NAMES = [[/^#\/?$/, 'IronHide'], [/^#\/continue/, 'Continue watching'], [/^#\/shelf/, 'Shelf'], [/^#\/(friends|together)/, 'Friends'], [/^#\/profile/, 'Profile'], [/^#\/settings/, 'Settings'], [/^#\/search\//, 'Search'], [/^#\/feed\/([^?]*)/, null]];
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
    e.stopPropagation(); closeMenu();
    ({ back: () => history.back(), fwd: () => history.forward(), reload: () => location.reload(),
       search: () => document.getElementById('nSearch')?.click(), resume: () => { location.hash = '#/continue'; }, friends: () => { location.hash = '#/friends'; },
       bell: () => document.querySelector('#updBell .ub-btn')?.click(), menu: () => toggleMenu(),
       profile: () => { location.hash = '#/profile'; } })[b.dataset.a]?.();
  });
  // drag the window by the bar, double-click to zoom
  bar.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('button')) { if (e.detail >= 2) call('win_zoom'); else call('player_drag'); } });

  // settings menu: jump straight to a section
  const SECTIONS = [['profile', 'Profile', 'user'], ['appearance', 'Appearance', 'palette'], ['playback', 'Playback', 'sliders'], ['streams', 'Streams', 'film'], ['connectors', 'Connectors', 'plug'], ['together', 'Friends', 'friends'], ['nodes', 'Nodes', 'nodes'], ['updates', 'Updates', 'bolt'], ['about', 'About', 'info']];
  const menu = document.createElement('div'); menu.id = 'ihmenu';
  menu.innerHTML = SECTIONS.map(([k, l, ic]) => `<a data-s="${k}">${I[ic]}${l}</a>`).join('');
  menu.addEventListener('click', (e) => { const a = e.target.closest('[data-s]'); if (a) { location.hash = '#/settings/' + a.dataset.s; closeMenu(); } });
  const closeMenu = () => menu.classList.remove('on');
  const toggleMenu = () => menu.classList.toggle('on');
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && !e.target.closest('#ihbar')) closeMenu(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  // badges: friends online / pending requests, unread updates
  async function badges() {
    try {
      const s = await (await fetch('/api/social')).json();
      const online = (s.friends || []).filter((f) => f.online).length, pending = (s.incoming || []).length + (s.invites || []).length;
      const d = q('[data-dot=friends]'); d.textContent = pending || online || ''; d.classList.toggle('on', !!(pending || online)); d.classList.toggle('warn', !!pending);
      q('[data-a=friends]').title = `Friends: ${online} online${pending ? `, ${pending} waiting` : ''}`;
    } catch {}
    q('[data-dot=bell]').classList.toggle('on', !!document.querySelector('#updBell .ub-btn.new'));
  }
  setInterval(badges, 15000); setTimeout(badges, 1200); setInterval(() => q('[data-dot=bell]').classList.toggle('on', !!document.querySelector('#updBell .ub-btn.new')), 2500);
  const mount = () => { if (!bar.isConnected) { document.body.append(bar); document.body.append(menu); } paint(); };
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
