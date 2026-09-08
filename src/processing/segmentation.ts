import {
  derivePaddedClips,
  deriveSpeechIntervals,
  type VadProbabilityFrame,
} from "../audio-domain/vad-intervals";
import type { FrameInterval } from "../audio-domain/timeline";

export const SEGMENTATION_SAMPLE_RATE = 48_000;
export const DEFAULT_ANALYSIS_WINDOW_FRAMES = 960; // 20 ms
export const MIN_ANALYSIS_WINDOW_FRAMES = 480; // 10 ms
export const MAX_ANALYSIS_WINDOW_FRAMES = 48_000; // 1 second
export const MAX_PCM_PAGE_FRAMES = SEGMENTATION_SAMPLE_RATE * 5;
export const MAX_SEGMENTATION_FRAMES = SEGMENTATION_SAMPLE_RATE * 900;
export const MAX_ANALYSIS_WINDOWS = Math.ceil(
  MAX_SEGMENTATION_FRAMES / DEFAULT_ANALYSIS_WINDOW_FRAMES,
);

export type SegmentationPcmPage = Readonly<{
  startFrame: number;
  validFrames: number;
  channels: readonly [Float32Array] | readonly [Float32Array, Float32Array];
}>;

export interface SegmentationPageReader {
  readonly sampleRate: 48_000;
  readonly totalFrames: number;
  readonly channelCount: 1 | 2;
  pages(signal: AbortSignal): AsyncIterable<SegmentationPcmPage>;
}

export type AnalysisFeature = Readonly<{
  startFrame: number;
  endFrame: number;
  rmsDb: number;
  zeroCrossingRate: number;
  speechLikelihood: number;
}>;

export type SpeechWindow = Readonly<{
  mono: Float32Array;
  startFrame: number;
  endFrame: number;
  rmsDb: number;
  zeroCrossingRate: number;
}>;

/** Replace this scorer with a pinned ONNX VAD without changing timeline output. */
export interface SpeechLikelihoodClassifier {
  readonly id: string;
  scoreWindow(
    window: SpeechWindow,
    signal: AbortSignal,
  ): number | Promise<number>;
}

export type SegmentationProgress = Readonly<{
  generation: number;
  completedFrames: number;
  totalFrames: number;
  completedWindows: number;
}>;

export type SegmentationOptions = Readonly<{
  generation: number;
  signal?: AbortSignal;
  isGenerationCurrent?: (generation: number) => boolean;
  classifier?: SpeechLikelihoodClassifier;
  analysisWindowFrames?: number;
  speechThreshold?: number;
  minimumSpeechFrames?: number;
  speechMergeGapFrames?: number;
  speechPreRollFrames?: number;
  speechPostRollFrames?: number;
  noiseChangeEnterDb?: number;
  noiseChangeExitDb?: number;
  noiseChangeConfirmationWindows?: number;
  minimumSegmentFrames?: number;
  onProgress?: (progress: SegmentationProgress) => void;
}>;

export type SegmentationResult = Readonly<{
  schemaVersion: 1;
  generation: number;
  classifierId: string;
  sampleRate: 48_000;
  totalFrames: number;
  analysisWindowFrames: number;
  features: readonly AnalysisFeature[];
  speechIntervals: readonly FrameInterval[];
  speechClips: readonly FrameInterval[];
  noiseChangeBoundaries: readonly number[];
  segments: readonly FrameInterval[];
}>;

export class StaleSegmentationError extends Error {
  constructor() {
    super("Segmentation result belongs to a stale project generation.");
    this.name = "StaleSegmentationError";
  }
}

const abortError = () =>
  new DOMException("Segmentation cancelled.", "AbortError");

const assertPositiveInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive safe integer`);
};

const assertNonNegativeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer`);
};

const assertFiniteRange = (
  value: number,
  minimum: number,
  maximum: number,
  name: string,
) => {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
};

const throwIfStopped = (
  signal: AbortSignal,
  generation: number,
  isGenerationCurrent?: (generation: number) => boolean,
) => {
  if (signal.aborted) throw abortError();
  if (isGenerationCurrent && !isGenerationCurrent(generation))
    throw new StaleSegmentationError();
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * LEAKY ABSTRACTION: This deterministic DSP score is an energy/activity hint,
 * not neural voice detection. UI and persisted metadata must call it the DSP
 * fallback until a qualified model implements SpeechLikelihoodClassifier.
 */
export const dspSpeechLikelihoodClassifier: SpeechLikelihoodClassifier = {
  id: "dsp-energy-zcr-v1",
  scoreWindow(window) {
    if (window.rmsDb <= -72) return 0;
    const energy = clamp01((window.rmsDb + 58) / 28);
    const zcr = window.zeroCrossingRate;
    const speechBand = clamp01(1 - Math.abs(zcr - 0.1) / 0.25);
    return clamp01(energy * (0.72 + 0.28 * speechBand));
  },
};

const computeWindowStats = (samples: Float32Array) => {
  let energy = 0;
  let crossings = 0;
  let previous = samples[0] ?? 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    energy += sample * sample;
    if (
      index > 0 &&
      ((previous < 0 && sample >= 0) || (previous >= 0 && sample < 0))
    )
      crossings += 1;
    previous = sample;
  }
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  return {
    rmsDb: rms > 0 ? 20 * Math.log10(rms) : -120,
    zeroCrossingRate: crossings / Math.max(1, samples.length - 1),
  };
};

const freezeIntervals = (intervals: readonly FrameInterval[]) =>
  Object.freeze(intervals.map((interval) => Object.freeze({ ...interval })));

const createSegments = (
  boundaries: readonly number[],
  totalFrames: number,
): readonly FrameInterval[] => {
  if (totalFrames === 0) return Object.freeze([]);
  const result: FrameInterval[] = [];
  let startFrame = 0;
  for (const boundary of boundaries) {
    result.push(Object.freeze({ startFrame, endFrame: boundary }));
    startFrame = boundary;
  }
  result.push(Object.freeze({ startFrame, endFrame: totalFrames }));
  return Object.freeze(result);
};

export async function analyzePcmSegments(
  reader: SegmentationPageReader,
  options: SegmentationOptions,
): Promise<SegmentationResult> {
  if (reader.sampleRate !== SEGMENTATION_SAMPLE_RATE)
    throw new RangeError("Segmentation input must use canonical 48 kHz PCM");
  assertNonNegativeInteger(reader.totalFrames, "reader.totalFrames");
  if (reader.totalFrames > MAX_SEGMENTATION_FRAMES)
    throw new RangeError("Segmentation input exceeds the 900 second MVP limit");
  if (reader.channelCount !== 1 && reader.channelCount !== 2)
    throw new RangeError("Segmentation input must be mono or stereo");
  assertNonNegativeInteger(options.generation, "options.generation");

  const windowFrames =
    options.analysisWindowFrames ?? DEFAULT_ANALYSIS_WINDOW_FRAMES;
  const minimumSpeechFrames = options.minimumSpeechFrames ?? 12_000;
  const speechMergeGapFrames = options.speechMergeGapFrames ?? 14_400;
  const speechPreRollFrames = options.speechPreRollFrames ?? 4_800;
  const speechPostRollFrames = options.speechPostRollFrames ?? 7_200;
  const enterDb = options.noiseChangeEnterDb ?? 8;
  const exitDb = options.noiseChangeExitDb ?? 4;
  const confirmationWindows = options.noiseChangeConfirmationWindows ?? 5;
  const minimumSegmentFrames = options.minimumSegmentFrames ?? 96_000;
  const speechThreshold = options.speechThreshold ?? 0.5;
  assertPositiveInteger(windowFrames, "analysisWindowFrames");
  if (
    windowFrames < MIN_ANALYSIS_WINDOW_FRAMES ||
    windowFrames > MAX_ANALYSIS_WINDOW_FRAMES
  )
    throw new RangeError("analysisWindowFrames must be between 480 and 48000");
  assertNonNegativeInteger(minimumSpeechFrames, "minimumSpeechFrames");
  assertNonNegativeInteger(speechMergeGapFrames, "speechMergeGapFrames");
  assertNonNegativeInteger(speechPreRollFrames, "speechPreRollFrames");
  assertNonNegativeInteger(speechPostRollFrames, "speechPostRollFrames");
  assertPositiveInteger(confirmationWindows, "noiseChangeConfirmationWindows");
  assertPositiveInteger(minimumSegmentFrames, "minimumSegmentFrames");
  assertFiniteRange(speechThreshold, 0, 1, "speechThreshold");
  if (!Number.isFinite(enterDb) || !Number.isFinite(exitDb) || exitDb < 0)
    throw new RangeError(
      "Noise-change thresholds must be finite and non-negative",
    );
  if (enterDb <= exitDb)
    throw new RangeError("noiseChangeEnterDb must exceed noiseChangeExitDb");

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const classifier = options.classifier ?? dspSpeechLikelihoodClassifier;
  const features: AnalysisFeature[] = [];
  const probabilityFrames: VadProbabilityFrame[] = [];
  const provisionalBoundaries: number[] = [];
  const monoWindow = new Float32Array(windowFrames);
  let windowFill = 0;
  let nextInputFrame = 0;
  let completedWindows = 0;
  let baselineDb: number | undefined;
  let candidateStart: number | undefined;
  let candidateDirection = 0;
  let candidateCount = 0;
  let lastBoundary = 0;

  const processWindow = async (validFrames: number) => {
    throwIfStopped(signal, options.generation, options.isGenerationCurrent);
    const startFrame = nextInputFrame - validFrames;
    const endFrame = nextInputFrame;
    const samples =
      validFrames === monoWindow.length
        ? monoWindow
        : monoWindow.slice(0, validFrames);
    const stats = computeWindowStats(samples);
    const speechLikelihood = await classifier.scoreWindow(
      Object.freeze({
        mono: samples,
        startFrame,
        endFrame,
        ...stats,
      }),
      signal,
    );
    throwIfStopped(signal, options.generation, options.isGenerationCurrent);
    assertFiniteRange(speechLikelihood, 0, 1, "classifier speech likelihood");
    const feature = Object.freeze({
      startFrame,
      endFrame,
      ...stats,
      speechLikelihood,
    });
    features.push(feature);
    probabilityFrames.push(
      Object.freeze({ startFrame, endFrame, probability: speechLikelihood }),
    );

    if (baselineDb === undefined) {
      baselineDb = stats.rmsDb;
    } else {
      const delta = stats.rmsDb - baselineDb;
      const direction = Math.sign(delta);
      if (Math.abs(delta) >= enterDb && direction === candidateDirection) {
        candidateCount += 1;
      } else if (Math.abs(delta) >= enterDb) {
        candidateStart = startFrame;
        candidateDirection = direction;
        candidateCount = 1;
      } else if (
        Math.abs(delta) <= exitDb ||
        direction !== candidateDirection
      ) {
        candidateStart = undefined;
        candidateDirection = 0;
        candidateCount = 0;
        baselineDb += 0.025 * delta;
      }
      if (
        candidateStart !== undefined &&
        candidateCount >= confirmationWindows &&
        candidateStart - lastBoundary >= minimumSegmentFrames
      ) {
        provisionalBoundaries.push(candidateStart);
        lastBoundary = candidateStart;
        baselineDb = stats.rmsDb;
        candidateStart = undefined;
        candidateDirection = 0;
        candidateCount = 0;
      }
    }

    completedWindows += 1;
    options.onProgress?.(
      Object.freeze({
        generation: options.generation,
        completedFrames: endFrame,
        totalFrames: reader.totalFrames,
        completedWindows,
      }),
    );
  };

  throwIfStopped(signal, options.generation, options.isGenerationCurrent);
  for await (const page of reader.pages(signal)) {
    throwIfStopped(signal, options.generation, options.isGenerationCurrent);
    assertNonNegativeInteger(page.startFrame, "page.startFrame");
    assertPositiveInteger(page.validFrames, "page.validFrames");
    if (page.validFrames > MAX_PCM_PAGE_FRAMES)
      throw new RangeError("PCM analysis page exceeds the five-second limit");
    if (page.startFrame !== nextInputFrame)
      throw new RangeError("PCM analysis pages must be contiguous and ordered");
    if (page.channels.length !== reader.channelCount)
      throw new RangeError("PCM page channel count does not match its reader");
    for (const channel of page.channels)
      if (channel.length < page.validFrames)
        throw new RangeError("PCM page channel is shorter than validFrames");
      else if (channel.length > MAX_PCM_PAGE_FRAMES)
        throw new RangeError(
          "PCM page allocation exceeds the five-second limit",
        );
    if (nextInputFrame + page.validFrames > reader.totalFrames)
      throw new RangeError("PCM page exceeds the declared canonical timeline");

    for (let pageFrame = 0; pageFrame < page.validFrames; pageFrame += 1) {
      const left = page.channels[0][pageFrame] ?? 0;
      const right = page.channels[1]?.[pageFrame] ?? left;
      monoWindow[windowFill] = (left + right) * 0.5;
      windowFill += 1;
      nextInputFrame += 1;
      if (windowFill === windowFrames) {
        await processWindow(windowFill);
        windowFill = 0;
      }
    }
  }
  if (nextInputFrame !== reader.totalFrames)
    throw new RangeError(
      "PCM pages ended before the declared canonical timeline",
    );
  if (windowFill > 0) await processWindow(windowFill);
  throwIfStopped(signal, options.generation, options.isGenerationCurrent);

  const boundaries = Object.freeze(
    provisionalBoundaries.filter(
      (boundary) => reader.totalFrames - boundary >= minimumSegmentFrames,
    ),
  );
  const speechIntervals = deriveSpeechIntervals(probabilityFrames, {
    threshold: speechThreshold,
    minSpeechDurationFrames: minimumSpeechFrames,
    mergeGapFrames: speechMergeGapFrames,
  });
  const speechClips = derivePaddedClips(speechIntervals, reader.totalFrames, {
    preRollFrames: speechPreRollFrames,
    postRollFrames: speechPostRollFrames,
  });

  return Object.freeze({
    schemaVersion: 1 as const,
    generation: options.generation,
    classifierId: classifier.id,
    sampleRate: SEGMENTATION_SAMPLE_RATE,
    totalFrames: reader.totalFrames,
    analysisWindowFrames: windowFrames,
    features: Object.freeze(features),
    speechIntervals: freezeIntervals(speechIntervals),
    speechClips: freezeIntervals(speechClips),
    noiseChangeBoundaries: boundaries,
    segments: createSegments(boundaries, reader.totalFrames),
  });
}
