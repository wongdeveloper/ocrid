#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

export PATH="/Users/gnow/.nvm/versions/node/v18.20.8/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Node.js was not found in PATH: $PATH" >&2
  exit 78
fi

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Starting WhatsApp Web worker"
echo "Node: $NODE_BIN"

exec "$NODE_BIN" "$PROJECT_ROOT/whatsapp-web-worker.js"
