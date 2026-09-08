---
title: "Transport and Automation"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Transport and Automation

## Common clock and streaming

AudioContext.currentTime schedules playback; canonical project frames are the authoritative timeline. At start or seek, establish `(contextStartTime, projectStartFrame)` and prebuffer every active source, including both dialogue variants, before scheduling a common start.

Use bounded worklet queues or validated scheduled AudioBufferSourceNode pages. Sources are one-shot; seeking creates a new generation. Never keep full-track AudioBuffers as the required long-file path. Clear old sources, pending pages, and automation on seek, while applying short fades to avoid clicks.

If the hardware context rate differs from 48 kHz, map canonical frames to context seconds and use validated output resampling. Never interpret a canonical frame index as a device-rate frame index. Calibrate shared processing latency, including limiter lookahead, in the playhead display and seek tests.

A background worker prefetches pages. The audio thread does not block on storage. Pause freezes the project position; resume prebuffers and establishes a fresh clock anchor. On underrun, enter buffering coherently for every bus and retain the restart position. Main-thread timers are not the audio clock.

## Speech-driven ducking

Use the unpadded speech intervals from [[Dialogue Enhancement and VAD]], including its minimum-speech and silence-merge policy. Clip safety padding is not added again to ducking.

| Parameter | Default / interpretation |
| --- | --- |
| Depth | -6 dB; range 0 to -18 dB |
| Attack time constant | 40 ms |
| Release time constant | 250 ms |
| Lookahead | Begin attenuation 20 ms before speech onset |
| Threshold | Shared `thetaVAD`, default 0.5 |

Convert dB to **linear gain** before scheduling:

$$G_{duck}=10^{d/20};\qquad -6\text{ dB}\approx0.5012.$$

For a segment starting at project time `s` and ending at `e`, attack begins at `max(0, s-0.020)` and release begins at `e`, each mapped through the current transport anchor. Positive `s + lookahead` would delay attenuation and is incorrect. Overlapping attack/speech intervals are combined before building an envelope.

For a target change at `t0`:

$$g(t)=g_{target}+(g(t_0)-g_{target})e^{-(t-t_0)/\tau}.$$

`setTargetAtTime` takes a time constant, not a time-to-completion. A 40 ms time constant with 20 ms lookahead only partially attenuates by speech onset. These defaults are retained as a proposed tuning point, not a guarantee of full pre-attenuation. Listening tests may select an earlier attack or a finite-duration ramp.

## Rescheduling contract

Represent the envelope independently of AudioParams so its value can be evaluated at any project frame. At seek/resume, initialize gain to the envelope's value at the destination, including an ongoing release, and schedule only subsequent changes. Apply a short transition for audible seeks.

On a sensitivity or depth change, preserve the current gain, invalidate future events, recompute the shared mask as needed, and smoothly schedule a new envelope. Use cancelAndHoldAtTime where validated, or evaluate the current value and perform equivalent cancellation explicitly.

Use a bounded scheduling horizon and refill before it expires; validate suspension/background behavior and enter a controlled paused state if timing cannot be maintained. Preview and export consume the same immutable event representation. Native automation still requires scheduling work; it is not “zero runtime CPU.”

See [[ADR 004 - Scheduled Ducking]] and [[Validation Plan]] V-05.
