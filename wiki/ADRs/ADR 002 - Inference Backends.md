---
title: "ADR 002 - Inference Backends"
version: "2.1"
status: reviewed-draft
updated: 2026-09-06
tags:
  - audio-workstation
  - specification
  - adr
---

# ADR 002 - Inference Backends

- **Original title:** Inference Engine Backend Validation & WebGPU Fallback Strategy.
- **Status:** Runtime family confirmed in-thread on 2026-09-06; model artifacts and provider qualifications remain open.
- **Decision:** Use ONNX Runtime Web as the primary browser inference runtime for version-pinned HTDemucs and Silero VAD artifacts. Qualify execution per model/provider, prefer verified WebGPU, and use checkpointed fallback to a separately qualified WASM configuration. DeepFilterNet may use this path only if conversion parity and resource gates pass; purpose-built WASM DSP such as RNNoise remains an allowed exception.

## Context

HTDemucs conversion can require unsupported transforms or operator combinations. A WebGPU-capable browser does not prove that a particular graph fits its adapter or runs correctly. A model can also exceed the device budget after successfully loading.

## Rationale

Use actual supported tensor shapes and representative data for the startup probe and release qualification. A fixed 100 ms dummy tensor can be invalid. Probe time and speedup depend on compilation, model, hardware, and caching; the draft's 150 ms penalty and 10× speed claim are removed.

WASM SIMD and multithreading depend on runtime build and browser deployment. Cross-origin isolation is required for the relevant multithread path; qualify a single-thread path where practical. WASM operator support and memory fit must be tested independently.

## Consequences

On device loss, stop the current chunk, release resources, reconstruct state on the replacement provider, and recompute from a committed checkpoint. Inform the user of the retry and slowdown. If no supported backend remains, preserve the project and stop processing with an actionable error. Fallback reduces failure impact; it does not eliminate crashes.

Keep model selection open until conversion correctness, domain quality, resource use, and redistribution are verified. Adaptive yields respond to measured responsiveness and throughput, not assumed access to temperature sensors.

ONNX names the artifact format; ONNX Runtime Web is the execution layer; WebGPU and WASM are execution providers beneath it. A provider fallback does not change the model semantics or artifact version. A different native/CUDA service on the home server would be a separate architecture and is outside this client-side decision.

## Validation and references

See [[Model Runtime and Licensing]], [[Memory and Storage]], and V-03/V-09/V-11 in [[Validation Plan]]. Upstream: [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) and [environment flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).
