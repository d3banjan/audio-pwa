import { describe, expect, test, vi } from "vitest";
import { ProcessingWorkerController } from "./processing-worker-controller";
import type {
  ProcessingWorkerCommand,
  ProcessingWorkerResult,
} from "./processing-worker-protocol";

class FakeWorker {
  readonly sent: ProcessingWorkerCommand[] = [];
  readonly terminate = vi.fn();
  private listener: ((event: MessageEvent<unknown>) => void) | undefined;

  postMessage(message: ProcessingWorkerCommand) {
    this.sent.push(message);
  }
  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    this.listener = listener;
  }
  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    if (this.listener === listener) this.listener = undefined;
  }
  emit(data: unknown) {
    this.listener?.({ data } as MessageEvent<unknown>);
  }
}

const completeResult = {
  processing: {
    job: {
      schemaVersion: 1,
      jobId: "job",
      projectId: "project",
      generation: 3,
      source: { runId: "i009-source", generation: 8 },
      segmentation: {
        schemaVersion: 1,
        resultId: "segmentation-result",
        generation: 3,
        classifierId: "dsp-energy-zcr-v1",
      },
      enrichment: {
        schemaVersion: 1,
        generation: 3,
        sampleRate: 48_000,
        totalFrames: 960,
        pages: 1,
      },
    },
    classifier: {
      classifierId: "dsp-energy-zcr-v1",
      mode: "dsp-fallback",
      fallbackCode: "model-setup-failed",
    },
    processedResultId: "processing-result",
  },
  output: {
    blob: new Blob([new Uint8Array(44)], { type: "audio/wav" }),
    mimeType: "audio/wav",
    fileName: "source-processed.wav",
    bytes: 44,
  },
} as const satisfies ProcessingWorkerResult;

const start = (controller: ProcessingWorkerController, onProgress = vi.fn()) =>
  controller.start({
    jobId: "job",
    projectId: "project",
    generation: 3,
    sourceName: "source.mp4",
    onProgress,
  });

describe("processing worker controller", () => {
  test("keeps exact identity and ignores stale or malformed events", async () => {
    const worker = new FakeWorker();
    const controller = new ProcessingWorkerController(
      worker,
      "https://local.invalid/audio-pwa/",
    );
    const progress = vi.fn();
    const promise = start(controller, progress);
    expect(worker.sent[0]).toMatchObject({
      type: "START_PROCESSING",
      baseUrl: "https://local.invalid/audio-pwa/",
      jobId: "job",
      projectId: "project",
      generation: 3,
    });
    worker.emit({ type: "PROCESSING_PROGRESS", event: null });
    worker.emit({
      type: "PROCESSING_PROGRESS",
      event: progressEvent("stale"),
    });
    const event = progressEvent("job");
    worker.emit({ type: "PROCESSING_PROGRESS", event });
    expect(progress).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(event);
    worker.emit({
      type: "PROCESSING_COMPLETE",
      jobId: "job",
      projectId: "project",
      generation: 3,
      result: completeResult,
    });
    await expect(promise).resolves.toBe(completeResult);
    expect(() => start(controller)).toThrow(/Dispose the previous/);
    const disposal = controller.disposeOutput();
    expect(worker.sent.at(-1)).toEqual({
      type: "DISPOSE_OUTPUT",
      jobId: "job",
      projectId: "project",
      generation: 3,
      processedResultId: "processing-result",
    });
    worker.emit({
      type: "OUTPUT_DISPOSED",
      jobId: "job",
      projectId: "project",
      generation: 3,
      processedResultId: "processing-result",
    });
    await expect(disposal).resolves.toBeUndefined();
  });

  test("forwards cancellation and exposes stable worker errors", async () => {
    const worker = new FakeWorker();
    const controller = new ProcessingWorkerController(
      worker,
      "https://local.invalid/",
    );
    const promise = start(controller);
    controller.cancel();
    expect(worker.sent[1]).toEqual({
      type: "CANCEL_PROCESSING",
      jobId: "job",
      projectId: "project",
      generation: 3,
    });
    worker.emit({
      type: "PROCESSING_ERROR",
      jobId: "job",
      projectId: "project",
      generation: 3,
      error: {
        stage: "enrichment",
        code: "CANCELLED",
        message: "Processing was cancelled.",
      },
    });
    await expect(promise).rejects.toMatchObject({
      name: "ProcessingWorkerClientError",
      stage: "enrichment",
      code: "CANCELLED",
    });
  });

  test.each([
    null,
    {},
    { ...completeResult, output: { ...completeResult.output, bytes: 45 } },
    {
      ...completeResult,
      processing: { ...completeResult.processing, processedResultId: "" },
    },
    {
      ...completeResult,
      processing: {
        ...completeResult.processing,
        job: { ...completeResult.processing.job, generation: 4 },
      },
    },
  ])(
    "rejects malformed completion data without leaving work pending",
    async (result) => {
      const worker = new FakeWorker();
      const controller = new ProcessingWorkerController(
        worker,
        "https://local.invalid/",
      );
      const promise = start(controller);
      worker.emit({
        type: "PROCESSING_COMPLETE",
        jobId: "job",
        projectId: "project",
        generation: 3,
        result,
      });
      await expect(promise).rejects.toMatchObject({
        name: "ProcessingWorkerClientError",
        code: "PROCESSING_BACKEND_FAILED",
      });
      controller.destroy();
    },
  );

  test("drops non-finite and out-of-bounds progress", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const controller = new ProcessingWorkerController(
      worker,
      "https://local.invalid/",
    );
    const promise = start(controller, progress);
    worker.emit({
      type: "PROCESSING_PROGRESS",
      event: { ...progressEvent("job"), overallRatio: Number.NaN },
    });
    worker.emit({
      type: "PROCESSING_PROGRESS",
      event: { ...progressEvent("job"), completedUnits: 961 },
    });
    expect(progress).not.toHaveBeenCalled();
    worker.emit({
      type: "PROCESSING_COMPLETE",
      jobId: "job",
      projectId: "project",
      generation: 3,
      result: completeResult,
    });
    await expect(promise).resolves.toBe(completeResult);
  });

  test("normalizes malformed terminal errors to the stable backend failure", async () => {
    const worker = new FakeWorker();
    const controller = new ProcessingWorkerController(
      worker,
      "https://local.invalid/",
    );
    const promise = start(controller);
    worker.emit({
      type: "PROCESSING_ERROR",
      jobId: "job",
      projectId: "project",
      generation: 3,
      error: { stage: "unknown", code: "BROKEN", message: "bad" },
    });
    await expect(promise).rejects.toMatchObject({
      code: "PROCESSING_BACKEND_FAILED",
      stage: "export",
    });
    controller.destroy();
  });

  test("rejects active work and terminates exactly once on destroy", async () => {
    const worker = new FakeWorker();
    const controller = new ProcessingWorkerController(
      worker,
      "https://local.invalid/",
    );
    const promise = start(controller);
    controller.destroy();
    controller.destroy();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

const progressEvent = (jobId: string) => ({
  schemaVersion: 1 as const,
  jobId,
  projectId: "project",
  generation: 3,
  sourceRunId: "i009-source",
  sourceGeneration: 8,
  stage: "segmentation" as const,
  status: "progress" as const,
  completedUnits: 480,
  totalUnits: 960,
  unit: "frames" as const,
  overallRatio: 0.25,
});
