import { describe, expect, test } from "vitest";
import {
  CURATED_MODEL_CATALOG,
  validateModelManifest,
  type CuratedModelManifest,
} from "./model-catalog";

describe("curated model catalog", () => {
  test("contains only internally valid manifests", () => {
    expect(CURATED_MODEL_CATALOG.length).toBe(1);
    for (const manifest of CURATED_MODEL_CATALOG) {
      expect(validateModelManifest(manifest)).toEqual([]);
    }
  });

  test("pins the upstream Silero artifact without claiming provider qualification", () => {
    const model = CURATED_MODEL_CATALOG[0];
    expect(model?.id).toBe("silero-vad-v6.2.1-16k-op15");
    expect(model?.artifactBytes).toBe(1_289_603);
    expect(model?.artifactSha256).toBe(
      "7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49",
    );
    expect(model?.weightsLicense.spdx).toBe("MIT");
    expect(model?.qualification).toBe("identity-verified");
    expect(model?.onnxRuntimeWebVersion).toBe("1.29.0");
    expect(
      model?.providers.find((provider) => provider.provider === "wasm")
        ?.qualification,
    ).toBe("reference-parity");
    expect(model?.resourceEvidence.peakRamBytes).toBeNull();
  });

  test("rejects malformed identity and unsupported qualification claims", () => {
    const valid = CURATED_MODEL_CATALOG[0] as CuratedModelManifest;
    const invalid = {
      ...valid,
      upstreamCommit: "main",
      artifactSha256: "unknown",
      artifactBytes: 0,
      qualification: "qualified" as const,
    };
    expect(validateModelManifest(invalid)).toEqual([
      "upstreamCommit must be a full lowercase Git commit SHA.",
      "artifactSha256 must be a lowercase SHA-256 digest.",
      "artifactBytes must be a positive safe integer.",
      "A qualified model requires at least one qualified provider.",
    ]);
  });
});
