import { describe, expect, it } from "vitest";
import {
  CANONICAL_PCM_LAYOUT,
  assessMemoryAdmission,
  estimatePcmBytes,
  estimateStorageRequirement,
} from "./memory-admission";

describe("memory and storage admission", () => {
  it("estimates a 15-minute stereo Float32 asset exactly", () => {
    expect(estimatePcmBytes(15 * 60, CANONICAL_PCM_LAYOUT)).toBe(345_600_000);
  });

  it("rejects a plan whose resident assets and runtime reservations exceed budget", () => {
    const result = assessMemoryAdmission({
      budgetBytes: 1_500_000_000,
      durationSeconds: 15 * 60,
      residentAudioAssetCount: 4,
      reservations: {
        modelBytes: 750_000_000,
        decoderBytes: 150_000_000,
        playbackBytes: 150_000_000,
        uiBytes: 100_000_000,
        safetyMarginBytes: 350_000_000,
      },
    });
    expect(result.admitted).toBe(false);
    expect(result.requiredBytes).toBeGreaterThan(result.budgetBytes);
    expect(result.deficitBytes).toBe(result.requiredBytes - result.budgetBytes);
  });

  it("adds the configured reserve to OPFS storage requirements", () => {
    expect(
      estimateStorageRequirement({
        projectAssetBytes: 100,
        modelBytes: 200,
        temporaryOverlapBytes: 50,
        exportBytes: 150,
        reserveRatio: 0.2,
      }),
    ).toEqual({ baseBytes: 500, reserveBytes: 100, requiredBytes: 600 });
  });

  it("rejects fractional byte reservations", () => {
    expect(() =>
      assessMemoryAdmission({
        budgetBytes: 1000,
        durationSeconds: 1,
        residentAudioAssetCount: 1,
        reservations: {
          modelBytes: 0.5,
          decoderBytes: 0,
          playbackBytes: 0,
          uiBytes: 0,
          safetyMarginBytes: 0,
        },
      }),
    ).toThrow(RangeError);
  });
});
