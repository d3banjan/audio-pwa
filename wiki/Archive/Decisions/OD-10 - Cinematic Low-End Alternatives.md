---
title: "OD-10 - Cinematic Low-End Alternatives"
version: "2.1"
status: archived
decision_id: OD-10
archived: 2026-09-07
rejected_by: D-018
tags:
  - audio-workstation
  - archive
  - mixer
---

# OD-10 - Cinematic Low-End Alternatives

> [!warning] Archived decision material
> D-018 in [[Decision Log]] includes a constrained Music Weight control in MVP.

## Rejected: Cinematic Low-End label

The label suggests subharmonic generation, multiband dynamics, or mastering intelligence. A modest low shelf only changes existing bass energy, so the label would make the expected outcome unclear.

## Rejected: no low-frequency macro

Excluding the control avoids headroom and muddiness risks but removes a cheap, understandable way to make the separated Music bus feel lighter or heavier.

## Selected boundary

Music Weight applies a qualified linked-stereo low shelf to Music only. It defaults neutral, includes lighter and heavier directions, exposes level-matched A/B and reset, predicts headroom impact, and disables itself when music is absent or uncertain. It does not synthesize bass.

See [[Mixer and Controls]], [[Experience Principles]], and [[Validation Plan]].
