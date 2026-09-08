import { describe, expect, test, vi } from "vitest";
import type {
  EnrichmentPageReader,
  EnrichmentPageWriter,
  EnrichmentPcmPage,
} from "./chunk-enrichment";
import {
  ProcessingJobError,
  runProcessingJob,
  type ProcessingJobDependencies,
  type ProcessingJobEvent,
  type SegmentationResultReference,
} from "./processing-job";
import type {
  SegmentationPageReader,
  SpeechLikelihoodClassifier,
} from "./segmentation";

const FRAMES = 960;

const samples = (amplitude = 0.1) => {
  const value = new Float32Array(FRAMES);
  for (let index = 0; index < value.length; index += 1)
    value[index] = index % 2 === 0 ? amplitude : -amplitude;
  return value;
};

const segmentationReader = (
  hooks: { opened?: () => void; closed?: () => void } = {},
): SegmentationPageReader => ({
  sampleRate: 48_000,
  totalFrames: FRAMES,
  channelCount: 2,
  async *pages(signal) {
    hooks.opened?.();
    try {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      yield {
        startFrame: 0,
        validFrames: FRAMES,
        channels: [samples(), samples()] as const,
      };
    } finally {
      hooks.closed?.();
    }
  },
});

const enrichmentReader = (
  hooks: { opened?: () => void; closed?: () => void } = {},
): EnrichmentPageReader => ({
  sampleRate: 48_000,
  totalFrames: FRAMES,
  channelCount: 2,
  async *pages(signal) {
    hooks.opened?.();
    try {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      yield {
        startFrame: 0,
        validFrames: FRAMES,
        channels: [samples(), samples()] as const,
      };
    } finally {
      hooks.closed?.();
    }
  },
});

const reference: SegmentationResultReference = Object.freeze({
  schemaVersion: 1,
  resultId: "segments-7",
  generation: 7,
  classifierId: "dsp-energy-zcr-v1",
});

const writer = (): EnrichmentPageWriter => ({
  write: vi.fn(async (_page: EnrichmentPcmPage) => undefined),
  close: vi.fn(async () => undefined),
  abort: vi.fn(async () => undefined),
});

const dependencies = (
  overrides: Partial<ProcessingJobDependencies> = {},
): ProcessingJobDependencies => ({
  createSegmentationReader: vi.fn(async () => segmentationReader()),
  segmentationStore: {
    commit: vi.fn(async () => reference),
  },
  createEnrichmentReader: vi.fn(async () => enrichmentReader()),
  createEnrichmentWriter: vi.fn(async () => writer()),
  ...overrides,
});

const request = (
  overrides: Partial<Parameters<typeof runProcessingJob>[1]> = {},
) => ({
  jobId: "job-7",
  projectId: "project-7",
  generation: 7,
  source: { runId: "i009-source", generation: 2 },
  signal: new AbortController().signal,
  isGenerationCurrent: () => true,
  ...overrides,
});

describe("processing job orchestration", () => {
  test("commits segmentation before it starts enrichment and publishes monotonic metadata-only events", async () => {
    const order: string[] = [];
    let sourceReaders = 0;
    const events: ProcessingJobEvent[] = [];
    const outputWriter = writer();
    const deps = dependencies({
      createSegmentationReader: vi.fn(async ({ signal }) => {
        order.push("segmentation-reader");
        expect(signal).toBe(job.signal);
        return segmentationReader({
          opened: () => {
            sourceReaders += 1;
            order.push("segmentation-open");
          },
          closed: () => {
            sourceReaders -= 1;
            order.push("segmentation-close");
          },
        });
      }),
      segmentationStore: {
        commit: vi.fn(async (_result, { signal }) => {
          expect(signal).toBe(job.signal);
          expect(sourceReaders).toBe(0);
          order.push("segmentation-commit");
          return reference;
        }),
      },
      createEnrichmentReader: vi.fn(async ({ signal }, committed) => {
        expect(signal).toBe(job.signal);
        expect(committed).toBe(reference);
        expect(sourceReaders).toBe(0);
        order.push("enrichment-reader");
        return enrichmentReader({
          opened: () => {
            expect(sourceReaders).toBe(0);
            sourceReaders += 1;
            order.push("enrichment-open");
          },
          closed: () => {
            sourceReaders -= 1;
            order.push("enrichment-close");
          },
        });
      }),
      createEnrichmentWriter: vi.fn(async ({ signal }) => {
        expect(signal).toBe(job.signal);
        order.push("enrichment-writer");
        return outputWriter;
      }),
    });
    const job = request({ onEvent: (event) => events.push(event) });

    const result = await runProcessingJob(deps, job);

    expect(result).toMatchObject({
      schemaVersion: 1,
      generation: 7,
      segmentation: reference,
      enrichment: { totalFrames: FRAMES, pages: 1 },
    });
    expect(order.indexOf("segmentation-close")).toBeLessThan(
      order.indexOf("segmentation-commit"),
    );
    expect(order.indexOf("segmentation-commit")).toBeLessThan(
      order.indexOf("enrichment-open"),
    );
    expect(sourceReaders).toBe(0);
    expect(outputWriter.close).toHaveBeenCalledOnce();
    expect(events.map(({ stage, status }) => `${stage}:${status}`)).toEqual([
      "segmentation:started",
      "segmentation:progress",
      "segmentation:completed",
      "enrichment:started",
      "enrichment:progress",
      "enrichment:completed",
    ]);
    expect(events.map(({ overallRatio }) => overallRatio)).toEqual([
      0, 0.5, 0.5, 0.5, 1, 1,
    ]);
    for (const event of events) {
      expect(event).not.toHaveProperty("channels");
      expect(event).not.toHaveProperty("features");
      expect(event).toMatchObject({
        sourceRunId: "i009-source",
        sourceGeneration: 2,
      });
      expect(
        Object.values(event).some((value) => ArrayBuffer.isView(value)),
      ).toBe(false);
    }
  });

  test("reports segmentation and atomic-commit failures with stable stages and codes", async () => {
    const classifier: SpeechLikelihoodClassifier = {
      id: "failure",
      scoreWindow: () => {
        throw new Error("classifier exploded");
      },
    };
    await expect(
      runProcessingJob(
        dependencies(),
        request({ segmentation: { classifier } }),
      ),
    ).rejects.toMatchObject({
      name: "ProcessingJobError",
      stage: "segmentation",
      code: "SEGMENTATION_FAILED",
    });

    const oldCommit = reference;
    const commitFailure = dependencies({
      segmentationStore: {
        commit: vi.fn(async () => {
          throw new Error("transaction rolled back");
        }),
      },
    });
    await expect(
      runProcessingJob(commitFailure, request()),
    ).rejects.toMatchObject({
      stage: "segmentation",
      code: "SEGMENTATION_COMMIT_FAILED",
    });
    expect(oldCommit.resultId).toBe("segments-7");
    expect(commitFailure.createEnrichmentReader).not.toHaveBeenCalled();
  });

  test("aborts enrichment staging and preserves the last committed output on failure", async () => {
    let committedOutput = "previous-output";
    let stagingOutput = "";
    const failingWriter: EnrichmentPageWriter = {
      write: vi.fn(async () => {
        stagingOutput = "partial-output";
        throw new Error("storage write failed");
      }),
      close: vi.fn(async () => {
        committedOutput = stagingOutput;
      }),
      abort: vi.fn(async () => {
        stagingOutput = "";
      }),
    };
    const deps = dependencies({
      createEnrichmentWriter: vi.fn(async () => failingWriter),
    });

    await expect(runProcessingJob(deps, request())).rejects.toMatchObject({
      stage: "enrichment",
      code: "ENRICHMENT_FAILED",
    });
    expect(failingWriter.abort).toHaveBeenCalledOnce();
    expect(failingWriter.close).not.toHaveBeenCalled();
    expect(committedOutput).toBe("previous-output");
    expect(stagingOutput).toBe("");
  });

  test("uses cancellation consistently and cleans up an active source iterator", async () => {
    const controller = new AbortController();
    let sourceClosed = false;
    const classifier: SpeechLikelihoodClassifier = {
      id: "cancel-on-score",
      scoreWindow: () => {
        controller.abort("user-requested");
        return 0;
      },
    };
    const deps = dependencies({
      createSegmentationReader: vi.fn(async () =>
        segmentationReader({ closed: () => (sourceClosed = true) }),
      ),
    });

    await expect(
      runProcessingJob(
        deps,
        request({ signal: controller.signal, segmentation: { classifier } }),
      ),
    ).rejects.toMatchObject({
      stage: "segmentation",
      code: "CANCELLED",
    });
    expect(sourceClosed).toBe(true);
    expect(deps.segmentationStore.commit).not.toHaveBeenCalled();
    expect(deps.createEnrichmentReader).not.toHaveBeenCalled();
  });

  test("aborts a staging writer when cancellation lands during its factory", async () => {
    const controller = new AbortController();
    const pendingWriter = writer();
    const deps = dependencies({
      createEnrichmentWriter: vi.fn(async () => {
        controller.abort("replaced");
        return pendingWriter;
      }),
    });

    await expect(
      runProcessingJob(deps, request({ signal: controller.signal })),
    ).rejects.toMatchObject({
      stage: "enrichment",
      code: "CANCELLED",
    });
    expect(pendingWriter.abort).toHaveBeenCalledOnce();
    expect(pendingWriter.write).not.toHaveBeenCalled();
    expect(pendingWriter.close).not.toHaveBeenCalled();
  });

  test("suppresses later events and success when the generation becomes stale", async () => {
    let current = true;
    const events: ProcessingJobEvent[] = [];
    const deps = dependencies();
    const running = runProcessingJob(
      deps,
      request({
        isGenerationCurrent: () => current,
        onEvent: (event) => {
          events.push(event);
          if (event.stage === "segmentation" && event.status === "progress")
            current = false;
        },
      }),
    );

    await expect(running).rejects.toMatchObject({
      code: "STALE_GENERATION",
      stage: "segmentation",
    });
    expect(events.map(({ status }) => status)).toEqual(["started", "progress"]);
    expect(deps.segmentationStore.commit).not.toHaveBeenCalled();
    expect(deps.createEnrichmentReader).not.toHaveBeenCalled();
  });

  test("rejects a generation made stale during final publication", async () => {
    let current = true;
    const deps = dependencies();
    let error: unknown;
    try {
      await runProcessingJob(
        deps,
        request({
          isGenerationCurrent: () => current,
          onEvent: (event) => {
            if (event.stage === "enrichment" && event.status === "completed")
              current = false;
          },
        }),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProcessingJobError);
    expect(error).toMatchObject({ code: "STALE_GENERATION" });
    expect((error as ProcessingJobError).stage).toBe("publication");
  });
});
