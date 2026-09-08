---
title: "Ingestion and Timeline"
version: "2.1"
status: reviewed-draft
updated: 2026-09-08
tags:
  - audio-workstation
  - specification
---

# Ingestion and Timeline

## File admission and decode

1. Inspect the audio or video container and basic metadata without trusting filename extensions. For video, select a supported audio stream, retain its timestamps and the source video timeline, and never decode picture frames merely to obtain audio. Accept mono/stereo audio; reject unsupported or ambiguous stream layouts with a clear message.
2. Estimate decoded size, duration, storage requirements, and decoder peak memory before a large allocation. Default maximum duration is 900 seconds. Offer a supported segment workflow only when the decoder can bound memory; merely slicing after full decode does not solve admission.
3. Use native `decodeAudioData` only for measured small **audio-only** inputs when the admission budget explicitly includes its complete compressed input and decoded `AudioBuffer`. It is prohibited for video and unsuitable as the general streaming path. The UI must not imply that this small-audio exception applies to larger media.
4. For D-024's initial measured browser-decodable MP4 matrix, require matching `video/mp4` MIME metadata and `.mp4` extension, then use a second non-visible local-file audio element feeding a fixed-buffer AudioWorklet and OPFS writer at normal playback speed. The adapter verifies successful mono/stereo PCM decode but cannot introspect the encoded audio codec; AAC-LC support is an evidence-backed matrix entry, not an inference about every MP4. Keep browser-native demux/decode behind that bounded adapter. Use a bundled, versioned worker/WASM decoder only when a measured native gap justifies its separately pinned binary, resource, quality, and rights gates; arbitrary containers/codecs are not implicitly supported.
5. Reject corrupt, truncated, encrypted, unsupported-rate, or unsupported-codec inputs with actionable messages and without replacing the last good project.

The visible supported-format list must reflect the tested matrix. Initial browser-decodable MP4 ingestion follows D-024 but remains disabled until I-009's private-source, full OPFS, timing, memory, suspension, and no-picture-decode evidence passes. FLAC and every broader format remain gated. Source media chunks belong in OPFS; synchronous string-based `localStorage` is neither large enough nor safe for media payloads. IndexedDB holds compact project/manifests metadata and is a measured blob fallback only where specified.

Import must stream `File.stream()` or bounded `File.slice()` ranges to the demux worker and OPFS writer with backpressure. Do not materialize video or non-small audio through a whole-file `arrayBuffer()`, transfer a complete source to WebGPU, or decode video frames merely to reach its audio. The narrowly admitted small-audio native-decode path above is the only whole-input exception. For same-session picture preview, an `HTMLVideoElement` may use an object URL for the original `File`, muted while the shared audio transport plays enhanced output. Persistent/reopened preview requires a validated bounded OPFS-to-demux/MediaSource path for the selected container.

## Canonical representation

Working PCM is 48,000 frames/second, Float32. Mono input is explicitly duplicated to stereo for processing without increasing its per-channel amplitude. Source metadata retains original sample rate, channel count, container duration, codec delay, and trim information where available.

For D-024's native browser-decodable MP4 path, request and verify a 48 kHz AudioContext; the Web Audio specification requires MediaElementAudioSource output to be resampled to the context rate. Qualify its implementation-defined filter against the spectral, delay, trim, and EOF quality floor before enabling the codec matrix. Other decode paths use a worker-based, anti-aliased polyphase sinc resampler with state carried between chunks and specify filter design, stopband performance, delay, and flush behavior in the implementation artifact. OfflineAudioContext is an optional measured bounded-buffer path, not assumed to run in arbitrary workers. Never double-resample. See the [Web Audio specification](https://webaudio.github.io/web-audio-api/).

| Stage | Rate | Contract |
| --- | --- | --- |
| Storage, mixing, and export | 48 kHz | Canonical project frames |
| Demucs candidate | 44.1 kHz | Model-manifest input shape and rate |
| Speech enhancement | Artifact-defined, preferably 48 kHz | No arbitrary rate substitution; validate any band-split reconstruction |
| Silero VAD candidate | 16 kHz | Model-defined frame count and recurrent state |

## Timeline invariants

- Frame zero is the first retained sample after decoder priming/trim handling. All buses retain the same canonical length and origin. For video sources, store the rational mapping between canonical audio frames and container timestamps so previews and any future remux remain synchronized.
- Metadata uses integer canonical frame offsets and half-open intervals `[startFrame, endFrame)`. Seconds are a display/interchange convenience.
- Map model boundaries using rational rate conversion, accounting for chunk origin, codec/model delay, and resampler delay. Carry phase across chunks; never accumulate independently rounded chunk durations.
- For aligned 16 kHz VAD indices, `frame48 = 3 * frame16`. Subtract known analysis delay before mapping, then clamp to `[0, totalFrames]`.
- Pad model inputs when required and trim padded outputs. Flush filter/model tails before canonical alignment; do not discard real ending samples.
- Test impulses near the start, page boundaries, model overlaps, and EOF for drift and off-by-one errors.

See [[Dialogue Enhancement and VAD]], [[Separation Pipeline]], and V-01/V-04 in [[Validation Plan]].
