import { describe, expect, it, vi } from "vitest";
import {
  analyzePcmSegments,
  StaleSegmentationError,
  type SegmentationPageReader,
  type SpeechLikelihoodClassifier,
} from "./segmentation";

const readerFrom = (
  channels: readonly Float32Array[],
  pageFrames: number,
): SegmentationPageReader => ({
  sampleRate: 48_000,
  totalFrames: channels[0]?.length ?? 0,
  channelCount: channels.length as 1 | 2,
  async *pages(signal) {
    for (
      let startFrame = 0;
      startFrame < (channels[0]?.length ?? 0);
      startFrame += pageFrames
    ) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const endFrame = Math.min(
        channels[0]?.length ?? 0,
        startFrame + pageFrames,
      );
      const pageChannels = channels.map((channel) =>
        channel.slice(startFrame, endFrame),
      );
      const typedChannels =
        pageChannels.length === 1
          ? ([pageChannels[0]!] as const)
          : ([pageChannels[0]!, pageChannels[1]!] as const);
      yield {
        startFrame,
        validFrames: endFrame - startFrame,
        channels: typedChannels,
      };
    }
  },
});

const energyClassifier: SpeechLikelihoodClassifier = {
  id: "test-energy",
  scoreWindow: ({ rmsDb }) => (rmsDb > -30 ? 0.9 : 0.1),
};

const constant = (frames: number, amplitude: number) => {
  const result = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1)
    result[index] = index % 2 === 0 ? amplitude : -amplitude;
  return result;
};

describe("bounded PCM segmentation", () => {
  it("keeps analysis windows sample-accurate across page boundaries and EOF", async () => {
    const source = constant(2_105, 0.2);
    const result = await analyzePcmSegments(readerFrom([source], 1_003), {
      generation: 7,
      classifier: energyClassifier,
      analysisWindowFrames: 960,
      minimumSpeechFrames: 0,
      speechMergeGapFrames: 0,
      minimumSegmentFrames: 960,
    });

    expect(
      result.features.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    ).toEqual([
      [0, 960],
      [960, 1_920],
      [1_920, 2_105],
    ]);
    expect(result.speechIntervals).toEqual([
      { startFrame: 0, endFrame: 2_105 },
    ]);
    expect(result.totalFrames).toBe(2_105);
  });

  it("detects a sustained energy-context change with hysteresis", async () => {
    const low = constant(2_880, 0.03);
    const high = constant(3_840, 0.3);
    const source = new Float32Array(low.length + high.length);
    source.set(low);
    source.set(high, low.length);

    const result = await analyzePcmSegments(readerFrom([source], 1_111), {
      generation: 1,
      classifier: energyClassifier,
      analysisWindowFrames: 960,
      noiseChangeEnterDb: 8,
      noiseChangeExitDb: 3,
      noiseChangeConfirmationWindows: 2,
      minimumSegmentFrames: 1_920,
      minimumSpeechFrames: 0,
      speechMergeGapFrames: 0,
      speechPreRollFrames: 0,
      speechPostRollFrames: 0,
    });

    expect(result.noiseChangeBoundaries).toEqual([2_880]);
    expect(result.segments).toEqual([
      { startFrame: 0, endFrame: 2_880 },
      { startFrame: 2_880, endFrame: 6_720 },
    ]);
  });

  it("keeps silence as one non-speech segment", async () => {
    const result = await analyzePcmSegments(
      readerFrom([new Float32Array(2_101)], 700),
      {
        generation: 2,
        analysisWindowFrames: 960,
        minimumSegmentFrames: 960,
      },
    );
    expect(result.speechIntervals).toEqual([]);
    expect(result.speechClips).toEqual([]);
    expect(result.segments).toEqual([{ startFrame: 0, endFrame: 2_101 }]);
    expect(result.features.at(-1)).toMatchObject({
      startFrame: 1_920,
      endFrame: 2_101,
      rmsDb: -120,
    });
  });

  it("uses the explicit arithmetic stereo downmix", async () => {
    const left = constant(960, 0.4);
    const right = Float32Array.from(left, (sample) => -sample);
    const result = await analyzePcmSegments(readerFrom([left, right], 731), {
      generation: 9,
      analysisWindowFrames: 960,
      minimumSegmentFrames: 960,
    });
    expect(result.features[0]).toMatchObject({
      rmsDb: -120,
      speechLikelihood: 0,
    });
  });

  it("pads speech clips while preserving an unpadded shared mask", async () => {
    const source = new Float32Array(4_800);
    source.set(constant(1_920, 0.3), 960);
    const result = await analyzePcmSegments(readerFrom([source], 1_200), {
      generation: 3,
      classifier: energyClassifier,
      analysisWindowFrames: 960,
      minimumSpeechFrames: 960,
      speechMergeGapFrames: 0,
      speechPreRollFrames: 480,
      speechPostRollFrames: 960,
      minimumSegmentFrames: 960,
    });
    expect(result.speechIntervals).toEqual([
      { startFrame: 960, endFrame: 2_880 },
    ]);
    expect(result.speechClips).toEqual([{ startFrame: 480, endFrame: 3_840 }]);
  });

  it("cancels between bounded windows and stops progress", async () => {
    const controller = new AbortController();
    const onProgress = vi.fn(() => controller.abort());
    await expect(
      analyzePcmSegments(readerFrom([constant(2_880, 0.2)], 2_880), {
        generation: 4,
        classifier: energyClassifier,
        analysisWindowFrames: 960,
        minimumSegmentFrames: 960,
        signal: controller.signal,
        onProgress,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale generation before committing a result", async () => {
    let current = true;
    await expect(
      analyzePcmSegments(readerFrom([constant(1_920, 0.2)], 1_920), {
        generation: 5,
        classifier: energyClassifier,
        analysisWindowFrames: 960,
        minimumSegmentFrames: 960,
        isGenerationCurrent: () => current,
        onProgress: () => {
          current = false;
        },
      }),
    ).rejects.toBeInstanceOf(StaleSegmentationError);
  });

  it("rejects gaps instead of silently shifting the timeline", async () => {
    const badReader: SegmentationPageReader = {
      sampleRate: 48_000,
      totalFrames: 960,
      channelCount: 1,
      async *pages() {
        yield {
          startFrame: 1,
          validFrames: 959,
          channels: [new Float32Array(959)],
        };
      },
    };
    await expect(
      analyzePcmSegments(badReader, {
        generation: 6,
        analysisWindowFrames: 480,
        minimumSegmentFrames: 480,
      }),
    ).rejects.toThrow("contiguous and ordered");
  });
});
