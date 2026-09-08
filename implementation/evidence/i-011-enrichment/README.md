# I-011 bounded chunk enrichment evidence

This slice implements the canonical 48 kHz stereo planar page reader/writer contract in `src/processing/chunk-enrichment.ts`. It accepts the frozen preview high-pass frequency/Q, presence frequency/gain, compressor threshold/ratio, mid/side width, and output gain; defaults remain conservative when no preview snapshot is supplied. It applies linked-stereo bounded dynamics and a -1 dB sample-peak safety clamp. Filter and envelope state remains continuous across page boundaries and the writer receives one bounded output page per input page. The dynamics stage derives attenuation from its envelope and never boosts an instantaneous sample merely because the release envelope remains above threshold.

The module validates contiguous ordered pages, finite samples, safe frame counts, the 900 second total limit, and both valid length and backing-array allocation against the five second page limit. Cancellation and stale generation checks run before processing, before writing, after writing, before close, and after close; stale or cancelled jobs reject and request writer cleanup. The writer adapter remains responsible for making close/commit atomic and generation-safe. Progress is emitted only after a page write resolves.

Focused tests cover page boundaries and EOF, state continuity, no-boost and linked-stereo dynamics, progress, cancellation, stale generations including close races, malformed page ordering, valid and allocated page limits, non-finite PCM, and canonical input validation. The JavaScript sample loop is a deliberate MVP seam marked `LEAKY ABSTRACTION:` in the module; a future worker/WASM renderer must preserve the same bounded paging, state, cancellation, generation, and output contracts.

The I-013 integration passes the accepted preview mapping into this renderer and runs it inside a dedicated worker. The native preview compressor and deterministic batch envelope are perceptually aligned but not numerically identical. This evidence proves sample-peak safety only; it does not claim a true-peak limiter, loudness normalization, neural denoising, dereverberation, or separated stems.

The accepted preview and batch renderer now carry the peaking filter Q explicitly and both use `0.8`; the parity test covers the complete frozen mapping instead of allowing the batch path to retain an unrelated hard-coded Q.

Validation commands:

```sh
bun x vitest run src/processing/chunk-enrichment.test.ts
bun run typecheck
bun x prettier --check src/processing/chunk-enrichment.ts src/processing/chunk-enrichment.test.ts
```
