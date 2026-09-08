---
title: "Test Environments"
version: "2.1"
status: active
updated: 2026-09-06
tags:
  - audio-workstation
  - validation
  - hardware
---

# Test Environments

The initial evidence comes from two real machines: this laptop and a home server. Hardware inventory does not equal browser capability. Record browser adapter/device probes and exact model results independently.

## E-01 — laptop baseline

Observed from the implementation environment on 2026-09-06:

| Field | Observed value |
| --- | --- |
| Host | `astronomy-domine` |
| OS/kernel | Manjaro Linux, kernel `6.18.45-1-MANJARO`, x86-64 |
| CPU/APU | AMD Ryzen 7 PRO 3700U, 4 cores / 8 threads |
| Graphics | Radeon Vega Mobile / Picasso-Raven (`1002:15d8`), `amdgpu` kernel driver |
| Memory | 14,180,344 kB reported by `/proc/meminfo` (about 13.5 GiB) |
| Browsers found | Chromium 152.0.7977.82; Firefox 155.0 |
| Vulkan probe in current agent environment | Radeon ICD file exists, but `vulkaninfo` could not enumerate a physical device; `/dev/dri` is absent and no display is available in this sandbox |

This environment proves the laptop has an AMD integrated GPU and driver module. It does **not** prove WebGPU is available to the interactive browser. The failed command-line Vulkan probe may reflect this agent/container device boundary rather than the desktop browser.

The Vega APU can be selected by WebGPU only if the interactive browser exposes `navigator.gpu`, `requestAdapter()` returns an adapter, device creation succeeds, and the browser/driver has not blocked it. Linux Chromium WebGPU may require platform-specific Vulkan support or flags depending on the shipped browser configuration; test the normal user configuration before any experimental flags. WebGPU is also usable for compute, not only graphics, but the exact ONNX graph must still pass operator, correctness, memory, and sustained-load gates. See [Chrome WebGPU troubleshooting](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) and [GPU.requestAdapter](https://developer.mozilla.org/en-US/docs/Web/API/GPU/requestAdapter).

## E-02 — NVIDIA home server

Inventory is pending because no `home-server` host alias or connection was available in the current environment. Record hostname, OS, CPU, RAM, exact NVIDIA GPU, driver, Vulkan availability, browser/version, display/headless mode, and WebGPU adapter limits before testing.

Serving the PWA from the home server and opening it on the laptop still runs ONNX Runtime Web on the **laptop**. To test the NVIDIA GPU within the current privacy/client-side architecture, run the browser on the home server itself—locally, through remote desktop, or through a supported headless browser WebGPU setup—and execute the test page there. The browser process must have access to the NVIDIA device.

A Python/native ONNX Runtime CUDA service on the home server would be a different backend architecture. It would transfer audio from the browser device to another machine, even over the LAN, and therefore requires a new ADR, privacy boundary, security design, failure model, and explicit product decision. It is not a fallback for the current PWA.

## Browser probe artifact

Add a local diagnostic route before model integration. It must export a JSON report without remote telemetry:

- app/build ID, secure-context and cross-origin-isolation state;
- browser user agent/version supplied by the environment;
- logical CPU count and storage estimate/persistence status;
- AudioContext requested/actual sample rate and AudioWorklet availability;
- OPFS, worker access-handle, IndexedDB, service worker, SharedArrayBuffer and WASM feature status;
- `navigator.gpu` presence, adapter acquisition outcome, fallback status where exposed, adapter features and limits, device creation, a small correctness compute shader, and device-loss event handling;
- ONNX Runtime Web/runtime/artifact versions and model-specific probe results only after those packages are pinned.

Do not expose raw high-entropy adapter details in routine UI or transmit the report. The diagnostic is user-invoked and local/exportable.

## I-002 — in-app browser diagnostic (2026-09-07)

The local Vite app was opened at `http://127.0.0.1:4173/` in the Codex in-app browser and the user-invoked diagnostic was run once. Exact visible result:

| Check | Result |
| --- | --- |
| Browser identity | Chromium/Chrome `152.0.0.0` on Linux x86-64 (`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36`) |
| Secure context | Available (`true`) on localhost |
| Cross-origin isolated | Unavailable (`false`) |
| Logical CPU count | Available (`8`) |
| SharedArrayBuffer | Unavailable |
| WebAssembly validation | Available |
| Storage estimate/persistence | Available; latest Chrome run rendered `0 used / 10737418240 quota`; persistence API reported `true` in the earlier in-app run |
| OPFS | Available |
| IndexedDB | Available |
| Service worker API | Available |
| AudioContext | Available; actual sample rate `48000 Hz` |
| AudioWorklet | Available |
| WebGPU API | Available (`navigator.gpu` exposed) |
| WebGPU adapter | Unavailable; `requestAdapter()` returned `null` |
| WebGPU device/compute | Not attempted because no adapter was returned |
| ONNX model qualification | Unknown/not tested; no ONNX Runtime integration exists yet |

This is evidence for the browser session and current in-app environment only. It does not prove that the laptop's interactive desktop browser cannot use the Radeon Vega APU. The current agent browser has no adapter; a hands-on run in the user's normal browser and a browser run on the home server remain required.

## Test order on each machine

1. Run the capability probe in a normal secure browser session with default flags.
2. Run WASM single-thread, then SIMD, then multithread/isolation checks independently.
3. Run a small WebGPU compute correctness test if an adapter exists.
4. Run each exact ONNX model with valid shapes and compare against reference output.
5. Measure cold/warm startup, peak working set, per-chunk and sustained real-time factor, UI responsiveness, and device loss.
6. Repeat with 2-, 10-, and 15-minute project fixtures only after admission predicts they fit.
7. Run cached cold-offline startup and failure recovery.
8. Record passing configurations; fallback is accepted only if independently correct and within budget.

## TC-LOCAL-001 — primary private media testcase

The user designated a private local MP4 as the primary end-to-end testcase on 2026-09-07. Do not copy, commit, upload, hash, or expose its filename/path. The local ignored testcase registry maps the ID to the source path for this machine.

Read-only `ffprobe` metadata:

| Field | Observed value |
| --- | --- |
| Container/size | ISO BMFF MP4; 54,636,200 bytes |
| Program duration/bitrate | 533.010658 s; about 820 kb/s |
| Picture | H.264 Baseline, 1024×576, yuv420p, approximately 23.98 fps, 532.990000 s |
| Audio | AAC-LC, 44.1 kHz stereo, about 59.2 kb/s, 533.010658 s |
| Boundary case | Audio duration is about 20.7 ms longer than picture duration; validate explicit EOF alignment/trim behavior |

I-003 may use these numbers as synthetic UI fixture metadata without reading the content. Production media work later uses bounded reads under [[Ingestion and Timeline]] and records only derived aggregate evidence approved for the repository.

ONNX Runtime Web states that WASM supports all ONNX operators while WebGPU supports a subset, so WebGPU adapter success cannot replace per-model qualification: [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/). See [[Validation Plan]] V-02/V-07/V-09 and [[ADR 002 - Inference Backends]].
