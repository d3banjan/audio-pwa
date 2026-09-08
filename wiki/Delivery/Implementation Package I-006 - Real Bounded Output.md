---
title: "Implementation Package I-006 - Real Bounded Output"
version: "2.1"
status: implemented
updated: 2026-09-08
tags:
  - audio-workstation
  - delivery
  - implementation
---

# Implementation Package I-006 - Real Bounded Output

## User-visible outcome

After a real local source is loaded, the user can record the processed preview into a local output, watch progress, cancel safely, preview the finished output, and download it. The output is an actual browser MediaRecorder file; it is not presented as a WAV, stem export, ML enhancement, or video remux.

## MVP contract

- Capture the existing processed Web Audio bus through `MediaStreamAudioDestinationNode` and `MediaRecorder`.
- Record sequentially with short timeslices. OPFS writes are serialized with an explicit 8 MiB pending-write cap; the non-OPFS fallback retains output only under its explicit 64 MiB cap. If either bound cannot be maintained, stop with a recoverable error.
- Use a browser-supported MIME type and expose the actual type/extension in the UI. The default expected type is WebM/Opus; browsers may choose another supported type.
- Drive progress from source media duration and current playback time. Stop at source end. Cancel stops recording, removes temporary chunks, and preserves the source preview.
- The prototype encoder runs at playback speed and owns the preview transport while recording. UI refreshes must keep the processed bus selected, controls remain locked, and the user is told this before starting. A later stateful offline renderer replaces this constraint.
- Final output is a local object URL for preview and a download link. It is audio-only in this slice, including when the input is video; video passthrough/remux is deferred.
- If OPFS is unavailable, estimate encoded size conservatively at 256 kbit/s plus 10% container overhead. Refuse the job before `MediaRecorder.start()` when that estimate exceeds the 64 MB fallback limit, and retain the runtime byte cap as a second guard. Never read the source file through `arrayBuffer()`.

## Accepted boundary leaks

`LEAKY ABSTRACTION:` the browser owns MediaRecorder encoding and OPFS stream semantics. The package must preserve bounded chunk accumulation, cancellation cleanup, truthful format labeling, local-only behavior, and output preview/download if replaced by a worker encoder or a qualified container writer.

## Acceptance evidence

- Unit tests inject only the recorder, chunk store, readiness, and animation-frame browser boundaries. They cover MIME selection, the pending-write cap under a stalled store, progress, readiness cancellation without a late recorder start, direct ended-stop, exactly one terminal store action, typed output, and output naming.
- Browser tests use generated local audio, verify processed capture starts and produces a decodable local output with positive duration and signal energy, keep mono centered, preserve stereo at natural width, leave no active job after cancellation, and call no whole-file source read API.
- Manual testing may use the private testcase locally; its path and contents must not enter tracked files or network requests.

## Deferred work

Video remux, 24-bit WAV/TPDF export, discrete stems, ONNX enhancement, OPFS random-access assembly, and arbitrary model selection remain later packages.
