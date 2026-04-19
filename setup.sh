#!/usr/bin/env bash
set -e

echo "==> IronHide setup"

# 1. Homebrew
if ! command -v brew &>/dev/null; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# 2. mpv + Vulkan/MoltenVK
echo "==> Installing mpv and MoltenVK..."
brew install mpv molten-vk
brew link molten-vk   # critical — without this mpv shows audio but no video window

# 3. Node.js
if ! command -v node &>/dev/null; then
  brew install node
fi

# 4. npm deps
echo "==> Installing Node dependencies..."
npm install

# 5. mpv config
MPV_CONF="$HOME/.config/mpv/mpv.conf"
mkdir -p "$(dirname "$MPV_CONF")"
if ! grep -q "vo=gpu-next" "$MPV_CONF" 2>/dev/null; then
  echo "==> Writing mpv.conf..."
  cat >> "$MPV_CONF" << 'MPVCONF'
vo=gpu-next
hwdec=videotoolbox
cache=yes
demuxer-max-bytes=512MiB
network-timeout=60
MPVCONF
fi

# 6. IronHide config
IRONHIDE_CONF="$HOME/.config/ironhide/config.json"
mkdir -p "$(dirname "$IRONHIDE_CONF")"

if [ ! -f "$IRONHIDE_CONF" ]; then
  echo ""
  echo "You need two API keys:"
  echo "  TMDB:        https://www.themoviedb.org/settings/api  (free)"
  echo "  Real-Debrid: https://real-debrid.com/apitoken          (paid, ~3€/mo)"
  echo ""
  read -rp "TMDB API key: " TMDB_KEY
  read -rp "Real-Debrid API key: " RD_KEY
  cat > "$IRONHIDE_CONF" << JSON
{
  "tmdb_api_key": "$TMDB_KEY",
  "rd_api_key": "$RD_KEY"
}
JSON
  echo "==> Config saved to $IRONHIDE_CONF"
else
  echo "==> Config already exists at $IRONHIDE_CONF, skipping"
fi

# 7. Claude Code MCP config
MCP_JSON="$HOME/.mcp.json"
IRONHIDE_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! grep -q "ironhide" "$MCP_JSON" 2>/dev/null; then
  echo "==> Registering IronHide MCP server in $MCP_JSON..."
  if [ -f "$MCP_JSON" ]; then
    # Merge into existing file
    node - << JS
const fs = require('fs');
const path = '$MCP_JSON';
const cfg = JSON.parse(fs.readFileSync(path, 'utf-8'));
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.ironhide = {
  command: 'node',
  args: ['$IRONHIDE_DIR/mcp/server.js']
};
fs.writeFileSync(path, JSON.stringify(cfg, null, 2));
console.log('done');
JS
  else
    cat > "$MCP_JSON" << JSON
{
  "mcpServers": {
    "ironhide": {
      "command": "node",
      "args": ["$IRONHIDE_DIR/mcp/server.js"]
    }
  }
}
JSON
  fi
else
  echo "==> IronHide already in $MCP_JSON, skipping"
fi

echo ""
echo "✓ Done! Restart Claude Code, then try: 'play Inception'"
