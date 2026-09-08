---
title: "Implementation Package I-013 - Browser Processing Backend"
version: "1.2"
status: integrated-prototype
updated: 2026-09-08
tags:
  - audio-workstation
  - implementation
  - processing
  - worker
---

# Implementation Package I-013 — Browser Processing Backend

I-013 provides the first concrete end-to-end processing path. It reads the
committed local audio cache, segments it, persists the segmentation metadata,
enriches the audio, transactionally publishes processed PCM, and streams that
exact result into a downloadable 24-bit WAV. The existing **Create processed
file** action uses this path for a prepared MP4; sources without a committed
I-009 cache retain the live MediaRecorder fallback.

## Direct processing path

The dedicated module worker follows one serial path:

1. Open and bind the current I-009 source run and extraction generation.
2. Select the local Silero WASM classifier when its catalog provider has
   reference parity, otherwise select the named DSP fallback.
3. Stream source pages through I-010 without retaining the recording.
4. Validate and atomically commit segmentation metadata in the shared I-009
   IndexedDB object store.
5. Reopen the current source, reject source replacement, and stream it through
   I-011 into the I-012 transactional processed writer.
6. Publish success only while the independent processing generation remains
   current.
7. Stream the committed processed result into the I-012 PCM24 WAV artifact and
   return it to the existing output preview and download controls.

The source extraction generation and processing/UI generation are deliberately
separate. Both travel with progress and result identity. Segmentation and
enrichment never consume the source concurrently.

## Classifier truthfulness

The pinned Silero artifact runs at 16 kHz behind a stateful 48-to-16 kHz
decimator. The I-013 adapter supplies exact 1,536-frame canonical windows and
zero-pads a partial final window only for inference. I-010 retains the real
half-open EOF boundary.

The returned classifier report distinguishes `silero-wasm` from
`dsp-fallback`. Setup failure has the stable reason `model-setup-failed`, while
an insufficient provider qualification has `provider-not-qualified`.
Cancellation never becomes fallback, and a failure during stateful inference
ends the run rather than mixing classifier semantics.

## Transaction and event limits

Segmentation metadata must have exact bounded feature coverage, finite values,
ordered intervals and boundaries, and a complete segment partition. One
IndexedDB transaction verifies the bound I-009 source, writes the new metadata,
replaces its pointer, and removes the previous metadata. Failure preserves the
last committed pointer and result.

Worker events contain IDs, generations, stage, status, frame counts, and an
overall ratio only. The controller validates and ignores stale or malformed
messages. Stable job errors identify cancellation, stale generations,
segmentation, segmentation commit, enrichment, or backend startup.

## Output artifact lifetime

The worker retains exactly one successful temporary WAV artifact after posting
its cloneable Blob. It rejects another processing start until the controller
sends `DISPOSE_OUTPUT` with the completed job and processed-result identity and
receives `OUTPUT_DISPOSED`. The visible flow revokes the old object URL, clears
the media element, and awaits this acknowledgement before replacing the output
or starting a new source. Immediate cleanup is unsafe in Chromium because the
posted OPFS-backed Blob can still depend on the source file.

The prepared path freezes the current preview controls into canonical I-011
batch options before starting, pauses preview playback, and labels progress by
analysis, setting application, and WAV creation. It claims sample-peak safety,
not true-peak limiting. A selected source owns its extraction identity; choosing
another audio or video file invalidates prior prepared-cache eligibility.

The first Create click synchronously claims a launch token before any disposal
or storage wait. The token marks the flow busy and binds the project, preview
source, extraction generation, prepared-cache owner, and exact frame count.
Every asynchronous boundary rechecks that snapshot. A second click cannot
launch concurrently, while source replacement, cancellation, admission
refusal, startup failure, completion, and job failure invalidate the token.

The worker-controller boundary validates bounded finite progress and the full
nested completion payload before exposing it. A malformed terminal message
settles the active request with `PROCESSING_BACKEND_FAILED`, and cancellation
that lands immediately after Silero loading disposes that new runtime session.

Before the worker starts, storage admission uses the committed source's exact
48 kHz frame count. The estimate includes an additional stereo Float32
processed result, its stereo PCM24 WAV, the pinned Silero model and ONNX Runtime
assets, then adds a 20% reserve. The browser's reported quota minus current
usage must cover the total. Missing or insufficient estimates stop before long
processing with a plain recovery message; the app does not silently reduce
quality. This check applies only to the prepared OPFS path. Per-write quota
failures remain in place because available storage can change after admission.

## Integration gate

The production integration emits the processing worker, lazy ONNX Runtime
JavaScript, and one content-hashed single-thread WASM binary. Vite's emitted
WASM URL is safe under the GitHub Pages repository base path and the immutable
service worker precaches it once; there is no second public runtime binary.
The repository gate passes 190 unit tests, formatting, type checking, and wiki
validation. Fourteen real Chromium journeys cover the local preview flow,
including committed MP4 processing into a valid stereo PCM24 RIFF/WAVE,
cancellation, stale MP4-cache replacement, and low-quota rejection before the
worker starts. Delayed-storage journeys also cover rapid double-click and
source replacement before worker creation. Sustained-load memory, offline
cold restart, and the remaining browser matrix still gate broad support claims.

Implementation evidence is recorded in
`implementation/evidence/i-013/README.md`.

See [[Implementation Package I-010 - Streaming Segmentation]],
[[Implementation Package I-012 - OPFS Processing Store]], [[Boundary Contracts]],
and [[Client-Side Backend Architecture]].
