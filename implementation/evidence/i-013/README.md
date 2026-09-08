# I-013 browser processing backend evidence

Date: 2026-09-08

I-013 connects the bounded I-010 segmentation and I-011 enrichment passes into
a serial browser job and wires that job into the existing **Create processed
file** action for a prepared MP4 source. It adds a transactional segmentation
metadata store, the direct I-012 OPFS adapter composition, a dedicated module
worker plus controller, and a bounded PCM24 WAV handoff to the existing output
preview and download controls. Sources without a committed I-009 cache keep the
truthfully labelled live MediaRecorder fallback.

## Ordering and identity

`src/processing/processing-job.ts` completes segmentation, atomically commits
its metadata, and only then creates the enrichment reader and writer. Every
factory and stage receives the same `AbortSignal`, project/job identity,
processing generation, and explicit I-009 source run identity. The source
generation is kept separate from the UI processing generation. Progress
contains those identities, a stage, frame counters, and a monotonic overall
ratio; it never contains PCM or feature arrays. A final generation guard
prevents stale success publication.

`src/processing/segmentation-result-store.ts` validates exact feature coverage,
bounded counts and windows, finite probabilities/statistics, intervals,
boundaries, and complete segments before opening a transaction. Its production
repository uses I-009's IndexedDB database and object store. One read-write
transaction verifies the current I-009 run ID, source generation, format, and
frame count, then writes the immutable result, replaces
`segmentation:current`, and deletes the previous segmentation metadata. Abort,
stale generation, validation, or transaction failure leaves the prior pointer
and result intact.

## Model and worker behavior

`src/processing/browser-processing-job.ts` directly composes the I-012 reader
and writer with I-013. It attempts the pinned local Silero model only when its
single-thread WASM provider has at least independent reference parity. The
stateful adapter consumes exact 1,536-frame 48 kHz windows and zero-pads only a
partial EOF window; canonical result boundaries remain clipped by I-010. A
model setup failure truthfully selects `dsp-energy-zcr-v1` and returns
`model-setup-failed`; an ineligible provider returns `provider-not-qualified`.
Cancellation during setup never turns into a fallback. Inference failure after
setup fails the run rather than switching classifiers mid-timeline.

`processing-worker.ts` owns the sample loops and ONNX session away from the UI
thread. It accepts same-origin module-worker commands, serializes replacement,
and emits sanitized progress/result/error messages. After committing processed
PCM, the worker streams that exact immutable result into the I-012 24-bit WAV
writer. It returns a cloneable `audio/wav` Blob and keeps exactly one successful
temporary OPFS artifact until the controller sends an identity-bound
`DISPOSE_OUTPUT` command and receives `OUTPUT_DISPOSED`. A second start is
rejected until that disposal completes. This is necessary because deleting the
OPFS file immediately after `postMessage` made Chromium's transferred Blob
unreadable.

The controller validates message identity and shape, ignores stale messages,
forwards cancellation, and waits for output-disposal acknowledgement before it
terminates the worker. The visible flow revokes the old object URL, clears the
media element, and awaits that disposal before publishing or starting another
source. A new source also invalidates the previous extraction owner, so an
audio file selected after an MP4 cannot accidentally process the prior MP4
cache.

The boundary validation rejects malformed terminal payloads with the stable
`PROCESSING_BACKEND_FAILED` code after checking the nested job, classifier,
processed-result identity, WAV Blob, MIME, name, and byte count. Progress only
accepts finite ratios in `[0, 1]` and nonnegative integer counts where completed
work does not exceed total work. A Silero session created as cancellation lands
is disposed before cancellation propagates.

GitHub Pages can serve the model with transfer compression, so its HTTP
`Content-Length` is not treated as the artifact length. The loader verifies the
decoded model bytes and checksum before creating the Silero session.

The UI freezes the current preview controls into I-011 batch options before it
starts the prepared path, pauses the preview, and reports analyzing, applying
settings, and WAV creation as separate stages. It uses sample-peak safety
wording; it makes no true-peak claim.

A synchronous launch token covers the gap before a worker job exists. It makes
the controls busy on the first click, snapshots the project, preview source,
prepared-cache owner, extraction generation, and exact frame count, then
rechecks all of them after output disposal and the asynchronous storage check.
Source replacement, cancellation, refusal, startup error, completion, and job
error invalidate the token. Therefore a rapid second click cannot start a
parallel job, and a source selected while storage estimation is pending cannot
publish work for the previous cache.

Before creating the worker, `processing-storage-admission.ts` uses the exact
committed 48 kHz frame count to reserve space for another stereo Float32
processed result, the stereo PCM24 WAV (including its header), the pinned
Silero/ONNX Runtime assets, and a 20% safety margin. It compares that total with
`navigator.storage.estimate()` quota minus usage and fails closed before long
work when the estimate is missing, malformed, or too small. The live recorder
fallback does not use this OPFS admission check. Individual writer quota errors
remain authoritative if browser usage changes after admission.

## Automated evidence

Focused tests cover serial stage ordering and cleanup, stable errors,
cancellation, stale publication, bounded metadata, separate source/job
generations, model selection and EOF padding, honest fallback, source
replacement, and worker identity/cancellation/destruction.

Run:

```sh
bun x vitest run src/processing/processing-job.test.ts src/processing/segmentation-result-store.test.ts src/processing/browser-processing-job.test.ts src/processing/processing-worker-controller.test.ts
bun run typecheck
```

The I-013 processing suites pass 34 focused tests, including eight pure storage
admission cases. The aggregate repository gate passes 190
unit tests, formatting, type checking, and wiki validation. Fifteen real
Chromium journeys pass, including committed MP4 cache processing into a valid
stereo PCM24 RIFF/WAVE file, prepared-job cancellation, and replacing a cached
MP4 with an audio source without reusing stale cache state. A low-quota journey
also proves that the prepared path reports insufficient storage before starting
the worker and publishes no download. Two delayed-estimate journeys cover rapid
double-click and source replacement during launch. The
integrated production build emits a 46,197-byte processing worker, a
72,435-byte lazy ONNX Runtime JavaScript asset, and exactly one 13,961,845-byte
WASM binary. The content-hashed WASM URL is Pages/base-safe and included once in
the immutable service-worker precache. Sustained-load memory, offline cold
restart, and the remaining browser matrix are still required before broad
support claims.

The full release gate passes all 38 Chromium journeys. Sol's final integration
review found no P0/P1 release blocker in the documented MVP scope. Astra
inspected a fresh desktop view and a 390 px viewport with no console errors,
overflow, or confirmed UI defect. The in-app browser's supported file chooser
hung, so Astra did not claim independent post-upload interaction coverage; the
real Chromium journeys above remain the evidence for upload, transport,
processing, cancellation, and output behavior.
