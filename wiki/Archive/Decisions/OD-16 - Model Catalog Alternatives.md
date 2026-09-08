---
title: "OD-16 - Model Catalog Alternatives"
version: "2.1"
status: archived
decision_id: OD-16
archived: 2026-09-07
rejected_by: D-010
tags:
  - audio-workstation
  - archive
  - model-runtime
---

# OD-16 - Model Catalog Alternatives

> [!warning] Archived decision material
> D-010 in [[Decision Log]] selects a curated MVP catalog and defers external model manifests to a future expert mode.

## Rejected for MVP: live Hugging Face model browser

Searching the Hub and attempting arbitrary ONNX results would offer broad choice but no reliable compatibility claim. ONNX does not standardize the application's sample-rate, preprocessing, recurrent state, output semantics, provider kernels, resource use, quality, or artifact rights. Hub model-card metadata supplies provenance but does not replace project qualification.

## Deferred: external signed manifests

A later expert mode may import an external signed manifest into an isolated qualification workflow. That requires a versioned schema, resource limits, integrity and provenance checks, audio-contract validation, provider tests, failure containment, and explicit unsupported status before an artifact can enter a project.

## Selected MVP behavior

The normal catalog contains project-pinned, pre-converted artifacts only. Before download it shows download/installed/temporary/project storage, measured RAM and GPU/native allocations, estimated time, input/output contract, provider qualification, quality limits, source/converter revisions, SHA-256, and artifact terms.

See [[Model Runtime and Licensing]], [[Memory and Storage]], and [[Offline PWA Lifecycle]].
