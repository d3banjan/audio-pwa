---
title: "Experience Principles"
version: "2.1"
status: active
updated: 2026-09-07
tags:
  - audio-workstation
  - product
  - user-experience
---

# Experience Principles

## Governing priority

Design and validate the experience before optimizing or broadening the client-side backend. The target user may know what dialogue, room sound, music, width, noise, and loudness should feel like, but must not need to understand ONNX, WebGPU, WASM, OPFS, model graphs, or browser scheduling.

The product succeeds when the user can state an audible intention, predict what a control will do, verify it quickly on their own material, and hear that expectation rewarded in most applicable cases. Technical novelty, maximum model choice, and peak benchmark speed do not compensate for an unclear or unreliable result.

## Interaction contract

1. **Name the intended sound.** Use outcome language such as clearer dialogue, less steady noise, preserve room character, wider music, or stronger speech focus. Keep units available where audio knowledge makes them useful.
2. **Preview quickly.** Apply the exact proposed pipeline/settings to a short representative region before a long job.
3. **Make causality audible.** Provide immediate, level-matched A/B where appropriate, a clear changed/unchanged state, and one-step undo/reset.
4. **Expose uncertainty honestly.** Show when the material is ambiguous, a feature is experimental, or the preview may not represent the full timeline. Preserve the source and never imply improvement from a failed/stub path.
5. **Ask only meaningful questions.** Hide scheduler chunks and implementation choices. Surface storage, time, quality, or provider detail only when it changes a user decision or explains a limitation.
6. **Use safe defaults, then control.** Start with a coherent global profile. Add semantic-region overrides only for material acoustic changes or explicit user intent.
7. **Keep outcomes reproducible.** A committed preview records source region, settings, pipeline/artifact versions, provider, and quality profile so the full pass can honor the demonstrated result.
8. **Let defaults carry the first run.** The primary path is choose a file, review the recommendation, and enhance. Reveal sound-engineering and resource controls only when the user asks to adjust or inspect them.
9. **Keep the surface calm.** Use a minimal warm-neutral canvas, quiet pastel accents, generous spacing, and a single visually dominant next action. Preserve readable contrast and never rely on color alone.

## UI-first delivery rule

Build the end-to-end state flow, copy, accessible controls, fixture previews, error/recovery paths, and typed boundary contracts before the corresponding production backend package. Fixtures are local, deterministic, and visibly development/test-only. They exist to test comprehension and interaction; they cannot mark a real source as processed or satisfy an audio quality gate.

Implement backend capability as thin vertical slices behind the accepted boundary: first make one promised outcome real on one supported path, then improve latency, efficiency, breadth, and fallbacks. A backend optimization that changes the promised outcome, control meaning, or failure behavior reopens the experience contract.

## Evidence

For each macro control, record:

- the user intention and material where it applies;
- the expected perceptual direction and unacceptable artifacts;
- representative fixtures, including counterexamples;
- preview latency and A/B loudness-matching method;
- listening/usability results and confidence;
- cases where the app should abstain or recommend the unchanged source.

OD-17 in [[Open Decisions]] defines the numerical/qualitative release rubric. See [[User Experience and Recovery]], [[Implementation Playbook]], and [[Validation Plan]] V-12.
