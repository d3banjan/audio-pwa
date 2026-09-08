---
title: "Open Decisions"
version: "2.1"
status: reviewed-draft
updated: 2026-09-08
tags:
  - audio-workstation
  - specification
---

# Open Decisions

These items capture uncertainty without silently inventing implementation evidence. Proposed defaults elsewhere in the wiki make the design reviewable; they are not completed decisions. Decisions are discussed one at a time in the active user thread and then moved to [[Decision Log]]. Filtered detail moves to [[Archive Index]] according to [[Decision Lifecycle]].

| ID | Decision needed | Working proposal | Blocks |
| --- | --- | --- | --- |
| OD-02 | Stage 2 mask algorithm and quality rubric | Complementary soft masks using transient, flux and harmonicity evidence; validate semantic labels | FR-2 product-quality claim |
| OD-04 | Codec coverage beyond D-024's initial MP4/AAC native path | Broaden only after each container/codec passes bounded memory, timing, quality, offline, and browser support evidence; qualify a bundled decoder only for a measured native gap | Broader FR-1 format claims and offline-ready asset list |
| OD-05 | Export backend and equivalence tolerances | Stateful worker/WASM preferred; independent contexts only with proven state policy | FR-7/8 |
| OD-06 | Limiter and metering implementation | Qualify an oversampled true-peak limiter and integrated loudness meter that implement D-014 consistently in preview and bounded export | FR-7/8 |
| OD-08 | Browser/device minimums and resource envelopes | Profile 8 GB desktop baseline; mobile exploratory; restrict unsupported paths | NFR-1/2/3/7 |
| OD-09 | Duck onset tuning and VAD short-utterance policy | Retain 40 ms time constant/20 ms lead as initial tuning, shared threshold | FR-4/6 quality acceptance |
| OD-11 | Model/runtime/code redistribution | Audit exact pinned artifacts; no presumed package-wide weight permissions | Distribution/offline bundling |
| OD-12 | Project fallback storage and final save path | OPFS preferred; qualify IndexedDB/short-file fallbacks and memory-safe downloads | FR-8/9, NFR-1/7 |
| OD-14 | Video container and audio-encoder qualification matrix | Under D-011, always offer admitted enhanced WAV and offer source-picture passthrough/remux only for measured container/encoder paths; determine exact supported matrix | FR-1/8, offline assets, export |
| OD-15 | Acoustic-scene change detector and confidence rubric | Detect material shifts in noise/source statistics after initial analysis; create semantic regions only above a validated confidence threshold | D-009 region UX, local overrides, quality |
| OD-17 | Audible-expectation success rubric | Define representative material and listening/usability scoring for whether each macro control produces the promised change without unacceptable damage | D-012, V-12, final UX acceptance |

OD-01, OD-03, OD-07, OD-10, OD-13, and OD-16 are resolved by D-007, D-013, D-015, D-018, D-009, and D-010 in [[Decision Log]]. D-024 resolves OD-04 only for the initial measured MP4/AAC route; FLAC, other containers/codecs, and a bundled fallback remain open. Phase 0 should resolve the remaining release-blocking implementation choices with experiments. Product-facing changes such as control behavior and labels should be recorded here and in [[Review Resolution Log]] when finalized. No separate permission process is imposed by this wiki.

Decision deadlines, required evidence, and safe defaults are defined in [[Implementation Playbook]]. Until a row is resolved, code may expose a typed interface, capability check, or experiment; it may not present the proposed choice as a verified production feature.
