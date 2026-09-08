---
title: "Implementation Package I-012 - OPFS Processing Store"
version: "1.0"
status: implemented-foundation
updated: 2026-09-08
tags:
  - audio-workstation
  - implementation
  - storage
---

# Implementation Package I-012 — OPFS Processing Store

I-012 connects the committed I-009 canonical PCM cache to the I-010 segmentation and I-011 enrichment page contracts. It also provides transactional persistence for processed PCM. It has no visible UI integration.

## Reader contract

`openCommittedPcmReader` reads the current IndexedDB pointer and manifest through an injectable repository. It rejects mismatched identities, incomplete state, non-48 kHz or non-stereo input, unsafe page names, invalid ordering, pages over five seconds, inconsistent frame totals, and malformed integrity data.

Every page is then read separately from its I-009 OPFS tree. Its exact byte length and separate left/right FNV-1a integrity values are checked before exposing two planar `Float32Array` views. The adapter never assembles the project. Consumers must finish with the yielded views before advancing the iterator. A changed committed source stops the run rather than combining generations.

The processed-result reader applies the same bounded page checks and revalidates both source and processed pointers/manifests before every page. A replacement under a new pointer, a source-generation mutation under the same run ID, a processed-generation mutation under the same result ID, a frame-total mismatch, truncated bytes, or page corruption stops the read.

## Processed-result transaction

`createTransactionalProcessedWriter` accepts exact contiguous stereo pages of at most five seconds. It rejects gaps, excess frames, shortened channel arrays, and non-finite samples. One combined planar page allocation is written and closed before the next page is accepted.

All pages are staged below a unique `processing-*` OPFS tree. `close()` requires exact coverage of the source timeline and publishes an immutable manifest plus `processing:current` pointer in one transaction. The same transaction verifies that the source run and generation remain current. Errors, cancellation, partial timelines, and stale sources cannot replace an earlier committed result. Staging cleanup and predecessor collection are best effort after the publication decision.

The production adapter intentionally shares I-009's IndexedDB object store because IndexedDB cannot make one atomic transaction across databases. Browser OPFS and IndexedDB dependencies remain injectable so storage failure and commit races can be tested without global browser state.

## Bounded WAV artifact slice

The current processed result can be streamed into an OPFS-backed 48 kHz stereo PCM24 RIFF/WAV artifact with TPDF dither. The artifact call requires the exact expected processed-result ID, preventing another tab's replacement from being exported as though it belonged to the completed job. Cancellation after any awaited write aborts and removes the partial file. A successful artifact exposes an `audio/wav` Blob and sanitized download name; disposal removes its OPFS file.

This remains a **sample-peak prototype**. I-011 supplies a -1 dBFS sample clamp; no oversampled true-peak limiter, dBTP claim, integrated loudness normalization, or post-quantization true-peak verification exists yet. See [[Export and Metering]] and V-06 in [[Validation Plan]]. Real Chromium OPFS/header/playability/cancel/dispose evidence is recorded in `implementation/evidence/i-012-wav/README.md`.

## Search markers and limits

Search `LEAKY ABSTRACTION:` in `src/processing/opfs-processing-store.ts`. The markers identify the OPFS-owned ArrayBuffer lifetime and `createWritable()` page-publication behavior that a worker or access-handle replacement must preserve.

This package provides storage plumbing only. It does not run segmentation or enrichment, connect processing to the interface, qualify crash recovery between an OPFS page close and manifest commit, or provide cryptographic integrity. FNV-1a detects accidental corruption; model/package authenticity continues to require SHA-256 under [[Model Runtime and Licensing]].

See [[Implementation Package I-009 - Local Audio Extraction Cache]], [[Implementation Package I-010 - Streaming Segmentation]], [[Memory and Storage]], and [[Boundary Contracts]].
