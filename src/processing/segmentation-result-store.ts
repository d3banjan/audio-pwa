import type { FrameInterval } from "../audio-domain/timeline";
import type {
  ProcessingSourceIdentity,
  SegmentationResultReference,
  SegmentationResultStore,
} from "./processing-job";
import {
  MAX_ANALYSIS_WINDOW_FRAMES,
  MAX_SEGMENTATION_FRAMES,
  MIN_ANALYSIS_WINDOW_FRAMES,
  type AnalysisFeature,
  type SegmentationResult,
} from "./segmentation";

const DATABASE_NAME = "cinematic-audio-i009";
const STORE_NAME = "manifests";
const INPUT_POINTER_KEY = "current";
const RESULT_POINTER_KEY = "segmentation:current";
const RESULT_KEY_PREFIX = "segmentation:";

export type CommittedSegmentationManifest = Readonly<{
  schemaVersion: 1;
  resultId: string;
  sourceRunId: string;
  sourceGeneration: number;
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
  state: "complete";
}>;

export interface SegmentationManifestRepository {
  commit(
    metadata: Omit<
      CommittedSegmentationManifest,
      "sourceRunId" | "sourceGeneration"
    >,
    expectedSource: ProcessingSourceIdentity,
    stillCurrent: () => void,
  ): Promise<SegmentationResultReference>;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const safeInteger = (value: number, minimum = 0) =>
  Number.isSafeInteger(value) && value >= minimum;
const finite = (value: number) => Number.isFinite(value);

const validateIntervals = (
  values: readonly FrameInterval[],
  totalFrames: number,
  name: string,
  requirePartition = false,
) => {
  if (values.length > Math.ceil(totalFrames / MIN_ANALYSIS_WINDOW_FRAMES) + 1)
    throw new RangeError(`${name} exceeds the bounded metadata limit.`);
  let previousEnd = 0;
  for (const [index, interval] of values.entries()) {
    if (
      !safeInteger(interval.startFrame) ||
      !safeInteger(interval.endFrame) ||
      interval.startFrame >= interval.endFrame ||
      interval.endFrame > totalFrames ||
      interval.startFrame < previousEnd ||
      (requirePartition && interval.startFrame !== previousEnd)
    )
      throw new RangeError(`${name} contains an invalid interval.`);
    previousEnd = interval.endFrame;
    if (
      requirePartition &&
      index === values.length - 1 &&
      previousEnd !== totalFrames
    )
      throw new RangeError(`${name} does not cover the complete timeline.`);
  }
  if (requirePartition && totalFrames > 0 && values.length === 0)
    throw new RangeError(`${name} does not cover the complete timeline.`);
};

export function validateSegmentationResult(
  result: SegmentationResult,
  generation: number,
): SegmentationResult {
  if (
    result.schemaVersion !== 1 ||
    result.generation !== generation ||
    result.sampleRate !== 48_000 ||
    !safeInteger(result.totalFrames) ||
    result.totalFrames > MAX_SEGMENTATION_FRAMES ||
    !safeInteger(result.analysisWindowFrames, MIN_ANALYSIS_WINDOW_FRAMES) ||
    result.analysisWindowFrames > MAX_ANALYSIS_WINDOW_FRAMES ||
    typeof result.classifierId !== "string" ||
    result.classifierId.length === 0 ||
    result.classifierId.length > 128
  )
    throw new RangeError(
      "Segmentation result identity or timeline is invalid.",
    );
  const maximumFeatures = Math.ceil(
    result.totalFrames / result.analysisWindowFrames,
  );
  if (result.features.length !== maximumFeatures)
    throw new RangeError("Segmentation features do not cover the timeline.");
  let nextFrame = 0;
  for (const feature of result.features) {
    if (
      feature.startFrame !== nextFrame ||
      !safeInteger(feature.endFrame, feature.startFrame + 1) ||
      feature.endFrame > result.totalFrames ||
      feature.endFrame - feature.startFrame > result.analysisWindowFrames ||
      !finite(feature.rmsDb) ||
      !finite(feature.zeroCrossingRate) ||
      feature.zeroCrossingRate < 0 ||
      feature.zeroCrossingRate > 1 ||
      !finite(feature.speechLikelihood) ||
      feature.speechLikelihood < 0 ||
      feature.speechLikelihood > 1
    )
      throw new RangeError("Segmentation contains an invalid feature.");
    nextFrame = feature.endFrame;
  }
  if (nextFrame !== result.totalFrames)
    throw new RangeError("Segmentation features do not cover the timeline.");
  validateIntervals(
    result.speechIntervals,
    result.totalFrames,
    "speechIntervals",
  );
  validateIntervals(result.speechClips, result.totalFrames, "speechClips");
  validateIntervals(result.segments, result.totalFrames, "segments", true);
  let previousBoundary = 0;
  for (const boundary of result.noiseChangeBoundaries) {
    if (
      !safeInteger(boundary, 1) ||
      boundary >= result.totalFrames ||
      boundary <= previousBoundary
    )
      throw new RangeError("Noise-change boundaries are invalid.");
    previousBoundary = boundary;
  }
  return result;
}

export function createTransactionalSegmentationResultStore(
  repository: SegmentationManifestRepository = browserSegmentationRepository(),
  randomId: () => string = () => crypto.randomUUID(),
): SegmentationResultStore {
  return {
    async commit(result, context) {
      validateSegmentationResult(result, context.generation);
      const resultId = `segmentation-${randomId()}`;
      if (!/^segmentation-[a-zA-Z0-9-]+$/.test(resultId))
        throw new Error("Segmentation result identity is unsafe.");
      const stillCurrent = () => {
        if (context.signal.aborted)
          throw new DOMException(
            "Segmentation commit cancelled.",
            "AbortError",
          );
        if (!context.isGenerationCurrent(context.generation))
          throw new Error("Segmentation commit belongs to a stale generation.");
      };
      stillCurrent();
      return repository.commit(
        Object.freeze({
          ...result,
          resultId,
          state: "complete" as const,
        }),
        context.source,
        stillCurrent,
      );
    },
  };
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Manifest storage failed."));
    request.onsuccess = () => resolve(request.result);
  });

const pointerId = (value: unknown, key: "runId" | "resultId") =>
  record(value) && typeof value[key] === "string" ? value[key] : undefined;

export const browserSegmentationRepository =
  (): SegmentationManifestRepository => ({
    async commit(metadata, expectedSource, stillCurrent) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        let reference: SegmentationResultReference | undefined;
        let previousResultId: string | undefined;
        const pointerRequest = store.get(INPUT_POINTER_KEY);
        pointerRequest.onsuccess = () => {
          try {
            stillCurrent();
            const sourceRunId = pointerId(pointerRequest.result, "runId");
            if (!sourceRunId || sourceRunId !== expectedSource.runId)
              return transaction.abort();
            const sourceRequest = store.get(sourceRunId);
            sourceRequest.onsuccess = () => {
              try {
                stillCurrent();
                const source = sourceRequest.result;
                if (
                  !record(source) ||
                  source["state"] !== "complete" ||
                  source["generation"] !== expectedSource.generation ||
                  source["sampleRate"] !== 48_000 ||
                  source["channels"] !== 2 ||
                  source["validFrames"] !== metadata.totalFrames
                )
                  return transaction.abort();
                const manifest: CommittedSegmentationManifest = Object.freeze({
                  ...metadata,
                  sourceRunId,
                  sourceGeneration: expectedSource.generation,
                });
                reference = Object.freeze({
                  schemaVersion: 1 as const,
                  resultId: metadata.resultId,
                  generation: metadata.generation,
                  classifierId: metadata.classifierId,
                });
                const previousRequest = store.get(RESULT_POINTER_KEY);
                previousRequest.onsuccess = () => {
                  try {
                    stillCurrent();
                    previousResultId = pointerId(
                      previousRequest.result,
                      "resultId",
                    );
                    store.put(
                      manifest,
                      `${RESULT_KEY_PREFIX}${metadata.resultId}`,
                    );
                    store.put(
                      { resultId: metadata.resultId },
                      RESULT_POINTER_KEY,
                    );
                    if (
                      previousResultId &&
                      previousResultId !== metadata.resultId
                    )
                      store.delete(`${RESULT_KEY_PREFIX}${previousResultId}`);
                  } catch {
                    transaction.abort();
                  }
                };
                previousRequest.onerror = () => transaction.abort();
              } catch {
                transaction.abort();
              }
            };
            sourceRequest.onerror = () => transaction.abort();
          } catch {
            transaction.abort();
          }
        };
        pointerRequest.onerror = () => transaction.abort();
        transaction.oncomplete = () => {
          db.close();
          if (reference) resolve(reference);
          else reject(new Error("Segmentation publication did not complete."));
        };
        transaction.onabort = transaction.onerror = () => {
          db.close();
          reject(
            transaction.error ??
              new Error("Segmentation publication was rejected as stale."),
          );
        };
      });
    },
  });
