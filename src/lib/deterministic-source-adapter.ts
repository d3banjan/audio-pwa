import {
  DEMO_FIXTURE,
  buildResourceProfiles,
  sourceKindFromFileName,
  supportsDemoSource,
  type ExperienceSourceAdapter,
  type ResourceCapacity,
} from "./experience-state";

export const deterministicFixtureAdapter: ExperienceSourceAdapter =
  Object.freeze({
    id: "i003-deterministic-fixture",
    prepare(fileName: string) {
      return supportsDemoSource(fileName)
        ? {
            accepted: true as const,
            prepared: {
              source: DEMO_FIXTURE,
              sourceKind: sourceKindFromFileName(fileName),
              capabilities: {
                dereverb: "unavailable" as const,
                reason:
                  "Experimental dereverb is not included in the deterministic fixture.",
              },
              profiles: buildResourceProfiles(),
            },
          }
        : {
            accepted: false as const,
            code: "unsupported-source" as const,
            reason: "Choose a WAV, MP3, M4A, AAC, FLAC, or MP4 file.",
          };
    },
    profiles: (capacity?: Partial<ResourceCapacity>) =>
      buildResourceProfiles(capacity),
  });
