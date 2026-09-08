---
title: "Validation Plan"
version: "2.2"
status: reviewed-draft
updated: 2026-09-07
tags:
  - audio-workstation
  - specification
---

# Validation Plan

The full product gates below remain **not run**. Foundation unit, type, build, and static release checks are recorded in `implementation/evidence/i-001/`; they do not qualify ML, DSP, performance, or general browser support. On 2026-09-07 the deterministic Chromium fixture passed five scenarios under `/audio-pwa/`: controller-version navigation, safe two-release activation, sibling-scope isolation, missing resources, same-context offline reload, and focus/input recovery. Cold browser restart remains unverified. This is foundation evidence toward V-07/V-08, not completion of either product gate.

## Acceptance gates

| ID | Gate | Required evidence |
| --- | --- | --- |
| V-01 | Decode and resampling | Valid/corrupt WAV, MP3, M4A, AAC, FLAC; mono/stereo; 44.1/48 kHz plus admitted additional rates; large files use bounded paths; codec priming, impulses, EOF and rate conversion preserve canonical duration and alignment. |
| V-02 | End-to-end memory and storage | Profile 2-, 10-, and 15-minute sessions on an 8 GB reference machine; include decoding, model warmup/steady-state, raw/clean playback, seek, provider failure, export and final save; peak working set stays within 1.5 GB on supported configurations; quantify opaque-memory uncertainty. |
| V-02A | Resource-plan accuracy | Across representative source sizes/profiles/devices, compare predicted persistent/temporary bytes, peak working memory, and ETA range with observed values; infeasible profiles stay blocked, no quality downgrade is silent, and estimate assumptions/confidence remain visible. |
| V-03 | Separation quality and reconstruction | Reproducible model conversion vs upstream; identity overlap-add has no endpoint holes; other masks reconstruct their input; measure model residual/leakage and blinded listening on field speech, music, mixed ambience and effects. Semantic quality acceptance rubric must be chosen before sign-off. |
| V-04 | Enhancement/VAD alignment | Check known delay, resampler phase, recurrent state, frame boundaries, EOF flush, wet/dry endpoints, and short utterances; target at most one canonical-frame fixed alignment error on deterministic fixtures, with natural-speech listening for phase artifacts. |
| V-05 | Mixer, transport and ducking | W=0/1/2 matrix checks, mono preservation, mute/solo combinations, dry/clean sync, seek into speech/release, rapid controls, D-018 Music Weight isolation/headroom/A-B, pause/resume, output-rate mismatch, stale-generation discard and simulated underrun; no clicks or bus drift. |
| V-06 | Export and safety | Match a continuous short reference render to chunked rendering within an agreed tolerance, especially at boundaries; verify WAV headers/length, dither distribution, each D-014 loudness policy, reported/achieved loudness and limiter activity, post-quantization true peak ≤ -1 dBTP, no sample overflow, silence handling and bounded save path. Sum D-015 processed stems against the pre-master reference after common-gain compensation; prove audition mute/solo cannot silently alter export inclusion. |
| V-07 | Offline and privacy | First uncached offline visit behavior; interrupted hydration; fully cached cold restart with network blocked; all feature paths including lazy modules; safe updates with an active project; missing assets; inspect requests to establish no audio/metadata egress. |
| V-08 | UI/accessibility/performance | On reference hardware, target p95 foreground frame intervals ≤ 20 ms at a 60 Hz display during interactions, no processing-caused main-thread tasks over 50 ms, and no audible underruns; virtualized peaks, keyboard/focus, screen-reader feedback, zoom/seek stress. |
| V-09 | Browser/provider and sustained load | Qualify exact artifacts with valid shapes on each provider; GPU loss, unsupported ops, isolation on/off, single-thread fallback, OPFS/access-handle availability, actual AudioContext sample rate, offline-context/worklet behavior, background transitions and sustained full-length inference. |
| V-10 | Fault recovery | Inject quota errors, failed writes/downloads, corruption, cancellation, worker termination, restart and missing chunks; prior committed project remains valid; recovery never consumes partially committed data. |
| V-11 | Artifact distribution | Exact code/weights/conversion/runtime/decoder license audit, notices, source and hashes included in distributable manifest; resolve redistribution restrictions before shipping. |
| V-12 | Audible expectation and control comprehension | With representative stable and changing recordings, users who understand their desired sound but not the software stack can predict each macro control, obtain the promised perceptual direction in a defined majority of applicable cases, identify uncertainty/failure, use matched A/B and undo, and complete the flow without model/provider/storage jargon. Exact thresholds and listening rubric are OD-17. |

Alignment tolerances, render tolerances, quality scores, limiter reference, and runtime targets that are still open are tracked in [[Open Decisions]]. Numeric targets here are proposed release criteria, not benchmark observations.

## Browser matrix to execute

The first physical environments and execution-location constraints are recorded in [[Test Environments]]. Results must name the machine running the browser; the HTTP server's machine is not the WebGPU execution device.

| Environment | Paths to test | Initial status |
| --- | --- | --- |
| Chrome desktop, Windows/macOS/Linux | WebGPU where available; WASM SIMD multi/single-thread; OPFS; export/save | Unverified |
| Edge desktop, Windows | Same provider/storage paths and policy-constrained isolation | Unverified |
| Firefox desktop | Available provider paths; single-thread fallback; offline/worklet/storage behaviors | Unverified |
| Safari desktop, macOS | Available provider paths, native codec gaps, sample rates, offline/export/storage | Unverified |
| Safari iOS / Chromium Android | Memory admission, background suspension, storage pressure, thermal/sustained behavior | Exploratory; no initial support claim |

Record exact stable browser versions at test time; do not infer support from another engine or desktop/mobile branding. Include at least integrated-GPU and WASM-only configurations. Where platform tools cannot distinguish application GPU/native memory, document the limit of evidence and keep support provisional.

## Fixture and benchmark policy

Use licensed test material with isolated references where possible. Include silence, impulses, near-full-scale tones, anti-phase stereo, very short files, maximum duration, speech over music, sustained strings/pads, rain, wind, traffic, applause, reverberant rooms, and non-speech vocal sounds.

Run performance tests after warmup and through sustained loads. Record real-time factor as processing seconds divided by audio seconds, peak disk use, model startup, throughput, underruns, and peak memory. Choose advertised processing-time limits from evidence rather than inherit the unmeasured v2.0 speed claims.

See [[Requirements]], [[Roadmap]], and [[Risk Register]].
