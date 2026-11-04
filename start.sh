#!/usr/bin/env bash
# Quick local dev launcher for LocalClips
# Starts the backend and frontend in parallel.
set -euo pipefail

# ── Backend ─────────────────────────────────────────────────────────────────
echo "🔧  Starting LocalClips backend on :8001…"
(
  cd backend
  [ -f .env ] || cp .env.example .env
  # Install deps if not already done
  [ -d .venv ] || uv sync
  uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8001 &
)
BACKEND_PID=$!

# ── Frontend ─────────────────────────────────────────────────────────────────
echo "🌐  Starting LocalClips frontend on :3200…"
(
  cd frontend
  [ -f .env.local ] || cp .env.example .env.local
  [ -d node_modules ] || npm install
  npm run dev
)

# Kill backend if frontend exits
kill $BACKEND_PID 2>/dev/null || true
