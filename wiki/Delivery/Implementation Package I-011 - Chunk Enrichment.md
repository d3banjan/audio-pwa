---
title: "Implementation Package I-011 - Chunk Enrichment"
version: "1.0"
status: integrated-functional-prototype
updated: 2026-09-08
tags:
  - audio-workstation
  - implementation
  - dsp
---

# Implementation Package I-011 — Chunk Enrichment

I-011 is the bounded offline renderer used after segmentation. It reads one
canonical 48 kHz stereo page at a time, keeps filter and dynamics state across
page boundaries, and writes one equally bounded processed page. It never holds
the full recording in JavaScript memory.

The visible flow freezes the accepted preview controls before starting the
worker. The batch pass receives the same high-pass frequency and Q, dialogue
presence frequency and gain, mid/side width, compressor threshold and ratio,
and output gain. This makes the processed WAV track the preview settings. The
native `DynamicsCompressorNode` and the deterministic batch envelope are not
numerically identical, so the current contract is perceptual continuity rather
than sample equality.

The renderer rejects non-finite PCM, gaps, overlaps, oversized allocations,
stale generations, and incomplete timelines. Cancellation is checked around
every page write and final publication. Its linked stereo detector preserves
the left/right relationship and never boosts a quiet sample while the
compressor releases.

The current safety stage is a **-1 dBFS sample-peak clamp**. It is not a
qualified true-peak limiter and the UI must not describe it as one. Dialogue
denoising, preview-first dereverberation, source-separated stems, loudness
normalization, and true-peak qualification remain separate implementation
packages.

Search `LEAKY ABSTRACTION:` in `src/processing/chunk-enrichment.ts` for the
bounded JavaScript sample-loop seam. A worker/WASM replacement must preserve
page bounds, state continuity, cancellation, generation checks, and atomic
writer behavior.

Evidence is recorded in
`implementation/evidence/i-011-enrichment/README.md`. See [[Implementation Package I-013 - Browser Processing Backend]], [[Mixer and Controls]], and [[Export and Metering]].
