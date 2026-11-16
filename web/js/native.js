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

  // ---------- updates: a quiet card when a new version is out; Orbie ▸ Check for Updates… asks now ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function card(html, actions) {
    document.getElementById('ihupd')?.remove();
    const el = document.createElement('div'); el.id = 'ihupd'; el.innerHTML = html; document.body.append(el);
    requestAnimationFrame(() => el.classList.add('on'));
    el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.classList.contains('x')) el.remove(); else actions?.[b.dataset.a]?.(el); });
    return el;
  }
  async function checkUpdate(manual) {
    let u; try { u = await (await fetch('/api/app/update' + (manual ? '?fresh=1' : ''))).json(); } catch { u = { error: 'offline' }; }
    if (u.available) {
      if (!manual && localStorage.getItem('ih.updSkip') === u.latest) return;
      card(`<div><b>Orbie ${esc(u.latest)} is ready</b><small>You have ${esc(u.current)}. It installs and reopens in about a minute.</small></div>
        <button class="go" data-a="install">Update</button><button class="x" title="Later" data-a="later">✕</button>`, {
        install: async (el) => {
          el.querySelector('div').innerHTML = '<b>Updating…</b><small>Orbie will close and reopen by itself.</small>'; el.querySelectorAll('button').forEach((b) => b.remove());
          const r = await fetch('/api/app/update/install', { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: 'The update could not start' }));
          if (r.error) { el.querySelector('div').innerHTML = `<b>Update failed</b><small>${esc(r.error)}</small>`; setTimeout(() => el.remove(), 8000); }
        },
      });
      document.querySelector('#ihupd .x')?.addEventListener('click', () => localStorage.setItem('ih.updSkip', u.latest));
    } else if (manual) {
      const el = card(u.error ? `<div><b>Couldn't check for updates</b><small>${esc(u.error)}</small></div><button class="x">✕</button>`
        : `<div><b>You're up to date</b><small>Orbie ${esc(u.current)} is the latest version.</small></div><button class="x">✕</button>`);
      setTimeout(() => el.remove(), 5000);
    }
  }
  window.__ihUpdate = (manual) => ready(() => checkUpdate(!!manual));

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
  ready(() => { setTimeout(() => checkUpdate(false), 8000); setInterval(() => checkUpdate(false), 6 * 3600e3); });
})();
