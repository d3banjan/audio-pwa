/// <reference lib="webworker" />

import { runBrowserProcessingJob } from "./browser-processing-job";
import {
  createBrowserWavArtifact,
  type BrowserWavArtifact,
} from "./browser-wav-artifact";
import { ProcessingJobError } from "./processing-job";
import type {
  ProcessingWorkerCommand,
  ProcessingWorkerMessage,
  ProcessingWorkerStart,
} from "./processing-worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
type ActiveRun = Readonly<{
  command: ProcessingWorkerStart;
  controller: AbortController;
}>;
let active: ActiveRun | undefined;
let queue = Promise.resolve();
let published:
  | Readonly<{
      command: ProcessingWorkerStart;
      processedResultId: string;
      artifact: BrowserWavArtifact;
    }>
  | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const validIdentity = (value: Record<string, unknown>) =>
  typeof value["jobId"] === "string" &&
  value["jobId"].length > 0 &&
  typeof value["projectId"] === "string" &&
  value["projectId"].length > 0 &&
  Number.isSafeInteger(value["generation"]) &&
  (value["generation"] as number) >= 0;
const parseCommand = (value: unknown): ProcessingWorkerCommand | undefined => {
  if (!isRecord(value) || !validIdentity(value)) return undefined;
  if (value["type"] === "CANCEL_PROCESSING")
    return value as unknown as ProcessingWorkerCommand;
  if (
    value["type"] === "DISPOSE_OUTPUT" &&
    typeof value["processedResultId"] === "string" &&
    value["processedResultId"].length > 0
  )
    return value as unknown as ProcessingWorkerCommand;
  if (
    value["type"] !== "START_PROCESSING" ||
    typeof value["baseUrl"] !== "string" ||
    typeof value["sourceName"] !== "string" ||
    value["sourceName"].length === 0
  )
    return undefined;
  try {
    if (new URL(value["baseUrl"]).origin !== scope.location.origin)
      return undefined;
  } catch {
    return undefined;
  }
  return value as unknown as ProcessingWorkerCommand;
};

const send = (message: ProcessingWorkerMessage) => scope.postMessage(message);
const matches = (left: ProcessingWorkerStart, right: ProcessingWorkerCommand) =>
  left.jobId === right.jobId &&
  left.projectId === right.projectId &&
  left.generation === right.generation;

const execute = async (run: ActiveRun) => {
  const { command, controller } = run;
  let stage: "segmentation" | "export" = "segmentation";
  try {
    const result = await runBrowserProcessingJob({
      ...command,
      signal: controller.signal,
      isGenerationCurrent: (generation) =>
        active === run &&
        !controller.signal.aborted &&
        generation === command.generation,
      onEvent: (event) =>
        send({
          type: "PROCESSING_PROGRESS",
          event: Object.freeze({
            ...event,
            overallRatio: event.overallRatio * 0.8,
          }),
        }),
    });
    if (active !== run || controller.signal.aborted) return;
    stage = "export";
    const exportEvent = (
      status: "started" | "progress" | "completed",
      completedUnits: number,
      totalUnits: number,
    ) => {
      send({
        type: "PROCESSING_PROGRESS",
        event: Object.freeze({
          schemaVersion: 1 as const,
          jobId: command.jobId,
          projectId: command.projectId,
          generation: command.generation,
          sourceRunId: result.job.source.runId,
          sourceGeneration: result.job.source.generation,
          stage: "export" as const,
          status,
          completedUnits,
          totalUnits,
          unit: "frames" as const,
          overallRatio:
            totalUnits === 0 ? 0.8 : 0.8 + (completedUnits / totalUnits) * 0.2,
        }),
      });
    };
    exportEvent("started", 0, result.job.enrichment.totalFrames);
    const artifact = await createBrowserWavArtifact({
      sourceName: command.sourceName,
      expectedResultId: result.processedResultId,
      signal: controller.signal,
      onProgress: (completed, total) =>
        exportEvent("progress", completed, total),
    });
    if (active !== run || controller.signal.aborted) {
      await artifact.dispose();
      return;
    }
    try {
      exportEvent(
        "completed",
        result.job.enrichment.totalFrames,
        result.job.enrichment.totalFrames,
      );
      send({
        type: "PROCESSING_COMPLETE",
        jobId: command.jobId,
        projectId: command.projectId,
        generation: command.generation,
        result: {
          processing: result,
          output: {
            blob: artifact.file,
            mimeType: "audio/wav",
            fileName: artifact.downloadName,
            bytes: artifact.result.bytes,
          },
        },
      });
      published = Object.freeze({
        command,
        processedResultId: result.processedResultId,
        artifact,
      });
    } catch (error) {
      await artifact.dispose();
      throw error;
    }
  } catch (error) {
    const normalized =
      error instanceof ProcessingJobError
        ? error
        : new ProcessingJobError(
            controller.signal.aborted
              ? "CANCELLED"
              : stage === "export"
                ? "EXPORT_FAILED"
                : "SEGMENTATION_FAILED",
            stage,
            controller.signal.aborted
              ? "Processing was cancelled."
              : "The local processing backend could not start.",
            error,
          );
    send({
      type: "PROCESSING_ERROR",
      jobId: command.jobId,
      projectId: command.projectId,
      generation: command.generation,
      error: {
        stage: normalized.stage,
        code:
          normalized.code === "SEGMENTATION_FAILED" &&
          !(error instanceof ProcessingJobError)
            ? "PROCESSING_BACKEND_FAILED"
            : normalized.code,
        message: normalized.message,
      },
    });
  } finally {
    if (active === run) active = undefined;
  }
};

scope.addEventListener("message", (message: MessageEvent<unknown>) => {
  const command = parseCommand(message.data);
  if (!command) return;
  if (command.type === "CANCEL_PROCESSING") {
    if (active && matches(active.command, command))
      active.controller.abort("cancel-command");
    return;
  }
  if (command.type === "DISPOSE_OUTPUT") {
    if (
      published &&
      matches(published.command, command) &&
      published.processedResultId === command.processedResultId
    ) {
      const completed = published;
      published = undefined;
      void completed.artifact.dispose().then(() =>
        send({
          type: "OUTPUT_DISPOSED",
          jobId: command.jobId,
          projectId: command.projectId,
          generation: command.generation,
          processedResultId: command.processedResultId,
        }),
      );
    }
    return;
  }
  if (published) {
    send({
      type: "PROCESSING_ERROR",
      jobId: command.jobId,
      projectId: command.projectId,
      generation: command.generation,
      error: {
        stage: "export",
        code: "PROCESSING_BACKEND_FAILED",
        message: "Dispose the previous processed output before starting again.",
      },
    });
    return;
  }
  active?.controller.abort("superseded");
  const run = Object.freeze({ command, controller: new AbortController() });
  active = run;
  queue = queue.catch(() => undefined).then(() => execute(run));
});
