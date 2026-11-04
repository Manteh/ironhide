# IronHide hub (hosted mode)

Visitors open the site, type a unique name, and land in their own private IronHide. Each name gets its own daemon with its own
settings, history, keys and friend identity. The relay for rooms and chat runs inside the same service.

Deploy on Render: New → Blueprint → this repo (uses `render.yaml`). Optional env vars:
- `HUB_CODE` access code visitors must enter (recommended, so strangers cannot use your server)
- `HUB_MAX_ACTIVE` daemons running at once (about 100 MB each). Idle ones stop after `HUB_IDLE_MIN` minutes (default 20)

Everyone adds their own TorBox key in Settings → Connectors. Video is fetched and proxied by the server, so bandwidth is yours.
Locally: `PORT=8080 node hub/server.js`.
