---
title: "Implementation Package I-010 - Streaming Segmentation"
version: "1.0"
status: implemented-foundation
updated: 2026-09-08
tags:
  - audio-workstation
  - implementation
  - segmentation
---

# Implementation Package I-010 — Streaming Segmentation

I-010 adds the first bounded, deterministic analysis pass over the canonical PCM cache. It plans navigation chunks, caches speech-likelihood features, and derives padded speech clips without retaining source audio pages. It has no visible UI integration yet.

## Honest capability boundary

The current classifier is `dsp-energy-zcr-v1`. It estimates activity from window RMS and zero-crossing rate. It is useful for deterministic plumbing, silence handling, preview planning, and finding sustained energy-context changes. It is **not** Silero VAD and cannot reliably distinguish speech from music or other active sound.

`SpeechLikelihoodClassifier.scoreWindow` is the replacement seam for a pinned ONNX VAD. A model adapter must consume and finish with each supplied mono window before its promise settles; it must not retain that mutable window. The adapter must preserve canonical half-open `[startFrame, endFrame)` output and the generation/cancellation contract. Qualified Silero integration remains governed by [[Dialogue Enhancement and VAD]].

## Streaming and timeline contract

- Input is contiguous 48 kHz planar Float32 PCM with one or two channels.
- Input pages may contain at most 240,000 frames (five seconds). The analyzer holds one input page supplied by the reader and one mono analysis window at a time; it never assembles the recording.
- Stereo downmix is `(L + R) / 2`. This can cancel phase-opposed sources and must remain an explicit model qualification case.
- Analysis windows default to 960 frames (20 ms), including one exact partial window at EOF. Configured windows are limited to 480–48,000 frames.
- The MVP duration limit is 43,200,000 frames (900 seconds). Default output contains at most 45,000 feature records; the configurable 10 ms floor limits it to 90,000.
- PCM pages must be ordered, contiguous, and end at `totalFrames`. Gaps, overlap, excess, and early EOF reject the run rather than shifting the timeline.
- Progress is emitted only after a complete analysis window. Cancellation and a stale generation are checked before pages, before classification, after awaited classification, and before result publication.

## Derived metadata

The analyzer returns:

1. RMS, zero-crossing rate, and speech likelihood for each exact canonical window.
2. The shared unpadded speech mask using the ordering in [[Dialogue Enhancement and VAD]].
3. Separately padded speech clips, clamped to the recording.
4. Sustained energy-context boundaries using 8 dB entry, 4 dB exit hysteresis, five-window confirmation, and a two-second minimum segment by default.
5. A complete, non-overlapping partition of `[0, totalFrames)` for navigation or sequential processing.

Energy-context segmentation is an unsupervised fallback. The app must not promise that every boundary represents a cut, noise-source change, or speaker change. Per-chunk controls should only appear later when measured differences make them useful.

## Search markers and follow-on work

The implementation is in `src/processing/segmentation.ts`. Search for `LEAKY ABSTRACTION:` to find the fallback-classifier disclosure. The low-level validation is recorded in `implementation/evidence/i-010/README.md`.

Before user-facing enablement, add an OPFS manifest adapter for I-009 pages, persist versioned results atomically, and qualify a curated speech model. UI integration must consume the committed result only when its generation still matches the project.

See [[Boundary Contracts]], [[Ingestion and Timeline]], [[Memory and Storage]], and [[Implementation Package I-009 - Local Audio Extraction Cache]].
