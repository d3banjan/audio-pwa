---
title: "I-009 Native PCM extraction feasibility probe"
status: implementation-repaired-qualification-partial
updated: 2026-09-08
tags:
  - i-009
  - media-element
  - audio-worklet
  - bounded-memory
---

# I-009 native PCM extraction feasibility

This is a local feasibility probe, not a production implementation or a claim that the product now extracts video audio. It tests whether a browser can decode a local uploaded MP4 through a second hidden audio element and expose small PCM blocks through `AudioWorkletProcessor`, while leaving the visible video element independent.

The implementation pass now includes the bounded native graph, four-page ownership handoff, high/low-water pause control, dedicated OPFS writer, staged generation manifests, exact canonical target-frame trimming, explicit flush/drain, cancellation cleanup, Web-Lock-protected orphan collection, stalled-clock recovery, and a user-visible start state. A rejected `play()` pauses the extraction clock before exposing Start/Resume; late writer acknowledgements preserve that state and can resume playback only after an intentional backpressure pause. Browser qualification of sustained no-drop timing remains a release gate; private source identity and bytes are intentionally absent from this artifact.

Run it only with an authorized local sample:

```sh
I009_PRIVATE_TESTCASE_PATH=/path/to/authorized.mp4 node scripts/probes/i-009-native-pcm-probe.mjs
```

The path and source bytes are consumed in memory by the test harness. They are not printed, copied, uploaded, or committed. Without the environment variable the probe exits as skipped.

The graph is `File object URL -> hidden audio element -> MediaElementAudioSourceNode -> AudioWorkletNode -> zero-gain destination`. Connecting to the destination keeps the media clock advancing while gain `0` prevents speaker output. Each worklet callback transfers one small `Float32Array` page; the main thread enforces an explicit 64-page queue cap and drops pages when full. Cancellation stops acceptance immediately and checks that no later pages are counted.

## Sanitized acceptance record

| Check                                         | Result                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Local MP4 decode through hidden audio element | Passed with a temporary H.264 Baseline + AAC-LC MP4 and the authorized private testcase              |
| Nonzero decoded PCM observed                  | Passed: 24 blocks / 3,072 samples, nonzero detected                                                       |
| Media clock advanced without speakers         | Passed: media clock advanced to ~0.054 s through zero-gain destination                                    |
| Cancellation stopped page acceptance          | Passed: count remained stable after cancellation                                                          |
| Queue bound                                   | Passed: explicit cap 64 Float32 pages; observed peak 1                                                    |
| Visible video preview independence            | Passed: visible video `src` remained untouched                                                            |

The generated MP4 run establishes that the browser graph works in this local Chromium context. The authorized private testcase also completed through the product UI: an 8 minute 53 second, 54.6 MB MP4 reached `Local audio cache is ready` while its visible preview remained available and independent. That run used the exact-frame build immediately before the manual-recovery status/action repair; it did not encounter the recovery path. The generated regression suite verifies the repaired recovery behavior. The private source name, path, and bytes were not recorded, copied, uploaded, or committed.

The probe is intentionally bounded and does not use `File.arrayBuffer()`, `File.bytes()`, `decodeAudioData()`, or `MediaRecorder`. Production uses the same privacy boundary. A repository-owned H.264 Baseline/AAC-LC fixture now completes through the production worklet, OPFS writer, and atomic manifest with exact retained duration; cancellation, manual recovery, and cross-tab cleanup are browser-tested. Full 900-second memory, impulse/resampler accuracy, sustained contention/background behavior, picture-decoder tracing, and cross-browser qualification remain release gates.
