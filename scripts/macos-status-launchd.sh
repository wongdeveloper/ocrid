#!/usr/bin/env bash
set -euo pipefail

DOMAIN="gui/$(id -u)"
LABELS=(
  "com.ocrid.ocr-api"
  "com.ocrid.whatsapp-web"
)

for label in "${LABELS[@]}"; do
  target="$DOMAIN/$label"
  echo "== $label =="
  if launchctl print "$target" >/dev/null 2>&1; then
    echo "launchd: loaded"
    launchctl print "$target" 2>/dev/null | awk '/state =|pid =|last exit code =/ {gsub(/^[ \t]+/, ""); print}'
  else
    echo "launchd: not loaded"
  fi
  echo
done

echo "== HTTP checks =="
printf "OCR API: "
curl -fsS http://127.0.0.1:6017/health || true
echo
printf "WhatsApp worker: "
curl -fsS http://127.0.0.1:3001/whatsapp/status || true
echo
echo
echo "Log files:"
for label in "${LABELS[@]}"; do
  plist="$HOME/Library/LaunchAgents/$label.plist"
  if [[ -f "$plist" ]]; then
    stdout_path="$(/usr/libexec/PlistBuddy -c 'Print :StandardOutPath' "$plist" 2>/dev/null || true)"
    stderr_path="$(/usr/libexec/PlistBuddy -c 'Print :StandardErrorPath' "$plist" 2>/dev/null || true)"
    [[ -n "$stdout_path" ]] && echo "  $stdout_path"
    [[ -n "$stderr_path" ]] && echo "  $stderr_path"
  fi
done
