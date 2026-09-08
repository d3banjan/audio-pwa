---
title: "Risk Register"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Risk Register

Severity/likelihood are qualitative planning judgments inherited or extended from the supplied review. Mitigations are designs awaiting validation.

| Risk | Severity | Likelihood | Mitigation and gate |
| --- | --- | --- | --- |
| Browser OOM during decode/inference/export | Critical | High | Admission budget, paged assets, bounded decode/save, checkpointing; V-01/V-02 |
| No viable HTDemucs browser artifact | Critical | High | Reproducible conversion, representative probes, independent WASM qualification; V-03/V-09 |
| Music model and heuristic masks mislabel field content | High | High | Representative listening gate, complementary masks, honest labels; V-03 |
| Fixed alignment or chunk-state error causes comb filtering/drift | High | Medium | Align cleaned output to canonical time, stateful resampling, impulse and speech fixtures; V-04/V-06 |
| “Limiter” permits sample or intersample clipping | High | High | Validated true-peak stage and post-quantization export verification; V-06 |
| Independent offline chunks reset filters/dynamics | High | High | Explicit stateful render design or proven reconstruction method; V-06 |
| Quota/eviction destroys offline readiness or project data | High | Medium | Capacity preflight, persistence request, committed manifests, readiness recheck; V-07/V-10 |
| Runtime GPU loss interrupts processing | High | High | Dispose and retry at checkpoint on qualified provider, user notice; V-09/V-10 |
| Model or dependency redistribution rights unresolved | High | Unknown | Audit exact artifacts and retain notices before bundling; V-11 |
| Sustained thermal slowdown or background suspension | Medium | High | Measure throughput/underruns, adapt yielding, pause/resume; V-08/V-09 |
| Waveform/UI jank disrupts controls | Medium | Medium | Peak tiles, bounded resident cache, separate playhead overlay; V-08 |
| Mixing code/runtime versions breaks offline startup | High | Medium | Atomic versioned release manifest and safe activation; V-07 |
| WASM isolation or OPFS path unavailable | High | Medium | Capability checks and independently tested degraded modes; V-09 |

The highest-priority blockers are model feasibility, bounded resource use, domain-appropriate quality, and stateful safe export. See [[Open Decisions]] and [[Roadmap]].
