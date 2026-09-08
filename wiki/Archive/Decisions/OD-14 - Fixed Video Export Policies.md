---
title: "OD-14 - Fixed Video Export Policies"
version: "2.1"
status: archived
decision_id: OD-14
archived: 2026-09-07
rejected_by: D-011
tags:
  - audio-workstation
  - archive
  - export
---

# OD-14 - Fixed Video Export Policies

> [!warning] Archived decision material
> D-011 in [[Decision Log]] requires a preflight choice among qualified profiles using source fidelity, storage, working-memory, and ETA estimates. OD-14 remains open only for the exact container/encoder qualification matrix.

## Rejected: audio-only output for every video source

This is broadly feasible but makes the user reattach audio in another editor even when the browser can safely stream the original picture into a qualified remux.

## Rejected: remuxed video required for every source

This promises unsupported combinations and may require an unavailable audio encoder or a second video-sized output that does not fit persistent storage. It also hides a useful high-quality WAV fallback.

## Selected policy

The planner always includes enhanced WAV when its resource plan passes. It includes a video profile only when the exact source container, picture passthrough, audio encoder, muxer, browser, output destination, and storage plan are qualified. The user chooses with estimates visible. MVP never transcodes picture quality merely to make an output fit.

See [[User Experience and Recovery]], [[Memory and Storage]], [[Export and Metering]], and [[Validation Plan]].
