#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DISPLAY:-}" ]]; then
  echo "[kbms] DISPLAY is unset — Electron GUI will not open."
  echo "[kbms] On Linux host, allow X11 then reopen the container:"
  echo "         xhost +local:docker"
  echo "         export DISPLAY=:0"
else
  echo "[kbms] DISPLAY=${DISPLAY}"
fi
