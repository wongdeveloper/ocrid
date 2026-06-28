#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PYTHONUNBUFFERED=1
export TESSERACT_CMD="${TESSERACT_CMD:-/opt/homebrew/bin/tesseract}"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Starting OCR API"
echo "Python: $PROJECT_ROOT/.venv/bin/python"
echo "Tesseract: ${TESSERACT_CMD}"

exec "$PROJECT_ROOT/.venv/bin/python" "$PROJECT_ROOT/main.py"
