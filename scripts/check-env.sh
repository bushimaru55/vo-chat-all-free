#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== vo-chat environment check ==="
echo

echo "[docker version]"
if command -v docker >/dev/null 2>&1; then
  docker version
else
  echo "ERROR: docker not found"
  exit 1
fi
echo

echo "[docker compose version]"
docker compose version
echo

echo "[docker compose config]"
if [[ -f .env ]]; then
  docker compose config
else
  echo "WARN: .env not found. Copy .env.example to .env before starting."
  docker compose --env-file .env.example config 2>/dev/null || docker compose config
fi
echo

echo "[models/*.gguf]"
shopt -s nullglob
gguf_files=(models/*.gguf)
if [[ ${#gguf_files[@]} -eq 0 ]]; then
  echo "WARN: No .gguf files found in models/"
  echo "      Place a GGUF model in models/ and set LLM_MODEL_PATH in .env"
else
  for f in "${gguf_files[@]}"; do
    echo "  OK: $f"
  done
fi
echo

echo "[.env file]"
if [[ -f .env ]]; then
  echo "  OK: .env exists"
else
  echo "  WARN: .env not found (run: cp .env.example .env)"
fi
echo

echo "=== check complete ==="
