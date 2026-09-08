/**
 * Integer timeline helpers for audio model boundaries.
 *
 * Audio intervals are half-open: [startFrame, endFrame).  The conversion
 * functions use integer arithmetic so a long sequence of chunk boundaries
 * cannot accumulate floating-point rounding drift.
 */

export type FrameInterval = Readonly<{
  startFrame: number;
  endFrame: number;
}>;

export type FrameRounding = "floor" | "ceil" | "nearest";

export type FrameMapOptions = Readonly<{
  startRounding?: FrameRounding;
  endRounding?: FrameRounding;
  /** Offset in the destination rate, applied after rate conversion. */
  destinationOffsetFrames?: number;
}>;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertFrame(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertRounding(value: FrameRounding): void {
  if (value !== "floor" && value !== "ceil" && value !== "nearest") {
    throw new RangeError(`Unsupported frame rounding mode: ${value}`);
  }
}

function bigintToSafeNumber(value: bigint, name: string): number {
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    throw new RangeError(`${name} is outside the safe integer range`);
  }
  return Number(value);
}

function addSafeFrames(left: number, right: number, name: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`${name} is outside the safe integer range`);
  }
  return result;
}

function roundRational(
  numerator: bigint,
  denominator: bigint,
  rounding: FrameRounding,
): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  switch (rounding) {
    case "floor":
      return quotient;
    case "ceil":
      return remainder === 0n ? quotient : quotient + 1n;
    case "nearest":
      return remainder * 2n >= denominator ? quotient + 1n : quotient;
  }
}

/** Convert one frame offset between integer sample rates without drift. */
export function mapFrameOffset(
  frame: number,
  sourceRate: number,
  destinationRate: number,
  rounding: FrameRounding = "nearest",
): number {
  assertFrame(frame, "frame");
  assertPositiveInteger(sourceRate, "sourceRate");
  assertPositiveInteger(destinationRate, "destinationRate");
  assertRounding(rounding);

  const mapped = roundRational(
    BigInt(frame) * BigInt(destinationRate),
    BigInt(sourceRate),
    rounding,
  );
  return bigintToSafeNumber(mapped, "mapped frame");
}

/**
 * Map a half-open interval between rates.  Flooring the start and ceiling the
 * end preserves every source sample represented by the interval.
 */
export function mapFrameInterval(
  interval: FrameInterval,
  sourceRate: number,
  destinationRate: number,
  options: FrameMapOptions = {},
): FrameInterval {
  assertFrame(interval.startFrame, "interval.startFrame");
  assertFrame(interval.endFrame, "interval.endFrame");
  if (interval.endFrame < interval.startFrame) {
    throw new RangeError(
      "interval.endFrame must be at least interval.startFrame",
    );
  }

  const startRounding = options.startRounding ?? "floor";
  const endRounding = options.endRounding ?? "ceil";
  assertRounding(startRounding);
  assertRounding(endRounding);

  const destinationOffsetFrames = options.destinationOffsetFrames ?? 0;
  assertFrame(destinationOffsetFrames, "destinationOffsetFrames");

  const start = mapFrameOffset(
    interval.startFrame,
    sourceRate,
    destinationRate,
    startRounding,
  );
  const end = mapFrameOffset(
    interval.endFrame,
    sourceRate,
    destinationRate,
    endRounding,
  );

  return Object.freeze({
    startFrame: addSafeFrames(
      start,
      destinationOffsetFrames,
      "mapped interval start",
    ),
    endFrame: addSafeFrames(
      end,
      destinationOffsetFrames,
      "mapped interval end",
    ),
  });
}

/** Convert seconds to a frame count using an explicit rounding policy. */
export function secondsToFrames(
  seconds: number,
  sampleRate: number,
  rounding: FrameRounding = "nearest",
): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError("seconds must be a finite non-negative number");
  }
  assertPositiveInteger(sampleRate, "sampleRate");
  assertRounding(rounding);

  const exactFrames = seconds * sampleRate;
  if (
    !Number.isSafeInteger(exactFrames) &&
    exactFrames > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      "secondsToFrames result is outside the safe integer range",
    );
  }

  switch (rounding) {
    case "floor":
      return Math.floor(exactFrames);
    case "ceil":
      return Math.ceil(exactFrames);
    case "nearest":
      return Math.floor(exactFrames + 0.5);
  }
}

export function framesToSeconds(frames: number, sampleRate: number): number {
  assertFrame(frames, "frames");
  assertPositiveInteger(sampleRate, "sampleRate");
  return frames / sampleRate;
}
