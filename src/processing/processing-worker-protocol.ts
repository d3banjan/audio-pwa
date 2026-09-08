import type { EnrichmentOptions } from "./chunk-enrichment";
import type { BrowserProcessingJobResult } from "./browser-processing-job";
import type {
  ProcessingJobEvent,
  ProcessingJobErrorCode,
  ProcessingStage,
} from "./processing-job";
import type { SegmentationOptions } from "./segmentation";

export type ProcessingWorkerStart = Readonly<{
  type: "START_PROCESSING";
  jobId: string;
  projectId: string;
  generation: number;
  baseUrl: string;
  sourceName: string;
  segmentation?: Omit<
    SegmentationOptions,
    | "generation"
    | "signal"
    | "isGenerationCurrent"
    | "classifier"
    | "onProgress"
  >;
  enrichment?: Omit<
    EnrichmentOptions,
    "generation" | "signal" | "isGenerationCurrent" | "onProgress"
  >;
}>;

export type ProcessingWorkerCancel = Readonly<{
  type: "CANCEL_PROCESSING";
  jobId: string;
  projectId: string;
  generation: number;
}>;

export type ProcessingWorkerDisposeOutput = Readonly<{
  type: "DISPOSE_OUTPUT";
  jobId: string;
  projectId: string;
  generation: number;
  processedResultId: string;
}>;

export type ProcessingWorkerCommand =
  | ProcessingWorkerStart
  | ProcessingWorkerCancel
  | ProcessingWorkerDisposeOutput;

export type ProcessingWorkerResult = Readonly<{
  processing: BrowserProcessingJobResult;
  output: Readonly<{
    blob: Blob;
    mimeType: "audio/wav";
    fileName: string;
    bytes: number;
  }>;
}>;

export type ProcessingWorkerMessage =
  | Readonly<{ type: "PROCESSING_PROGRESS"; event: ProcessingJobEvent }>
  | Readonly<{
      type: "PROCESSING_COMPLETE";
      jobId: string;
      projectId: string;
      generation: number;
      result: ProcessingWorkerResult;
    }>
  | Readonly<{
      type: "OUTPUT_DISPOSED";
      jobId: string;
      projectId: string;
      generation: number;
      processedResultId: string;
    }>
  | Readonly<{
      type: "PROCESSING_ERROR";
      jobId: string;
      projectId: string;
      generation: number;
      error: Readonly<{
        stage: ProcessingStage;
        code: ProcessingJobErrorCode | "PROCESSING_BACKEND_FAILED";
        message: string;
      }>;
    }>;
