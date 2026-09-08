---
title: "Mixer and Controls"
version: "2.1"
status: reviewed-draft
updated: 2026-09-05
tags:
  - audio-workstation
  - specification
---

# Mixer and Controls

## Routing

Aligned dialogue dry/clean pair → wet/dry sum → rumble high-pass → presence EQ → Dialogue volume/mute bus. Dialogue is centered by an explicit linked mono routing policy, not by assuming a centered panner collapses stereo.

Music and Ambience → mid/side width → independent duck gain → volume/mute bus. SFX → volume/mute bus. All four feed master processing and the true-peak safety stage. The supplied unspecified “Dynamic Balance” on SFX is not an additional MVP effect.

## True stereo width

$$M=(L+R)/2,\qquad S=(L-R)/2,$$

$$L'=M+WS,\qquad R'=M-WS,\qquad W\in[0,2].$$

Keep mid gain fixed at 1. Width 0 gives `L'=R'=M`; width 1 reconstructs the source; width 2 doubles the side component while preserving center content. The draft's `mid = 2-W` is removed because it boosts the mono setting and removes centered content at width 2. Widening can increase peaks and worsen mono compatibility; meter the result. Mono material remains mono.

Implement with explicit two-channel split/merge routing and gain nodes, including the negative side path. Set channel count/mode/interpretation explicitly and test the actual matrix. StereoPannerNode is appropriate for pan, not width.

## Control matrix

| Control | Range / default | Target and operation |
| --- | --- | --- |
| Stem Volume | Four faders; silence to +6 dB; 0 dB | Bus gain `10^(dB/20)`; silence is exact zero; 10 ms ramp |
| Stem Mute / Solo | Four pairs; off | Mute dominates; if any solo is active, only unmuted soloed stems play; 5 ms ramp |
| Dialogue Clean | 0–100%; 50% | Dual aligned gains `1-alpha` / `alpha`; 10 ms ramp |
| Rumble Cut | Enabled | Dialogue second-order Butterworth high-pass, 80 Hz; linear design Q = 1/√2; smoothly crossfade bypass |
| Dialogue Presence | -6 to +6 dB; +2.5 dB | Dialogue peaking EQ, 3.5 kHz, Q 1.2; smooth parameter changes |
| Stereo Width | 0–200%; 100% | Shared control for Music and Ambience; side gain W, mid gain 1; 10 ms ramp |
| Auto-Duck Depth | 0 to -18 dB; -6 dB | Music/Ambience duck gain; 0 dB disables attenuation |
| Music Weight | Lighter to heavier; neutral | Qualified linked-stereo low shelf on Music only; no subharmonic synthesis |
| VAD Sensitivity | 0.1–0.9; 0.5 | Shared threshold for speech mask, clips, and ducking; label explains higher values select less speech |
| Master Limiter | Always enabled | Validated lookahead/oversampled true-peak stage; export ceiling -1 dBTP |

For the Butterworth high-pass, convert the linear design Q to the native high-pass AudioParam: `Q.value = 20 * log10(1 / sqrt(2))`, approximately -3.0103 dB. Web Audio interprets high-pass/low-pass Q in dB, while peaking-filter Q remains linear. Verify the response at the cutoff. See the [BiquadFilterNode Q specification](https://webaudio.github.io/web-audio-api/#dom-biquadfilternode-q).

Ducking is independent of mute/solo and fader gains, so changing one cannot overwrite another's gain automation. Parameter state is shared by preview and export.

## Music Weight

D-018 replaces the vague Cinematic Low-End label with **Music Weight**. It adjusts only the Music bus through a modest, linked-stereo low shelf whose exact corner, slope, and gain range must pass listening and headroom tests. The experience ranges from lighter through neutral to heavier, starts neutral, supports level-matched A/B and one-step reset, and predicts additional peak/limiter pressure before commitment.

It never affects Dialogue, Ambience, or SFX and never synthesizes frequencies absent from the separated Music bus. When the music estimate is missing or too uncertain, disable the control with an audible-outcome explanation. A future subharmonic generator would be a separate experimental feature and must not inherit this control name.

The draft compressor settings (-0.5 dBFS threshold, zero knee, 20:1 ratio, 2 ms attack, 50 ms release) are not accepted as a brick-wall or true-peak limiter. Optional compression may precede the safety stage; see [[Export and Metering]].
