---
title: "Implementation Package I-004 - Real Local Preview"
version: "2.1"
status: ready
updated: 2026-09-08
tags:
  - audio-workstation
  - delivery
  - implementation
---

# Implementation Package I-004 - Real Local Preview

## User-visible outcome

Replace the fixture-only source/preview path with a real, private local-media preview. A user selects a supported audio or video file, plays it through a bounded Web Audio graph, changes safe native cleanup/mix controls, compares bypassed and processed monitoring, and returns to the original source without uploading or copying the whole file into application-managed RAM.

This is the first production vertical slice. It does not claim ML denoising, dereverberation, separation, processed stems, offline rendering, or completed export.

## Inputs and outputs

- Input is the user-selected `File`, exposed to an `HTMLMediaElement` through a revocable object URL. The application must not call whole-file `arrayBuffer()`, `bytes()`, or equivalent.
- Browser media decoding remains browser-managed. App-owned audio is limited to real-time Web Audio render quanta and small analysis state.
- Output is monitored audio routed through native Web Audio nodes to the local output device. No output file is produced in I-004.
- Video sources retain their picture in a local preview element while audio is routed through the same graph.

## Processing contract

- Source mode bypasses processing at matched gain.
- Preview mode may use only clearly disclosed native processing implemented in this package: dialogue high-pass/presence, conservative dynamics, music/background balance when available, and a true mid/side width matrix for stereo media.
- Controls that require separated stems or an ML artifact remain disabled with plain-language explanations.
- Switching source/preview uses short gain ramps and preserves a single media clock; it never runs two unsynchronized media elements.
- Replacing/resetting a source pauses playback, disconnects nodes, and revokes the old object URL.

## Resource, privacy, and failure behavior

- No network request may contain source metadata or content.
- No whole-file application allocation is allowed.
- Reject unsupported media through a recoverable state without losing the prior valid project.
- Autoplay restrictions are handled after a user gesture. Decode/play errors identify that the browser cannot play the selected container/codec.
- Seek, pause, ended, source replacement, suspended audio context, and device-output failure have explicit UI states.

## Acceptance checks

- Unit tests cover graph parameter mapping and cleanup/disposal state independently of browser devices.
- Browser tests use generated local audio/video fixtures to verify selection, real media-element readiness, play/pause/seek, source/preview routing, visible unsupported controls, source replacement, and absence of whole-file read APIs.
- A manual browser pass uses the private MP4 testcase without copying, uploading, committing, or naming its absolute path in evidence.
- Existing I-001/I-003 checks remain green.

## Ownership and review

Spark implements. Luna verifies browser/media failure behavior, Terra reviews ownership and resource boundaries, Sol reviews privacy/correctness/test realism, and Astra performs browser bug-finding after technical PASS.

See [[Experience Principles]], [[User Experience and Recovery]], [[Ingestion and Timeline]], [[Transport and Automation]], [[Frontend Architecture]], and [[Boundary Contracts]].
