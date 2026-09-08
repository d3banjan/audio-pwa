---
title: "Review Resolution Log"
version: "2.1"
status: reviewed-draft
updated: 2026-09-06
tags:
  - audio-workstation
  - specification
---

# Review Resolution Log

## Provenance and status

Source material: the user's technical review (sections 1–5) followed by the supplied **Product Specification & Architecture Decision Records v2.0 — Client-Side Cinematic Multitrack Audio Workstation**. This wiki consolidates that material as **v2.1 reviewed draft**. The pasted source is not an independently verified implementation report.

“Specified” below means the document now contains a coherent proposed contract. “Gated” means feasibility, quality, or a concrete artifact still needs evidence. Original requirement/ADR IDs are preserved; explicit additions and corrections are listed here. No original accepted ADR is silently represented as a newly approved implementation.

## Review traceability

| Review item | Resolution | State / destination |
| --- | --- | --- |
| 1.1 Memory over 1.5 GB | Count input, four stems, raw dialogue, native/WASM/GPU scratch; bound ingestion, processing, playback and final save. Float32 intermediate storage; integer conversion at export. | Specified + gated; [[Memory and Storage]], V-02 |
| 1.2 / 3.3 Stereo width | Replace panner with explicit mid/side processing. Correct v2.0 mid attenuation formula. | Specified; [[Mixer and Controls]], V-05 |
| 1.3 Incomplete music routing | Music = drums + bass + harmonic other; Rhythm Section stays intermediate; no fifth visible bus. | Specified; semantic quality gated in [[Separation Pipeline]] |
| 1.4 Offline shell missing | Cache all shell/runtime/worker/decoder/model dependencies, register SW, version coherently, define first-visit limitations. | Specified; [[Offline PWA Lifecycle]], V-07 |
| 2.1 Sample-rate mismatch | Canonical 48 kHz; artifact-specific resampling and state/delay handling; bounded decoder path. | Specified + package gate; [[Ingestion and Timeline]] |
| 2.2 VAD timeline | Integer canonical intervals, chunk origin and delay correction; aligned 16 kHz indices map by 3. | Specified; [[Dialogue Enhancement and VAD]] |
| 2.3 Ducking undefined | Shared threshold, evaluable smooth envelope, linear gains, seek-safe scheduling and correctly directed lookahead. | Specified + tuning gate; [[Transport and Automation]] |
| 2.4 Cleaning latency | Align cleaned output back to source; keep all buses on the same timeline. | Specified + model measurement gate; [[Dialogue Enhancement and VAD]] |
| 2.5 FLAC varies | Require a bundled validated fallback; native decode alone does not establish coverage. | Gated; [[Ingestion and Timeline]], OD-04 |
| 3.1 Low-end nonexistent stems | Supplied v2.0 omits this control; keep deferred, Music-only if restored. | Explicit scope decision pending; [[Mixer and Controls]], OD-10 |
| 3.2 Real-time clean blend | Two synchronized, aligned, paged sources with complementary smoothed gains. | Specified; [[Mixer and Controls]] |
| 4.1 JS SIMD overstatement | No arbitrary loop/vectorization guarantee; native nodes or measured compiled DSP. | Corrected; [[ADR 001 - Language and Runtime]] |
| 4.2 ONNX/WebGPU coverage | Pin actual export, qualify valid production shapes and WASM separately, retry at checkpoints. | Gated; [[ADR 002 - Inference Backends]] |
| 4.3 Chunk overlap | Retain candidate 7.8 s windows / 2.5 s overlap; explicit endpoint-safe normalized OLA and artifact validation. | Specified + listening gate; [[Separation Pipeline]] |
| 4.4 Thermal pauses | Adapt using observable throughput/underruns; no assumption of portable thermal sensors. | Specified + profiling gate; [[Model Runtime and Licensing]] |
| 5 Error handling | Failure-specific messages, committed checkpoints, cancellation, retry and recovery. | Specified; [[User Experience and Recovery]], V-10 |
| 5 Stage progress | Stage units, truthful indeterminate states, ETA from measured throughput. | Specified; [[User Experience and Recovery]] |
| 5 Licensing | Audit exact weights/code/conversions/decoders and retain notices. | Gated; [[Model Runtime and Licensing]], V-11 |
| 5 Cross-browser plan | Explicit unverified desktop/mobile/provider matrix and failure tests. | Specified; [[Validation Plan]], V-09 |
| 5 Memory monitoring | Internal reservations plus external profiling; no universal OOM catch guarantee. | Corrected; [[Memory and Storage]] |
| 5 Waveform jank | Multi-resolution stored peaks, viewport tiles and separate playhead overlay; real peak-cache accounting. | Specified; [[User Experience and Recovery]], [[ADR 003 - Memory and Paging]] |

## Additional v2.0 corrections

| Supplied statement | Working correction |
| --- | --- |
| Mid gain `2-W`; width 2 removes mid | Mid gain remains 1; side gain W. |
| Delay raw dialogue only by D | Advance/trim delayed clean output with correct padding to preserve project alignment. |
| Gain automation target expressed in dB | AudioParam gain receives `10^(dB/20)`. |
| Schedule at onset plus lookahead | Attack starts before onset; time constants are not full transition durations. |
| 30 ms Silero frame universally | Selected artifact dictates frame size; current cited releases use 512 at 16 kHz (32 ms). |
| Butterworth high-pass uses native Q = 0.707 | Preserve linear design Q = 1/√2 but convert to the native high-pass Q parameter in dB (about -3.0103). |
| Compressor described as true-peak limiter | Dedicated validated limiter, dBTP ceiling, post-quantization verification. |
| Live graph connected to OfflineAudioContext | Separate renderer configured from shared mix state. |
| Chunked OfflineAudioContext automatically deterministic | Explicit state continuity/backend gate required. |
| Full decode plus a duration cutoff enforces memory | Decode itself must be admitted/bounded; cutoff after allocation is too late. |
| 400 MB guaranteed heap and <2 MB waveforms | Remove claims; account for all buffers, stems, levels and opaque allocations. |
| OPFS supported everywhere and immune to eviction | Capability tests, storage persistence request, quota/eviction recovery. |
| Fixed 1.5 GB free storage is sufficient | Capacity depends on retained audio, models, temporaries, export and reserve. |
| All startup probes cost 150 ms and prevent crashes | Measure valid-shape probes; runtime failures remain possible. |
| Zero CPU ducking and <5 ms threshold updates | Treat costs as measured performance targets. |
| Early reflection suppression assured by denoiser choice | Separate quality gate; denoising does not establish dereverberation. |
| Verified eight-week roadmap | Indicative phases preceded by feasibility work; no test result claimed. |

Additions include explicit codec admission, project checkpoints, numerical export checks, accessibility, a provisional resource budget, the D-014 three-preset loudness policy, and proposed stem-export semantics. Unresolved items remain identified in [[Open Decisions]].

Technical primary references are collected in [[Sources]].

## Delivery clarification — 2026-09-06

Implementation now follows [[Implementation Playbook]]. Terra and Luna own non-overlapping implementation packages, Sol performs an independent technical review after integration, and Astra performs final UX acceptance only after Sol reports no unresolved critical/high findings. The playbook adds definitions of ready/done, evidence records, decision deadlines, fallback behavior, and mandatory regression review after UX-driven behavioral changes.

## Architecture onboarding clarification — 2026-09-06

The wiki now distinguishes [[Frontend Architecture]] from [[Client-Side Backend Architecture]], with their typed interaction surface in [[Boundary Contracts]] and the quickest task-based entry in [[Agent Orientation]]. [[Test Environments]] records the actual AMD APU laptop and the pending NVIDIA home-server profile, including the key constraint that serving a page from the server does not move browser inference to the server GPU. ONNX Runtime Web is confirmed as the primary inference runtime family; exact model artifacts and provider qualifications remain gated.
