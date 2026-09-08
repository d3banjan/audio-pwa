---
title: "OD-04 - Browser Audio Extraction Alternatives"
version: "2.1"
status: archived
decision_id: OD-04
archived: 2026-09-08
rejected_by: D-024
tags:
  - audio-workstation
  - archive
  - ingestion
---

# OD-04 - Browser Audio Extraction Alternatives

> [!warning] Archived decision material
> D-024 in [[Decision Log]] selects the browser-native media-element/AudioWorklet path for the initial measured MP4/AAC matrix. OD-04 remains open only for additional codecs/containers or if native-path acceptance evidence reopens the decision.

## Comparison at selection time

All routes were compared against local-only execution, no whole-file application allocation, a 900-second input ceiling, 48 kHz stereo planar Float32 OPFS pages, independent video preview, and the current Chromium browser with no `AudioDecoder`/`VideoDecoder` constructors.

| Route | Download/bundle | Bounded RAM and storage | License/distribution | Implementation surface | Result |
| --- | --- | --- | --- | --- | --- |
| Second local-file audio element → MediaElementAudioSource → fixed-buffer AudioWorklet → OPFS writer | No new runtime bytes | Four five-second PCM buffers reserve 7.68 MB; native decoder overhead must be measured; output is at most 345.6 MB plus one temporary page | No codec implementation is redistributed; application code remains MIT | Medium: real-time page pool, pause/resume backpressure, writer, timing and recovery | Selected for initial MP4/AAC. Generated and authorized-source probes exposed nonzero PCM in the target Chromium browser |
| MP4Box.js `2.4.1` + WebCodecs | Package inspection found about 328 kB raw/61 kB gzip for the browser entry and its imported module | Incremental demux and bounded decoder queues are possible; same PCM storage | BSD-3-Clause MP4Box.js; browser supplies codecs | Medium/high: demux timestamps/config, decoder queue, resampler, OPFS writer, plus capability split | Rejected for MVP because the target browser exposes neither decoder constructor; MP4Box.js alone does not produce PCM |
| Mediabunny `1.55.7` | Tree-shakable source, but exact selected bundle would require a build measurement; npm package unpacked size is not a runtime estimate | Streaming Blob input is available; decoding still uses browser WebCodecs | MPL-2.0 | Medium, with a broad media abstraction | Rejected for the current browser because its browser decode path still depends on WebCodecs |
| LibAV.js `v6.10.9.0` custom `aac-af` direct-worker build | Upstream describes full WASM builds as usually 1.5–3 MB; exact custom files were not built, sized, or hashed | Upstream baseline heap starts at 24 MiB and grows; block-reader and limited packet APIs can bound application queues; reserve capped at 150 MB until measured; same PCM storage | LibAV wrappers are 0BSD; compiled FFmpeg configuration is LGPL-2.1 with source/notice duties; AAC distribution review still required | High: custom reproducible build, block-reader, demux/decode/filter state, OPFS writer, license/source offer | Deferred acceleration/codec fallback. Upstream deliberately does not publish AAC/MPEG variants |
| `@ffmpeg/ffmpeg` `0.12.15` + `@ffmpeg/core` `0.12.10` | Official usage guide reports about a 31 MB core load | Broad WASM runtime/virtual filesystem; common API writes complete inputs and reads complete output `Uint8Array`s; output staging conflicts with the page contract | Wrapper MIT; examined core package GPL-2.0-or-later | High and broad relative to one audio track | Rejected: large, license-incompatible with the intended MIT distribution posture, and whole-output oriented |
| `decodeAudioData()` | No bundle | Requires a complete compressed `ArrayBuffer` and returns a complete decoded `AudioBuffer` | Browser-native | Low | Rejected for video/long input because it violates the whole-input and decoded-memory bounds |
| `captureStream()`/MediaRecorder playback copy | No bundle | Can be timesliced but runs in real time | Browser-native | Low/medium | Rejected because MediaRecorder re-encodes and does not yield the canonical stable PCM cache. The selected direct MediaElementAudioSource graph avoids this defect |

## Selected native-path limits

The graph must connect through zero gain to the destination. This keeps the real-time audio rendering clock active without speaker output; merely muting the media element can suppress the PCM presented to the source node. The extraction element stays at playback rate `1`: faster playback can invoke pitch preservation, interpolation, dropped/muted audio, or changed sample semantics. Therefore extraction ETA is approximately source duration.

The Web Audio specification requires MediaElementAudioSource output to match the AudioContext sample rate, so a requested and observed 48 kHz context supplies canonical-rate frames. The resampling algorithm is implementation-defined. I-009 must measure quality, codec trim, first/last frame timing, and repeatability against references before claiming support.

The AudioWorklet cannot wait for OPFS. Production therefore uses a reusable fixed buffer pool and pauses the hidden element at a high-water mark before capacity is exhausted. Writer delay or render overrun fails the candidate cache visibly; it never uses the feasibility probe's drop-on-cap behavior. Silent output also lacks Chromium's documented audible-background throttling exemption, so foreground/background and device-suspension recovery remain explicit acceptance cases.

## Exact deferred pins

- MP4Box.js `2.4.1`, BSD-3-Clause, npm integrity `sha512-0HGX7nXoDIX6FKLVl4a3wtYjBlwqsN3xuQC3GXzNtKp98FXUOhDSq623azsz8DG5ptd9ZXcXodDkgbdMZOjWvw==`; inspected tarball SHA-256 `c24dd2e4a793afc080797bf3c69529f09add9880177b78289ef2a76603ed7388`.
- LibAV.js tag `v6.10.9.0`, commit `c80e885c3461f7bb7ea565c9631b34243ae0dbf1`; if reopened, build only upstream `aac-af` files `libav-6.10.9.0-aac-af.mjs`, `libav-6.10.9.0-aac-af.wasm.mjs`, and `libav-6.10.9.0-aac-af.wasm.wasm`, then record their exact hashes, sizes, license text, source/build offer, and measurements.
- ffmpeg.wasm wrapper `0.12.15` and core `0.12.10` were comparison pins only and must not be added under D-024.

Primary source links and retrieval context are recorded in [[Sources]]. See [[Implementation Package I-009 - Local Audio Extraction Cache]], [[Ingestion and Timeline]], and [[Memory and Storage]].
