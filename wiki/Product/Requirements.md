---
title: "Requirements"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Requirements

IDs FR-1–FR-9 and NFR-1–NFR-3 follow the supplied v2.0 specification. NFR-4 onward make review gaps explicit. Acceptance evidence is defined in [[Validation Plan]].

## Functional requirements

| ID | Requirement | Acceptance / detailed contract |
| --- | --- | --- |
| FR-1 | Import validated audio files and audio-bearing video containers using a bounded local demux/decode path; extract and normalize the selected audio stream to 48 kHz Float32 working PCM while retaining source timing/video metadata. | Exact audio/video container and codec matrix, corrupt-input recovery, A/V timestamps, duration admission, and bounded demux/decode pass V-01; [[Ingestion and Timeline]] |
| FR-2 | Produce four editable buses for dialogue, music, ambience, and effects using cascaded ML/DSP. | Complete routing and no discarded other content; domain-quality gate V-03; [[Separation Pipeline]] |
| FR-3 | Enhance dialogue with a smooth wet/dry control and compensated algorithmic delay. | Alignment and continuity pass V-04; dereverberation remains gated; [[Dialogue Enhancement and VAD]] |
| FR-4 | Generate non-destructive speech clips from VAD with canonical timeline boundaries. | Exact offsets, padding, and threshold updates pass V-04/V-05 |
| FR-5 | Provide synchronized four-bus playback, seek, mute/solo, and true mid/side width. | Transport and width tests V-05; [[Mixer and Controls]], [[Transport and Automation]] |
| FR-6 | Duck Music and Ambience from the same speech mask used by the VAD sensitivity control. | Smooth, seek-safe and export-consistent envelopes pass V-05 |
| FR-7 | Meter peak/RMS/clipping and provide the D-014 outcome-oriented loudness presets plus true-peak export protection at -1 dBTP. | Achieved loudness and limiter activity are reported; post-quantization verification passes V-06; [[Export and Metering]] |
| FR-8 | Preview and export the accepted full audio result plus D-015 processed pre-master stems; qualified profiles may also remux enhanced audio with source-identical video. Audio WAV output is 48 kHz, 24-bit PCM with TPDF dither and bounded memory. | Explicit inclusion, processed-stem reconstruction/common gain, header, duration, A/V synchronization where applicable, state continuity, and download path pass V-06/V-02 |
| FR-9 | Work offline after verified asset setup; version the shell, runtime, and model set. | Cold offline reload, interrupted setup, and update tests V-07; [[Offline PWA Lifecycle]] |

## Non-functional requirements

| ID | Requirement | Acceptance / limitation |
| --- | --- | --- |
| NFR-1 | Target a maximum 1.5 GB total application working set for supported sessions up to 15 minutes. | Decimal GB; heap, workers, WASM, native audio, and GPU allocations included. V-02 profiles supported configurations. No universal browser OOM guarantee is claimed. |
| NFR-2 | Target smooth 60 fps interaction on supported devices; keep inference and heavy DSP off the main thread. | V-08 measures foreground frame times, long tasks, and audio underruns; peak pyramids avoid full waveform redraws. |
| NFR-3 | Probe each model's supported execution paths, prefer verified WebGPU, then supported WASM SIMD/multithread or single-thread paths. | V-09 proves numerical correctness, memory fit, and recovery; unsupported paths are reported explicitly. |
| NFR-4 | Never transmit local audio, metadata, or derived content. | Network inspection during V-07; no remote telemetry by default. Asset requests are permitted during setup/update. |
| NFR-5 | Expose stage progress, cancel/pause, actionable errors, and restartable checkpoints. | V-10 fault injection covers decoding, downloads, quota, storage loss, and inference errors. |
| NFR-6 | Ship only version-pinned assets with documented redistribution rights, notices, and hashes. | Artifact-specific audit V-11 before distribution; [[Model Runtime and Licensing]] |
| NFR-7 | Publish only tested browser/device support, with explicit degraded modes. | V-09 compatibility matrix; secure context and isolation requirements included. |
| NFR-8 | Support keyboard-operated controls and accessible progress/error reporting. | V-08 keyboard and screen-reader checks; [[User Experience and Recovery]] |

## Release interpretation

No requirement passes merely because an ADR is accepted. If a model or browser fails the memory, quality, export, or offline gates, restrict the supported configuration or revise the design; do not silently lower advertised guarantees. Track unresolved product choices in [[Open Decisions]].
