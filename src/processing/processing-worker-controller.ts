import workerUrl from "./processing-worker.ts?worker&url";
import type {
  ProcessingJobEvent,
  ProcessingJobErrorCode,
  ProcessingStage,
} from "./processing-job";
import type {
  ProcessingWorkerCommand,
  ProcessingWorkerMessage,
  ProcessingWorkerResult,
  ProcessingWorkerStart,
} from "./processing-worker-protocol";

export class ProcessingWorkerClientError extends Error {
  constructor(
    readonly code: ProcessingJobErrorCode | "PROCESSING_BACKEND_FAILED",
    readonly stage: ProcessingStage,
    message: string,
  ) {
    super(message);
    this.name = "ProcessingWorkerClientError";
  }
}

export interface ProcessingWorkerPort {
  postMessage(message: ProcessingWorkerCommand): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  terminate(): void;
}

type StartOptions = Omit<ProcessingWorkerStart, "type" | "baseUrl"> &
  Readonly<{ onProgress?: (event: ProcessingJobEvent) => void }>;

type Pending = Readonly<{
  jobId: string;
  projectId: string;
  generation: number;
  onProgress?: (event: ProcessingJobEvent) => void;
  resolve: (result: ProcessingWorkerResult) => void;
  reject: (reason: unknown) => void;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const hasIdentity = (
  value: unknown,
): value is Record<string, unknown> &
  Readonly<{
    jobId: string;
    projectId: string;
    generation: number;
  }> =>
  isRecord(value) &&
  typeof value["jobId"] === "string" &&
  typeof value["projectId"] === "string" &&
  Number.isSafeInteger(value["generation"]);

const stages = new Set(["segmentation", "enrichment", "export"]);
const errorStages = new Set([
  "segmentation",
  "enrichment",
  "export",
  "publication",
]);
const errorCodes = new Set([
  "CANCELLED",
  "STALE_GENERATION",
  "SEGMENTATION_FAILED",
  "SEGMENTATION_COMMIT_FAILED",
  "ENRICHMENT_FAILED",
  "EXPORT_FAILED",
  "PROCESSING_BACKEND_FAILED",
]);
const statuses = new Set(["started", "progress", "completed"]);
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const boundedInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= max;
const isProgress = (value: unknown): value is ProcessingJobEvent => {
  if (!hasIdentity(value)) return false;
  const completed = value["completedUnits"];
  const total = value["totalUnits"];
  const ratio = value["overallRatio"];
  return (
    value["schemaVersion"] === 1 &&
    nonEmpty(value["sourceRunId"]) &&
    boundedInteger(value["sourceGeneration"]) &&
    stages.has(String(value["stage"])) &&
    statuses.has(String(value["status"])) &&
    value["unit"] === "frames" &&
    boundedInteger(total) &&
    boundedInteger(completed, total as number) &&
    typeof ratio === "number" &&
    Number.isFinite(ratio) &&
    ratio >= 0 &&
    ratio <= 1
  );
};

const isCompleteResult = (
  value: unknown,
  identity: { jobId: string; projectId: string; generation: number },
): value is ProcessingWorkerResult => {
  if (
    !isRecord(value) ||
    !isRecord(value["processing"]) ||
    !isRecord(value["output"])
  )
    return false;
  const processing = value["processing"];
  const job = processing["job"];
  const classifier = processing["classifier"];
  const output = value["output"];
  if (
    !isRecord(job) ||
    !isRecord(classifier) ||
    !isRecord(job["source"]) ||
    !isRecord(job["segmentation"]) ||
    !isRecord(job["enrichment"])
  )
    return false;
  const resultId = processing["processedResultId"];
  return (
    job["schemaVersion"] === 1 &&
    job["jobId"] === identity.jobId &&
    job["projectId"] === identity.projectId &&
    job["generation"] === identity.generation &&
    nonEmpty(job["source"]["runId"]) &&
    boundedInteger(job["source"]["generation"]) &&
    job["segmentation"]["schemaVersion"] === 1 &&
    nonEmpty(job["segmentation"]["resultId"]) &&
    job["segmentation"]["generation"] === identity.generation &&
    nonEmpty(job["segmentation"]["classifierId"]) &&
    job["enrichment"]["schemaVersion"] === 1 &&
    job["enrichment"]["generation"] === identity.generation &&
    job["enrichment"]["sampleRate"] === 48_000 &&
    boundedInteger(job["enrichment"]["totalFrames"]) &&
    boundedInteger(job["enrichment"]["pages"]) &&
    nonEmpty(classifier["classifierId"]) &&
    (classifier["mode"] === "silero-wasm" ||
      classifier["mode"] === "dsp-fallback") &&
    nonEmpty(resultId) &&
    output["blob"] instanceof Blob &&
    output["mimeType"] === "audio/wav" &&
    nonEmpty(output["fileName"]) &&
    boundedInteger(output["bytes"]) &&
    output["bytes"] === output["blob"].size
  );
};

/** Owns one dedicated module worker and one processing request at a time. */
export class ProcessingWorkerController {
  private pending: Pending | undefined;
  private completed:
    | Readonly<{
        jobId: string;
        projectId: string;
        generation: number;
        processedResultId: string;
      }>
    | undefined;
  private disposal:
    | Readonly<{ resolve: () => void; reject: (error: unknown) => void }>
    | undefined;
  private destroyed = false;
  private readonly receive = (event: MessageEvent<unknown>) =>
    this.handleMessage(event.data);

  constructor(
    private readonly worker: ProcessingWorkerPort = new Worker(workerUrl, {
      type: "module",
      name: "local-audio-processing",
    }),
    private readonly baseUrl = new URL("./", document.baseURI).href,
  ) {
    worker.addEventListener("message", this.receive);
  }

  start(options: StartOptions): Promise<ProcessingWorkerResult> {
    if (this.destroyed) throw new Error("Processing worker is closed.");
    if (this.pending) throw new Error("A processing job is already active.");
    if (this.completed)
      throw new Error(
        "Dispose the previous processed output before starting again.",
      );
    return new Promise((resolve, reject) => {
      this.pending = { ...options, resolve, reject };
      this.worker.postMessage({
        type: "START_PROCESSING",
        baseUrl: this.baseUrl,
        jobId: options.jobId,
        projectId: options.projectId,
        generation: options.generation,
        sourceName: options.sourceName,
        segmentation: options.segmentation,
        enrichment: options.enrichment,
      });
    });
  }

  cancel(): void {
    if (!this.pending) return;
    this.worker.postMessage({
      type: "CANCEL_PROCESSING",
      jobId: this.pending.jobId,
      projectId: this.pending.projectId,
      generation: this.pending.generation,
    });
  }

  disposeOutput(): Promise<void> {
    if (!this.completed) return Promise.resolve();
    if (this.disposal)
      throw new Error("Processed output disposal is already pending.");
    const completed = this.completed;
    return new Promise<void>((resolve, reject) => {
      this.disposal = { resolve, reject };
      this.worker.postMessage({
        type: "DISPOSE_OUTPUT",
        ...completed,
      });
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.worker.removeEventListener("message", this.receive);
    this.worker.terminate();
    this.pending?.reject(
      new DOMException("Processing worker closed.", "AbortError"),
    );
    this.disposal?.reject(
      new DOMException("Processing worker closed.", "AbortError"),
    );
    this.pending = undefined;
    this.completed = undefined;
    this.disposal = undefined;
  }

  private handleMessage(value: unknown): void {
    if (!isRecord(value) || typeof value["type"] !== "string") return;
    const type = value["type"];
    if (type === "OUTPUT_DISPOSED") {
      if (
        this.completed &&
        this.disposal &&
        hasIdentity(value) &&
        value["jobId"] === this.completed.jobId &&
        value["projectId"] === this.completed.projectId &&
        value["generation"] === this.completed.generation &&
        (value as Record<string, unknown>)["processedResultId"] ===
          this.completed.processedResultId
      ) {
        const disposal = this.disposal;
        this.disposal = undefined;
        this.completed = undefined;
        disposal.resolve();
      }
      return;
    }
    if (!this.pending) return;
    if (
      type !== "PROCESSING_PROGRESS" &&
      type !== "PROCESSING_COMPLETE" &&
      type !== "PROCESSING_ERROR"
    )
      return;
    const identityValue =
      type === "PROCESSING_PROGRESS" ? value["event"] : value;
    if (!hasIdentity(identityValue)) {
      if (type !== "PROCESSING_PROGRESS") this.rejectMalformed();
      return;
    }
    const message = value as ProcessingWorkerMessage;
    const identity = identityValue;
    if (
      identity.jobId !== this.pending.jobId ||
      identity.projectId !== this.pending.projectId ||
      identity.generation !== this.pending.generation
    )
      return;
    if (message.type === "PROCESSING_PROGRESS") {
      if (!isProgress(message.event)) return;
      this.pending.onProgress?.(message.event);
      return;
    }
    if (
      message.type === "PROCESSING_COMPLETE" &&
      !isCompleteResult(message.result, identity)
    ) {
      this.rejectMalformed();
      return;
    }
    if (
      message.type === "PROCESSING_ERROR" &&
      (!isRecord(message.error) ||
        !errorCodes.has(String(message.error.code)) ||
        !errorStages.has(String(message.error.stage)) ||
        !nonEmpty(message.error.message))
    ) {
      this.rejectMalformed();
      return;
    }
    const pending = this.pending;
    this.pending = undefined;
    if (message.type === "PROCESSING_COMPLETE") {
      this.completed = Object.freeze({
        jobId: message.jobId,
        projectId: message.projectId,
        generation: message.generation,
        processedResultId: message.result.processing.processedResultId,
      });
      pending.resolve(message.result);
    } else if (message.type === "PROCESSING_ERROR")
      pending.reject(
        new ProcessingWorkerClientError(
          message.error.code,
          message.error.stage,
          message.error.message,
        ),
      );
  }

  private rejectMalformed(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    pending.reject(
      new ProcessingWorkerClientError(
        "PROCESSING_BACKEND_FAILED",
        "export",
        "Processing worker returned malformed data.",
      ),
    );
  }
}
