#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$SOURCE_ROOT"
AGENT_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"

if [[ "$SOURCE_ROOT" == "$HOME/Documents/"* && "${OCRID_DISABLE_RUNTIME_COPY:-}" != "1" ]]; then
  RUNTIME_ROOT="${OCRID_RUNTIME_ROOT:-$HOME/OCRID-launchd}"
  mkdir -p "$RUNTIME_ROOT"

  copy_dir_replace() {
    local dir="$1"
    [[ -d "$SOURCE_ROOT/$dir" ]] || return 0
    rm -rf "$RUNTIME_ROOT/$dir"
    mkdir -p "$(dirname "$RUNTIME_ROOT/$dir")"
    (cd "$SOURCE_ROOT" && COPYFILE_DISABLE=1 tar -cf - "$dir") | (cd "$RUNTIME_ROOT" && COPYFILE_DISABLE=1 tar -xf -)
  }

  copy_dir_once() {
    local dir="$1"
    local marker="$RUNTIME_ROOT/$dir/.ocrid-runtime-copy-complete"
    [[ -d "$SOURCE_ROOT/$dir" ]] || return 0
    [[ -f "$marker" ]] && return 0
    rm -rf "$RUNTIME_ROOT/$dir"
    mkdir -p "$(dirname "$RUNTIME_ROOT/$dir")"
    (cd "$SOURCE_ROOT" && COPYFILE_DISABLE=1 tar -cf - "$dir") | (cd "$RUNTIME_ROOT" && COPYFILE_DISABLE=1 tar -xf -)
    touch "$marker"
  }

  for file in \
    .env .env.example .gitignore \
    app.js index.html ktp_ai.py main.py package-lock.json package.json \
    README.md requirements.txt server.js styles.css whatsapp-web-worker.js
  do
    if [[ -f "$SOURCE_ROOT/$file" ]]; then
      cp -p "$SOURCE_ROOT/$file" "$RUNTIME_ROOT/$file"
    fi
  done
  copy_dir_replace scripts
  copy_dir_replace tests
  copy_dir_replace .runtime
  copy_dir_once .venv
  copy_dir_once .wwebjs_auth
  copy_dir_once .wwebjs_cache
  if [[ -z "$NPM_BIN" || ! -x "$NPM_BIN" ]]; then
    echo "npm was not found. Install Node.js/npm, then rerun this script."
    exit 1
  fi
  if [[ ! -f "$RUNTIME_ROOT/.ocrid-npm-install-complete" ]]; then
    rm -rf "$RUNTIME_ROOT/node_modules"
  fi
  if [[ ! -d "$RUNTIME_ROOT/node_modules/whatsapp-web.js" || "$SOURCE_ROOT/package-lock.json" -nt "$RUNTIME_ROOT/.ocrid-npm-install-complete" ]]; then
    (cd "$RUNTIME_ROOT" && "$NPM_BIN" install --omit=dev)
    touch "$RUNTIME_ROOT/.ocrid-npm-install-complete"
  fi
  PROJECT_ROOT="$RUNTIME_ROOT"
  echo "Project is under ~/Documents, which launchd cannot access without extra privacy permissions."
  echo "Synced launchd runtime copy to: $PROJECT_ROOT"
fi

LOG_DIR="$PROJECT_ROOT/logs"

OCR_LABEL="com.ocrid.ocr-api"
WA_LABEL="com.ocrid.whatsapp-web"
OCR_PLIST="$AGENT_DIR/$OCR_LABEL.plist"
WA_PLIST="$AGENT_DIR/$WA_LABEL.plist"

PYTHON_BIN="$PROJECT_ROOT/.venv/bin/python"
SERVICE_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
TESSERACT_BIN="${TESSERACT_CMD:-$(command -v tesseract || true)}"
if [[ -z "$TESSERACT_BIN" && -x "/opt/homebrew/bin/tesseract" ]]; then
  TESSERACT_BIN="/opt/homebrew/bin/tesseract"
fi
if [[ -z "$TESSERACT_BIN" && -x "/usr/local/bin/tesseract" ]]; then
  TESSERACT_BIN="/usr/local/bin/tesseract"
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing Python runtime: $PYTHON_BIN"
  echo "Run: npm run setup:python"
  exit 1
fi

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Node.js was not found. Install Node.js, then rerun this script."
  exit 1
fi

if [[ "$PROJECT_ROOT" == "$SOURCE_ROOT" && ! -d "$PROJECT_ROOT/node_modules" ]]; then
  echo "Missing node_modules."
  echo "Run: npm install"
  exit 1
fi

mkdir -p "$AGENT_DIR" "$LOG_DIR"
chmod +x "$PROJECT_ROOT/scripts/run-ocr-api.sh" "$PROJECT_ROOT/scripts/run-whatsapp-web.sh"

cat > "$OCR_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$OCR_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PROJECT_ROOT/scripts/run-ocr-api.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONUNBUFFERED</key>
    <string>1</string>
    <key>PATH</key>
    <string>$SERVICE_PATH</string>
    <key>TESSERACT_CMD</key>
    <string>$TESSERACT_BIN</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/ocr-api.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/ocr-api.err.log</string>
</dict>
</plist>
PLIST

cat > "$WA_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$WA_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PROJECT_ROOT/scripts/run-whatsapp-web.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$SERVICE_PATH</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/whatsapp-web.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/whatsapp-web.err.log</string>
</dict>
</plist>
PLIST

restart_agent() {
  local label="$1"
  local plist="$2"
  launchctl bootout "$DOMAIN/$label" >/dev/null 2>&1 || true
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "$DOMAIN" "$plist"
  launchctl enable "$DOMAIN/$label" >/dev/null 2>&1 || true
  launchctl kickstart -k "$DOMAIN/$label" >/dev/null 2>&1 || true
}

restart_agent "$OCR_LABEL" "$OCR_PLIST"
restart_agent "$WA_LABEL" "$WA_PLIST"

echo "Installed launchd agents:"
echo "  $OCR_PLIST"
echo "  $WA_PLIST"
echo "Runtime root:"
echo "  $PROJECT_ROOT"
echo
echo "Status:"
echo "  npm run macos:status"
echo
echo "Logs:"
echo "  tail -f \"$LOG_DIR/ocr-api.err.log\" \"$LOG_DIR/whatsapp-web.err.log\""
