# I-007 ONNX runtime foundation evidence

Date: 2026-09-08

## Implemented scope

- `src/models/model-catalog.ts` defines the project-curated manifest contract: immutable artifact identity, pinned release and commit, exact byte count and SHA-256, separate code/weight licenses, conversion provenance, audio/tensor contracts, provider requirements, resource evidence, qualification state, and limitations.
- The first identity-audited entry is upstream Silero VAD `v6.2.1`, 16 kHz opset-15. Its single-thread WASM path has narrow reference parity; broad product qualification and UI compatibility claims remain disabled.
- `src/models/onnx-runtime.ts` is an injected, lazy runtime seam. Constructing or importing it does not download weights or load ONNX Runtime. Explicit invocation tries WebGPU and then WASM, records structured failures, and requires the caller's model-specific valid-shape/correctness probe before accepting a session. A session that fails its probe is released before fallback; if release fails, the seam fails closed with a structured teardown error and does not create the fallback provider.
- The follow-up execution package pins `onnxruntime-web@1.29.0`, adds its single-thread WASM binary plus upstream MIT and third-party notices, and stores the verified Silero artifact as a versioned offline asset. No UI change or network-at-import behavior was added.
- `StatefulSileroClassifier` accepts exactly 1,536 canonical mono frames, performs causal anti-aliased 3:1 decimation, maintains the upstream 64-sample context and `[2,1,128]` recurrent state, submits scalar int64 `sr=16000`, validates finite output shapes, and returns the canonical half-open source window. Cancelled or stale calls do not commit state.

## Artifact identity and license

| Field | Recorded value |
| --- | --- |
| Repository | `https://github.com/snakers4/silero-vad` |
| Release | `v6.2.1` |
| Commit | `7e30209a3e901f9842f81b225f3e93d8199902b1` |
| Path | `src/silero_vad/data/silero_vad_16k_op15.onnx` |
| Git blob | `625ad8909b1abdba2292f3a9a10db6864fd5d561` |
| Bytes | `1,289,603` |
| SHA-256 | `7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49` |
| Code and weights terms | Upstream repository MIT license; retain upstream notice |

The exact artifact was downloaded from the commit-pinned upstream raw URL, measured with `sha256sum` and `stat`, and then copied unchanged into `public/models/silero-vad-v6.2.1/` with its upstream notice and provenance. The upstream release/tag API identifies the full commit. The release's `model.py` selects this artifact for opset 15, and its `utils_vad.py` establishes the 16 kHz, 512-frame, 64-context, recurrent-state contract recorded in the catalog. Primary sources: [release](https://github.com/snakers4/silero-vad/releases/tag/v6.2.1), [license](https://github.com/snakers4/silero-vad/blob/7e30209a3e901f9842f81b225f3e93d8199902b1/LICENSE), [model loader](https://github.com/snakers4/silero-vad/blob/7e30209a3e901f9842f81b225f3e93d8199902b1/src/silero_vad/model.py), and [wrapper contract](https://github.com/snakers4/silero-vad/blob/7e30209a3e901f9842f81b225f3e93d8199902b1/src/silero_vad/utils_vad.py).

## Validation run

`bun x vitest run src/models` passes 16 focused contract tests. They cover the catalog/runtime seam plus exact decimation length, filter history, alias attenuation, model tensor contracts, recurrent carry, canonical alignment, cancellation transactionality, stale generation, invalid output, disposal, and tracked artifact checksum admission.

After integration settled, the full `bun run check`, production build, and release artifact verification passed: formatting, typecheck, all 166 unit tests, and the 56-note wiki link check.

The opt-in `RUN_SILERO_BROWSER_PROBE=1 bun run probe:silero` run loaded only same-origin assets and matched an independent Python ONNX Runtime 1.23.2 CPU reference:

| Stateful input | Python probability | Chromium WASM probability | Absolute difference |
| --- | ---: | ---: | ---: |
| First 1,536-frame silence window | 0.0016697943210601807 | 0.001669853925704956 | 0.0000000596046447753 |
| Following 1,536-frame 440 Hz window | 0.011689633131027222 | 0.011689633131027222 | 0 |

The Python runtime was installed only in `/tmp` and is not shipped. Headless Chromium exposed `navigator.gpu`, but `requestAdapter()` returned null, so WebGPU graph execution remains untested. The minimal shipped WASM is 13,961,845 bytes (`ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d`). npm records package integrity `sha512-LuQlpX6MFLJZu756erwUeb1mNfoJGbs1kzDwJGNlf5RvfYMdqhcY3vNpDPK40CUV2HoWTkIj+uS0o36GFHjeYw==` and MIT license. Bun blocked protobufjs's optional postinstall; real inference passed without trusting it.

The integrated production build contains exactly one single-thread WASM binary: Vite emits `ort-wasm-simd-threaded-*.wasm` at 13,961,845 bytes and the service worker precaches that content-hashed URL. The former duplicate `public/runtime/...wasm` copy was removed. The lazy ORT JavaScript is 72,435 bytes; the model plus its notice/provenance files are 1,291,199 bytes; runtime license/provenance files are 338,712 bytes. These model/runtime assets total 15,664,191 bytes before transfer compression. The integrated processing worker is a separate 46,197-byte asset. File names are content-hashed and may change without changing these measured byte counts.

## Remaining gate

The exact Silero graph has narrow single-thread WASM reference parity. Memory, sustained load, realistic speech calibration, end-to-end VAD interval alignment, offline cold restart, and the browser matrix remain before broad product qualification. WebGPU remains unqualified. The causal FIR has a declared 31-canonical-frame group delay that V-04 alignment must account for. EOF callers must zero-pad a partial final analysis window and clip the returned interval to the real project end.

Dialogue denoising/dereverberation and HTDemucs remain blocked on exact artifact and license/runtime evidence. Silero VAD performs segmentation only; it is not an enhancement model.
