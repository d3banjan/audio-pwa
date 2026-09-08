---
title: "OD-13 - Chunk Fine-Tuning Alternatives"
version: "2.1"
status: archived
decision_id: OD-13
archived: 2026-09-07
rejected_by: D-009
tags:
  - audio-workstation
  - archive
  - user-experience
---

# OD-13 - Chunk Fine-Tuning Alternatives

> [!warning] Archived decision material
> D-009 in [[Decision Log]] keeps technical chunks invisible, uses a global profile by default, and creates optional override regions only for confidently detected acoustic-scene changes.

## Rejected: expose every processing chunk

Fixed model and storage chunks are selected for receptive field, overlap, memory, and restart behavior. They do not represent audible edits. Asking the user to approve or tune every chunk would add work to stable continuous recordings and couple the creative interface to implementation details.

## Rejected: arbitrary independent settings per chunk

Independent dial values at fixed boundaries cause hidden state, discontinuities, overlap ambiguity, and fragile export behavior. A local audible problem may also span multiple scheduler chunks or occupy only part of one.

## Conditional alternative retained

A global profile with explicit local overrides remains useful when analysis finds a material acoustic-scene change. The override belongs to a semantic timeline region with transition context, not the scheduler window. Model choice, canonical rates, routing topology, limiter safety, and provider remain project-global until more variable processing is proven safe.

The exact detector/features/confidence rubric remains OD-15 in [[Open Decisions]].

See [[User Experience and Recovery]], [[Separation Pipeline]], and [[Memory and Storage]].
