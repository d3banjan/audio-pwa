---
title: "ADR 004 - Scheduled Ducking"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
  - adr
---

# ADR 004 - Scheduled Ducking

- **Original title:** Sidechain Ducking via Scheduled Parameter Automation.
- **Status:** Accepted architectural intent from v2.0; revised details proposed.
- **Decision:** Derive background gain automation from a shared precomputed VAD speech mask, independent of fader and mute/solo gains.

## Context

DynamicsCompressorNode has no exposed external sidechain input. Offline VAD allows predictable speech-keyed gain changes without a real-time detector or a fixed threshold inconsistent with clip sensitivity.

## Rationale

Cache probabilities once and derive both clips and ducking from the user's threshold. Convert depth from dB to linear gain. Begin attack before speech onset, not after it. Store an evaluable envelope so seeks, resumes, and export reconstruct the same gain state.

The retained defaults are -6 dB depth, 40 ms attack time constant, 250 ms release time constant, and 20 ms pre-onset scheduling. A time constant does not mean a completed transition; listening tests must tune the onset behavior.

## Consequences

Sensitivity changes recompute metadata and reschedule future events while preserving current gain. Scheduling and analysis have nonzero cost; the draft's “zero runtime CPU” and under-5 ms recomputation claims are withdrawn pending measurement.

A shared event representation supports consistent preview/export, but native backend floating-point behavior is not promised bit-identical across browsers. Validate seek into speech, long releases, overlapping segments, and threshold changes during playback.

## Validation and references

See [[Dialogue Enhancement and VAD]], [[Transport and Automation]], and V-04/V-05/V-06 in [[Validation Plan]]. API reference: [Web Audio API](https://webaudio.github.io/web-audio-api/).
