# I-014 native AI research-reference evidence

The executed pipeline and its qualification boundary are the source-of-truth entry [[Implementation Package I-014 - Native AI Research Reference]].

Local review artifacts are in `artifacts/ai-reference-verified/`:

- `top-four-ai-before-after.mp4` — four 8-second source scenes, each played as ORIGINAL then level-matched PROCESSED.
- `top-four-ai-before-after.json` — alignment confidence, scene boundaries, volume-agnostic spectral/dynamic scores, and applied level matching.
- `stem-walkthrough.mp4` and `stem-walkthrough.json` — the same four scenes cycling through Original Mix, Dialogue, Music, Ambience, SFX, and Processed Mix, plus reconstruction and common-gain evidence.
- `final-processed-video.mp4` — complete source video with processed audio.
- `final-processed.wav` — complete 48 kHz stereo PCM24 master.
- `htdemucs-manifest.json` and `postprocess-manifest.json` — pinned model/config hashes, runtime contracts, measurements, and output hashes.
- `SHA256SUMS` — final review-artifact hashes.

Observed final hashes:

```text
57afd82ae8aaddcf493d3add78f3c9f7b2c8dd015571bbfc6c2541f3dd33f9ed  final-processed.wav
001bee811547e9327f2828c508fcc7d5ea40b0c0f1124eff02e2d39e2938dc71  final-processed-video.mp4
0c8f0df6b1f929f281d6be85a18cdf8c6d2b937422af98aeb531b95961f9e2fe  top-four-ai-before-after.mp4
d8d1ed3340c42c88437e07d4988cb680f56031908e1e9fbda9c4235d8a4a3d1f  stem-walkthrough.mp4
```

Verification completed on 2026-09-08:

- Strict entry point completed all eight stages from the original MP4.
- Output portfolio contains H.264 video and 48 kHz stereo AAC, duration 64.021 seconds.
- Portfolio scene RMS deltas after encoding are +0.01, +0.17, −0.62, and −0.04 dB.
- The 192.021-second stem walkthrough has H.264 video and 48 kHz stereo AAC; all four bus sums reconstruct their premaster excerpts within `4.56e-08` peak error before encoding.
- A synthetic 3.7× pure-gain transformation scores below `0.000001`; removal of a meaningful frequency component scores above `9.13`.
- Final master measures −16.0 LUFS and −1.1 dBTP.
- Bash syntax, Python compilation, and repository whitespace validation pass.

This evidence qualifies the native full-topology run as a research reference only. See the wiki package for the browser, semantic-separation, memory, provider, limiter, and licensing gates that remain open.
