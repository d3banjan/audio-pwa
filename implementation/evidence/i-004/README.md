# I-004 evidence

## Bounded repair — 2026-09-08

- `bun run check` passes: formatting, TypeScript, 82 unit tests, and wiki-link verification.
- `bun run build` passes.
- The real preview controller clears the initial video `muted` attribute before creating its one `MediaElementAudioSourceNode` graph. The graph owns the audio route, so playback is audible without a second native route.
- Stem-dependent Music level and Music under speech controls remain disabled outside busy phases and explain `Available after stem separation`.
- Real source metadata uses probed video dimensions when present. If probing fails, dimensions, sample rate, and channel count remain unmeasured; fixture dimensions and assumed 48 kHz/2 channel values are not presented as source measurements.

## Accepted seams

The live `LEAKY ABSTRACTION:` markers in `src/main.ts`, `src/media/real-local-preview.ts`, and `src/lib/experience-state.ts` all name I-004, state the accepted reason and limit, and describe the replacement behavior required by [[Implementation Package I-004 - Real Local Preview]].
