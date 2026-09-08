---
title: "Sources"
version: "2.1"
status: reviewed-draft
updated: 2026-09-08
tags:
  - audio-workstation
  - specification
---

# Sources

The supplied user review and v2.0 specification are the product source. External references support technical corrections; they do not establish that a candidate artifact, license, performance target, or browser configuration has been validated.

Primary technical references consulted through **2026-09-08**:

| Reference | Used for |
| --- | --- |
| [Web Audio API specification](https://webaudio.github.io/web-audio-api/) | AudioBuffer/offline rendering, node behavior, scheduling and compressor limitations |
| [Demucs upstream repository](https://github.com/facebookresearch/demucs) | Music separation, HTDemucs family and documented maximum segment length |
| [ONNX Runtime Web documentation](https://onnxruntime.ai/docs/tutorials/web/) | Browser runtime integration and provider qualification starting point |
| [ONNX Runtime environment flags and session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) | Runtime artifact configuration, WASM threading and deployment requirements |
| [ONNX Runtime performance diagnosis](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html) | Provider-specific profiling and multithread isolation requirements |
| [Silero VAD releases](https://github.com/snakers4/silero-vad/releases) | Version-dependent sample rate and fixed input-window contracts |
| [OPFS, Chrome developer guidance](https://web.dev/articles/origin-private-file-system) | Origin-private storage and worker-oriented file access |
| [Storage for the web, browser developer guidance](https://web.dev/articles/storage-for-the-web) | Storage selection, quota and persistence considerations |
| [Service worker lifecycle, browser developer guidance](https://web.dev/articles/service-worker-lifecycle?hl=en) | Install/wait/activate lifecycle and coherent version transitions |
| [RNNoise upstream](https://github.com/xiph/rnnoise) | Enhancement candidate and starting point for artifact-specific license/runtime review |
| [Chrome WebGPU troubleshooting](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) | Secure-context, adapter, GPU acceleration, platform and blocklist diagnostics |
| [GPU.requestAdapter on MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPU/requestAdapter) | Adapter selection, null/fallback behavior, features and limits |
| [ONNX Runtime WebGPU guide](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) | Browser WebGPU inference runtime, GPU buffers, graph capture, and lifecycle starting point |
| [Web Audio API 1.1: MediaElementAudioSourceNode and AudioWorklet](https://www.w3.org/TR/webaudio-1.1/) | A playing media element actively supplies worklet render quanta; media audio is resampled to the AudioContext rate; graph routing moves audibility to the destination path |
| [WHATWG HTML media elements](https://html.spec.whatwg.org/multipage/media.html) | Media playback clock, playback-rate behavior, audio playback state, autoplay promises, and local `File`/Blob media processing |
| [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay) | User-activation requirement and recoverable `AudioContext`/media start behavior |
| [Chrome background-tab policy](https://developer.chrome.com/blog/background_tabs) | Silent audio does not receive the audible-audio background throttling exemption, so suspended/background behavior must be measured and communicated |
| [LibAV.js v6.10.9.0 source and configurations](https://github.com/Yahweasel/libav.js/tree/v6.10.9.0) | Deferred direct-worker FFmpeg fallback, block-reader API, versioned build artifacts, licensing, and exact `aac-af` source configuration |
| [MP4Box.js v2.4.1 source](https://github.com/gpac/mp4box.js/tree/v2.4.1) | Progressive MP4 parsing/sample extraction candidate for a WebCodecs route; it does not itself decode AAC to PCM |
| [WebCodecs specification](https://www.w3.org/TR/webcodecs/) | Optional demux/decode fast-path interfaces, queue backpressure, and the fact that codec implementations remain user-agent capabilities |
| [Mediabunny source](https://github.com/Vanilagy/mediabunny) | Streaming media toolkit comparison; current browser decode path relies on WebCodecs |
| [ffmpeg.wasm usage documentation](https://ffmpegwasm.netlify.app/docs/getting-started/usage/) | Rejected broad fallback's core download and whole virtual-file input/output usage |

Pin upstream commits, model binaries, runtime packages, and license files when selecting implementation artifacts. Dynamic upstream documentation is not a substitute for reproducible versioned evidence. In particular, no exact HTDemucs ONNX package, DeepFilterNet package, decoder, or limiter has been selected or audited here.

Design proposals such as the resource reservations, page sizes, stereo matrix policy, loudness preset, and export semantics are identified in the relevant notes; they are not attributed to upstream sources. See [[Review Resolution Log]] and [[Open Decisions]].
