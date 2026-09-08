---
title: "Product Vision and Scope"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Product Vision and Scope

The Client-Side Cinematic Multitrack Audio Workstation serves content creators, indie filmmakers, video journalists, and podcasters who need intelligible dialogue and a balanced sound bed without learning a full DAW.

The project is non-commercial and published as an open-source GitHub Pages site. The application source uses the MIT license. Model weights and other artifacts retain their own terms and notices; the application license never broadens them. The current HTDemucs research candidate requires a separately disclosed scientific-purpose restriction.

Typical input includes local video or audio from spoken capture, field interviews, conferences, and vlogs. For video, the app extracts and enhances the audio locally while retaining the original picture/timeline for synchronized preview. The app addresses buried speech, hiss, competing background sound, and difficult mix balance using intelligent defaults and a small set of controls.

## User outcome

Import a local video or audio recording, state the intended audible result through macroscopic sound controls, verify it on a short preview with immediate A/B and undo, then enhance the timeline through invisible bounded chunks. Stable recordings keep one global profile; confidently detected acoustic changes may become optional review regions. Preview and download the accepted full result. Audio, source media, derived waveforms, and analysis metadata must never be uploaded. Initial asset downloads require a connection; verified cached assets enable subsequent offline operation.

The experience is designed before backend optimization. Primary language describes sound and outcomes; model names, providers, storage engines, and memory mechanics appear only when they help a decision or diagnose a limitation. See [[Experience Principles]].

| Visible bus | Intended content | Routing contract |
| --- | --- | --- |
| Dialogue | Speech with adjustable enhancement | Aligned raw and cleaned vocals feed one bus |
| Music & Harmonic Bed | Rhythm and melodic accompaniment | Demucs drums + bass + harmonic portion of other |
| Ambience / Room Tone | Estimated stationary background | Ambience mask applied to other |
| Transient SFX & Foley | Estimated non-tonal events | Effects mask applied to other |

“Rhythm Section” is an intermediate signal, not a fifth visible stem. The product has four visible buses but more than four stored assets, because raw and cleaned dialogue are both needed.

## Quality boundaries

The named buses describe intended content, not guaranteed semantic isolation. Demucs is a music-separation candidate; its vocals output can include singing and can miss speech in field recordings. Spectral stationarity is not proof of ambience: sustained instruments can also be stationary, and drums may resemble effects. Stage 2 is explicitly heuristic and must pass a representative listening evaluation before these labels are marketed as reliable separation.

Denoising is a dependable MVP objective under D-013. Dereverberation is a separately labeled experimental, preview-first option: it must offer level-matched A/B and undo, abstain when support/confidence is insufficient, and never turn the primary Dialogue Clean promise into “remove all room echo.” RNNoise or DeepFilterNet selection alone does not establish dereverberation capability. Mid/side width cannot create stereo information from a mono signal.

## Scope

- Up to 15 minutes of mono or stereo audio carried by a validated audio or video container, subject to memory, codec, model, and storage admission checks.
- Four-bus playback; mute, solo, volume, dialogue enhancement, tone, width, ducking, and non-destructive speech clips.
- Stereo 48 kHz, 24-bit PCM WAV mix export and aligned stem export.
- Offline operation after verified setup, with local progress, recovery, and diagnostics.

Multichannel audio, cloud processing, collaboration, recording, picture editing/transcoding beyond the eventual audio-remux contract, arbitrary plug-ins, and guaranteed mobile support are outside the initial scope. Browser support is established by [[Validation Plan]], not inferred from API availability. The eight-week sequence in [[Roadmap]] is a planning estimate, contingent on feasibility gates.

See [[Requirements]] and [[Open Decisions]].
