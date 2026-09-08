---
title: "ADR 003 - Memory and Paging"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
  - adr
---

# ADR 003 - Memory and Paging

- **Original title:** Memory Safety Architecture & OPFS-Backed Stem Paging.
- **Status:** Accepted architectural intent from v2.0; revised details proposed.
- **Decision:** Store PCM in bounded local chunks, maintain a small active playback window, and admit work using a measured memory/storage budget.

## Context

Four 15-minute stereo Float32 stems at 48 kHz occupy about 1.38 GB before input, raw dialogue, model state, or export. The 1.5 GB target cannot be met by keeping all assets resident.

## Rationale

OPFS-backed paging decouples recording duration from resident PCM. Worker prefetch feeds bounded render-thread queues. Full-file native decode, oversized WASM heaps, GPU scratch, and final Blob assembly can still break the budget and must be measured or replaced.

The initial page proposal is five seconds with an approximately five-second lookahead and one-second lookbehind, subject to throughput tests. Do not mandate 30 seconds on either side for every device. Peak pyramids are stored separately and rendered by viewport.

At 100 stereo min/max peak pairs per second for 15 minutes, a Float32 base level is 1.44 MB per stem; multiple stems and coarser levels exceed the draft's aggregate under-2 MB claim. Bound the resident peak cache, use quantization if validated, and account for all levels.

## Consequences

The under-400 MB guarantee is withdrawn. The working-set goal covers JS, native audio, workers, WASM, and GPU resources. Browser measurements can be incomplete, so conservative admission and profiled support limits accompany internal accounting.

Feature-probe OPFS access handles and validate fallback throughput. Quota and persistence are advisory and must be rechecked on writes. Recover from committed manifests after interrupted work; do not promise catchable recovery from every browser OOM.

Export needs bounded rendering and a bounded final save path. See [[Export and Metering]].

## Validation and references

V-01/V-02/V-06/V-10 in [[Validation Plan]] gate this decision. Detailed accounting: [[Memory and Storage]]. Upstream: [OPFS](https://web.dev/articles/origin-private-file-system).
