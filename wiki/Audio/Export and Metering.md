---
title: "Export and Metering"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Export and Metering

## Output contract

- Stereo 48 kHz, signed 24-bit little-endian PCM WAV for a full mix or four aligned stem files.
- Every file starts at canonical frame zero and retains the project duration. Model padding is trimmed; no implicit reverb tail extension.
- Full-mix export uses an explicit inclusion snapshot shown on the export screen. It includes accepted edits, controls, automation, and ducking; temporary solo state never silently determines output, and current mute state is translated into a visible inclusion choice that the user can confirm or change.
- D-015 stem mode exports the explicitly selected named buses with their accepted processing: dialogue dry/clean blend and filters, bus gain/automation, music/ambience width and ducking, SFX balance, edits, and semantic-region overrides. It excludes audition mute/solo and excludes master loudness normalization/limiting.
- If any processed stem cannot fit signed 24-bit PCM without clipping, apply one common fixed attenuation to every exported stem rather than independent gains. Record that gain in the manifest so importing all stems preserves their relative balance and reconstructs the pre-master mix up to the documented common gain.
- Export a versioned manifest containing project/pipeline identity, canonical origin/duration/rate, included buses, processing snapshot hash, common attenuation, and per-file integrity data. Raw separated/model outputs are not an MVP export.
- Apply TPDF dither once at final Float32-to-24-bit quantization. Use the difference of two independent uniform values scaled to one output LSB each (two-LSB peak-to-peak TPDF); avoid repeated dither in intermediate pages.

## Stateful bounded rendering

A single full-duration OfflineAudioContext allocates its complete output. Recreating a context per chunk resets filters, compressor/limiter state, and automation history. Therefore “chunked OfflineAudioContext” alone does not satisfy memory or deterministic-render requirements.

Build a separate export graph/engine from the shared mix configuration. Before choosing the production backend, pass V-06 using either:

1. A stateful worker/WASM renderer with explicit filter, resampler, limiter, and automation state carried between blocks; compare against the monitoring graph within defined tolerances.
2. Bounded offline contexts with a proven preroll/state-reconstruction and overlap policy for every effect. No assumption that a fixed short overlap reproduces arbitrary IIR/dynamics state is allowed.

The first is the preferred feasibility direction; backend selection is pending [[Open Decisions]]. Sequential output pages are written to a temporary file, with headers finalized after the frame count is known. Never assemble the complete export in an ArrayBuffer. Validate that the browser's final save/download path also respects memory limits; use a file-backed or streaming path where supported, otherwise enforce a measured size limit.

## Loudness and true peak

D-014 defines three outcome presets:

| Preset | Loudness behavior | Export ceiling | User expectation |
| --- | --- | ---: | --- |
| Preserve Dynamics | No integrated-loudness target; retain the accepted mix gain unless safety attenuation is required | -1 dBTP | Keep natural quiet/loud contrast |
| Clear & Balanced (default) | Aim for -16 LUFS integrated | -1 dBTP | Consistent dialogue-led video, podcasts, and general listening |
| Streaming Loud | Aim for -14 LUFS integrated | -1 dBTP | Louder online delivery when it does not require unacceptable limiting |

Targets are conditional. Loudness and peak headroom can conflict, so predict and report limiter activity and the achieved loudness rather than promise both at any input level. If reaching a target would exceed the accepted compression/artifact rubric, preserve dynamics and explain the shortfall. Primary copy names the outcome; LUFS, dBTP, loudness range, gain, and limiting remain available in details.

Use two distinct comparisons. A level-matched A/B lets the user judge whether processing improved the sound without “louder is better” bias. An output-level preview lets the user compare the chosen delivery loudness and dynamics. Both use the same committed mix state as export.

Use a validated integrated-loudness/true-peak implementation and an independent reference measurement. Silence, very short content, and insufficient gated content need explicit “not measurable” handling. Metering standards/library selection remains part of V-06.

A DynamicsCompressorNode is not a guaranteed brick-wall or true-peak limiter. Use a validated oversampled lookahead limiter with declared latency, consistent preview/export timing, and bounded state. The Web Audio API describes a compressor, not a true-peak ceiling guarantee: [Web Audio specification](https://webaudio.github.io/web-audio-api/).

Proposed two-pass export:

1. Render the processed mix in bounded blocks to compute loudness and peak statistics; retain or deterministically reproduce the intermediate mix within the storage budget.
2. Apply the selected D-014 normalization policy and the -1 dBTP true-peak limiter, then dither/encode incrementally.
3. Verify the quantized exported result against the ceiling and sample bounds. On failure, lower gain and rerender; do not publish a failed file as safe.

Use a seeded dither generator for reproducible tests. Exact bit identity across browsers is not assumed for native audio nodes; require documented numerical and perceptual equivalence tolerances.

V-06 must also sum the quantized processed stems and compare them with the pre-master reference after compensating the documented common attenuation. Independent dither noise is included in the tolerance; timing, processing state, and relative bus balance are not waived.

Monitoring exposes peak, RMS, and a clip indicator; label true-peak measurements distinctly from sample peaks. Silence must never produce NaN or infinite gain. See [[Memory and Storage]] and [[Validation Plan]] V-06.
