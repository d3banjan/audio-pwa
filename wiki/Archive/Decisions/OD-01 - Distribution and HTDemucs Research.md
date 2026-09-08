---
title: "OD-01 - Distribution and HTDemucs Research"
version: "2.1"
status: archived
decision_id: OD-01
archived: 2026-09-07
rejected_by: D-006
tags:
  - audio-workstation
  - archive
  - model-licensing
---

# OD-01 - Distribution and HTDemucs Research

> [!archive] Historical detail
> The active decision is D-005 in [[Decision Log]]. This note preserves the filtered alternatives and evidence; it is not an instruction to ship HTDemucs.

## Question considered

Whether the application would be a scientific/personal non-commercial product, a commercially usable public product, or a public shell that requires users to supply their own model.

## Evidence retained

- The official Demucs repository and code are MIT licensed: [repository](https://github.com/facebookresearch/demucs) and [license](https://github.com/facebookresearch/demucs/blob/main/LICENSE).
- In the official repository's model-license issue, maintainer `adefossez` states that pretrained model weights are not covered by MIT and are provided only for scientific purposes: [issue #327](https://github.com/facebookresearch/demucs/issues/327).
- Converting those weights to ONNX does not create a broader license grant.
- Community HTDemucs ONNX exports report roughly 166 MB for weight-only FP16 or 316 MB for FP32 for one four-stem model, but their redistribution labels cannot override upstream rights and their browser correctness/memory were not validated here.
- The intended users include creators and filmmakers who may monetize their work.

## Filtered alternatives

| Avenue | Rejection reason |
| --- | --- |
| Commercial-ready product requiring commercially redistributable model weights | Superseded when the user defined the project as non-commercial and selected MIT for the application source. |
| Public app with user-supplied HTDemucs weights as its primary path | Poor onboarding and does not automatically resolve the user's permission to use the weights; retained only as a possible developer experiment. |
| Bundle or automatically download a community ONNX conversion labeled MIT | A conversion/rehost cannot broaden the upstream pretrained-weight license. |

## Selected direction

Publish a non-commercial open-source GitHub Pages application. License the application source under MIT. Evaluate HTDemucs as the leading research-build separator, but disclose and preserve the pretrained weights' separate scientific-purpose terms; do not call those weights MIT.

**Load-bearing reason:** the user explicitly intends a non-commercial experimental project and wants a permissive MIT license for the application source.

See [[Decision Log]], [[Open Decisions]], and [[Model Runtime and Licensing]].
