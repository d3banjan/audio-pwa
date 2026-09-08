import { describe, expect, it } from "vitest";
import {
  admitProcessingStorage,
  estimateProcessingStorage,
  PINNED_PROCESSING_ASSET_BYTES,
} from "./processing-storage-admission";

describe("prepared processing storage admission", () => {
  it("sizes exact stereo Float32 PCM, stereo PCM24 WAV, assets, and reserve", () => {
    const result = estimateProcessingStorage(48_000);
    expect(result.processedPcmBytes).toBe(48_000 * 2 * 4);
    expect(result.wavBytes).toBe(44 + 48_000 * 2 * 3);
    expect(result.assetAllowanceBytes).toBe(PINNED_PROCESSING_ASSET_BYTES);
    expect(result.reserveBytes).toBe(
      Math.ceil(
        (result.processedPcmBytes +
          result.wavBytes +
          result.assetAllowanceBytes) *
          0.2,
      ),
    );
    expect(result.requiredBytes).toBe(
      result.processedPcmBytes +
        result.wavBytes +
        result.assetAllowanceBytes +
        result.reserveBytes,
    );
  });

  it("admits exactly enough available quota", () => {
    const required = estimateProcessingStorage(1).requiredBytes;
    expect(
      admitProcessingStorage(1, { quota: required + 25, usage: 25 }),
    ).toMatchObject({
      status: "admitted",
      availableBytes: required,
      deficitBytes: 0,
    });
  });

  it("reports the exact deficit without silently reducing quality", () => {
    const required = estimateProcessingStorage(100).requiredBytes;
    expect(
      admitProcessingStorage(100, { quota: required, usage: 17 }),
    ).toMatchObject({
      status: "insufficient",
      availableBytes: required - 17,
      deficitBytes: 17,
    });
  });

  it.each([undefined, {}, { quota: 0, usage: 0 }, { quota: 100, usage: 101 }])(
    "fails closed when the storage estimate is unavailable (%j)",
    (estimate) => {
      expect(admitProcessingStorage(1, estimate)).toMatchObject({
        status: "unavailable",
      });
    },
  );

  it("rejects an unsafe frame count", () => {
    expect(() => estimateProcessingStorage(Number.MAX_SAFE_INTEGER)).toThrow(
      RangeError,
    );
  });
});
