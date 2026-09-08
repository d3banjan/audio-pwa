---
title: "Implementation Playbook"
version: "2.1"
status: active
updated: 2026-09-06
tags:
  - audio-workstation
  - delivery
---

# Implementation Playbook

This note is the operational contract for turning the wiki into software. The wiki is the source of truth; code/spec disagreement means the work is incomplete. [[Experience Principles]] defines the product priority: establish and validate the expectation-setting UI contract before dependent backend optimization. This note makes ownership, ordering, evidence, and stop conditions explicit. Product requirements remain in [[Requirements]]; this playbook does not weaken them. Decision and archive changes follow [[Decision Lifecycle]].

## Roles and sequence

| Role | Model | Responsibility | May approve its own work? |
| --- | --- | --- | --- |
| Implementer | Spark | Implement one ready, bounded package against its accepted experience and boundary contracts | No |
| Verification pass | Luna | Run focused checks, inspect edge/failure behavior, and return bugs without broadening scope | No |
| Integration/architecture pass | Terra | Integrate the package, verify cross-boundary/state/resource design, and resolve integration defects through a new implementation loop | No |
| Technical reviewer | Sol | Review correctness, security/privacy, resource bounds, test quality, dependency posture, and spec consistency | No |
| Browser bug-finding | Astra | Exercise the runnable app through browser control; find UX, accessibility, recovery, and browser-integration bugs with reproduction evidence | No; final holistic UX acceptance remains a separate release gate |
| Primary integrator | Root agent | Package definition, conflict resolution, verification, decision log, and final handoff | Must preserve reviewer independence |

The preferred stages run in order for each implementation package: Spark → Luna → Terra → Sol → Astra. A defect returns to the implementer with a bounded reproduction; the revised package repeats every independent downstream stage. Independent packages may run concurrently only when file/data ownership does not overlap. Every package has one named owner.

Under D-017, if Spark is unavailable, the primary integrator chooses the lowest available adequate implementer from the package's actual complexity and proceeds. Luna normally handles bounded/simple modules; Terra handles architecture-heavy integration. The implementer cannot review itself: omit its named review stage, retain the other independent Luna/Terra pass where useful, retain Sol as technical reviewer whenever possible, and retain Astra browser bug-finding for user-visible work. If Sol must implement because no lower model is adequate, assign an independent technical review before Astra rather than treating Sol's result as reviewed.

## Work-package template

Every implementation package must state all fields before coding:

1. **ID and user-visible outcome.** One bounded capability, expressed in observable behavior.
2. **Inputs and outputs.** Types, units, sample rates, frame-interval convention, ownership, persistence, and error representation.
3. **Dependencies.** Previous packages and unresolved [[Open Decisions]].
4. **Scope exclusions.** Capabilities the package must not imply or simulate.
5. **Resource budget.** Maximum resident bytes, queue depth, storage growth, and main/audio-thread work where applicable.
6. **Failure behavior.** Invalid input, cancellation, stale generation, quota/allocation failure, restart, and unsupported capability.
7. **Acceptance checks.** Requirement IDs, validation gate IDs, deterministic fixtures, boundary cases, and exact commands.
8. **Evidence artifact.** A record under `implementation/evidence/<package-id>/` containing environment, commands, results, limitations, and relevant hashes.
9. **Rollback boundary.** Files/data schema affected and how the previous committed project remains readable.
10. **Owner and reviewers.** Name the Spark implementer and the Luna, Terra, Sol, and Astra stages. Astra browser evidence is required for user-visible/browser behavior. Final Astra UX acceptance is assigned only to the complete release candidate.

For a user-facing feature, the package begins with its experience contract: audible intention, preview fixture, A/B and undo behavior, honest pending/unsupported/failure states, accessibility language, and evidence that the control causes the expected perceptual direction. Backend implementation then replaces fixtures behind the same typed boundary. Fixture mode is visibly development/test-only and can never report a real project as processed.

If a required decision is unresolved, implement an interface or experiment behind a capability state. Do not pick a production dependency by convenience, embed unlicensed weights, or expose a UI success state for a stub.

For remaining engineering choices, D-019 authorizes the primary integrator to choose and continue when more than one option satisfies the accepted contracts and gates. Prefer the smallest measured download, working set, storage footprint, and implementation surface. Record the load-bearing reason and archive rejected detail. Escalate only when variants change an accepted user outcome, cannot meet a required quality/privacy/safety/right-to-distribute gate, or lack enough evidence for a bounded experiment.

## Leaky abstraction markers

Keep each vertical slice direct. When a browser or platform constraint leaks through a nominal boundary, add a short comment at that exact seam beginning with `LEAKY ABSTRACTION:`. State what leaks, why the MVP accepts it, the relevant resource or failure limit, and what behavior a later replacement must preserve. End with the owning wiki package name. Put comparisons and refactor detail in the wiki/evidence rather than duplicating them in code.

## Repair-loop limit

Use Luna as the default implementation model. An implementation agent gets at most three unsuccessful repair attempts for the same failing behavior. After the third attempt, stop editing and return the exact blocker, observed evidence, and attempted fixes to the primary agent. The primary agent must then narrow or redesign the repair, or escalate guidance and implementation to Terra or Sol. A new attempt starts only after that guidance changes the approach. Keep final review independent from the implementation pass.

Do not use a marker to normalize an unbounded allocation, source/network privacy leak, fabricated success, swallowed failure, or a dependency without acceptable rights. Those conditions still block the package.

## Definition of ready

A package is ready only when:

- its requirement and architecture links are named;
- algorithms use explicit units and interval/rounding conventions;
- external artifacts have a version, source, and license-audit task;
- success, unsupported, recoverable failure, and cancellation states are specified;
- expected memory/storage/thread ownership is bounded;
- acceptance tests can fail for an incorrect implementation;
- user-facing work has an approved experience state/copy/interaction contract and representative local fixtures;
- file ownership does not overlap concurrent work.

If any item is missing, the primary integrator either supplies it or keeps the package in discovery. Implementation does not convert an open assumption into an accepted decision.

## Definition of done

A package is done only when all of the following are true:

- production code contains no silent fallback, fake inference, swallowed error, or unbounded queue/allocation;
- public functions validate invalid and unsafe inputs;
- deterministic unit tests cover normal, boundary, and failure behavior;
- relevant integration/browser tests exist where browser APIs are involved;
- typecheck, tests, build, wiki-link validation, and package-specific checks pass from a clean dependency install;
- generated or downloaded artifacts are excluded or intentionally versioned, with hashes where required;
- the evidence record names untested claims and degraded modes;
- documentation and [[Open Decisions]] match the implementation;
- [[Decision Log]] contains every settled choice and its load-bearing reason, while filtered alternatives are linked from [[Archive Index]];
- Sol has no unresolved critical/high finding and the Astra browser pass has no unresolved release-blocking reproduction;
- for the final release candidate only, Astra's one final UX acceptance has no unresolved critical/high finding.

Passing a unit test does not satisfy quality, memory, offline, or cross-browser gates that require measured evidence.

## Review protocol

### Integration review

The primary integrator checks interfaces between packages, runs the whole suite, scans for placeholders and accidental network paths, validates Obsidian links, and writes the increment evidence record. Failed checks return to the owning implementer.

### Luna verification and Terra integration

Luna checks the bounded package against its declared normal, boundary, failure, and cancellation behavior. Terra then checks integration, state ownership, privacy/resource boundaries, and consistency with adjacent packages. Neither stage expands product scope or certifies its own edits; defects return to Spark and restart the chain.

### Sol technical review

Sol reviews after integration. Findings use `critical`, `high`, `medium`, or `low`, with reproduction/evidence and the violated requirement. Critical/high findings block final UX acceptance and release. Fixes return through integration checks and independent re-review; an implementing reviewer does not self-certify the fix.

Minimum review areas: correctness and edge cases; canonical timing; memory and queue bounds; thread ownership; storage atomicity; privacy/network behavior; accessibility primitives; dependency/version/license posture; test realism; error/cancel/restart behavior; unsupported-capability honesty.

### Astra UX acceptance

Every user-visible package receives an Astra browser bug-finding pass after Sol. Astra uses browser control against the runnable build, records exact interactions and evidence, and returns bugs through the implementation chain. This pass is not approval and does not begin the final holistic gate.

Astra final UX acceptance starts only once: after all implementation phases are complete, Sol explicitly reports no unresolved critical/high findings on the release candidate, all package browser bugs are reconciled, and all release checks pass. Use the runnable app, not screenshots alone. Test first-run online setup, first-run offline failure, cached offline launch, import failure, processing progress/cancel/retry, playback/buffering/seek, keyboard-only mixing, export failure/success, narrow viewport, reduced motion, and screen-reader announcements.

Every UX finding contains steps, expected/actual behavior, severity, affected requirement, and evidence. UX fixes that touch behavior return to Sol for regression review before final acceptance.

## Stop and fallback rules

- Stop before allocating when admission cannot prove the work fits the configured budget.
- Stop a feature cleanly when no validated provider/storage/codec path exists; preserve the last committed project.
- Retry provider failures only from a committed checkpoint and only on a separately qualified backend.
- Never degrade privacy, bypass integrity checks, or silently lower output safety to complete a job.
- Restrict the advertised file/device/browser matrix when evidence fails; do not relabel a failure as support.
- Reopen the relevant ADR when a fallback changes architecture, stored formats, visible semantics, or a hard requirement.

## Decision deadlines

| Decision group | Latest safe point | Required evidence | Default if unresolved |
| --- | --- | --- | --- |
| OD-01/02/03/11 models, quality, licensing | Before model packages or user-facing separation claims | Conversion parity, memory/throughput, listening rubric, exact license audit | Keep interface/experiment only; do not ship models |
| OD-04 decoder | Before FR-1 format claims or long-file import | Corrupt/large codec fixtures and bounded-memory measurements | Limit visible formats/sizes to validated native path |
| OD-05/06/07 export | Before export UI is enabled | Stateful equivalence, loudness/true-peak verification, agreed stem semantics | Keep export disabled with a clear capability state |
| OD-08/12 support/storage | Before beta device/browser claims | Matrix results, persistence/quota/final-save tests | Publish the narrower passing matrix |
| OD-09 ducking | Before UX acceptance | Speech fixtures and listening results for onset/release/short utterances | Use documented defaults marked provisional |
| OD-10 low-end control | Before mixer UI freeze | Product value, DSP parameters, headroom tests | Exclude from MVP |
| OD-17 audible-expectation rubric | Before any macro control is called product-ready | Representative listening tasks, expectation match, artifact tolerance, A/B usability | Keep control experimental and do not claim reliable improvement |

## Required commands

The implementation must expose stable scripts for formatting/checking, unit tests, production build, and browser tests. The final exact command set is established by I-001 and recorded in its evidence. A release check runs them from a clean install and then validates every Obsidian wikilink.

See [[Roadmap]], [[Validation Plan]], [[Risk Register]], and [[Review Resolution Log]].
