---
title: "Implementation Package I-003 - Experience Prototype"
version: "2.1"
status: ready
updated: 2026-09-07
tags:
  - audio-workstation
  - delivery
  - implementation
---

# Implementation Package I-003 - Experience Prototype

## User-visible outcome

A runnable, accessible prototype of the complete experience contract: local video/audio selection, audible-intention controls, representative preview, level-matched A/B and undo, qualified-profile planning, visible progress/cancellation, optional acoustic-region review, assembled preview, and full-mix/processed-stem export selection.

This package evaluates comprehension and interaction. Real-file mode now makes local preview, automatic MP4 audio preparation, and processed preview the primary journey; its planning controls remain a clearly labeled simulated demo for interface testing only.

## Inputs and outputs

- Input: local file selection metadata only; never read or decode its content in this package.
- Development fixtures: local deterministic metadata and visibly synthetic preview/progress states behind a typed adapter.
- Output: UI state and commands suitable for a later browser-worker backend; no generated audio file and no success claim for real media.
- All intervals use canonical half-open 48 kHz frame ranges in contracts even when the fixture displays friendly time.

## Required journey

1. Select an audio/video file and see privacy/local-storage language.
2. Choose sound intentions: dependable Dialogue Clean, experimental Dereverb, Music Weight, width, ducking, and loudness outcome.
3. Select a representative preview region and enter fixture preview mode.
4. Compare changed/source through a clear A/B state and undo/reset controls.
5. Inspect quality-profile cards with source fidelity, model, persistent/temporary bytes, peak working-memory range, ETA range/confidence, feasibility, and named blockers.
6. Press Enhance to see a bounded sequential plan with progress and cancellation.
7. Keep technical chunks out of creative controls; show an optional semantic acoustic-change region fixture only.
8. Preview an assembled result state and choose finished mix plus D-015 processed stems through explicit inclusion controls.

## Scope exclusions

- No decode, OPFS media persistence, ONNX session, real DSP/audio preview, model download, WAV/video output, or production resource estimate.
- No fabricated meters, waveforms, audible output, “enhanced,” “offline-ready,” or export-success claim for a selected file.
- Fixture/demo mode is visually and accessibly persistent and cannot be confused with real processing. In real mode, the simulated planning panel is collapsed by default and labeled as a demo.

## State and failure behavior

Use an explicit experience state machine with legal forward/back/cancel transitions and immutable snapshots for preview/plan/export. Cover unsupported type, infeasible profile, experimental feature unavailable, cancelled plan, and reset to the original source. Preserve focus and prior valid choices across status updates.

## Resource and privacy budget

Do not read file bytes. Keep fixture data below 1 MB, create no audio/video buffers, make no network request, and perform no interval/main-thread work that creates a long task. Diagnostics and service-worker behavior from I-001 remain intact.

## Acceptance checks

- Unit tests cover legal state transitions, invalid/stale events, A/B/undo, profile feasibility, cancellation, and export inclusion independent of audition state.
- Browser tests cover the primary keyboard journey, focus/status behavior, narrow viewport, reduced motion, and persistent fixture disclosure.
- Existing I-001 unit, PWA browser, build, release, and wiki checks continue to pass.
- Evidence lives under `implementation/evidence/i-003/` and explicitly lists unimplemented backend capabilities.

## Ownership and review

Preferred implementer: Spark. If unavailable, D-017 applies. Review order: independent Luna verification, Terra integration/architecture, Sol technical review, and Astra browser-control bug-finding. Any defect returns to the implementer and repeats the independent chain.

See [[Experience Principles]], [[User Experience and Recovery]], [[Frontend Architecture]], [[Boundary Contracts]], and [[Implementation Playbook]].
