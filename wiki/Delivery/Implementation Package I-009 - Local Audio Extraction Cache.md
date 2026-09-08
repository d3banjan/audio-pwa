---
title: "Implementation Package I-009 - Local Audio Extraction Cache"
version: "2.2"
status: implemented-pending-qualification
updated: 2026-09-08
tags:
  - audio-workstation
  - delivery
  - implementation
---

# Implementation Package I-009 - Local Audio Extraction Cache

## Outcome and selected route

Selecting an admitted browser-decodable MP4 starts local audio preparation automatically. The browser must report `video/mp4`, the name must end in `.mp4`, and the media element must actually decode an audio program exposed to the worklet as mono or stereo. The native path cannot introspect the encoded audio codec; AAC-LC is qualified by the generated fixture and private testcase matrix rather than inferred for every MP4. The original `File` object URL feeds a second, non-visible `HTMLAudioElement`, then `MediaElementAudioSourceNode -> AudioWorkletNode -> GainNode(0) -> AudioDestinationNode`. The worklet copies decoded PCM into a fixed pool of page buffers; the main thread immediately transfers full buffers to a dedicated OPFS writer. The visible video element keeps its own clock and controls.

In real-file mode, local preview, automatic audio preparation, and processed preview are the primary journey. The separate planning controls remain a collapsed, explicitly labeled simulation for interface testing and do not claim to enhance real media.

D-024 selects this path because the current Chromium browser decodes the admitted source through the graph even though it does not expose WebCodecs constructors. It adds no codec bundle, does not redistribute an audio decoder, does not read the whole `File` into application memory, and produces model-ready PCM rather than a MediaRecorder re-encode. Extraction is a background application operation at normal playback speed: an admitted 15-minute source needs about 15 minutes, but preview, cancellation, and navigation within the current project remain usable.

## Platform and stored artifacts

No runtime package is added for the MVP path. The platform dependencies are `HTMLAudioElement`, `AudioContext({ sampleRate: 48000 })`, `MediaElementAudioSourceNode`, `AudioWorkletNode`, transferable `ArrayBuffer`s, a dedicated `Worker`, OPFS, and IndexedDB.

The cache uses the existing canonical format:

- 48,000 frames/second, stereo, planar Float32;
- five-second OPFS pages: `2 channels * 240,000 frames * 4 bytes = 1,920,000 bytes` per full page;
- at most four reusable PCM page buffers across the worklet, main-thread handoff, and writer (`7,680,000 bytes`), plus measured native decoder/browser overhead;
- compact IndexedDB metadata containing page order, valid frame count, canonical target/end frame, observed and trimmed browser tail, HTML-media duration authority/rounding, state, generation, and integrity data; and
- at most 180 full pages and `345,600,000 bytes` of PCM for the 900-second admission ceiling, plus one temporary page and compact metadata.

Constructing the requested 48 kHz context and observing `context.sampleRate === 48000` is an admission requirement. The Web Audio specification requires a media element at another rate to be resampled to the context rate. Browser resampler quality and end trimming remain measured acceptance properties rather than assumed implementation details.

## Execution contract

1. Inspect metadata through a separate non-visible audio element without trusting the filename. Admit one mono or stereo audio program, a duration no greater than 900 seconds, a 48 kHz `AudioContext`, AudioWorklet, and enough OPFS quota with reserve. Unsupported, ambiguous, corrupt, encrypted, over-duration, or under-quota sources fail before replacing the last committed project.
2. Create the extractor from the original local object URL. Keep it unmuted at volume `1` so the media source exposes PCM; silence only the downstream graph with `GainNode(0)`. Connect the graph to the context destination so the real-time rendering clock is driven. Never use `File.arrayBuffer()`, `File.bytes()`, `decodeAudioData()`, MediaRecorder, capture-stream recording, or a network request.
3. Resume the context and call `play()` from the file-selection activation. If autoplay policy rejects either operation, enter a recoverable `needs-start` state and present one plain-language start action. This is the only permitted manual continuation; do not report preparation as running while its media clock is stopped.
4. In the AudioWorklet, accept frames only while the media source input is active. Copy mono to both planes without gain change; copy stereo channel-for-channel; reject any other channel count. Fill preallocated five-second pages without allocation in `process()`. Transfer a full page and immediately take the next buffer from the fixed pool.
5. Use high- and low-water marks. Ask the main thread to pause the extractor before the last spare buffer is consumed, resume only after the writer returns capacity, and fail visibly on any overrun. Never drop, duplicate, or overwrite PCM to keep up with the real-time source.
6. The main thread transfers each page to one dedicated writer worker without copying it. The worklet retains exactly `round(mediaDuration * 48,000)` frames, reports all observed frames and any render tail it discarded, and treats an underrun as failure. The writer writes a temporary OPFS page, closes it, records its valid frame count/integrity metadata, then returns the empty buffer to the pool. Publish the new cache manifest atomically only after the final partial page and exact timeline checks pass.
7. Progress comes from the extractor media clock and admitted duration. A watchdog exposes browser/device suspension as a resumable `needs-start` state instead of leaving progress running indefinitely. Cancellation or source replacement first stops page acceptance, then pauses the element, disconnects the graph, closes its context/worker, revokes owned URLs, and removes unreferenced temporary pages. Generation identity rejects every late worklet or writer message. Per-run Web Locks prevent another tab's startup collector from deleting live staging; cleanup preserves the atomically published current tree.

The AudioWorklet performs bounded copies only. OPFS access, hashing, manifest mutation, progress formatting, and cleanup stay off its rendering thread. A `LEAKY ABSTRACTION:` marker at the media-graph adapter states that the browser owns MP4 demux, audio-codec decode, resampling, codec trim, real-time scheduling, and codec identity; a future decoder must preserve the same page/timing/cancel contract.

## Current implementation evidence

- A repository-owned one-second H.264 Baseline/AAC-LC fixture completes through the real Chromium worklet, writer, OPFS, and atomic IndexedDB manifest path. Its provenance and reproduction command are in `tests/fixtures/README.md`.
- The worklet caps a browser render tail to the canonical half-open duration. Unit checks cover the observed 576,512-frame case retaining exactly 576,000 frames, plus EOF underrun rejection.
- Tests cover strict MIME/extension admission, the 20%/one-page storage reserve, resumable stall detection, `play()` rejection after clock advance, backpressure-only automatic resume, malformed writer acknowledgements, replacement after an already-won commit, cancellation, visible-preview independence, exact manifest timing metadata, and Web-Lock-protected startup cleanup across tabs.
- An authorized private 8 minute 53 second, 54.6 MB MP4 completed through the product UI to `Local audio cache is ready`; the visible preview remained available and independent. Its name, path, and bytes were not recorded. This run used the exact-frame build immediately before the manual-recovery status/action repair and did not encounter that recovery path; the repaired path is covered by the generated browser regression.
- Full 900-second memory, impulse/resampler quality, browser picture-decode tracing, and sustained contention/background qualification remain required before this matrix is release-enabled.

## Acceptance evidence required

- The authorized MP4/AAC testcase completes through the full OPFS path without its path, filename, or bytes entering logs, tracked artifacts, network requests, or whole-file application buffers.
- A generated 900-second admitted fixture completes in bounded memory. JS heap is flat after page-pool warm-up; the page pool never exceeds four buffers; native browser-process peak and decoder use stay within the 150 MB decoder reservation or the visible support matrix narrows.
- Source duration, emitted valid frames, first retained frame, AAC priming/edit-list trim, resampling delay, and rational video-timeline mapping pass impulses at start, page boundaries, and EOF. A 44.1-to-48 kHz sweep/reference comparison establishes the native resampler quality floor.
- OPFS pages are bit-stable across repeated foreground runs. A CPU-contention run reports any render overrun rather than committing a cache with missing samples.
- The visible video can play, pause, and seek while extraction continues independently. Browser tracing shows the non-visible audio element does not decode picture frames merely to obtain audio.
- Autoplay rejection, tab backgrounding, screen lock/suspension, quota exhaustion, corrupt/truncated media, writer delay, cancel, retry, and source replacement preserve the last committed project. Because silent audio does not receive Chromium's documented audible-background exemption, the UI must say that preparation may pause when the tab/device is suspended and must resume from a verified checkpoint or restart cleanly.
- Tests cover buffer-pool exhaustion and return, pause/resume boundaries, final partial page, mono duplication, stereo order, generation-stale messages, worker failure, and atomic manifest publication. Production code never contains the probe's drop-on-cap behavior.

The initial feasibility evidence is in `implementation/evidence/i-009-native-probe/README.md`: generated and authorized local MP4/AAC probes produced nonzero PCM, advanced the hidden media clock, kept the visible preview independent, and stopped acceptance on cancellation. That evidence resolves the architecture/dependency blocker; it does not claim the OPFS cache is implemented.

## Implementation sequence

1. Add black-box contracts for automatic start, honest `needs-start`, preview independence, cancellation, stale replacement, privacy, and cleanup.
2. Implement the fixed-buffer AudioWorklet and bounded main-thread handoff with synthetic audio first; prove no allocation in `process()` and no silent page loss.
3. Add the OPFS writer, temporary-page cleanup, atomic IndexedDB manifest, quota admission, and restart state.
4. Join the native media graph to that writer and qualify timing, long-file memory, foreground/background behavior, picture-decoder use, and the admitted private source.
5. Enable only the measured browser-decodable MP4 matrix; record AAC-LC qualification as evidence without claiming runtime codec introspection. Keep FLAC, other containers/codecs, faster-than-real-time extraction, persistent reopened video preview, and export remux behind their separate gates.

## Deferred accelerated fallback

If real-time duration, resampler quality, browser suspension, or the supported codec matrix fails the MVP acceptance floor, qualify LibAV.js tag `v6.10.9.0` at commit `c80e885c3461f7bb7ea565c9631b34243ae0dbf1` using its upstream `aac-af` configuration. Expected runtime files are `libav-6.10.9.0-aac-af.mjs`, `libav-6.10.9.0-aac-af.wasm.mjs`, and `libav-6.10.9.0-aac-af.wasm.wasm`; exact built hashes and sizes must be recorded before use. This source-built fallback remains deferred because upstream does not publish AAC/MPEG variants and it adds FFmpeg LGPL source/notice obligations, an AAC distribution review, a WASM heap, and a second decode path. Do not install or build it under I-009 unless the native acceptance evidence reopens D-024.
