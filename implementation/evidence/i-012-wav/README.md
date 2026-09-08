# I-012 processed reader and WAV artifact evidence

Date: 2026-09-08

## Implemented scope

The committed processed-result reader now revalidates both current pointers and the immutable source/result manifests before every bounded OPFS page read. It rejects result-pointer replacement, source-pointer replacement, same-run source-generation mutation, same-ID processed-generation mutation, total-frame mismatch, truncated bytes, and FNV-1a page corruption. FNV-1a is accidental-corruption detection rather than artifact authentication.

`exportPcm24Wav` writes canonical 48 kHz stereo signed PCM24 in bounded pages, with TPDF dither and a final RIFF header patch. Cancellation is checked after every awaited sink write, including the last data page, so cancellation cannot race into a successful header patch and close. Failure always asks the sink to abort.

`createBrowserWavArtifact` requires the exact committed `expectedResultId`; a different current result fails and removes the staged export. It writes to `processed-exports` in OPFS, exposes the completed snapshot as an `audio/wav` Blob without assembling the file in JavaScript, provides a sanitized download name, and removes the OPFS file on `dispose()`.

## Automated and browser evidence

The focused reader/export suite passes 20 tests. Added cases cover processed-byte corruption, same-ID source and processed generation replacement, invalid totals, pre-read cancellation, and cancellation during the final page write.

After the parallel I-013 integration settled, the repository typecheck, all 174 unit tests, and the 57-note wiki link check passed.

The opt-in real browser probe is:

```sh
RUN_WAV_BROWSER_PROBE=1 bun run probe:wav
```

Chromium created a 4,800-frame artifact through real IndexedDB and OPFS. Observed results:

| Property | Result |
| --- | --- |
| Replacement result ID | Rejected; zero staged export files |
| Cancellation after first page | `AbortError`; zero staged export files |
| MIME | `audio/wav` |
| File size | 28,844 bytes (`44 + 4,800 * 2 * 3`) |
| Header | RIFF/WAVE, PCM24, stereo, 48,000 Hz, 28,800 data bytes |
| Chromium media load | `loadedmetadata` with finite positive duration |
| Before/after `dispose()` | One OPFS file / zero OPFS files |
| Network boundary | Same-origin page/module and local Blob URL only |

The probe has 30-second stage bounds and guaranteed Vite/Chromium cleanup.

## Explicit limits

This is a sample-peak prototype. The upstream enrichment slice clamps canonical Float32 samples to -1 dBFS sample peak. This evidence does not establish an oversampled true-peak limiter, dBTP ceiling, loudness normalization, post-quantization true-peak verification, listening quality, 15-minute memory behavior, broad browser support, or a production save destination. Those remain V-02/V-06/V-09 gates.
