import { describe, expect, it } from "vitest";
import {
  acceptsAudioFile,
  createOpaqueId,
  initialProjectState,
  nextGeneration,
  reduceProjectState,
  type JobId,
  type ProjectId,
  type ProjectState,
} from "./app-state";

const projectId = createOpaqueId(
  "project",
  () => "10000000-0000-4000-8000-000000000001",
) as ProjectId;
const validationJobId = "job_10000000-0000-4000-8000-000000000001" as JobId;
const processingJobId = createOpaqueId(
  "job",
  () => "20000000-0000-4000-8000-000000000002",
) as JobId;
const exportJobId = createOpaqueId(
  "job",
  () => "30000000-0000-4000-8000-000000000003",
) as JobId;

function sourceReady(): ProjectState {
  const selected = reduceProjectState(initialProjectState, {
    type: "FILE_SELECTED",
    projectId,
    generation: 1,
    fileName: "interview.FLAC",
  });
  const validating = reduceProjectState(selected, {
    type: "VALIDATION_STARTED",
    projectId,
    generation: 1,
    jobId: validationJobId,
  });
  return reduceProjectState(validating, {
    type: "VALIDATION_ACCEPTED",
    projectId,
    generation: 1,
    jobId: validationJobId,
  });
}

function processing(): ProjectState {
  return reduceProjectState(sourceReady(), {
    type: "PROCESSING_STARTED",
    projectId,
    generation: 1,
    jobId: processingJobId,
  });
}

function mixReady(): ProjectState {
  return reduceProjectState(processing(), {
    type: "PROCESSING_COMPLETE",
    projectId,
    generation: 1,
    jobId: processingJobId,
  });
}

describe("project state", () => {
  it("keeps project setup independent and follows legal processing transitions", () => {
    const selected = reduceProjectState(initialProjectState, {
      type: "FILE_SELECTED",
      projectId,
      generation: 1,
      fileName: "interview.FLAC",
    });

    expect(selected).toMatchObject({
      phase: "source-selected",
      generation: 1,
      projectId,
      fileName: "interview.FLAC",
    });
    expect(sourceReady()).toMatchObject({
      phase: "source-ready",
      activeJob: undefined,
    });
    expect(processing()).toMatchObject({
      phase: "processing",
      activeJob: { id: processingJobId, status: "running" },
    });
  });

  it("ignores illegal and stale async transitions", () => {
    const active = processing();
    const illegalExport = reduceProjectState(active, {
      type: "EXPORT_STARTED",
      projectId,
      generation: 1,
      jobId: exportJobId,
    });
    const staleCompletion = reduceProjectState(active, {
      type: "PROCESSING_COMPLETE",
      projectId,
      generation: 0,
      jobId: processingJobId,
    });
    const wrongJobCompletion = reduceProjectState(active, {
      type: "PROCESSING_COMPLETE",
      projectId,
      generation: 1,
      jobId: exportJobId,
    });

    expect(illegalExport).toBe(active);
    expect(staleCompletion).toBe(active);
    expect(wrongJobCompletion).toBe(active);
  });

  it("pauses, resumes and cancels only the current job", () => {
    const active = processing();
    const paused = reduceProjectState(active, {
      type: "PROCESSING_PAUSED",
      projectId,
      generation: 1,
      jobId: processingJobId,
    });
    const resumed = reduceProjectState(paused, {
      type: "PROCESSING_RESUMED",
      projectId,
      generation: 1,
      jobId: processingJobId,
    });
    const pending = reduceProjectState(resumed, {
      type: "JOB_CANCEL_REQUESTED",
      projectId,
      generation: 1,
      jobId: processingJobId,
    });
    const cancelled = reduceProjectState(pending, {
      type: "JOB_CANCELLED",
      projectId,
      generation: 1,
      jobId: processingJobId,
    });

    expect(paused.activeJob?.status).toBe("paused");
    expect(resumed.activeJob?.status).toBe("running");
    expect(pending.activeJob?.status).toBe("cancel-pending");
    expect(cancelled).toMatchObject({
      phase: "source-ready",
      generation: 2,
      activeJob: undefined,
    });
    expect(
      reduceProjectState(cancelled, {
        type: "PROCESSING_COMPLETE",
        projectId,
        generation: 1,
        jobId: processingJobId,
      }),
    ).toBe(cancelled);
  });

  it("uses UI-only language when fixture processing completes", () => {
    expect(mixReady().message).toBe(
      "Fixture workflow reached mix-ready; preview stems are visible in UI only.",
    );
  });

  it("uses UI-only language when fixture buffering resolves", () => {
    const started = reduceProjectState(mixReady(), {
      type: "PLAYBACK_STARTED",
      projectId,
      generation: 1,
    });
    const buffering = reduceProjectState(started, {
      type: "BUFFERING_STARTED",
      projectId,
      generation: 1,
    });
    const resolved = reduceProjectState(buffering, {
      type: "BUFFERING_RESOLVED",
      projectId,
      generation: 1,
    });

    expect(resolved.message).toBe(
      "Fixture playback state returned to synthetic preview; stems are UI-only.",
    );
  });

  it("returns cancelled validation to an unvalidated source and rejects late results", () => {
    const selected = reduceProjectState(initialProjectState, {
      type: "FILE_SELECTED",
      projectId,
      generation: 1,
      fileName: "interview.FLAC",
    });
    const validating = reduceProjectState(selected, {
      type: "VALIDATION_STARTED",
      projectId,
      generation: 1,
      jobId: validationJobId,
    });
    const pending = reduceProjectState(validating, {
      type: "JOB_CANCEL_REQUESTED",
      projectId,
      generation: 1,
      jobId: validationJobId,
    });

    expect(
      reduceProjectState(pending, {
        type: "VALIDATION_ACCEPTED",
        projectId,
        generation: 1,
        jobId: validationJobId,
      }),
    ).toBe(pending);
    expect(
      reduceProjectState(pending, {
        type: "VALIDATION_REJECTED",
        projectId,
        generation: 1,
        jobId: validationJobId,
        message: "late",
      }),
    ).toBe(pending);

    const cancelled = reduceProjectState(pending, {
      type: "JOB_CANCELLED",
      projectId,
      generation: 1,
      jobId: validationJobId,
    });
    expect(cancelled).toMatchObject({
      phase: "source-selected",
      generation: 2,
    });
    expect(
      reduceProjectState(cancelled, {
        type: "PROCESSING_STARTED",
        projectId,
        generation: 2,
        jobId: processingJobId,
      }),
    ).toMatchObject({
      phase: "processing",
      generation: 2,
      activeJob: {
        id: processingJobId,
        kind: "processing",
      },
    });
  });

  it("recovers a failed job from its valid checkpoint without losing project identity", () => {
    const failed = reduceProjectState(processing(), {
      type: "JOB_FAILED",
      projectId,
      generation: 1,
      jobId: processingJobId,
      checkpoint: "chunk-12",
      message: "Worker stopped.",
    });
    const retryJobId = createOpaqueId(
      "job",
      () => "40000000-0000-4000-8000-000000000004",
    ) as JobId;
    const recovered = reduceProjectState(failed, {
      type: "RECOVERY_STARTED",
      projectId,
      generation: 1,
      jobId: retryJobId,
    });

    expect(failed).toMatchObject({
      phase: "recoverable-error",
      failedJob: { kind: "processing", checkpoint: "chunk-12" },
    });
    expect(recovered).toMatchObject({
      phase: "processing",
      projectId,
      activeJob: { id: retryJobId, kind: "processing" },
    });
  });

  it("models aligned playback buffering separately from project processing", () => {
    const ready = mixReady();
    const playing = reduceProjectState(ready, {
      type: "PLAYBACK_STARTED",
      projectId,
      generation: 1,
    });
    const buffering = reduceProjectState(playing, {
      type: "BUFFERING_STARTED",
      projectId,
      generation: 1,
    });
    const refilled = reduceProjectState(buffering, {
      type: "BUFFERING_RESOLVED",
      projectId,
      generation: 1,
    });

    expect(playing.transport).toBe("playing");
    expect(buffering).toMatchObject({
      phase: "mix-ready",
      transport: "buffering",
      transportBeforeBuffering: "playing",
    });
    expect(refilled.transport).toBe("playing");
  });

  it("exports only from a committed mix and preserves it on cancellation", () => {
    const ready = mixReady();
    const exporting = reduceProjectState(ready, {
      type: "EXPORT_STARTED",
      projectId,
      generation: 1,
      jobId: exportJobId,
    });
    const pending = reduceProjectState(exporting, {
      type: "JOB_CANCEL_REQUESTED",
      projectId,
      generation: 1,
      jobId: exportJobId,
    });
    const cancelled = reduceProjectState(pending, {
      type: "JOB_CANCELLED",
      projectId,
      generation: 1,
      jobId: exportJobId,
    });

    expect(exporting.phase).toBe("exporting");
    expect(cancelled).toMatchObject({
      phase: "mix-ready",
      generation: 2,
      committedMixGeneration: 1,
    });
  });

  it("creates constrained opaque IDs and guards generation overflow", () => {
    expect(projectId).toBe("project_10000000-0000-4000-8000-000000000001");
    expect(() => createOpaqueId("job", () => "unsafe-id")).toThrow(
      "valid UUID",
    );
    expect(() => nextGeneration(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it("accepts the declared audio extensions only", () => {
    expect(acceptsAudioFile("take.wav")).toBe(true);
    expect(acceptsAudioFile("take.FLAC")).toBe(true);
    expect(acceptsAudioFile("notes.txt")).toBe(false);
  });
});
