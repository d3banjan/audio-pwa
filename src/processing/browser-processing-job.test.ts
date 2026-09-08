import { describe, expect, test, vi } from "vitest";
import type { StatefulSileroClassifier } from "../models/silero-classifier";
import type { EnrichmentPcmPage } from "./chunk-enrichment";
import type { CanonicalInputManifest } from "./opfs-processing-store";
import type { SegmentationResultStore } from "./processing-job";
import {
  runBrowserProcessingJob,
  type BrowserProcessingBackendDependencies,
} from "./browser-processing-job";

const source = (totalFrames: number): CanonicalInputManifest => ({
  runId: "i009-bound-source",
  generation: 12,
  sampleRate: 48_000,
  channels: 2,
  layout: "planar-f32le",
  validFrames: totalFrames,
  pages: [],
});

const reader = (totalFrames: number) => ({
  sampleRate: 48_000 as const,
  channelCount: 2 as const,
  totalFrames,
  source: source(totalFrames),
  async *pages(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    yield {
      startFrame: 0,
      validFrames: totalFrames,
      channels: [
        new Float32Array(totalFrames).fill(0.1),
        new Float32Array(totalFrames).fill(0.1),
      ] as const,
    };
  },
});

const backend = (
  totalFrames: number,
  options: {
    eligible: boolean;
    loadSilero?: BrowserProcessingBackendDependencies["loadSilero"];
  },
) => {
  const writes: EnrichmentPcmPage[] = [];
  let committed = false;
  const commit = vi.fn<SegmentationResultStore["commit"]>(
    async (result, context) => ({
      schemaVersion: 1,
      resultId: "segmentation-result",
      generation: context.generation,
      classifierId: result.classifierId,
    }),
  );
  const dependencies: BrowserProcessingBackendDependencies = {
    openReader: vi.fn(async () => reader(totalFrames)),
    createSegmentationStore: () => ({ commit }),
    createWriter: vi.fn((input, generation) => ({
      resultId: "processing-result",
      committed: () =>
        committed
          ? {
              schemaVersion: 1 as const,
              resultId: "processing-result",
              sourceRunId: input.runId,
              sourceGeneration: input.generation,
              generation,
              sampleRate: 48_000 as const,
              channels: 2 as const,
              layout: "planar-f32le" as const,
              totalFrames: input.validFrames,
              pages: [],
              state: "complete" as const,
            }
          : undefined,
      write: vi.fn(async (page) => {
        writes.push(page);
      }),
      close: vi.fn(async () => {
        committed = true;
      }),
      abort: vi.fn(async () => undefined),
    })),
    sileroEligible: () => options.eligible,
    loadSilero:
      options.loadSilero ??
      vi.fn(async () => {
        throw new Error("model unavailable");
      }),
  };
  return { dependencies, commit, writes };
};

const request = (signal = new AbortController().signal) => ({
  jobId: "job-9",
  projectId: "project-9",
  generation: 9,
  baseUrl: "https://local.invalid/audio-pwa/",
  signal,
  isGenerationCurrent: () => true,
});

describe("browser processing backend", () => {
  test("uses the reference-qualified local Silero path and pads only its EOF window", async () => {
    const classify = vi.fn(async (options: { mono48k: Float32Array }) => ({
      generation: 9,
      canonicalStartFrame: 0,
      canonicalEndFrame: 1_536,
      probability: options.mono48k.length === 1_536 ? 0.75 : 0,
    }));
    const dispose = vi.fn(async () => undefined);
    const fakeSilero = {
      classify,
      dispose,
    } as unknown as StatefulSileroClassifier;
    const setup = vi.fn(async () => fakeSilero);
    const { dependencies, commit, writes } = backend(1_000, {
      eligible: true,
      loadSilero: setup,
    });

    const jobRequest = request();
    const result = await runBrowserProcessingJob(jobRequest, dependencies);

    expect(setup).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 9, signal: jobRequest.signal }),
    );
    expect(classify).toHaveBeenCalledOnce();
    expect(classify.mock.calls[0]![0].mono48k).toHaveLength(1_536);
    expect(commit.mock.calls[0]![0]).toMatchObject({
      classifierId: "silero-vad-v6.2.1-16k-op15:wasm",
      analysisWindowFrames: 1_536,
      features: [{ startFrame: 0, endFrame: 1_000 }],
    });
    expect(result.classifier).toEqual({
      classifierId: "silero-vad-v6.2.1-16k-op15:wasm",
      mode: "silero-wasm",
    });
    expect(result.job.source).toEqual({
      runId: "i009-bound-source",
      generation: 12,
    });
    expect(result.processedResultId).toBe("processing-result");
    expect(writes).toHaveLength(1);
    expect(dispose).toHaveBeenCalledOnce();
  });

  test("falls back truthfully when Silero setup fails", async () => {
    const loadSilero = vi.fn(async () => {
      throw new Error("runtime init failed");
    });
    const { dependencies, commit } = backend(960, {
      eligible: true,
      loadSilero,
    });

    const result = await runBrowserProcessingJob(request(), dependencies);

    expect(result.classifier).toEqual({
      classifierId: "dsp-energy-zcr-v1",
      mode: "dsp-fallback",
      fallbackCode: "model-setup-failed",
    });
    expect(commit.mock.calls[0]![0].classifierId).toBe("dsp-energy-zcr-v1");
  });

  test("does not attempt an unqualified provider and preserves cancellation during setup", async () => {
    const loadSilero = vi.fn(async () => {
      throw new Error("must not load");
    });
    const fallback = backend(960, { eligible: false, loadSilero });
    const result = await runBrowserProcessingJob(
      request(),
      fallback.dependencies,
    );
    expect(loadSilero).not.toHaveBeenCalled();
    expect(result.classifier.fallbackCode).toBe("provider-not-qualified");

    const controller = new AbortController();
    const cancelled = backend(960, {
      eligible: true,
      loadSilero: vi.fn(async () => {
        controller.abort();
        throw new DOMException("cancelled", "AbortError");
      }),
    });
    await expect(
      runBrowserProcessingJob(
        request(controller.signal),
        cancelled.dependencies,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled.commit).not.toHaveBeenCalled();
  });

  test("disposes a Silero session when cancellation lands as loading completes", async () => {
    const controller = new AbortController();
    const dispose = vi.fn(async () => undefined);
    const cancelled = backend(960, {
      eligible: true,
      loadSilero: vi.fn(async () => {
        controller.abort();
        return { dispose } as unknown as StatefulSileroClassifier;
      }),
    });
    await expect(
      runBrowserProcessingJob(
        request(controller.signal),
        cancelled.dependencies,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(dispose).toHaveBeenCalledOnce();
    expect(cancelled.commit).not.toHaveBeenCalled();
  });

  test("rejects source replacement between analysis and enrichment", async () => {
    const first = reader(960);
    const second = {
      ...reader(960),
      source: { ...source(960), runId: "i009-replacement" },
    };
    const built = backend(960, { eligible: false });
    const dependencies = {
      ...built.dependencies,
      openReader: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
    };

    await expect(
      runBrowserProcessingJob(request(), dependencies),
    ).rejects.toMatchObject({ code: "ENRICHMENT_FAILED" });
    expect(built.dependencies.createWriter).not.toHaveBeenCalled();
  });
});
