import { describe, expect, test, vi } from "vitest";
import type { ProcessingJobContext } from "./processing-job";
import {
  createTransactionalSegmentationResultStore,
  validateSegmentationResult,
  type SegmentationManifestRepository,
} from "./segmentation-result-store";
import type { SegmentationResult } from "./segmentation";

const result = (): SegmentationResult =>
  Object.freeze({
    schemaVersion: 1,
    generation: 4,
    classifierId: "dsp-energy-zcr-v1",
    sampleRate: 48_000,
    totalFrames: 960,
    analysisWindowFrames: 960,
    features: Object.freeze([
      Object.freeze({
        startFrame: 0,
        endFrame: 960,
        rmsDb: -20,
        zeroCrossingRate: 0.1,
        speechLikelihood: 0.8,
      }),
    ]),
    speechIntervals: Object.freeze([
      Object.freeze({ startFrame: 0, endFrame: 960 }),
    ]),
    speechClips: Object.freeze([
      Object.freeze({ startFrame: 0, endFrame: 960 }),
    ]),
    noiseChangeBoundaries: Object.freeze([]),
    segments: Object.freeze([Object.freeze({ startFrame: 0, endFrame: 960 })]),
  });

const context = (controller = new AbortController()): ProcessingJobContext => ({
  jobId: "job-4",
  projectId: "project-4",
  generation: 4,
  source: { runId: "i009-source", generation: 11 },
  signal: controller.signal,
  isGenerationCurrent: () => true,
});

describe("transactional segmentation result store", () => {
  test("validates bounded metadata and returns the atomically committed reference", async () => {
    const commits: unknown[] = [];
    const repository: SegmentationManifestRepository = {
      commit: vi.fn(async (metadata, expectedSource, stillCurrent) => {
        stillCurrent();
        expect(expectedSource).toEqual({
          runId: "i009-source",
          generation: 11,
        });
        commits.push(metadata);
        return {
          schemaVersion: 1 as const,
          resultId: metadata.resultId,
          generation: metadata.generation,
          classifierId: metadata.classifierId,
        };
      }),
    };
    const store = createTransactionalSegmentationResultStore(
      repository,
      () => "fixed",
    );

    const reference = await store.commit(result(), context());

    expect(reference).toEqual({
      schemaVersion: 1,
      resultId: "segmentation-fixed",
      generation: 4,
      classifierId: "dsp-energy-zcr-v1",
    });
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      state: "complete",
      totalFrames: 960,
      classifierId: "dsp-energy-zcr-v1",
    });
    expect(JSON.stringify(commits[0])).not.toContain("channels");
  });

  test("rejects malformed or unbounded metadata before opening a transaction", async () => {
    const repository: SegmentationManifestRepository = {
      commit: vi.fn(async () => {
        throw new Error("must not run");
      }),
    };
    const store = createTransactionalSegmentationResultStore(repository);
    await expect(
      store.commit({ ...result(), features: [] }, context()),
    ).rejects.toThrow(/cover the timeline/);
    await expect(
      store.commit(
        {
          ...result(),
          features: [
            { ...result().features[0]!, speechLikelihood: Number.NaN },
          ],
        },
        context(),
      ),
    ).rejects.toThrow(/invalid feature/);
    expect(repository.commit).not.toHaveBeenCalled();
  });

  test("rejects cancellation and stale generations without replacing a prior result", async () => {
    let committed = "prior-result";
    const repository: SegmentationManifestRepository = {
      commit: vi.fn(async (metadata, _expectedSource, stillCurrent) => {
        stillCurrent();
        committed = metadata.resultId;
        return {
          schemaVersion: 1 as const,
          resultId: metadata.resultId,
          generation: metadata.generation,
          classifierId: metadata.classifierId,
        };
      }),
    };
    const cancelled = new AbortController();
    cancelled.abort();
    const store = createTransactionalSegmentationResultStore(repository);
    await expect(
      store.commit(result(), context(cancelled)),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      store.commit(result(), {
        ...context(),
        isGenerationCurrent: () => false,
      }),
    ).rejects.toThrow(/stale generation/);
    expect(committed).toBe("prior-result");
    expect(repository.commit).not.toHaveBeenCalled();
  });

  test("validates complete ordered intervals and exact feature coverage", () => {
    expect(() =>
      validateSegmentationResult(
        {
          ...result(),
          segments: [{ startFrame: 1, endFrame: 960 }],
        },
        4,
      ),
    ).toThrow(/complete timeline|invalid interval/);
    expect(() =>
      validateSegmentationResult(
        {
          ...result(),
          features: [{ ...result().features[0]!, endFrame: 959 }],
        },
        4,
      ),
    ).toThrow(/cover the timeline/);
  });
});
