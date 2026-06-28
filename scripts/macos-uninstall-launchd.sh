#!/usr/bin/env bash
set -euo pipefail

AGENT_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

LABELS=(
  "com.ocrid.ocr-api"
  "com.ocrid.whatsapp-web"
)

for label in "${LABELS[@]}"; do
  plist="$AGENT_DIR/$label.plist"
  launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || true
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  rm -f "$plist"
  echo "Removed $label"
done

echo "WhatsApp session data under .wwebjs_auth was left untouched."
