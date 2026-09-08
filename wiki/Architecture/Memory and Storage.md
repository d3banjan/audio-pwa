---
title: "Memory and Storage"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Memory and Storage

## Budget scope

At 48 kHz, stereo Float32 audio consumes:

$$B = T \times 48000 \times 2 \times 4.$$

| Resident audio | 10 minutes | 15 minutes |
| --- | --- | --- |
| One stereo asset | 230.4 MB | 345.6 MB |
| Four output stems | 921.6 MB | 1,382.4 MB |
| Input + four stems + extra raw dialogue | 1,382.4 MB | 2,073.6 MB |

These figures exclude weights, inference scratch, decoder buffers, mix output, WASM heaps, and GPU allocations. Paging is required even before export. OfflineAudioContext produces floating-point AudioBuffers; integer encoding is a separate operation. Storing 16-bit PCM is not the baseline solution because it introduces intermediate quantization and does not remove inference memory.

## Proposed admission budget

The 1.5 GB ceiling is a release target on profiled configurations, not a runtime guarantee on every browser. A conservative reservation model must include opaque memory estimates from actual model/decoder measurements.

| Category | Provisional reservation |
| --- | ---: |
| Model weights, WASM/GPU session, inference scratch | 750 MB |
| Decoder and resampler working set | 150 MB |
| Playback, dialogue pair, paging, and overlap buffers | 150 MB |
| UI, workers, peaks, export encoder and misc. | 100 MB |
| Unallocated safety margin | 350 MB |
| Total | 1,500 MB |

These numbers are planning allocations, not measured facts. Decoding, inference, and export should normally run as separate heavy phases. Any model exceeding its reservation fails admission until a viable configuration is measured. The supplied “under 400 MB regardless of duration” claim is withdrawn.

## Storage contract

- Stream video and non-small audio source files into OPFS with bounded reads, writes, and backpressure. Never stage a complete video in a JS `ArrayBuffer`, WASM heap, or GPU buffer. A measured small audio-only input may use the explicitly admitted native whole-buffer decode path in [[Ingestion and Timeline]]; its compressed and decoded allocations count against the budget.
- Store canonical and intermediate PCM as immutable, bounded Float32 chunks; start with 5-second storage pages, independent of model windows.
- Index each chunk by asset ID, start frame, valid frames, channels, rate, format, checksum, and pipeline version.
- Commit data first, then atomically publish its manifest entry. Restart removes unreferenced partial chunks and resumes only from valid checkpoints.
- Preserve resampler/model state or recompute from a defined earlier checkpoint when restarting.
- Retain raw dialogue while its wet/dry control is available. Delete temporary Demucs components after final buses are durably committed, if no subsequent operation requires them.
- Prefetch approximately 5 seconds and retain approximately 1 second behind playback initially; tune using measured I/O. A 30-second window on either side is not a default requirement.
- Reserve buffers before allocation; bound all queues, evict distant clean pages, and release tensors/sessions as soon as possible.
- Schedule model windows chunk by chunk and use the highest measured safe concurrency for the selected provider without exceeding the reservation or starving the UI/audio threads.
- Store preview products under the same pipeline/settings identity as full-pass chunks. Promote or reuse them only when their overlap context and committed outputs are bitwise or tolerance-equivalent to the full scheduler; otherwise treat them as audition-only and recompute in sequence. Processing chunks remain scheduler/storage units; acoustic-scene regions are independent timeline metadata.
- The render thread consumes ready pages only. On starvation, use a short fade and enter buffering while preserving the common transport position.

## Capacity and recovery

Compute free space from models + retained project assets + current-stage temporary overlap + export + a proposed 20% reserve. Six 15-minute Float32 stereo assets alone occupy about 2.07 GB; a 1.5 GB free-space check is therefore insufficient. Model replacement may temporarily require two model versions. Storage estimates are advisory; every write must handle quota failures.

The preflight plan separates persistent and peak working resources. Persistent bytes include any OPFS source copy, pinned models, committed PCM/stems, metadata/peaks, temporary export, final output, and reserve. Peak working memory includes resident pages, model weights/session/scratch, decoder/resampler state, queues, and measured opaque browser/GPU overhead. Streamed video passthrough contributes source/output storage and I/O time but must not be counted as a whole-file RAM allocation.

ETA is a range calculated from a bounded local OPFS read/write calibration, model load/warm-up, measured per-chunk throughput for the selected provider, overlap/retry overhead, and output write/encode throughput. Persist the inputs and confidence of the estimate. Update it from observed progress without presenting it as a deadline.

OPFS is preferred. Capability-probe worker access handles and required read/write semantics. IndexedDB supports model blobs and metadata fallback; project paging through IndexedDB is supported only after throughput tests, otherwise offer a measured short-file mode or an unsupported-storage message.

Request persistent storage and disclose its result. OPFS and IndexedDB do not guarantee permanent retention; users or browsers can remove origin data. See [browser storage guidance](https://web.dev/articles/storage-for-the-web) and [OPFS documentation](https://web.dev/articles/origin-private-file-system).

There is no portable reliable total-memory monitor or catchable recovery from every tab OOM. Internal accounting, conservative admission, controlled concurrency, measured device limits, and durable checkpoints provide risk reduction. Catch recoverable allocation errors; do not promise to catch browser termination.

See [[ADR 003 - Memory and Paging]], [[Validation Plan]] V-02, and [[User Experience and Recovery]].
