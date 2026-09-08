---
title: "OD-07 - Stem Export Alternatives"
version: "2.1"
status: archived
decision_id: OD-07
archived: 2026-09-07
rejected_by: D-015
tags:
  - audio-workstation
  - archive
  - export
---

# OD-07 - Stem Export Alternatives

> [!warning] Archived decision material
> D-015 in [[Decision Log]] selects processed, pre-master stems with explicit inclusion and a documented common safety gain.

## Rejected for MVP: raw separated stems only

Raw model/separation outputs maximize later engineering flexibility but omit the dialogue cleaning, filters, width, ducking, automation, edits, and local overrides the user previewed and accepted. They do not represent the product's promised result.

## Deferred: raw and processed packages

Exporting both variants roughly doubles output storage and presents overlapping files whose intended use is unclear to the primary user. Raw/source stems may return in a future expert export with explicit naming and resource planning.

## Selected reconstruction contract

Every processed stem has the same origin, duration, sample rate, and bit depth. Master loudness and limiting are excluded. Audition mute/solo is ignored; an explicit export screen controls inclusion. If headroom is needed, one common attenuation applies to all stems and is recorded in a manifest, preserving relative balance and pre-master reconstruction.

See [[Export and Metering]], [[Boundary Contracts]], and [[Validation Plan]].
