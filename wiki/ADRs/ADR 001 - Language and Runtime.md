---
title: "ADR 001 - Language and Runtime"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
  - adr
---

# ADR 001 - Language and Runtime

- **Original title:** Language & Runtime — TypeScript + Native Web Audio vs. Rust + WASM.
- **Status:** Accepted architectural intent from v2.0; revised details proposed.
- **Decision:** TypeScript for application logic and orchestration; native Web Audio for standard playback DSP; qualified WASM/WebGPU runtimes for heavy compute.

## Context

The application needs responsive controls, sustained inference, bounded memory, and glitch-free audio. Writing the complete application in Rust would not by itself solve model compatibility, browser storage, or transfer overhead.

## Rationale

Native Web Audio supplies standard gain/filter/routing operations without running custom sample loops on the UI thread. Arbitrary JavaScript TypedArray loops are not guaranteed to vectorize. Use measured implementations and compiled SIMD kernels for workloads that need them; avoid claims that all typed-array operations automatically use SIMD.

ArrayBuffer transfer moves ownership between workers. WASM linear memory, GPU uploads, and native audio boundaries can still require copies; measure them in [[Memory and Storage]]. Rust with wasm-bindgen is an option for custom DSP, not a universal zero-copy or real-time guarantee.

## Consequences

Keep AudioWorklet hot paths allocation-free and nonblocking regardless of implementation language. Custom limiter/playback DSP can use validated JavaScript or compiled WASM according to measured deadlines and garbage-collection behavior. Rust is not mandatory solely because a processor is custom.

The export renderer must reproduce the mix's DSP contract and state; code reuse is preferred where it improves consistency. State-store choice (Zustand, Redux, or equivalent) is deferred until application implementation.

## Validation and references

V-02, V-05, V-06, and V-08 in [[Validation Plan]] cover memory, real-time deadlines, export equivalence, and UI performance. See [[System Architecture]], [[Export and Metering]], and [Web Audio API](https://webaudio.github.io/web-audio-api/).
