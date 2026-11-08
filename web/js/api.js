export async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
const send = (method) => (path, body) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
export const post = send('POST');
export const put = send('PUT');
export const del = (path) => api(path, { method: 'DELETE' });
