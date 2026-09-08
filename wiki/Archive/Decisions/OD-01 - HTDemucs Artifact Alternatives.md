---
title: "OD-01 - HTDemucs Artifact Alternatives"
version: "2.1"
status: archived
decision_id: OD-01
archived: 2026-09-07
rejected_by: D-007
tags:
  - audio-workstation
  - archive
  - model-runtime
---

# OD-01 - HTDemucs Artifact Alternatives

> [!warning] Archived decision material
> This comparison is historical context, not an implementation instruction. D-007 in [[Decision Log]] selects the single four-stem `htdemucs` weight-only FP16 artifact for Phase 0 qualification.

## Filtered first candidates

Community `demucs-onnx` documentation reported the following approximate weight sizes. None was locally verified when the decision was made.

| Candidate | Reported weight size | Outputs | Why it was not selected first |
| --- | ---: | --- | --- |
| Single `htdemucs`, FP32 | ~316 MB | vocals, drums, bass, other | Roughly doubles weight storage/memory before a browser-pipeline quality benefit is shown |
| `htdemucs_ft` four-model bag, FP16 | ~660 MB | vocals, drums, bass, other | Four sessions/passes leave too little headroom under the 1.5 GB target for the first feasibility experiment |
| `htdemucs_6s`, FP16 | ~136 MB | adds guitar and piano | Changes routing semantics and carries weaker reported vocals/other behavior despite the smaller artifact |

The selected single `htdemucs` FP16 artifact was reported at roughly 166 MB and preserved the required four-output topology. The load-bearing reason is memory headroom while retaining that contract.

FP32 remains a conditional comparison if the selected FP16 conversion fails numerical parity or produces unacceptable quality. If both single-model variants fail, reopen the decision rather than silently adopting a bag or six-stem topology.

Source for reported converted artifacts: [StemSplit demucs-onnx model documentation](https://github.com/StemSplit/demucs-onnx/blob/main/docs/models.md). Original architecture/segment constraint: [Demucs upstream](https://github.com/facebookresearch/demucs). Weight-rights history remains in [[OD-01 - Distribution and HTDemucs Research]].

## Qualification obligations retained by D-007

- Pin source revision, exact URL, byte count, SHA-256, converter commit, graph inputs/outputs, preprocessing, and separate model notice.
- Compare outputs with the official PyTorch model on deterministic fixtures using declared numerical and perceptual tolerances.
- Measure model/session/scratch memory and run the exact valid segment shape on each provider.
- Test sustained throughput, device loss, checkpoint retry, overlap-add boundaries, and field-dialogue quality.

See [[Model Runtime and Licensing]], [[Memory and Storage]], and [[Validation Plan]].
