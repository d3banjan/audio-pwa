---
title: "I-005 Bounded MP4 Playback Feasibility"
status: observed
updated: 2026-09-08
tags:
  - media-path
  - browser-capability
  - i-005
  - streaming-readiness
---

# I-005 Bounded MP4 playback feasibility

## Scope and constraints

- Probe private test sample metadata (read-only).
- Do not copy/upload/store the source file or absolute file path in tracked files.
- Do not edit application runtime code.
- Compare bounded playback options for the first ship candidate only.

## Source media evidence (sanitized)

`TODO(I-005):` successful playback of the private source in the integrated I-004 UI remains the final local acceptance check. Container metadata stays sanitized and the file is never copied or uploaded.

| Field | Value |
| --- | --- |
| Container | `mov,mp4,m4a,3gp,3g2,mj2` (QuickTime/MOV muxer family) |
| Major profile | MP4/H.264/AAC with compatible major brands |
| Video codec | `h264` (Baseline profile, tag `avc1`, level 31, `avc1.42001f`) |
| Audio codec | `aac` (AAC-LC, tag `mp4a`, `mp4a.40.2`) |
| Resolution | `1024x576` |
| Duration | `533.010658` s (container duration), video duration `532.990000` s |
| File size | `54,636,200` bytes |
| Video timebase | `1/600` |
| Audio timebase | `1/44100` |
| Video frame rate | `24000/1001` (R-frame, progressive) |
| Video duration TS | `319794` |
| Audio duration TS | `23505770` |

### Tooling status

- `ffprobe` succeeded and produced stream/container metadata above.
- `mediainfo` command is not installed in this environment (`mediainfo: command not found`).

## Browser capability test attempt

A generic probe script was added at `scripts/probes/i-005-browser-capability.mjs`. It checks:

- `video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')`
- `audio canPlayType('audio/mp4; codecs="mp4a.40.2"')`
- `VideoDecoder.isConfigSupported` and `AudioDecoder.isConfigSupported`

The probe ran with the already-installed Chromium 152 binary. `canPlayType` returned `maybe` for generic MP4 and `probably` for both H.264 Baseline + AAC-LC MP4 and AAC-LC audio-in-MP4. This confirms the media-element candidate at the browser capability level; it does not prove successful decode of the private file until the integrated manual check runs.

`BLOCKED(I-005):` WebCodecs constructors were absent in this headless probe context. The richer demux/WebCodecs path remains deferred; it does not block the selected HTMLMediaElement prototype.

### Runtime result and remaining limit

- HTMLMediaElement reports `probably` for the private source's codec combination in this local Chromium build.
- WebCodecs remains unqualified in this environment and is not part of the immediate path.

## Path comparison for ship decision

- **Path A: media-element real-time path** (bounded, minimal)
  - Use `<video>` directly for immediate playback and timeline sync, then decode downstream only as needed.
  - Lowest integration cost and fastest shipping path.
  - `LEAKY ABSTRACTION:` playback state, timing, and sample-domain assumptions leak through DOM/media-element behavior; this is acceptable for now because I-005 scope is to prove bounded viability, not production-grade transport transforms. Future seam: isolate playback into a `PlaybackRuntime` interface with deterministic state snapshots and explicit fallback states.

- **Path B: MP4 demux + WebCodecs** (richer bounded path)
  - Demux MP4 in JS/worker and decode with `VideoDecoder` / `AudioDecoder`.
  - Gives explicit timing control and easier future transform hooks.
  - More code paths, more runtime permissions, and greater risk around browser implementation variance.

- **Recommended immediate seam:** keep/finish **Path A** for the first functional ship due to lower risk and existing acceptance of a local preview stack.

## Next refactor seam (handoff to I-004)

- Add a minimal codec/runtime adapter boundary between UI controls and preview implementation:
  - current concrete: DOM `HTMLMediaElement` control + direct metadata-driven preview assumptions
  - target seam: adapter that exposes a typed `PlaybackRuntime` contract (`play`, `pause`, `seek`, `duration`, `timeBase`, `error`, `codecProfile`) and can be swapped with a WebCodecs-backed implementation later.

## App edits from the prior functional patch that I-004 should audit

- `src/main.ts`
  - import/wiring of `createRealMediaPreviewController` and local preview initialization path around the DOM media element setup
  - `LEAKY ABSTRACTION` notes near metadata sampling and metadata-only path treatment (e.g., codec/channel/sample-rate sampling and `decodeAudioData` metadata path)
- `src/media/real-local-preview.ts`
  - runtime controller lifecycle and best-effort cleanup path currently handling single-element playback semantics
- `src/media/real-local-preview.test.ts`
  - unit coverage for the real media preview controller behavior was added/modified to match the same seam

These are implementation edits and should be reviewed against I-004 acceptance gates (timing accuracy, cleanup determinism, and fallback behavior).
