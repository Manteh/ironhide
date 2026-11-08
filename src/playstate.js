// Shared launch state: lets the web app show progress between "Play" and mpv taking over.
// phases: idle | finding | resolving | launching | buffering | playing | error
let state = { phase: 'idle', title: '', imdbId: '', detail: '', token: 0, at: Date.now() };

export const getPlayState = () => ({ ...state });
export function setPlayState(patch) { state = { ...state, ...patch, at: Date.now() }; }
export function beginLaunch(info) { state = { phase: 'finding', detail: 'Finding the best stream', title: '', imdbId: '', ...info, token: state.token + 1, at: Date.now() }; return state.token; }
export const isCurrent = (token) => state.token === token;
