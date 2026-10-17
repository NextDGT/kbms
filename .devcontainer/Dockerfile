FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

USER root

# Windows installers are built under wine; NSIS runs a 32-bit helper, so wine32 (i386) is needed
RUN dpkg --add-architecture i386

# Electron runtime / native build deps + packaging tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Electron GUI / Chromium deps
    libgtk-3-0 \
    libnss3 \
    libnspr4 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libcups2 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    # Build tools for native modules
    build-essential \
    python3 \
    pkg-config \
    # Linux packaging (deb / rpm / AppImage helpers)
    rpm \
    fakeroot \
    dpkg \
    # Windows cross-builds from Linux
    wine \
    wine64 \
    wine32:i386 \
    # X11 utilities for GUI forwarding
    x11-apps \
    libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

# Avoid Electron sandbox issues inside containers
ENV ELECTRON_DISABLE_SANDBOX=1
ENV ELECTRON_ENABLE_LOGGING=1

USER node
