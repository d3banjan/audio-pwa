import type { FrameInterval } from "./timeline";

export type VadProbabilityFrame = Readonly<
  FrameInterval & { probability: number }
>;

export type VadIntervalOptions = Readonly<{
  threshold?: number;
  minSpeechDurationFrames?: number;
  mergeGapFrames?: number;
}>;

export type ClipPadding = Readonly<{
  preRollFrames: number;
  postRollFrames: number;
}>;

/** Defaults from the product contract, expressed in canonical 48 kHz frames. */
export const DEFAULT_VAD_THRESHOLD = 0.5;
export const DEFAULT_MIN_SPEECH_DURATION_FRAMES = 12_000; // 250 ms @ 48 kHz
export const DEFAULT_MERGE_GAP_FRAMES = 14_400; // 300 ms @ 48 kHz

function assertFrame(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertInterval(interval: FrameInterval, name: string): void {
  assertFrame(interval.startFrame, `${name}.startFrame`);
  assertFrame(interval.endFrame, `${name}.endFrame`);
  if (interval.endFrame <= interval.startFrame) {
    throw new RangeError(`${name} must have a positive duration`);
  }
}

function freezeIntervals(intervals: FrameInterval[]): readonly FrameInterval[] {
  return Object.freeze(
    intervals.map((interval) => Object.freeze({ ...interval })),
  );
}

function validateProbabilityFrames(
  frames: readonly VadProbabilityFrame[],
): void {
  let previousEnd = 0;
  frames.forEach((frame, index) => {
    assertInterval(frame, `frames[${index}]`);
    if (
      !Number.isFinite(frame.probability) ||
      frame.probability < 0 ||
      frame.probability > 1
    ) {
      throw new RangeError(
        `frames[${index}].probability must be between 0 and 1`,
      );
    }
    if (index > 0 && frame.startFrame < previousEnd) {
      throw new RangeError(
        "VAD probability frames must be sorted and non-overlapping",
      );
    }
    previousEnd = frame.endFrame;
  });
}

/**
 * Derive the shared, unpadded speech mask from cached VAD probabilities.
 *
 * Short active runs are filtered before nearby surviving runs are merged. The
 * strict `< mergeGapFrames` rule matches the product contract: a gap exactly
 * equal to the hang time remains a boundary.
 */
export function deriveSpeechIntervals(
  frames: readonly VadProbabilityFrame[],
  options: VadIntervalOptions = {},
): readonly FrameInterval[] {
  validateProbabilityFrames(frames);
  const threshold = options.threshold ?? DEFAULT_VAD_THRESHOLD;
  const minSpeechDurationFrames =
    options.minSpeechDurationFrames ?? DEFAULT_MIN_SPEECH_DURATION_FRAMES;
  const mergeGapFrames = options.mergeGapFrames ?? DEFAULT_MERGE_GAP_FRAMES;

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("threshold must be between 0 and 1");
  }
  assertFrame(minSpeechDurationFrames, "minSpeechDurationFrames");
  assertFrame(mergeGapFrames, "mergeGapFrames");

  const activeRuns: FrameInterval[] = [];
  for (const frame of frames) {
    if (frame.probability < threshold) {
      continue;
    }
    const last = activeRuns[activeRuns.length - 1];
    if (last && last.endFrame === frame.startFrame) {
      activeRuns[activeRuns.length - 1] = {
        startFrame: last.startFrame,
        endFrame: frame.endFrame,
      };
    } else {
      activeRuns.push({
        startFrame: frame.startFrame,
        endFrame: frame.endFrame,
      });
    }
  }

  const survivors = activeRuns.filter(
    (interval) =>
      interval.endFrame - interval.startFrame >= minSpeechDurationFrames,
  );
  const merged: FrameInterval[] = [];
  for (const interval of survivors) {
    const last = merged[merged.length - 1];
    if (last && interval.startFrame - last.endFrame < mergeGapFrames) {
      merged[merged.length - 1] = {
        startFrame: last.startFrame,
        endFrame: Math.max(last.endFrame, interval.endFrame),
      };
    } else {
      merged.push({ ...interval });
    }
  }
  return freezeIntervals(merged);
}

/** Add non-destructive clip padding and clamp to the project timeline. */
export function derivePaddedClips(
  intervals: readonly FrameInterval[],
  totalFrames: number,
  padding: ClipPadding,
): readonly FrameInterval[] {
  assertFrame(totalFrames, "totalFrames");
  assertFrame(padding.preRollFrames, "padding.preRollFrames");
  assertFrame(padding.postRollFrames, "padding.postRollFrames");

  const padded: FrameInterval[] = [];
  let previousEnd = 0;
  for (const interval of intervals) {
    assertInterval(interval, "interval");
    if (interval.endFrame > totalFrames) {
      throw new RangeError("interval.endFrame cannot exceed totalFrames");
    }
    if (interval.startFrame < previousEnd) {
      throw new RangeError("intervals must be sorted and non-overlapping");
    }
    previousEnd = interval.endFrame;
    const startFrame = Math.max(0, interval.startFrame - padding.preRollFrames);
    const endFrame = Math.min(
      totalFrames,
      interval.endFrame + padding.postRollFrames,
    );
    const last = padded[padded.length - 1];
    if (last && startFrame <= last.endFrame) {
      padded[padded.length - 1] = {
        startFrame: last.startFrame,
        endFrame: Math.max(last.endFrame, endFrame),
      };
    } else {
      padded.push({ startFrame, endFrame });
    }
  }
  return freezeIntervals(padded);
}
