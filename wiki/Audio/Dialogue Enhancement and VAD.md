---
title: "Dialogue Enhancement and VAD"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Dialogue Enhancement and VAD

## Stage 3 — enhancement and alignment

Evaluate a pinned DeepFilterNet or RNNoise artifact for the dependable denoising path. The runtime may be model-specific WASM rather than ONNX; neither project name guarantees an ONNX package or a particular input rate. Pin frame shape, rate, state, preprocessing, delay, and output scaling in its manifest.

D-013 separates core denoising from experimental dereverberation. The normal Dialogue Clean control promises reduction of supported background noise while preserving intelligibility; it does not imply full room-echo removal. If an exact artifact passes preliminary dereverberation gates, expose it as a distinct experimental option applied first to a representative preview. Show applicable material/limitations, use level-matched source-versus-result A/B, provide one-step undo, and retain the source. Abstain or disable the option when confidence is low, speech damage/artifacts exceed the rubric, latency alignment is unproven, or the device cannot run the qualified path.

For an enhancer with fixed delay `D` canonical samples, compensate the cleaned output back to the source timeline:

$$c_{aligned}[n]=c_{delayed}[n+D],$$

$$v[n]=(1-\alpha)r[n]+\alpha c_{aligned}[n],\quad 0\leq\alpha\leq1.$$

Feed sufficient padding and flush the enhancer to retain the complete ending. Include resampler and model buffering delays in `D`. Measure fixed delay with suitable fixtures and verify against natural speech; processing can alter phase or waveform shape even after fixed-delay correction. Nonlinear enhancement means perfect waveform identity is not expected.

Do not delay only raw vocals against the other buses. An alternative delay-based design must delay every bus and compensate transport/VAD consistently; pre-alignment is the preferred batch design.

Keep raw and aligned-clean pages available together within the playback window. Feed synchronized sources into two smoothed gain paths with complementary gains `1-alpha` and `alpha`, then sum into the Dialogue bus. Linear blending preserves level for correlated identical inputs; equal-power blending can boost those signals. Dial updates use a 10 ms ramp without recreating full-file buffers or restarting playback.

## Stage 4 — VAD

Run VAD on the raw separated vocal signal, before the user wet/dry blend, so changing Dialogue Clean does not change clips. Downmix using an explicit stereo-to-mono rule, resample to 16 kHz, and preserve recurrent state across contiguous frames. Evaluate phase-canceling stereo as an edge case.

Use the selected artifact's required window size. Recent Silero versions document 512 samples at 16 kHz, or 32 ms; the supplied fixed 30 ms assumption is removed. See [Silero releases](https://github.com/snakers4/silero-vad/releases).

Cache probabilities with canonical frame intervals and the model/analysis version. Resampler delay and chunk offsets are included before applying the `3 * frame16` mapping in [[Ingestion and Timeline]].

## One speech-mask contract

1. Threshold cached probabilities using `thetaVAD`, default 0.5, range 0.1–0.9.
2. Form contiguous speech intervals; remove isolated intervals shorter than 250 ms.
3. Merge surviving intervals separated by less than 300 ms silence.
4. Store this unpadded speech mask as the shared source for clip derivation and ducking.
5. For clips, add 100 ms pre-roll and 150 ms post-roll, clamp to the recording, and merge overlaps. Apply 10 ms edge fades, shortened if required for very short intervals.

This ordering is proposed and must be checked for missed short utterances. Preserve raw audio so users can audition or restore rejected speech. Clip generation does not destructively remove samples. In the initial design clips are navigation/edit metadata; Dialogue playback remains continuous unless an explicit clip edit changes it. Preview and export must share any such edit state.

Changing VAD sensitivity recomputes both derived clips and ducking from cached probabilities, without rerunning the neural model. Cancel stale recomputation generations, keep transport continuous, and smoothly replace future automation. No unmeasured sub-5 ms update guarantee is made.

See [[Transport and Automation]], [[Mixer and Controls]], and [[Validation Plan]] V-04/V-05.
