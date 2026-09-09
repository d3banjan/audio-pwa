---
title: "Implementation Package I-014 - Native AI Research Reference"
version: "1.0"
status: implemented-research-reference
updated: 2026-09-08
tags:
  - audio-workstation
  - delivery
  - ai
  - research-reference
---

# Implementation Package I-014 - Native AI Research Reference

## Outcome

The private 8 minute 53 second video has completed the intended audio topology on the NVIDIA home server. The run provides a listening reference and executable native pipeline before the browser implementation is expanded.

This is the **full research topology**, not the qualified browser production pipeline. It proves that the stages can be connected and produces reviewable audio. It does not prove FP16 ONNX browser parity, bounded browser memory, WebGPU support, or semantic quality of the provisional `other`-stem partition.

## Reproduce

Run the strict Bash entry point:

```sh
scripts/ai-pipeline.sh INPUT_VIDEO OUTPUT_DIRECTORY
```

The local machine must provide native FFmpeg, FFprobe, Python, SHA-256 tools, and SSH. The configured server must provide the pinned Python environment and NVIDIA CUDA device. Every required stage fails visibly; the pipeline has no model or DSP fallback.

The default remote is the Tailscale MagicDNS identity `debanjan@home-server.taila135aa.ts.net`. The earlier `home-server.local` mDNS address failed outside its local discovery scope. SSH verifies the MagicDNS route using the same server key already trusted as its stable Tailscale address `100.94.51.105`; `--host` remains available for another explicit target.

The entry point uses these implementation seams:

- `scripts/run_htdemucs_reference.py` — official PyTorch HTDemucs execution with a 7.8 second segment and 2.5 second overlap.
- `scripts/research_ai_postprocess.py` — 48 kHz alignment, DeepFilterNet3, exact Silero VAD artifact, provisional linked-stereo Stage 2 masks, four-bus routing, width, VAD ducking, and premaster safety.
- `scripts/compare-audio.sh` and `scripts/compare_audio.py` — sequential decoding, alignment, volume-agnostic ranking, per-scene level matching, and A/B video assembly using native FFmpeg.

Search these exact strings before changing the research seams:

```sh
rg -n 'LEAKY ABSTRACTION\(I-014\)|research-reference-not-browser-qualified|provisional-linked-envelope-complementary-v1|meaningful_power|compensated_algorithmic_delay_samples' scripts wiki implementation
```

## Executed topology

1. Extract stereo Float32 audio at the HTDemucs 44.1 kHz model boundary.
2. Run official `htdemucs` on the RTX 3060 and produce vocals, drums, bass, and other.
3. Resample stems to the canonical 48 kHz project timeline.
4. Enhance vocals with DeepFilterNet3 in overlapping chunks and compensate its declared 480-sample delay.
5. Run pinned Silero VAD 6.2.1 at 16 kHz and map its activity to the 48 kHz timeline.
6. Partition `other` with complementary linked-stereo envelope masks; route drums, bass, and the harmonic portion to Music, then route the remaining portions to Ambience and SFX.
7. Blend raw and enhanced dialogue, apply dialogue filtering, stereo width, and VAD-driven −6 dB background ducking.
8. Render a premaster, apply two-pass loudness normalization and triangular dither, and write 48 kHz stereo 24-bit PCM WAV.
9. Remux the mastered audio with the source picture and render four level-matched ORIGINAL/PROCESSED scenes selected by spectral and dynamic change.

## Measured result

| Property | Observation |
| --- | --- |
| Source duration | 533.0107 seconds |
| Separation device | NVIDIA GeForce RTX 3060 |
| HTDemucs elapsed time | 28.77 seconds |
| Downstream elapsed time | 36.01 seconds |
| Final master | −16.0 LUFS, −1.1 dBTP |
| VAD frames | 16,657 total; 7,985 active at threshold 0.5 |
| Stage 2 mask-sum error | `1.1920928955078125e-07` |
| A/B alignment confidence | `0.909294` |
| A/B playback level deltas | +0.01, +0.17, −0.62, −0.04 dB RMS |

Exact artifact, checkpoint, stem, output, and configuration hashes are recorded under `artifacts/ai-reference-verified/` and summarized in `implementation/evidence/i-014/README.md`.

The diagnostic `stem-walkthrough.mp4` replays each selected scene as Original Mix, Dialogue, Music, Ambience, SFX, and Processed Mix. The isolated channels retain a common gain derived from the premaster and level-matched final mix; they are not normalized independently. This preserves their real relative contributions. All four channel sums reconstruct their corresponding premaster excerpts with maximum errors between `1.67e-08` and `4.56e-08`.

## Load-bearing limits

- HTDemucs uses its official PyTorch checkpoint in FP32-oriented native execution. The selected browser target remains a weight-only FP16 ONNX conversion whose parity and provider support are unproven.
- Stage 2 uses a provisional complementary envelope partition. It preserves energy, but it is not yet the specified spectral-flux and harmonicity classifier and must not be described as semantically verified Music, Ambience, or SFX separation.
- Silero runs through an explicitly selected CPU ONNX Runtime provider on the server. This is intentional and is not a hidden fallback.
- Master verification uses FFmpeg's native EBU R128/true-peak analysis. Browser limiter and export equivalence remain release work.
- The run processes and writes full native files on the server. It is reference evidence, not evidence for the 1.5 GB browser ceiling or OPFS paging contract.
- Demucs pretrained-weight terms remain a distribution blocker. The repository may contain scripts and manifests, but must not publish the checkpoint as MIT application content.

## Next gate

The user reviews the A/B portfolio and full processed output first. After acceptance, use this reference to define listening criteria and implement the browser stages incrementally. Do not call browser processing equivalent until V-02, V-03, V-04, V-06, V-09, and V-11 pass.

### Listening review finding — 2026-09-09

The first four-scene portfolio is not yet accepted as product-quality evidence. The user clarified that the salient loud events were dramatic, louder dialogue rather than non-speech transient noises. The earlier inference that SFX energy dominated these scenes was incorrect and is superseded by this note.

Maximum volume-agnostic difference still does not establish audible benefit. Loud, already-intelligible dialogue may create a strong analysis window while giving a denoiser little unwanted sound to remove. The current 45% wet dialogue blend also retains most of the separated raw vocal, so improvement can remain subtle even when separation succeeds.

Replace the portfolio criterion with an outcome-based selection:

- favor high speech activity with audible noise, masking, or reverberation rather than speech level alone;
- distinguish loud dialogue from non-speech transient peaks before excluding a window;
- rank dialogue-clean improvement separately from full-mix difference;
- audition Original Mix → Dialogue → Music → Ambience → SFX → Processed Mix so routing can be judged independently from final enhancement;
- do not present the full processed mix as improved merely because its waveform differs.

The load-bearing reason for rejecting maximum-difference ranking as the sole criterion is that salience and benefit are different objectives. Preserve the original report as diagnostic evidence; archive its detailed candidate rankings when the replacement artifact is accepted.

See [[Separation Pipeline]], [[Model Runtime and Licensing]], [[Validation Plan]], and [[Implementation TODOs]].
