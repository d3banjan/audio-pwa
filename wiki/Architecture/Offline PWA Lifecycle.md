---
title: "Offline PWA Lifecycle"
version: "2.2"
status: active-design
updated: 2026-09-07
tags:
  - audio-workstation
  - specification
---

# Offline PWA Lifecycle

## Readiness contract

“Offline ready” requires a controlled app shell, every required lazy code chunk, worker/worklet module, WASM runtime, decoder, model, configuration, font/icon, and manifest to be locally available and integrity-checked where applicable. Model caching alone is insufficient.

Deploy over a secure context, register a scoped service worker, and provide a web app manifest with local icons/start URL. Cache an offline navigation response. On a genuinely first-ever offline visit, no app code is available to show a custom fallback; the browser will show its network error. If a shell was cached but setup is incomplete, show which downloads need a connection.

## Versioned asset lifecycle

- Generate the service worker from the Vite production bundle. Precache `index.html`, every emitted content-hashed JavaScript/CSS asset, the manifest, and local icons in a release-hashed named cache. A missing asset fails installation.
- Use relative build assets and derive service-worker URL and scope at runtime. GitHub Pages repository subpaths such as `/audio-pwa/` are a required deployment target.
- Use cache-first serving for content-addressed code and runtime assets. Avoid independent stale-while-revalidate updates that mix incompatible application/runtime versions.
- Let updates wait until old clients close; do not use `skipWaiting()` or `clients.claim()`. On activation, remove only stale caches bearing the application-owned prefix.
- Serve only generated allowlisted URLs from the active named cache. Do not place arbitrary same-origin responses in the shell cache.
- Qualify cache ownership with the stable full registration scope before the release hash, so activation cannot delete a sibling GitHub Pages application's cache. Controlled navigations always receive the controlling worker's cached `index.html`, including while online; they never fetch a newer document into an older executable graph.
- Await every cache lookup. If controller-version HTML is missing, return an explicit error and require a safe close/reload boundary. A missing allowlisted content-addressed asset may use its exact URL while online; offline, return a typed shell error.
- Pair runtime, WASM, decoder, model, and preprocessing versions. A new model is downloaded into temporary storage, hash-verified, then atomically published in metadata.
- Treat hashes as integrity checks against a trusted release manifest; a hash supplied by the same untrusted download is not independent authenticity proof.

This follows the lifecycle's install/wait/activate behavior; see [service worker lifecycle](https://web.dev/articles/service-worker-lifecycle?hl=en).

## Persistence

Use OPFS for model binaries and PCM, with IndexedDB metadata and validated model-blob fallback. Request persistent storage; report whether it was granted. Both stores are subject to quota and possible removal; neither is a backup. Use the session-dependent capacity calculation in [[Memory and Storage]], not a fixed 1.5 GB threshold.

Downloads show bytes, package size, verification status, retry, and cancellation. Resume only if the server and integrity scheme support it; otherwise restart the affected package. Leave the last verified model usable until replacement commits. Corrupt models are marked invalid and redownloaded only when connected.

Recheck readiness on startup and after storage errors. Represent current-cache verification, current-document control, and waiting-update installation/verification as separate facts. Observe `updatefound` and `controllerchange`; never describe a waiting release as the release controlling the current document. An offline missing/corrupt asset blocks its dependent feature with a precise message, while already available local editing/export remains usable where possible.

## Deployment and privacy

The production target is a GitHub Pages project site. All application URLs, service-worker scope, navigation fallback, manifest paths, worker/worklet URLs, and precache entries must work under the repository base path rather than assume origin root. Preview and browser tests exercise the same base-path behavior.

WASM multithreading/shared rings may require cross-origin isolation. Configure and test COOP/COEP and resource CORS/CORP as appropriate, including service-worker-served responses. Bundle compatible runtimes and avoid CDN dependencies during normal operation. ONNX Runtime's [environment guidance](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) documents thread and artifact configuration.

Never send audio, filenames, probabilities, or waveforms over the network. Setup/update may fetch allowlisted assets. Diagnostics remain local unless the user explicitly exports them. Offline testing must use a cold browser restart and blocked network, not only the service worker's development toggle.

Treat `navigator.onLine` as a hint. On startup, verify network reachability with a same-origin, no-store shell request that is outside the precache allowlist; it carries no project or user data. A cached navigation alone cannot prove the network is online.

See [[ADR 005 - Offline Persistence]], [[User Experience and Recovery]], and V-07 in [[Validation Plan]].
