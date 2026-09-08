# Cinematic Audio Workstation

This repository contains a privacy-first, client-side audio workstation prototype. It runs in the browser and keeps selected media local.

The current prototype supports local audio and video preview through the browser’s media and Web Audio APIs, safe monitoring controls, level-matched source/processed comparison, undo, bounded local audio output capture, and automatic bounded PCM audio preparation/cache for admitted browser-decodable MP4 files. Preparation runs at playback speed and may need a click to resume if the browser suspends it; it is local audio preparation only, not model enhancement. The prototype also includes a clearly labeled fixture mode for testing the planned workflow.

Model-based enhancement, automatic stem separation, full offline rendering, video remuxing, and production-quality stem export are not implemented. Fixture mode simulates planning and export UI; it does not process real audio. Browser-native output capture is audio-only and runs at playback speed. Supported formats and browser limits depend on the local browser. See the [wiki](wiki/Home.md) for the current requirements, architecture, decisions, delivery status, and evidence.

## Run locally

Requires [Bun](https://bun.sh/).

```sh
bun install
bun run dev
```

Open the local URL printed by Vite. To run the checks:

```sh
bun run check
bun run release:check
```

The release check builds the app, runs unit and browser checks, verifies wiki links, and validates the generated offline shell. GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`; Vite uses relative asset paths so the build works under a repository subpath.
