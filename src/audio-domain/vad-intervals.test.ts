import { describe, expect, it } from "vitest";
import { derivePaddedClips, deriveSpeechIntervals } from "./vad-intervals";

describe("VAD interval derivation", () => {
  it("filters short runs before merging by hang time", () => {
    const result = deriveSpeechIntervals(
      [
        { startFrame: 0, endFrame: 100, probability: 0.9 },
        { startFrame: 100, endFrame: 200, probability: 0.1 },
        { startFrame: 200, endFrame: 300, probability: 0.9 },
        { startFrame: 300, endFrame: 400, probability: 0.9 },
        { startFrame: 400, endFrame: 500, probability: 0.1 },
        { startFrame: 500, endFrame: 600, probability: 0.9 },
      ],
      { threshold: 0.5, minSpeechDurationFrames: 150, mergeGapFrames: 250 },
    );
    expect(result).toEqual([{ startFrame: 200, endFrame: 400 }]);
  });

  it("keeps a gap equal to the merge threshold as a boundary", () => {
    expect(
      deriveSpeechIntervals(
        [
          { startFrame: 0, endFrame: 100, probability: 1 },
          { startFrame: 200, endFrame: 300, probability: 1 },
        ],
        { minSpeechDurationFrames: 0, mergeGapFrames: 100 },
      ),
    ).toEqual([
      { startFrame: 0, endFrame: 100 },
      { startFrame: 200, endFrame: 300 },
    ]);
  });

  it("uses the contract's 250 ms minimum by default on the canonical timeline", () => {
    expect(
      deriveSpeechIntervals([
        { startFrame: 0, endFrame: 11_999, probability: 1 },
        { startFrame: 11_999, endFrame: 12_000, probability: 0 },
      ]),
    ).toEqual([]);
    expect(
      deriveSpeechIntervals([
        { startFrame: 0, endFrame: 12_000, probability: 1 },
      ]),
    ).toEqual([{ startFrame: 0, endFrame: 12_000 }]);
  });

  it("returns immutable intervals and clamps padded clips", () => {
    const intervals = deriveSpeechIntervals(
      [{ startFrame: 90, endFrame: 120, probability: 1 }],
      { minSpeechDurationFrames: 0, mergeGapFrames: 0 },
    );
    const clips = derivePaddedClips(intervals, 150, {
      preRollFrames: 100,
      postRollFrames: 100,
    });
    expect(clips).toEqual([{ startFrame: 0, endFrame: 150 }]);
    expect(Object.isFrozen(intervals)).toBe(true);
    expect(Object.isFrozen(intervals[0])).toBe(true);
  });

  it("rejects unsorted source intervals before adding padding", () => {
    expect(() =>
      derivePaddedClips(
        [
          { startFrame: 100, endFrame: 120 },
          { startFrame: 20, endFrame: 40 },
        ],
        200,
        { preRollFrames: 0, postRollFrames: 0 },
      ),
    ).toThrow(RangeError);
  });
});
