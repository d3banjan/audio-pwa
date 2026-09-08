# I-003 experience prototype fixture journey

Status: implemented; startup DOM wiring, lifecycle/phase guards, recovery controls, source-kind labeling, and resource accounting are covered.

Date: 2026-09-08  
Environment: Chromium/Chromium-compatible Playwright harness via `pwa-fixture-server` at `http://127.0.0.1:4173/`

Requirements covered: FR-1, FR-2, FR-3, FR-7, FR-8, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, NFR-1, NFR-2, NFR-3, NFR-4, NFR-6

Source-of-truth package: [[Implementation Package I-003 - Experience Prototype]]

## Outcome

This package now ships a fixture-only experience prototype for the complete UX flow. The browser suite contains 15 I-003 scenarios plus 5 I-001 offline-shell scenarios, 20 total.

- local file metadata selection in a metadata-only path,
- audible-intention controls with dependable and experimental labels,
- region editing with fixture canonical-frame conversion,
- level-matched preview/source switching, A/B and undo,
- resource-profile cards with feasibility, blockers, separately labeled persistent and peak-temporary storage, RAM, and ETA bands,
- sequential bounded enhance simulation with cancellation,
- optional semantic acoustic-region inclusion toggle,
- assembled-preview state and explicit stem export inclusion controls (D-015),
- explicit fixture-disclosure visibility that cannot be accidentally hidden as a normal production status.
- real-file mode keeps the local preview, automatic audio preparation, and processed preview as the primary path; the simulated planning panel is hidden entirely and remains available only in explicit fixture mode.
- recoverable-error retry and reset controls, with reducer transitions preserving the failed plan snapshot.
- audio/video fixture labeling derived from the selected filename.
- cancellation advances both state machines together so a subsequent run uses a new generation; finished-mix inclusion is an explicit accessible export choice.
- export captures an immutable output snapshot at export start; declared profile blockers remain visible alongside capacity blockers.
- lifecycle transitions now pass through explicit compound coordinator commands (`SOURCE_REPLACED`, processing lifecycle, and export lifecycle), atomically applying paired project/experience events, enforcing shared generation identity, and validating active export job identity.
- reset-to-source is an explicit compound command preserving source identity while invalidating the committed mix and allowing a new enhance run; accepted export snapshots preserve the accepted plan profile, provider, model artifacts, measurement identity, and staleness status.
- fixture timing is represented by the typed `ExperienceDriver` seam (`src/lib/deterministic-driver.ts`) so future worker/OPFS drivers can replace it without changing UI contracts.
- The fixture driver owns enhance/export timers and is disposed on cancellation; `main.ts` contains no fixture lifecycle timers and only translates driver events through the coordinator.
- Source preparation now lives in the injected `deterministic-source-adapter.ts`; reducers consume only the typed prepared-source payload and contain no concrete adapter reference. Replacing the source adapter therefore leaves reducer and UI code unchanged.
- File admission is owned by the adapter's typed `prepare()` result, including explicit rejection reasons; the composition root passes accepted prepared profiles/capabilities/source identity into the coordinator.
- `src/lib/experience-state.test.ts` covers alternate adapter payloads with a normally unsupported extension, alternate profile IDs/order/feasibility, selected-profile preservation, and the stable rejection code/display message contract.
- resource plans and snapshots carry the Boundary Contracts version, fixture source identity/version, pipeline/model/measurement inputs, and explicit stale status; the deterministic source adapter exposes dereverb as unavailable with a visible explanation.
- cancellation/restart is covered by a browser journey test that starts, cancels, and reruns enhancement.

No real decode, ONNX inference, audio buffering, or file persistence occurs in this package.

## Verification run (post-change)

Commands executed:

```sh
bun run format:check
bun run typecheck
bun run test
bun run build
node scripts/verify-release.mjs
bun run wiki:check
bun run test:browser
```

Observed results after the Sol integrity pass:

- Prettier and type checks passed.
- 69 unit tests passed across 9 files (the exact current unit count).
- Vite production build passed and release verification accepted the generated shell asset invariants.
- Obsidian link verification passed.
- The parent task ran the complete Playwright suite in its permitted local-loopback environment after the command-only coordinator migration: all 20 scenarios passed in 45.1 seconds. The suite includes complete fixture processing/export, processing and export recovery, cancel/restart, completed-mix control and region edit/undo, output selection, exact resource presentation, focus preservation, active-state locking, audio/video metadata, empty-export handling, responsive/reduced-motion layout, and the existing offline-shell matrix.

Repair applied:

- Added the missing `#project-status` live output required by the startup DOM wiring and populated it from the project reducer message. This allows initialization to complete so `#connection-status` and `#project-phase` receive their initial values while preserving the I-001 offline shell and I-003 fixture contract.
- Added explicit export completion handling, synchronized processing cancellation with the project reducer, blocked mutable controls during active processing/export, and rejected unsafe progress values in the experience reducer.

Focused validation after these repairs: formatting, typecheck, 69 unit tests, production build, release verification, wiki verification, and all 20 browser scenarios pass.

## Limits and unimplemented backend capabilities

- No media decoding, chunking, DSP/ONNX execution, or export-file generation is implemented in this I-003 package.
- Run Enhance is a fixture simulation and explicitly states it does not run real inference.
- Acoustic-region controls only influence preview labeling; no production scene-analysis engine is hooked.
- Export action is a simulation endpoint for preview assembly and manifest selection only.
- The real processed-file path is owned by I-006; this package's planning/export controls remain intentionally simulated and are only exposed in explicit fixture mode.

## Final browser gate

The current integrated prototype passes 100 unit tests and 32 Chromium journeys. After Astra identified that the simulated planner was too prominent, real-file mode was changed to lead with the balanced processed preview and hide the demo planner entirely. Fixture mode keeps the planner open for interface testing. A fresh Astra browser pass verified the repaired desktop and 390 px layouts, truthful empty-cache copy, distinct progress names, and no horizontal overflow.
