---
title: "Glossary"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Glossary

| Term | Meaning in this specification |
| --- | --- |
| Asset | Stored PCM or analysis object; there can be more assets than visible buses. |
| Bus / visible stem | One of the four user-facing mix paths. |
| Canonical frame | One time position at 48 kHz containing one sample per channel. |
| Sample | A scalar channel value; stereo frames contain two samples. |
| PCM | Pulse-code modulation; working Float32 and final integer WAV are distinct representations. |
| dBFS | Level relative to digital full scale; distinguish sample peak from reconstructed true peak. |
| dBTP | True-peak level accounting for intersample reconstruction. |
| LUFS | Loudness units relative to full scale; integrated loudness summarizes a program using a specified measurement method. |
| TPDF | Triangular probability density function; the final quantizer's proposed dither distribution. |
| Mid/side | Mid is `(L+R)/2`; side is `(L-R)/2`. Width scales side while preserving mid. |
| VAD | Voice activity detection; cached probabilities become speech intervals under a user threshold. |
| OLA | Overlap-add; combines overlapping output windows with explicit weight normalization. |
| OPFS | Origin Private File System; browser-managed local files, subject to origin storage policies. |
| IndexedDB | Transactional browser database used for metadata and qualified binary fallbacks. |
| Service worker | Origin-scoped worker that can serve cached application assets and handle offline navigation. |
| AudioWorklet | Processor running in the Web Audio rendering environment with strict real-time constraints. |
| Execution provider | Runtime backend such as WebGPU or WASM. |
| Cross-origin isolation | Deployment/browser state needed for certain shared-memory and multithreading capabilities. |
| Checkpoint | Committed data plus sufficient state/version information to resume or deterministically recompute work. |
| Generation ID | Identifier that invalidates stale playback packets and automation after seek/cancel/restart. |
| Algorithmic delay | Signal displacement caused by framing, filters, lookahead, or model processing; distinct from computation wall time. |
| Real-time factor | Processing wall time divided by audio duration; below 1 means faster than real time. |
| MB / GB | Decimal 10^6 / 10^9 bytes throughout memory calculations. |

See [[Ingestion and Timeline]] for timing contracts and [[Home]] for the full map.
