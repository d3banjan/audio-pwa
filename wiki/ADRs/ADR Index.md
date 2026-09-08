---
title: "ADR Index"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# ADR Index

The supplied v2.0 ADRs were marked **Accepted**. This wiki retains their decision IDs and architectural intent. Their corrected wording is a **proposed revision**, with unexecuted validation gates called out individually. No revised performance claim is treated as measured evidence.

| ADR | Decision | Revision focus |
| --- | --- | --- |
| [[ADR 001 - Language and Runtime]] | TypeScript orchestration, native Web Audio, compiled compute where needed | No arbitrary JS SIMD guarantee or mandatory Rust requirement |
| [[ADR 002 - Inference Backends]] | Per-model provider qualification and checkpointed fallback | Valid shapes, WASM qualification, variable probe cost |
| [[ADR 003 - Memory and Paging]] | OPFS-backed bounded audio storage and playback | Full memory scope, bounded ingestion/export, no 400 MB guarantee |
| [[ADR 004 - Scheduled Ducking]] | VAD-derived gain automation | Shared threshold, linear gain, true lookahead direction, seek continuity |
| [[ADR 005 - Offline Persistence]] | Versioned app shell plus local model persistence | Atomic updates, realistic quota, persistence and first-visit limits |

Material changes to these decisions should update the associated ADR, [[Review Resolution Log]], and affected requirement/validation links. New decisions should receive a new ID rather than reuse an existing one.
