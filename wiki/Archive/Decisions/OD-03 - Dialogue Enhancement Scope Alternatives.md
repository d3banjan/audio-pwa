---
title: "OD-03 - Dialogue Enhancement Scope Alternatives"
version: "2.1"
status: archived
decision_id: OD-03
archived: 2026-09-07
rejected_by: D-013
tags:
  - audio-workstation
  - archive
  - dialogue
---

# OD-03 - Dialogue Enhancement Scope Alternatives

> [!warning] Archived decision material
> D-013 in [[Decision Log]] makes denoising dependable MVP behavior and dereverberation a separate experimental, preview-first option.

## Rejected: denoising-only product scope

This is the lowest-risk promise but omits a potentially valuable recovery tool for users who can judge a representative preview and revert it safely.

## Rejected: strong dereverberation as a core promise

Room reflections vary with speaker, microphone, geometry, motion, and noise. An enhancer name or model selection does not prove safe reflection removal. Treating it as guaranteed core behavior would make the Dialogue Clean dial unpredictable and could trade room sound for speech damage or synthetic artifacts.

## Selected boundary

Denoising receives the normal supported-quality gates. Dereverberation remains visibly experimental, runs on a representative preview first, exposes limitations/confidence, uses level-matched A/B and undo, and abstains when the exact material/artifact/device path is not qualified.

Artifact selection between DeepFilterNet, RNNoise, or another pinned candidate remains an evidence task under [[Model Runtime and Licensing]].

See [[Dialogue Enhancement and VAD]], [[Experience Principles]], and [[Validation Plan]].
