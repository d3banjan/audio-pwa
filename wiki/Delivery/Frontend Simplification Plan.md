---
title: "Frontend Simplification Plan"
version: "1.0"
status: proposed
updated: 2026-09-08
tags:
  - audio-workstation
  - delivery
  - frontend
  - implementation
---

# Frontend Simplification Plan

## Outcome

Make the frontend small enough that an agent can understand a user action from DOM event to browser effect with one or two jumps. Preserve the correctness boundaries that prevent stale jobs, source replacement, and simulated output from corrupting or overstating the current project. Under D-022, I-008 remains planning-only until real media behavior is implemented and pinned by outermost behavioral tests. This plan does not authorize a behavior change or weaken I-004 media limits.

The current frontend has more coordination layers than its present behavior needs. `src/main.ts` is about 1,600 lines and owns markup, DOM references, rendering, event wiring, source inspection, fixture jobs, connectivity, and preview orchestration. The same workflow is represented again by `app-state.ts`, `experience-state.ts`, and `lifecycle-coordinator.ts`. Real preview adds a fourth state vocabulary, while `main.ts` also keeps mutable flags beside those stores. The result is several legal representations of one screen and a coordinator whose main job is translating paired events between two reducers.

## Current layer map

| Layer | Current responsibility | Simplification decision |
| --- | --- | --- |
| `main.ts` | Boot, full HTML template, element lookup, rendering, input handlers, import probing, fixture timers, shell/capability state, and preview synchronization | Split boot from the view and interaction controller. Remove workflow rules from DOM handlers. |
| `app-state.ts` | Project phase, jobs, generation, transport, recovery, and status copy | Merge its unique identity/job rules into one application reducer. Remove its duplicate phase and message track. |
| `experience-state.ts` | A second phase machine plus controls, profiles, regions, stems, processing/export jobs, snapshots, and fixture data | Keep the product data and pure calculations in the single reducer; move fixture constants/profile data to `fixtures.ts`. |
| `lifecycle-coordinator.ts` | Converts one command into paired project/experience events and rejects drift between both reducers | Remove after the unified reducer has equivalent identity and transition tests. Its atomicity becomes intrinsic because one event produces one state. |
| `deterministic-driver.ts` | Browser timers for simulated enhance/export progress | Move to `fixtures.ts` and expose two small start functions used only in fixture mode. |
| `deterministic-source-adapter.ts` | Wraps fixture source validation and profile construction behind an interface | Remove. Call the fixture preparation function directly. Introduce an interface only when a second production implementation needs the same contract. |
| `real-local-preview.ts` | Owns object URLs, media-element events, Web Audio nodes, playback, seek, and cleanup | Keep as the browser resource boundary. Reduce its public surface to `load`, `play`, `pause`, `seek`, `setMix`, `setComparison`, `dispose`, and one state callback. |
| `device-state.ts` / `offline-shell.ts` | Offline shell lifecycle and connection label | Keep as a leaf service; publish its result into the single app state. Do not route it through the media/workflow reducer. |
| `browser-capabilities.ts` | Explicit browser capability probe | Keep as a leaf service because it is independently testable and only runs on request. |

## State that must survive the collapse

The unified state must retain these invariants:

1. Every selected source gets an opaque `projectId` and a monotonically increasing safe `generation`. Every asynchronous media, processing, and export result carries both; a mismatch is ignored.
2. Processing and export each get an opaque `jobId`. Progress, completion, failure, cancellation, and retry are accepted only for the active matching job. Cancellation or source replacement invalidates late callbacks before changing visible state.
3. Source replacement pauses playback, disconnects the graph, revokes the prior object URL, clears active timers, and advances the generation. Media callbacks also retain the controller's source token so an old load cannot clear or publish over the new source.
4. Working controls and the last committed controls remain distinct. Undo restores the committed values. Starting processing captures an immutable plan snapshot; starting export captures an immutable output manifest. Later checkbox or control edits cannot alter an in-flight snapshot.
5. Phase and capability text remain honest. Fixture completion means only that the fixture workflow completed. Media-element readiness means only that the browser loaded the local source. Neither implies separated, rendered, or audible-ready stems.
6. Source content stays local. Browser playback should use an object URL and bounded browser-owned decode. Application code must not call `file.arrayBuffer()` or `decodeAudioData()` on the whole file merely to learn metadata. No source name, metadata, or bytes may enter a network request.
7. Existing focus restoration, live-region announcements, keyboard controls, reduced-motion behavior, and the verified 4.5:1 small-text color pairs remain acceptance checks.

## Target structure

```text
src/
  main.ts                 # boot only: create services, mount app, register shell
  app.ts                  # one state value, dispatch, effects, and event wiring
  state.ts                # AppState, AppEvent, initial state, one pure reducer
  view.ts                 # markup, typed element references, render(state)
  fixtures.ts             # I-003 fixture data and deterministic timers
  media/preview.ts        # object URL + media element + Web Audio ownership
  capabilities/browser-capabilities.ts
  offline-shell.ts
  styles.css
```

`AppState` should have one `phase`, one `message`, one project identity, optional active job, source metadata, working/committed controls, preview state, profiles, stems, and immutable plan/export snapshots. `dispatch(event)` runs the reducer once and then invokes a small effect switch for browser work. Browser callbacks dispatch ordinary identity-bearing events. The view reads only `AppState`; it does not infer a second phase from controller state.

Do not add a generic store, event bus, dependency container, base controller, repository interface, or component framework during this migration. Plain functions and explicit imports are enough at the current scale.

## Staged migration

### 1. Freeze behavior with characterization checks

Add a compact browser journey covering select, play/pause/seek, source/preview switch, enhance progress/cancel/retry, edit/undo, export snapshot, source replacement, and a late callback from the replaced generation. Keep the current unit checks for identity, stale job rejection, snapshots, object URL revocation, and fixture-only copy. Run typecheck, unit, wiki, and focused browser checks before structural edits.

### 2. Introduce the unified reducer behind the current view

Create `state.ts` by composing the data that is currently split across project and experience state. Port one transition at a time, beginning with source selection and identity, then processing, editing/undo, export, and reset. For each group, run reducer tests that compare the old and new observable state for valid, invalid, stale, cancelled, and failed events. Keep `main.ts` rendering the same DOM during this stage.

Exit check: every user event has one reducer event and one authoritative phase/message; fixture completion and buffering tests still require UI-only copy.

### 3. Remove the duplicate reducers and coordinator

Switch handlers to `dispatch(AppEvent)`. Delete `app-state.ts`, `experience-state.ts`, and `lifecycle-coordinator.ts` once all callers and tests use `state.ts`. Move pure frame/profile/export helpers that remain useful into `state.ts` or a narrowly named domain helper only when they are used from more than one module.

Exit check: stale project/generation/job events return the same state object, cancellation invalidates late completion, working/committed controls undo correctly, and plan/export snapshots cannot be mutated by later edits.

### 4. Separate view code from effects

Move the HTML template, element lookup, dynamic profile/stem rendering, and focus restoration to `view.ts`. Keep listeners in `app.ts`, grouped by the screen control they serve. Replace the broad `updateUi()` routine with one `render(state)` call; rendering must not start media, timers, capability probes, or service-worker work.

Exit check: the existing keyboard, narrow viewport, reduced-motion, live-region, and contrast browser checks pass without changed labels or focus order.

### 5. Narrow the browser services

Keep `media/preview.ts` as the sole owner of the media element, object URL, Web Audio graph, and source token. Remove the full-file `arrayBuffer()` / `decodeAudioData()` metadata probe from `main.ts`; take duration, dimensions, and browser decode success from the media element, and treat unavailable codec/sample-rate detail as unknown. Fold deterministic source preparation and timers into `fixtures.ts`. Leave offline-shell and capability probing as direct leaf services.

Exit check: a source-replacement test proves pause/disconnect/revoke and rejects an old `loadedmetadata` callback; a browser test spies on `File.prototype.arrayBuffer` and verifies it is not called during import; network inspection shows no source-derived request.

### 6. Delete compatibility scaffolding and record evidence

Remove old adapters, paired-event types, duplicated messages, unreachable compatibility branches, and tests that only mirror deleted translation code. Record before/after line counts, module graph, focused browser results, full checks, known browser variance, and remaining markers under `implementation/evidence/i-008/`.

Exit check: the complete flow is traceable from a DOM listener to `dispatch`, reducer, render, and at most one browser service; full release checks pass; no orphan marker or tracker row remains.

## Searchable comments under D-021

Use only these exact prefixes in live code:

```text
TODO(I-008):
LEAKY ABSTRACTION:
```

During migration, place `TODO(I-008):` only on a concrete compatibility branch that will be removed in a named later stage. Remove the marker with that branch. Do not leave narrative future-work comments outside the exact form because the tracker query cannot find them.

Keep `LEAKY ABSTRACTION:` at the actual browser seam, not in a reducer or an empty callback. Each marker must say, in one concise comment, what browser behavior leaks, why it is temporarily accepted, the resource or failure bound, what a replacement must preserve, and end with `[[Implementation Package I-004 - Real Local Preview]]` or this plan as the owning wiki note. This makes the seam immediately searchable and prevents browser-specific assumptions from spreading into state and view code.

The current comment inventory needs correction before or during Stage 5:

- The two `app-state.ts` fixture comments use the exact searchable prefix and accurately deny rendered or audible-ready stems. They still omit why the leak is accepted, the replacement-preservation clause, and the owning I-003 package name. They should either become ordinary fixture-contract comments or satisfy the complete D-021 marker contract.
- The `experience-state.ts` canonical-timeline marker uses the right prefix but omits the owning package and the replacement-preservation clause.
- The `main.ts` metadata marker does not state a resource bound or owning package. The adjacent `decodeAudioData` marker is factually unsafe: `file.arrayBuffer()` plus `decodeAudioData()` performs a whole-file application allocation and full decode even if only sample rate/channel count are read afterward. D-021 cannot legitimize that path.
- The `main.ts` “metadata-only previewing” marker is not at the browser seam and is inaccurate once real object-URL playback and Web Audio preview run.
- The `real-local-preview.ts` marker inside an empty `finally` block is not attached to operative behavior. The boundary belongs beside media-element load/readiness handling. The cleanup marker is at the correct catch seam, but swallowed cleanup failures need an explicit bounded fallback or report rather than only a marker.

## Definition of done for I-008

- One authoritative workflow state and reducer replace the project/experience/coordinator trio.
- `main.ts` is boot code; `view.ts` renders; `app.ts` owns direct interaction effects.
- Media, offline shell, and capability probe remain small leaf boundaries without wrapper layers.
- The identity, stale-event, cancellation, source-token, snapshot, privacy, focus, and accessibility invariants above have focused checks.
- No whole-file application allocation occurs during import or preview.
- Every live marker is returned by the exact query in [[Implementation TODOs]], has one owning tracker row, and its wording satisfies D-021.
- I-001, I-003, and I-004 behavior checks and the full release check pass.

See [[Implementation TODOs]], [[Implementation Playbook]], [[Decision Log]], [[Implementation Package I-003 - Experience Prototype]], and [[Implementation Package I-004 - Real Local Preview]].
