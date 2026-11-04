# IronHide relay

A tiny always-on WebSocket server that lets IronHide instances find each other for friends, rooms, chat,
reactions and **playback sync**. It never carries video: every viewer plays their own copy.

- Everything is in memory (no database). Restarting the relay clears rooms and pending friend requests.
- Identity is an Ed25519 key each IronHide creates locally. Friend codes are derived from the public key.
- Presence is only shared between *mutual* friends.

## Deploy on Render

1. Push this repo, then in Render create a **Web Service** with root directory `relay`.
2. Build command `npm install`, start command `npm start`, plan Free is fine (it sleeps when idle, the first
   connection after a nap takes a moment).
3. Set env var `RELAY_DIRECTORY=1` so members see a "People here" list and can add each other by name
   (names stay unique among people online). `render.yaml` at the repo root does steps 1-3 as a Blueprint.
4. Copy the service URL, change `https://` to `wss://`, and paste it in IronHide under
   **Settings → Together → Relay URL**, or put it in `src/relay-default.js` so everyone who pulls the repo connects automatically.

Health check: `GET /health`.

## Run locally

```bash
cd relay && npm install && npm start    # ws://localhost:8790
```
