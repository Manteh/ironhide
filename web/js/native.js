// Only in the Orbie Mac app: the native shell's init script loads this into the daemon's pages.
// Makes the page feel like an app, sends outside links to the browser, adds the player overlay, the window header and
// the update notice. Everything native is reached through window.__TAURI_INTERNALS__.invoke.
(() => {
  if (window.__ihNative) return;
  window.__ihNative = true;
  const invoke = (cmd, args) => window.__TAURI_INTERNALS__?.invoke(cmd, args);

  // The page-drawn cursor trails the real pointer; the system cursor has no lag. Once per install, so Settings can turn it back on.
  if (!localStorage.getItem('cursorAppDefault')) { localStorage.setItem('cursorAppDefault', '1'); localStorage.setItem('cursor', 'off'); }

  // Links to other sites (IMDb, YouTube, full reviews…) open in the default browser: the app window can't open new tabs.
  const outside = (url) => { try { const u = new URL(url, location.href); return /^https?:$/.test(u.protocol) && u.origin !== location.origin ? u.href : null; } catch { return null; } };
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]'); if (!a || e.defaultPrevented) return;
    const href = outside(a.href); if (!href) return;
    e.preventDefault(); e.stopPropagation(); invoke('open_external', { url: href });
  }, true);
  const winOpen = window.open;
  window.open = (url, ...rest) => { const href = outside(url); if (href) { invoke('open_external', { url: href }); return null; } return winOpen.call(window, url, ...rest); };

  const add = (tag, attrs) => { const el = document.createElement(tag); Object.assign(el, attrs); document.documentElement.appendChild(el); };
  add('link', { rel: 'stylesheet', href: '/css/native.css' });
  add('link', { rel: 'stylesheet', href: '/css/appplayer.css' }); // the in-app player overlay (controls, picture settings)
  add('script', { type: 'module', src: '/js/appplayer.js' });
  add('link', { rel: 'stylesheet', href: '/css/appbar.css' }); // the window header
  add('script', { type: 'module', src: '/js/appbar.js' });

  const ready = (f) => (document.body ? f() : document.addEventListener('DOMContentLoaded', f));
  ready(() => {
    // the web app's "Now playing" remote is pointless here (the player has its own controls): remove it whenever it appears
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('nowv')) n.remove(); }).observe(document.body, { childList: true });
  });

  // the menu bar's "Next episode": what's playing now, and the episode after it
  window.__ihNextEp = async () => {
    try {
      const np = await (await fetch('/api/nowplaying')).json(), m = np?.meta;
      if (!m?.imdbId || !m.season) return;
      const r = await (await fetch(`/api/nextup?imdbId=${m.imdbId}&season=${m.season}&episode=${m.episode}&any=1`)).json();
      const { quickPlay } = await import('/js/main.js'), { toast } = await import('/js/ui.js');
      if (!r.next) { toast('That was the last episode out', 'ok'); return; }
      quickPlay({ imdbId: m.imdbId, type: 'series', title: m.title || String(np.title || '').replace(/\s+S\d+E\d+.*$/, ''), season: r.next.season, episode: r.next.episode });
    } catch {}
  };
})();
