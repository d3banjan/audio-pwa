# I-006 evidence — real bounded processed output

Status: Sol technical PASS after D-023 escalation; Astra browser review pending.

The prototype now captures the existing processed Web Audio bus with the browser's `MediaRecorder`, writes timeslices incrementally to OPFS when the API is available, and uses a conservative 64 MB fallback cap when it is not. Before recording without OPFS, it estimates output at 256 kbit/s plus 10% overhead and rejects inputs that cannot fit the cap; the byte counter remains a runtime guard. The UI reports duration-based progress, supports cancellation, and exposes a local preview plus a download link using the actual recorder MIME type.

The output is audio-only, including for video sources. This slice makes no WAV, stem, ONNX, video-remux, or quality claim. Those remain explicit follow-up packages.

The MediaRecorder prototype runs at playback speed and temporarily owns the preview transport. A browser regression check asserts that progress refreshes keep the processed bus active rather than silently switching capture back to source/bypass.

The D-023 escalation added a narrow dependency seam for the browser-owned recorder, chunk store, media-readiness, and animation-frame boundaries. Production behavior is unchanged at the call site. Cancellation aborts readiness and cannot later start the recorder; OPFS/fallback writes select exactly one finish-or-cancel action after queued writes settle; an 8 MiB pending-write cap stops a stalled store with a recoverable error; and a direct media `ended` event stops recording even when animation frames are throttled. The returned Blob is labeled with the recorder's actual MIME type.

The processed width path explicitly upmixes mono to two-channel speakers input before its mid/side splitter. A Chromium `OfflineAudioContext` regression proves mono renders equally to left and right and natural-width stereo preserves both original channels. The outer browser test decodes the actual MediaRecorder output and verifies positive duration, nonzero signal energy, and centered mono output.

Validation performed after the repair:

- `bun run check` passes (90 unit tests, formatting, typecheck, and wiki verification).
- `bun run build` and `node scripts/verify-release.mjs` pass.
- All 27 browser checks pass in Chromium; the focused real-preview/output group contains 4 checks.
- The existing preview graph remains the single source media clock.
- No input `File.arrayBuffer()`/`bytes()` path was introduced.

Reviewers should search `rg -n 'TODO\(I-[0-9]+\):|BLOCKED\(I-[0-9]+\):|LEAKY ABSTRACTION:' src scripts tests` and inspect the I-006 `LEAKY ABSTRACTION:` markers in `src/media/processed-output.ts` and `src/main.ts` against this package. The output path is bounded by an 8 MiB pending-write queue and a 64 MiB non-OPFS fallback cap.
