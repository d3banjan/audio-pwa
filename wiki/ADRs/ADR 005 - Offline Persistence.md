---
title: "ADR 005 - Offline Persistence"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
  - adr
---

# ADR 005 - Offline Persistence

- **Original title:** Resilient Offline Persistence & PWA Asset Lifecycle.
- **Status:** Accepted architectural intent from v2.0; revised details proposed.
- **Decision:** Version and verify the complete app/runtime asset set in service-worker caches, and persist model binaries in OPFS with a validated IndexedDB fallback.

## Context

An offline workstation requires its shell, lazy chunks, decoders, worklets, WASM files, and models. An initial asset download can fail midway, and independently refreshed files can create incompatible versions.

## Rationale

Use immutable release assets and atomic manifest publication. Replace blanket stale-while-revalidate for executable assets with coherent release activation. Keep active projects on their current version until a safe reload. Hash-check model artifacts before making them available.

Query storage capacity based on the actual project, model, temporary, and export requirements. The fixed 1.5 GB preflight is replaced because it is smaller than the retained audio for some supported-length sessions.

## Consequences

OPFS and IndexedDB can survive restarts but are not immune to eviction or user deletion. Request persistence and report whether it was granted. Revalidate offline readiness on launch, handle quota failures at write time, and preserve old verified assets during failed updates.

An uncached first visit cannot work offline. A partially cached installation must identify missing packages rather than claim readiness. Privacy permits setup/update requests but no audio or derived-data upload.

## Validation and references

V-07/V-10 in [[Validation Plan]] cover cold offline operation, interruption, quota, eviction, and update consistency. See [[Offline PWA Lifecycle]], [service worker lifecycle](https://web.dev/articles/service-worker-lifecycle?hl=en), and [browser storage guidance](https://web.dev/articles/storage-for-the-web).
