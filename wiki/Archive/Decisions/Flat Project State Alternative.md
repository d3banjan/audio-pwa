---
title: "Flat Project State Alternative"
status: archived
decision_id: D-002
archived: 2026-09-07
rejected_by: D-002
tags:
  - audio-workstation
  - archive
---

# Flat Project State Alternative

> The active choice is D-002 in [[Decision Log]]. This note is historical context, not implementation instruction.

The first foundation represented setup, processing, playback buffering, and export in one phase with a numeric counter. This admitted impossible transitions and allowed old worker completions to mutate a newer project.

It was rejected because device capability, project work, job cancellation, and transport change independently. The chosen design separates device and project state, keeps transport orthogonal, and requires matching opaque project/job IDs and generation on asynchronous events. See [[Frontend Architecture]] and [[Boundary Contracts]].
