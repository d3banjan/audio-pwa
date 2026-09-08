# I-010 streaming segmentation evidence

Date: 2026-09-08

`src/processing/segmentation.ts` implements a bounded analysis pass over canonical 48 kHz planar PCM pages. The source audio is never assembled in memory. The default classifier is explicitly identified as the deterministic `dsp-energy-zcr-v1` fallback and is replaceable through `SpeechLikelihoodClassifier`.

Focused automated tests cover:

- an analysis window spanning five-second-page-like boundaries and a partial EOF window;
- exact half-open feature, speech-mask, padded-clip, boundary, and segment offsets;
- sustained energy changes with entry/exit hysteresis, confirmation, and minimum segment duration;
- all-silence behavior;
- the explicit arithmetic stereo downmix and its phase-cancellation edge case;
- cancellation between windows;
- stale-generation rejection before result publication; and
- rejection of a non-contiguous page timeline.

Run the focused evidence with:

```sh
bun x vitest run src/processing/segmentation.test.ts
```

This evidence validates deterministic plumbing and bounded page consumption. It does not qualify the DSP score as voice detection, validate Silero/ONNX, persist analysis metadata, or connect segmentation to the visible product flow.
