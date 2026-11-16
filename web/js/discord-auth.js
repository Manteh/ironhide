// Discord sends the browser here with the token in the address fragment (never sent over the network by the browser).
// Hand it to Orbie, then clear it from the address bar.
(async () => {
  const h = document.getElementById('h'), p = document.getElementById('p');
  const f = new URLSearchParams(location.hash.slice(1)); history.replaceState(null, '', location.pathname);
  if (f.get('error')) { h.textContent = 'Not linked'; p.textContent = 'Discord sign-in was cancelled. You can close this tab.'; return; }
  try {
    const r = await fetch('/api/auth/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: f.get('access_token'), state: f.get('state') }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Something went wrong');
    h.textContent = `Hi ${d.name}!`; p.textContent = 'Your Discord is linked. You can close this tab and go back to Orbie.';
  } catch (e) { h.textContent = 'Not linked'; p.textContent = e.message; }
})();
