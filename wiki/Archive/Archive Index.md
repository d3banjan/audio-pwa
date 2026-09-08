---
title: "Archive Index"
version: "2.1"
status: archive-index
updated: 2026-09-08
tags:
  - audio-workstation
  - archive
---

# Archive Index

Archived notes preserve filtered alternatives, failed experiments, and superseded designs. They are not current implementation instructions. Current truth lives in active notes linked from [[Home]] and concise decisions in [[Decision Log]].

## Decision archives

| Decision | Archived avenue | Load-bearing rejection reason | Current decision |
| --- | --- | --- | --- |
| OD-01 | [[OD-01 - Distribution and HTDemucs Research]] | Commercial-ready distribution was filtered out when the user chose a non-commercial project; treating converted weights as MIT remains rejected. | D-006 in [[Decision Log]] |
| OD-01 | [[OD-01 - HTDemucs Artifact Alternatives]] | FP32-first, four-model-bag-first, and six-stem-first approaches consume more memory or change the required output contract before FP16 parity is tested. | D-007 in [[Decision Log]] |
| OD-13 | [[OD-13 - Chunk Fine-Tuning Alternatives]] | Fixed scheduler windows do not correspond to audible source changes; exposing them creates needless work and risks seams on stable recordings. | D-009 in [[Decision Log]] |
| OD-16 | [[OD-16 - Model Catalog Alternatives]] | Arbitrary Hub models do not provide the measured audio, provider, memory, quality, integrity, or licensing contract needed for a compatible/offline model picker. | D-010 in [[Decision Log]] |
| OD-14 | [[OD-14 - Fixed Video Export Policies]] | An always-video or always-audio-only policy ignores device/container capability, source-sized storage, and the user's fidelity/resource preference. | D-011 in [[Decision Log]] |
| OD-03 | [[OD-03 - Dialogue Enhancement Scope Alternatives]] | Denoising-only omits a useful recoverable experiment, while promising strong dereverberation as core behavior overstates material-dependent capability and artifact risk. | D-013 in [[Decision Log]] |
| OD-06 | [[OD-06 - Loudness Preset Alternatives]] | A single forced target cannot preserve dynamic material while serving dialogue and louder online-delivery expectations; the earlier -0.5 dBTP proposal leaves less lossy-encoding headroom. | D-014 in [[Decision Log]] |
| OD-07 | [[OD-07 - Stem Export Alternatives]] | Raw-only stems discard the accepted sound, while exporting raw and processed variants doubles storage and complexity before an expert workflow exists. | D-015 in [[Decision Log]] |
| OD-10 | [[OD-10 - Cinematic Low-End Alternatives]] | “Cinematic Low-End” overpromises synthesis/mastering behavior; excluding all weight control also removes a simple, predictable music-only adjustment. | D-018 in [[Decision Log]] |
| OD-04 | [[OD-04 - Browser Audio Extraction Alternatives]] | WebCodecs is absent in the target Chromium browser, while bundled decoders add download, memory, implementation, and redistribution costs before the browser-native media graph has failed its measured quality/resource gates. | D-024 in [[Decision Log]] |
| D-002 | [[Flat Project State Alternative]] | Setup, project jobs, and transport vary independently; a flat phase admitted impossible and stale transitions. | D-002 in [[Decision Log]] |

## Required archive frontmatter

```yaml
status: archived
decision_id: OD-00
archived: YYYY-MM-DD
rejected_by: D-000
```

Use a unique descriptive filename under `wiki/Archive/Decisions/`. Keep original evidence and citations intact; add a short banner linking back to the current decision. See [[Decision Lifecycle]].
