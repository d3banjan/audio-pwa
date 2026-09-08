---
title: "Model Runtime and Licensing"
version: "2.1"
status: reviewed-draft
updated: 2026-09-06
tags:
  - audio-workstation
  - specification
---

# Model Runtime and Licensing

## Artifact manifest

The primary browser inference runtime is **ONNX Runtime Web**, confirmed in-thread on 2026-09-06. D-007 selects a single four-stem `htdemucs` weight-only FP16 ONNX artifact as the Phase 0 qualification candidate. It does not approve a particular binary, conversion, or execution provider for production. DeepFilterNet joins the same runtime only after conversion parity and resource validation. A narrowly scoped custom WASM runtime remains permissible for DSP such as RNNoise when that is the verified upstream path.

Each selected model/runtime package must record its source URL, upstream commit/release, artifact SHA-256, weights license, code license, redistribution notices, conversion procedure/version, runtime build, operators, input/output names and shapes, rates, channel layout, normalization, frame/context requirements, recurrent state, algorithmic delay, and measured peak resource use.

## End-user catalog contract

D-010 requires a project-curated MVP catalog of pre-converted, revision-pinned artifacts. An entry is visible as compatible only after its exact graph, pre/post-processing, semantic outputs, conversion parity, providers, sustained resource envelope, quality scope, checksum, and artifact terms pass project gates. ONNX format or Hugging Face metadata alone is not compatibility evidence: ONNX Runtime Web documents full WASM operator coverage but only a subset for browser GPU providers, while Hugging Face model cards are publisher-supplied documentation and metadata.

Before download, show artifact bytes, installed bytes, temporary installation space, projected project storage, measured peak RAM and GPU/native allocation by provider/device class, a locally estimated processing-time range, sample rate/outputs, qualification state, limitations, source revision, checksum, and separate license notice. Conversion is a reproducible maintainer pipeline; the browser downloads the pinned result and performs checksum, admission, warm-up, and provider qualification.

The normal picker must not query arbitrary Hub search results or call them compatible. It may link each curated entry to its upstream [Hugging Face model card](https://huggingface.co/docs/hub/model-cards) for provenance. External model manifests are deferred beyond MVP; a future expert flow may accept a signed manifest into isolated qualification, never directly into a user project. See [ONNX Runtime Web provider guidance](https://onnxruntime.ai/docs/tutorials/web/) and [[OD-16 - Model Catalog Alternatives]].

| Candidate | Intended task | Unresolved gate |
| --- | --- | --- |
| Single four-stem `htdemucs` FP16 | Broad music-source separation | Exact artifact pin, conversion parity, STFT/iSTFT path, WebGPU/WASM support, memory, field-speech quality |
| DeepFilterNet | Dialogue enhancement | Exact weights/runtime, rate/frame contract, state, latency, quality and redistribution terms |
| RNNoise | Alternative enhancement | WASM or other validated integration, exact weights, state, latency and quality |
| Silero VAD | Speech probabilities | Pinned ONNX version, frame/state contract, alignment and calibration |
| Decoder/resampler/limiter | Audio infrastructure | Package choice, licenses, bounded execution and numerical validation |

> [!warning] HTDemucs weight licensing
> The application source is MIT and the project is non-commercial. The upstream Demucs code is MIT, but the upstream maintainer states that pretrained model weights are not covered by MIT and are provided only for scientific purposes. D-006 permits HTDemucs evaluation for the research build while requiring separate model notices and an artifact-specific distribution/use audit. Never label converted weights MIT merely because the application or converter is MIT. See [[OD-01 - Distribution and HTDemucs Research]].

DeepFilterNet and RNNoise are alternatives pending a measured choice, not interchangeable generic ONNX models. Repository licenses do not automatically settle rights for every downloaded weight or converted package. Upstream starting points are listed in [[Sources]]; no artifact license audit is marked complete.

## Backend qualification

1. Validate the conversion against upstream outputs using deterministic fixtures and declared error tolerances.
2. Load and run representative **valid production input shapes**, including state and padding, on each candidate provider. A 100 ms dummy input may be invalid for a fixed-segment model.
3. Measure startup time, steady-state throughput, output correctness, scratch allocation, GPU/native/WASM memory, and sustained behavior.
4. Prefer WebGPU only for that validated model/device/runtime combination. Test both initialization failure and runtime device loss.
5. If a checkpointed fallback is needed, release the failed session and buffers, reserve the replacement budget, recreate state, and rerun the uncommitted chunk on a separately validated WASM path.
6. Use WASM SIMD/multithreading only when supported and isolated as required; offer a qualified single-thread path when practical. If no path is valid, stop the feature with an explanation.

Fallback kernels are not guaranteed merely because a runtime lists WASM support. Never claim a fixed 10× speedup, 150 ms probe, or elimination of crashes. See [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) and [performance diagnosis](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html).

## Sustained-load scheduling

No broadly portable browser API supplies reliable device temperature or CPU thermal state. Use observed chunk duration, responsiveness, underruns, memory reservations, and visibility state to adapt concurrency and yielding. Within the admitted memory budget, use the maximum qualified provider concurrency and bounded queues that sustained tests show remain responsive; more parallelism is not assumed faster. Offer pause/resume and a lower-resource mode. Compare sustained throughput against the warm baseline and lengthen idle intervals when it degrades; calibrate thresholds in tests. A fixed 20 ms sleep is not thermal protection.

Model precision and audio sample rate are separate contracts. FP16 applies to the selected model weights and supported tensor path; canonical project PCM remains 48 kHz Float32. HTDemucs input is resampled to its required 44.1 kHz as a declared model boundary. Any additional quality-reducing downsampling or lower-resource mode requires a clear estimate, user confirmation, and recorded processing metadata; it must never happen silently.

## Release evidence

Store benchmark environment, exact artifact hashes, fixtures, numerical results, license notices, and approval status in versioned implementation evidence when it exists. Missing redistribution rights, an unsupported graph, excessive memory, or unacceptable domain quality blocks distribution of that artifact. See [[ADR 002 - Inference Backends]], [[Validation Plan]] V-03/V-09/V-11, and [[Open Decisions]].
