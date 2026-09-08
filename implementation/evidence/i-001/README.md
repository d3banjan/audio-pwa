# I-001 foundation and domain primitives

Status: implemented and architecture-reviewed. Astra's closure review found no remaining critical, high, or medium foundation issue. Astra UX acceptance remains reserved for the final release candidate.

Date: 2026-09-07  
Requirements: FR-4, FR-9, NFR-1, NFR-2, NFR-4, NFR-5, NFR-8  
Validation gates touched: V-02, V-04, V-07, V-08, V-10

## Outcome

This increment provides the TypeScript/Vite foundation, local capability diagnostic, immutable generated app shell, separate device/project lifecycle state, and pure canonical timeline, resource-admission, and VAD interval primitives. It does not decode or process audio, install models, page projects through OPFS, play stems, or export audio.

## Architecture remediation

1. The Vite build generates a release-hashed service worker precache containing `index.html`, emitted hashed JavaScript/CSS, manifest, and icon. UI readiness requires a successful worker cache-verification response.
2. Shell fetches use an exact named cache and generated allowlist. Cache ownership includes the full registration scope. Controlled navigation always serves controller-version cached HTML. Awaited misses return explicit online/offline failures. Updates wait at the browser lifecycle boundary; there is no `skipWaiting()` or `clients.claim()`.
3. Device shell/model readiness is independent from project operation. Cache verification, current-document control, and waiting-update state/release are separate and observed through `updatefound` and `controllerchange`. Project, job, and transport transitions cover validation, pause/resume, cancellation, recovery, buffering, and export. Cancel-pending validation rejects late results and returns to unvalidated source selection. Async results require matching opaque UUID IDs and generation.
4. Format, type, unit, browser, and release scripts exist. UI controls and live regions remain stable across state updates, the hidden file input has a visible focus indicator, and invalid file selection can recover on the next choice.

Relative build assets and runtime-derived service-worker URL/scope support GitHub Pages repository subpaths. No research-only HTDemucs model or other model weight is bundled.

## Verification

Commands:

```sh
bun run format:check
bun run typecheck
bun run test
bun run build
node scripts/verify-release.mjs
```

Latest verification: Prettier passed; strict TypeScript passed; 40 unit tests passed across seven files; the Obsidian wiki passed link verification; production Vite build passed; static release verification passed. After correcting first-install/update classification, the deterministic Playwright suite ran in system Chromium through privileged localhost port 4179 and all five scenarios passed in 8.7 seconds. Root independently repeated all five scenarios on port 4180 in 8.6 seconds. Coverage includes the `/audio-pwa/` Pages subpath, controller-version old-tab behavior, safe two-release activation, same-context offline reload, sibling-scope cache isolation, missing documents/assets, and focus/input recovery. Cold browser restart remains a later validation gate. `PLAYWRIGHT_EXECUTABLE_PATH` selects a different browser binary.

Astra's final architecture closure independently passed formatting, TypeScript, 40 unit tests, wiki-link verification, and static release verification, and accepted the reported browser evidence. This closure is architecture review, not final UX acceptance.

Two earlier failures were corrected rather than waived. Fixture control requests retained a hard-coded port after the runner became configurable, so release 2 was never staged on the app's server. Separately, Chromium's cached offline navigation retained `navigator.onLine === true`; startup now makes a data-free same-origin HEAD probe outside the shell allowlist before claiming network availability.

## Invariants and limitations

- Audio intervals are immutable half-open ranges; rate mapping uses integer arithmetic and explicit boundary rounding.
- Resource admission uses decimal bytes and caller-supplied opaque-memory reservations.
- Extension checks are a UI guard only and never claim decoder/container validation.
- No audio, filename, capability result, PCM, model weight, or project data is sent over the network.
- These foundation scenarios do not complete full V-07/V-08 product qualification; model hydration, processing, sustained performance, and assistive-technology testing remain future gates.
- Low review findings about VAD diagnostic threshold range, documented rounding ties, and provisional dependency posture remain outside this bounded remediation.

See the source-of-truth notes: [[Offline PWA Lifecycle]], [[Frontend Architecture]], [[Boundary Contracts]], [[Validation Plan]], and [[Flat Project State Alternative]].
