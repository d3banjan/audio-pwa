---
title: "Cinematic Audio Workstation"
version: "2.1"
status: reviewed-draft
updated: 2026-09-06
tags:
  - audio-workstation
  - specification
---

# Cinematic Audio Workstation

> [!info] Specification status
> Version **2.1 — reviewed draft**, derived from the supplied v2.0 product specification, ADRs, and review. Architectural intent is preserved. Corrections are recorded in [[Review Resolution Log]]. No feasibility gate has yet been executed.

> [!important] Source of truth
> This wiki is authoritative for the product, architecture, decisions, delivery state, and evidence links. Implementation must conform to the active notes. [[Decision Lifecycle]] defines how choices are made and how rejected detail is archived.

A privacy-first, zero-install PWA for turning a flat recording into an editable cinematic mix, entirely on the user's device.

## Start here

1. [[Agent Orientation]] — the fastest accurate read for a new implementation or review agent.
2. [[Frontend Architecture]] and [[Client-Side Backend Architecture]] — explicit ownership on each side of the app.
3. [[Boundary Contracts]] — messages, state, storage, and failure contracts between them.
4. [[Decision Log]] and [[Open Decisions]] — settled choices and the next choices to make.
5. [[Experience Principles]], [[Product Vision and Scope]], and [[Requirements]] — product priority, users, outcomes, and acceptance obligations.
6. [[Test Environments]] — the actual laptop and home-server validation strategy.
7. [[Implementation TODOs]], [[Review Resolution Log]], [[Validation Plan]], and [[Roadmap]] — current work, changes, evidence, and delivery order.

## Specification map

| Area | Notes |
| --- | --- |
| Product | [[Experience Principles]], [[Product Vision and Scope]], [[Requirements]], [[User Experience and Recovery]] |
| Architecture | [[Agent Orientation]], [[Frontend Architecture]], [[Client-Side Backend Architecture]], [[Boundary Contracts]], [[System Architecture]], [[Memory and Storage]], [[Model Runtime and Licensing]], [[Offline PWA Lifecycle]] |
| Audio | [[Ingestion and Timeline]], [[Separation Pipeline]], [[Dialogue Enhancement and VAD]], [[Mixer and Controls]], [[Transport and Automation]], [[Export and Metering]] |
| Decisions | [[Decision Lifecycle]], [[Decision Log]], [[Open Decisions]], [[ADR Index]], [[ADR 001 - Language and Runtime]], [[ADR 002 - Inference Backends]], [[ADR 003 - Memory and Paging]], [[ADR 004 - Scheduled Ducking]], [[ADR 005 - Offline Persistence]] |
| Delivery | [[Implementation TODOs]], [[Implementation Playbook]], [[Test Environments]], [[Validation Plan]], [[Risk Register]], [[Roadmap]], [[Open Decisions]] |
| Reference | [[Review Resolution Log]], [[Glossary]], [[Sources]], [[Archive Index]] |

## Reading conventions

- **Must** identifies a release requirement; a requirement is not evidence that it has been met.
- **Proposed** identifies a correction or design choice awaiting implementation evidence or product review.
- **Gate** identifies work that must pass before the dependent feature can be called supported.
- ADRs preserve the supplied accepted decisions as architectural intent; revised details remain subject to the listed gates.
- Internal links use unique note names so the folder can move within a vault. Source links are ordinary Markdown hyperlinks.
- Active notes state current truth. Filtered alternatives and superseded detail live under `Archive/` and cannot override active notes.

The wiki is the consolidated working specification. [[Review Resolution Log]] retains the supplied draft's disputed claims for traceability without treating them as current guarantees.
