import { describe, expect, it } from "vitest";
import {
  framesToSeconds,
  mapFrameInterval,
  mapFrameOffset,
  secondsToFrames,
} from "./timeline";

describe("timeline conversion", () => {
  it("maps aligned 16 kHz VAD frames exactly to canonical 48 kHz", () => {
    expect(mapFrameOffset(12_345, 16_000, 48_000, "floor")).toBe(37_035);
  });

  it("preserves a half-open interval with floor start and ceil end", () => {
    expect(
      mapFrameInterval({ startFrame: 1, endFrame: 2 }, 44_100, 48_000),
    ).toEqual({
      startFrame: 1,
      endFrame: 3,
    });
  });

  it("converts seconds with an explicit boundary policy", () => {
    expect(secondsToFrames(0.001, 48_000, "floor")).toBe(48);
    expect(secondsToFrames(0.00101, 48_000, "ceil")).toBe(49);
    expect(framesToSeconds(48_000, 48_000)).toBe(1);
  });

  it("rejects inverted intervals", () => {
    expect(() =>
      mapFrameInterval({ startFrame: 2, endFrame: 1 }, 48_000, 48_000),
    ).toThrow(RangeError);
  });

  it("rejects a destination offset that would exceed the safe integer range", () => {
    expect(() =>
      mapFrameInterval({ startFrame: 1, endFrame: 2 }, 48_000, 48_000, {
        destinationOffsetFrames: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(RangeError);
  });
});
