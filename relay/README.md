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
3. Copy the service URL, change `https://` to `wss://`, and paste it in IronHide under
   **Settings → Together → Relay URL**.

Health check: `GET /health`.

## Run locally

```bash
cd relay && npm install && npm start    # ws://localhost:8790
```
