# Cinematic Audio Workstation

This repository contains a privacy-first, client-side audio workstation prototype. It runs in the browser and keeps selected media local.

The current prototype supports local audio and video preview through the browser’s media and Web Audio APIs, safe monitoring controls, source/processed comparison, undo, bounded local audio output capture, and automatic bounded PCM audio preparation/cache for admitted browser-decodable MP4 files. Prepared MP4 audio can be analyzed by the packaged Silero speech model, enriched in serial local chunks using the accepted preview settings, and exported as a playable 48 kHz stereo 24-bit WAV. Preparation runs at playback speed and may need a click to resume if the browser suspends it. The prototype also includes a clearly labeled fixture mode for testing the planned workflow.

Automatic stem separation, speech denoising, dereverberation, video remuxing, true-peak mastering, and stem export are not implemented. The speech model currently supplies segmentation metadata; the audible treatment is bounded DSP rather than model-generated replacement audio. Fixture mode simulates planning and export UI; it does not process real audio. Sources without a prepared MP4 cache use browser-native audio-only output capture at playback speed. Supported formats and browser limits depend on the local browser. See the [wiki](wiki/Home.md) for the current requirements, architecture, decisions, delivery status, and evidence.

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
