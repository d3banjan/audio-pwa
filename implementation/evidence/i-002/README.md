# I-002 browser capability diagnostic

Status: observed browser evidence; not a release gate.

Date: 2026-09-07  
Environment: Codex in-app browser, Chromium/Chrome `152.0.0.0`, Linux x86-64  
URL: local Vite app at `http://127.0.0.1:4173/`  
Action: clicked the user-visible “Run device diagnostics” control once.

## Exact result

| Check | Result |
| --- | --- |
| Secure context | Available (`true`) |
| Cross-origin isolated | Unavailable (`false`) |
| Logical CPU count | Available (`8`) |
| SharedArrayBuffer | Unavailable |
| WebAssembly validation | Available |
| Storage estimate/persistence | Available; latest Chrome run rendered `0 used / 10737418240 quota`; persistence API reported `true` in the earlier in-app run |
| OPFS | Available |
| IndexedDB | Available |
| Service worker API | Available |
| AudioContext actual sample rate | `48000 Hz` |
| AudioWorklet | Available |
| WebGPU API | Available (`navigator.gpu` exposed) |
| WebGPU adapter | Unavailable; `requestAdapter()` returned `null` |
| WebGPU device | Unavailable because no adapter was returned |
| WebGPU compute correctness | Not attempted because no adapter was returned |
| Device loss | No loss observed during the probe |
| ONNX qualification | Unknown/not tested; adapter/device checks are not ONNX operator qualification |

The browser user agent was:

```text
Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36
```

No audio, filenames, or report data were transmitted by the diagnostic. The report is held in the current tab only.

In the final Chrome smoke run, the service-worker API was available and the diagnostic completed, but the setup banner reported the shell as unavailable because the current development registration resolved `/src/service-worker.js` as HTML. This is separate from the capability probe and remains with the offline-shell integration owner.

## Limits

The diagnostic browser could not see a WebGPU adapter even though the host inventory identifies an AMD Radeon Vega APU. This may be caused by the agent/container/display boundary. It is not a definitive desktop-driver verdict. Re-run the same user action in the user's normal Chromium/Firefox session and on the home server's browser to test actual APU/NVIDIA execution.
