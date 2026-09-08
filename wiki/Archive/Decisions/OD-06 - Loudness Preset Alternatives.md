---
title: "OD-06 - Loudness Preset Alternatives"
version: "2.1"
status: archived
decision_id: OD-06
archived: 2026-09-07
rejected_by: D-014
tags:
  - audio-workstation
  - archive
  - export
---

# OD-06 - Loudness Preset Alternatives

> [!warning] Archived decision material
> D-014 in [[Decision Log]] defines Preserve Dynamics, Clear & Balanced, and Streaming Loud with a -1 dBTP export ceiling.

## Rejected: one mandatory -16 LUFS target

A -16 LUFS target is useful for dialogue-led material but can require unnecessary limiting on a dynamic cinematic mix and may be quieter than a user expects for online music delivery. It remains the Clear & Balanced default rather than a universal requirement.

## Rejected: loudest possible normalization

Forcing every mix to a high loudness can flatten intended contrast, increase limiter activity, and create audible pumping or distortion. The product reports when Streaming Loud cannot be reached safely.

## Superseded: -0.5 dBTP ceiling

The earlier draft used -0.5 dBTP. D-014 selects -1 dBTP for consistent headroom across lossless WAV and qualified lossy video-audio encoding. Exact limiter implementation still requires OD-06/V-06 evidence.

## References considered

- [Apple Podcasts audio requirements](https://podcasters.apple.com/support/893-audio-requirements) recommend approximately -16 LKFS and true peak no higher than -1 dBFS.
- [Spotify loudness normalization](https://support.spotify.com/mx-en/artists/article/loudness-normalization/) uses -14 LUFS normalization and recommends -1 dBTP headroom for lossy encoding.
- [EBU R128](https://tech.ebu.ch/fr/publications/r128) uses -23 LUFS for broadcast, demonstrating that destination context matters.

See [[Export and Metering]], [[Mixer and Controls]], and [[Validation Plan]].
