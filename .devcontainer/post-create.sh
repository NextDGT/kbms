#!/usr/bin/env bash
set -euo pipefail

echo "[kbms] Installing npm dependencies..."
npm install

echo "[kbms] Ready. Run: npm run dev"
echo "[kbms] Package locally: npm run dist:linux | dist:win"
echo "[kbms] Package all OS (CI): push a tag or run the GitHub Actions workflow"
