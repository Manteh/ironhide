// The update button in the Mac app's header: an arrow that appears when there is a new version, a ring that fills while
// it downloads by itself, then "Restart". A card shows what is new. It never restarts while something is playing.
const get = (fresh) => fetch('/api/app/update' + (fresh ? '?fresh=1' : '')).then((r) => r.json());
const post = (p) => fetch('/api/app/update/' + p, { method: 'POST' }).then((r) => r.json()).catch(() => ({ error: 'That did not work' }));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// release notes are Markdown: keep the plain sentences and bullet points
const notes = (text) => String(text || '').split('\n').map((l) => l.replace(/[*_`#>]/g, '').trim()).filter((l) => l && !/curl|install\.sh|http/i.test(l))
  .slice(0, 6).map((l) => `<li>${esc(l.replace(/^-\s*/, ''))}</li>`).join('');

const R = 10, C = 2 * Math.PI * R;
let btn, pop, u = {}, timer = 0, restarting = false;

async function playing() {
  if (document.documentElement.classList.contains('ihp-on')) return true;
  if ([...document.querySelectorAll('video')].some((v) => !v.paused && !v.muted)) return true;
  try { return !!(await (await fetch('/api/nowplaying')).json()); } catch { return false; }
}

function paint() {
  const show = u.available && !restarting;
  btn.hidden = !show && !restarting;
  btn.dataset.state = restarting ? 'ready' : u.state;
  btn.querySelector('.up-fill').style.strokeDashoffset = String(C * (1 - (u.state === 'ready' ? 1 : (u.pct || 0) / 100)));
  btn.querySelector('span').textContent = restarting ? 'Restarting…' : u.state === 'ready' ? 'Restart' : '';
  btn.title = u.state === 'ready' ? `Orbie ${u.latest} is ready` : u.state === 'downloading' ? `Downloading Orbie ${u.latest}… ${u.pct}%` : u.state === 'error' ? u.error : `Orbie ${u.latest} is available`;
  if (!pop.hidden) card();
}

async function card() {
  const busy = await playing();
  const head = u.state === 'ready' ? `Orbie ${u.latest} is ready` : u.state === 'error' ? 'The update did not work' : `Downloading Orbie ${u.latest}`;
  const sub = u.state === 'ready' ? (busy ? 'Something is playing. Restart when you are done, or just quit Orbie later.' : `You have ${u.current}. Restarting takes a few seconds.`)
    : u.state === 'error' ? u.error : `${u.pct || 0}% · you can keep watching`;
  const list = notes(u.notes);
  pop.innerHTML = `<b>${esc(head)}</b><p>${esc(sub)}</p>${list ? `<h5>What's new</h5><ul>${list}</ul>` : ''}
    <div class="up-actions">${u.state === 'ready' ? `<button class="up-go" data-u="restart" ${busy ? 'disabled' : ''}>Restart now</button><button data-u="later">Later</button>`
      : u.state === 'error' ? '<button class="up-go" data-u="retry">Try again</button><button data-u="later">Close</button>' : '<button data-u="later">Close</button>'}</div>`;
}

async function poll(fresh) {
  clearTimeout(timer);
  try { u = await get(fresh); } catch { u = { available: false }; }
  if (u.available && u.state === 'idle') { await post('download'); try { u = await get(); } catch {} } // quietly, by itself
  paint();
  timer = setTimeout(poll, u.state === 'downloading' ? 700 : 15 * 60e3);
  return u;
}

export function mount(bar) {
  btn = document.createElement('button'); btn.className = 'up-btn'; btn.hidden = true; btn.setAttribute('aria-label', 'Update Orbie');
  btn.innerHTML = `<i><svg viewBox="0 0 24 24"><circle class="up-track" cx="12" cy="12" r="${R}"/><circle class="up-fill" cx="12" cy="12" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/><path class="up-arrow" d="M12 7.5v8M8.5 12.2 12 15.7l3.5-3.5"/></svg></i><span></span>`;
  const right = bar.querySelector('.r');
  right.prepend(btn);
  pop = document.createElement('div'); pop.className = 'up-pop'; pop.hidden = true; document.body.append(pop);
  btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) card(); });
  pop.addEventListener('click', async (e) => {
    e.stopPropagation();
    const a = e.target.closest('[data-u]')?.dataset.u;
    if (a === 'later') pop.hidden = true;
    if (a === 'retry') { await post('download'); poll(); }
    if (a === 'restart') {
      if (await playing()) return card();
      restarting = true; pop.hidden = true; paint();
      const r = await post('install');
      if (r.error) { restarting = false; paint(); }
    }
  });
  document.addEventListener('click', () => { pop.hidden = true; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
  // Orbie ▸ Check for Updates… in the menu bar
  window.__ihUpdate = async () => {
    const now = await poll(true);
    pop.hidden = false;
    if (now.available) return card();
    pop.innerHTML = `<b>${now.error ? "Couldn't check for updates" : "You're up to date"}</b><p>${esc(now.error || `Orbie ${now.current} is the latest version.`)}</p>`;
  };
  setTimeout(poll, 4000);
  // coming back to Orbie is a good moment to look (the service only asks GitHub again after ten minutes)
  addEventListener('focus', () => { if (u.state !== 'downloading') poll(); });
}
