// Browser side of "Together": one WebSocket to the local daemon, which holds the relay connection.
import { api, post } from './api.js';

export const social = { state: null, states: new Set(), events: new Set() };
let ws, retry = 1000;

export function connectSocial() {
  api('/api/social').then((s) => setState(s)).catch(() => {});
  open();
}
function open() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type !== 'social') return;
    if (m.event === 'kicked') social.lastKick = Date.now();
    if (m.event === 'state') setState(m.data); else social.events.forEach((f) => f(m.event, m.data));
  };
  ws.onopen = () => { retry = 1000; };
  ws.onclose = () => setTimeout(open, (retry = Math.min(retry * 1.6, 10000)));
}
function setState(s) { social.state = s; social.states.forEach((f) => f(s)); }

// subscribe to state; calls immediately with the current one
export function onState(fn) { social.states.add(fn); if (social.state) fn(social.state); return () => social.states.delete(fn); }
export function onEvent(fn) { social.events.add(fn); return () => social.events.delete(fn); }
// live pointer: goes over the local socket because it is too frequent for HTTP
export const sendCursor = (x, y, off) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'cursor', x, y, off: !!off })); };
export const sapi = (path, body = {}) => post('/api/social' + path, body);
export const serverNow = () => Date.now() + (social.state?.offset || 0);
export const inRoom = () => !!social.state?.room;
// the owner counts as host: they keep control (and sync) for the life of the room
export const isHost = () => { const r = social.state?.room, id = social.state?.you?.id; return !!(r && (r.host === id || r.owner === id)); };
export const canControl = () => { const r = social.state?.room, id = social.state?.you?.id; return !!r && (r.host === id || r.owner === id || r.control === 'all'); };
export const fmtCode = (c = '') => (c.length === 10 ? c.slice(0, 5) + '-' + c.slice(5) : c);
