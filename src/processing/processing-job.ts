import {
  analyzePcmSegments,
  type SegmentationOptions,
  type SegmentationPageReader,
  type SegmentationResult,
} from "./segmentation";
import {
  enrichPcmPages,
  type EnrichmentOptions,
  type EnrichmentPageReader,
  type EnrichmentPageWriter,
  type EnrichmentResult,
} from "./chunk-enrichment";

export type ProcessingStage =
  "segmentation" | "enrichment" | "export" | "publication";

export type ProcessingSourceIdentity = Readonly<{
  runId: string;
  generation: number;
}>;

export type ProcessingJobContext = Readonly<{
  jobId: string;
  projectId: string;
  generation: number;
  source: ProcessingSourceIdentity;
  signal: AbortSignal;
  isGenerationCurrent: (generation: number) => boolean;
}>;

export type SegmentationResultReference = Readonly<{
  schemaVersion: 1;
  resultId: string;
  generation: number;
  classifierId: string;
}>;

export interface SegmentationResultStore {
  /** Atomically replaces the committed reference or leaves the old one intact. */
  commit(
    result: SegmentationResult,
    context: ProcessingJobContext,
  ): Promise<SegmentationResultReference>;
}

export type ProcessingJobEvent = Readonly<{
  schemaVersion: 1;
  jobId: string;
  projectId: string;
  generation: number;
  sourceRunId: string;
  sourceGeneration: number;
  stage: Exclude<ProcessingStage, "publication">;
  status: "started" | "progress" | "completed";
  completedUnits: number;
  totalUnits: number;
  unit: "frames";
  overallRatio: number;
}>;

export type ProcessingJobDependencies = Readonly<{
  createSegmentationReader(
    context: ProcessingJobContext,
  ): SegmentationPageReader | Promise<SegmentationPageReader>;
  segmentationStore: SegmentationResultStore;
  createEnrichmentReader(
    context: ProcessingJobContext,
    segmentation: SegmentationResultReference,
  ): EnrichmentPageReader | Promise<EnrichmentPageReader>;
  createEnrichmentWriter(
    context: ProcessingJobContext,
    segmentation: SegmentationResultReference,
  ): EnrichmentPageWriter | Promise<EnrichmentPageWriter>;
}>;

export type ProcessingJobRequest = Readonly<{
  jobId: string;
  projectId: string;
  generation: number;
  source: ProcessingSourceIdentity;
  signal: AbortSignal;
  isGenerationCurrent: (generation: number) => boolean;
  segmentation?: Omit<
    SegmentationOptions,
    "generation" | "signal" | "isGenerationCurrent" | "onProgress"
  >;
  enrichment?: Omit<
    EnrichmentOptions,
    "generation" | "signal" | "isGenerationCurrent" | "onProgress"
  >;
  onEvent?: (event: ProcessingJobEvent) => void;
}>;

export type ProcessingJobResult = Readonly<{
  schemaVersion: 1;
  jobId: string;
  projectId: string;
  generation: number;
  source: ProcessingSourceIdentity;
  segmentation: SegmentationResultReference;
  enrichment: EnrichmentResult;
}>;

export type ProcessingJobErrorCode =
  | "CANCELLED"
  | "STALE_GENERATION"
  | "SEGMENTATION_FAILED"
  | "SEGMENTATION_COMMIT_FAILED"
  | "ENRICHMENT_FAILED"
  | "EXPORT_FAILED";

export class ProcessingJobError extends Error {
  readonly code: ProcessingJobErrorCode;
  readonly stage: ProcessingStage;
  override readonly cause: unknown;

  constructor(
    code: ProcessingJobErrorCode,
    stage: ProcessingStage,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ProcessingJobError";
    this.code = code;
    this.stage = stage;
    this.cause = cause;
  }
}

const isStaleError = (error: unknown) =>
  error instanceof Error &&
  (error.name === "StaleSegmentationError" ||
    error.name === "StaleEnrichmentError");

const throwIfStopped = (
  request: Pick<
    ProcessingJobRequest,
    "signal" | "generation" | "isGenerationCurrent"
  >,
  stage: ProcessingStage,
) => {
  if (request.signal.aborted)
    throw new ProcessingJobError(
      "CANCELLED",
      stage,
      "Processing was cancelled.",
      request.signal.reason,
    );
  if (!request.isGenerationCurrent(request.generation))
    throw new ProcessingJobError(
      "STALE_GENERATION",
      stage,
      "Processing belongs to a stale project generation.",
    );
};

const validateIdentity = (request: ProcessingJobRequest) => {
  if (request.jobId.length === 0) throw new RangeError("jobId is required");
  if (request.projectId.length === 0)
    throw new RangeError("projectId is required");
  if (request.source.runId.length === 0)
    throw new RangeError("source.runId is required");
  if (
    !Number.isSafeInteger(request.source.generation) ||
    request.source.generation < 1
  )
    throw new RangeError("source.generation must be a positive safe integer");
  if (!Number.isSafeInteger(request.generation) || request.generation < 0)
    throw new RangeError("generation must be a non-negative safe integer");
};

/**
 * LEAKY ABSTRACTION: I-013 sequences in-process I-010/I-011 functions. A worker
 * job graph may replace it, but must retain serial source reads, one signal,
 * atomic result seams, monotonic metadata-only events, and the final generation
 * publication guard. See implementation/evidence/i-013/README.md.
 */
export async function runProcessingJob(
  dependencies: ProcessingJobDependencies,
  request: ProcessingJobRequest,
): Promise<ProcessingJobResult> {
  validateIdentity(request);
  const context = Object.freeze({
    jobId: request.jobId,
    projectId: request.projectId,
    generation: request.generation,
    source: Object.freeze({ ...request.source }),
    signal: request.signal,
    isGenerationCurrent: request.isGenerationCurrent,
  });
  let stage: ProcessingStage = "segmentation";
  let committingSegmentation = false;
  let pendingEnrichmentWriter: EnrichmentPageWriter | undefined;
  let enrichmentOwnsWriter = false;
  let lastOverallRatio = 0;
  const stageFrames = { segmentation: 0, enrichment: 0 };

  const emit = (
    eventStage: "segmentation" | "enrichment",
    status: ProcessingJobEvent["status"],
    completedUnits: number,
    totalUnits: number,
    ratio: number,
  ) => {
    throwIfStopped(request, eventStage);
    if (
      !Number.isSafeInteger(completedUnits) ||
      !Number.isSafeInteger(totalUnits) ||
      completedUnits < stageFrames[eventStage] ||
      completedUnits < 0 ||
      totalUnits < completedUnits
    )
      throw new RangeError("Processing progress must be monotonic and bounded");
    if (!Number.isFinite(ratio) || ratio < lastOverallRatio || ratio > 1)
      throw new RangeError("Overall processing progress must be monotonic");
    stageFrames[eventStage] = completedUnits;
    lastOverallRatio = ratio;
    request.onEvent?.(
      Object.freeze({
        schemaVersion: 1,
        jobId: request.jobId,
        projectId: request.projectId,
        generation: request.generation,
        sourceRunId: request.source.runId,
        sourceGeneration: request.source.generation,
        stage: eventStage,
        status,
        completedUnits,
        totalUnits,
        unit: "frames",
        overallRatio: ratio,
      }),
    );
  };

  try {
    throwIfStopped(request, stage);
    const segmentationReader =
      await dependencies.createSegmentationReader(context);
    throwIfStopped(request, stage);
    emit("segmentation", "started", 0, segmentationReader.totalFrames, 0);
    const segmentationResult = await analyzePcmSegments(segmentationReader, {
      ...request.segmentation,
      generation: request.generation,
      signal: request.signal,
      isGenerationCurrent: request.isGenerationCurrent,
      onProgress: ({ completedFrames, totalFrames }) =>
        emit(
          "segmentation",
          "progress",
          completedFrames,
          totalFrames,
          totalFrames === 0 ? 0 : (completedFrames / totalFrames) * 0.5,
        ),
    });
    throwIfStopped(request, stage);
    committingSegmentation = true;
    const segmentationReference = await dependencies.segmentationStore.commit(
      segmentationResult,
      context,
    );
    committingSegmentation = false;
    throwIfStopped(request, stage);
    if (segmentationReference.generation !== request.generation)
      throw new ProcessingJobError(
        "STALE_GENERATION",
        stage,
        "Committed segmentation belongs to a different generation.",
      );
    emit(
      "segmentation",
      "completed",
      segmentationReader.totalFrames,
      segmentationReader.totalFrames,
      0.5,
    );

    stage = "enrichment";
    throwIfStopped(request, stage);
    const enrichmentReader = await dependencies.createEnrichmentReader(
      context,
      segmentationReference,
    );
    throwIfStopped(request, stage);
    const enrichmentWriter = await dependencies.createEnrichmentWriter(
      context,
      segmentationReference,
    );
    pendingEnrichmentWriter = enrichmentWriter;
    throwIfStopped(request, stage);
    emit("enrichment", "started", 0, enrichmentReader.totalFrames, 0.5);
    enrichmentOwnsWriter = true;
    const enrichmentResult = await enrichPcmPages(
      enrichmentReader,
      enrichmentWriter,
      {
        ...request.enrichment,
        generation: request.generation,
        signal: request.signal,
        isGenerationCurrent: request.isGenerationCurrent,
        onProgress: ({ completedFrames, totalFrames }) =>
          emit(
            "enrichment",
            "progress",
            completedFrames,
            totalFrames,
            totalFrames === 0
              ? 0.5
              : 0.5 + (completedFrames / totalFrames) * 0.5,
          ),
      },
    );
    throwIfStopped(request, stage);
    emit(
      "enrichment",
      "completed",
      enrichmentReader.totalFrames,
      enrichmentReader.totalFrames,
      1,
    );

    stage = "publication";
    throwIfStopped(request, stage);
    return Object.freeze({
      schemaVersion: 1,
      jobId: request.jobId,
      projectId: request.projectId,
      generation: request.generation,
      source: Object.freeze({ ...request.source }),
      segmentation: segmentationReference,
      enrichment: enrichmentResult,
    });
  } catch (error) {
    if (pendingEnrichmentWriter && !enrichmentOwnsWriter) {
      try {
        await pendingEnrichmentWriter.abort?.(error);
      } catch {
        // Preserve the job failure; adapter cleanup is local diagnostics.
      }
    }
    if (error instanceof ProcessingJobError) throw error;
    if (request.signal.aborted)
      throw new ProcessingJobError(
        "CANCELLED",
        stage,
        "Processing was cancelled.",
        error,
      );
    if (!request.isGenerationCurrent(request.generation) || isStaleError(error))
      throw new ProcessingJobError(
        "STALE_GENERATION",
        stage,
        "Processing belongs to a stale project generation.",
        error,
      );
    throw new ProcessingJobError(
      stage === "enrichment"
        ? "ENRICHMENT_FAILED"
        : committingSegmentation
          ? "SEGMENTATION_COMMIT_FAILED"
          : "SEGMENTATION_FAILED",
      stage,
      stage === "enrichment"
        ? "Audio enrichment failed."
        : committingSegmentation
          ? "Segmentation metadata could not be committed."
          : "Audio segmentation failed.",
      error,
    );
  }
}
