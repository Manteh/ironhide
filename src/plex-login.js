// One-time Plex sign-in: opens Plex's own approval page and stores the token it hands back. No password passes through here.
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { saveConfig } from './config.js';

const clientId = randomUUID();
const headers = { Accept: 'application/json', 'X-Plex-Product': 'Orbie', 'X-Plex-Client-Identifier': clientId };

const pin = await (await fetch('https://plex.tv/api/v2/pins?strong=true', { method: 'POST', headers })).json();
if (!pin.code) throw new Error('Plex did not give a sign-in code');
const url = `https://app.plex.tv/auth#?clientID=${clientId}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=Orbie`;
console.log(`Approve Orbie in your browser:\n${url}`);
execFile('open', [url]);

for (let i = 0; i < 55; i++) { // about 110 s
  await new Promise((r) => setTimeout(r, 2000));
  const { authToken } = await (await fetch(`https://plex.tv/api/v2/pins/${pin.id}`, { headers })).json();
  if (authToken) {
    saveConfig({ plex_token: authToken });
    console.log('Signed in. The bridge will start watching your Watchlist.');
    process.exit(0);
  }
}
console.error('Not approved in time. Run this again.');
process.exit(1);
