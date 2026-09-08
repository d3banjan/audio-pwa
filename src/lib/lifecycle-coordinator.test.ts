import { describe, expect, it } from "vitest";
import { createOpaqueId, type JobId, type ProjectId } from "./app-state";
import {
  createLifecycleState,
  LifecycleCoordinator,
  reduceLifecycleCommand,
  type LifecycleState,
  type PremixEditEvent,
  type PhaseNeutralExperienceEvent,
} from "./lifecycle-coordinator";
import { deterministicFixtureAdapter } from "./deterministic-source-adapter";

const projectId = createOpaqueId(
  "project",
  () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
) as ProjectId;
const job = (n: string) =>
  createOpaqueId(
    "job",
    () => `bbbbbbbb-bbbb-4bbb-8bbb-${n.padStart(12, "0")}`,
  ) as JobId;
const prepared = (() => {
  const result = deterministicFixtureAdapter.prepare("fixture.mp4");
  if (!result.accepted) throw new Error(result.reason);
  return result.prepared;
})();
function selected(): LifecycleState {
  return reduceLifecycleCommand(createLifecycleState(), {
    type: "SOURCE_REPLACED",
    projectId,
    generation: 1,
    fileName: "fixture.mp4",
    prepared,
  });
}
function premix(state: LifecycleState, event: PremixEditEvent): LifecycleState {
  return reduceLifecycleCommand(state, {
    type: "PREMIX_EVENT",
    event,
  });
}
function event(
  state: LifecycleState,
  value: PhaseNeutralExperienceEvent,
): LifecycleState {
  return reduceLifecycleCommand(state, { type: "EVENT", event: value });
}
function processingStarted(
  state: LifecycleState,
  jobId: JobId,
): LifecycleState {
  return reduceLifecycleCommand(state, {
    type: "PROCESSING_STARTED",
    projectId,
    generation: 1,
    jobId,
  });
}

describe("LifecycleCoordinator", () => {
  it("rejects raw domain events at the command boundary", () => {
    const coordinator = new LifecycleCoordinator();
    reduceLifecycleCommand(createLifecycleState(), {
      type: "EVENT", // @ts-expect-error EVENT only accepts phase-neutral experience events
      event: { type: "CONTROL_CHANGED", projectId, generation: 1 },
    });
    const before = coordinator.state;
    expect(
      coordinator.dispatch({
        type: "CONTROL_CHANGED",
        projectId,
        generation: 1,
      } as never),
    ).toBe(before);
  });
  it("atomically accepts source selection with shared identity", () => {
    const state = selected();
    expect(state.project.projectId).toBe(projectId);
    expect(state.experience.projectId).toBe(projectId);
    expect(state.experience.generation).toBe(state.project.generation);
  });
  it("replaces a second source and clears prior mix/export state", () => {
    let state = event(selected(), {
      type: "FINISHED_MIX_EXPORT_TOGGLE",
      projectId,
      generation: 1,
      include: true,
    });
    const second = createOpaqueId(
      "project",
      () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ) as ProjectId;
    const result = deterministicFixtureAdapter.prepare("replacement.wav");
    if (!result.accepted) throw new Error(result.reason);
    state = reduceLifecycleCommand(state, {
      type: "SOURCE_REPLACED",
      projectId: second,
      generation: 2,
      fileName: "replacement.wav",
      prepared: result.prepared,
    });
    expect(state.experience.projectId).toBe(second);
    expect(state.experience.finishedMixExportInclude).toBe(false);
    expect(state.experience.activePlan).toBeUndefined();
  });
  it("rejects stale or mismatched events without divergence", () => {
    const state = selected();
    expect(
      premix(state, { type: "CONTROL_RESET", projectId, generation: 0 }),
    ).toEqual(state);
    expect(
      reduceLifecycleCommand(state, {
        type: "SOURCE_REPLACED",
        projectId,
        generation: 1,
        fileName: "other.mp4",
        prepared,
      }),
    ).toEqual(state);
  });
  it("runs start, progress and completion through one state boundary", () => {
    const id = job("1");
    let state = processingStarted(selected(), id);
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_PROGRESS",
      projectId,
      generation: 1,
      jobId: id,
      chunksCompleted: 12,
      chunksTotal: 12,
    });
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_COMPLETED",
      projectId,
      generation: 1,
      jobId: id,
    });
    expect(state.project.phase).toBe("mix-ready");
    expect(state.experience.phase).toBe("mix-ready");
  });
  it("allows processing start from source-selected", () => {
    const id = job("81");
    const startedFromSource = processingStarted(selected(), id);
    expect(startedFromSource.project.phase).toBe("processing");
    expect(startedFromSource.experience.phase).toBe("enhancing");
  });
  it("accepts only current monotonic processing progress checkpoints", () => {
    const id = job("8");
    const started = processingStarted(selected(), id);
    const progressed = reduceLifecycleCommand(started, {
      type: "PROCESSING_PROGRESS",
      projectId,
      generation: 1,
      jobId: id,
      chunksCompleted: 5,
      chunksTotal: 12,
    });
    expect(progressed.project.phase).toBe("processing");
    expect(progressed.experience.phase).toBe("enhancing");
    expect(progressed.project.activeJob?.id).toBe(id);
    expect(progressed.experience.activePlan?.chunksCompleted).toBe(5);
    expect(progressed.experience.activePlan?.chunksTotal).toBe(12);

    const invalid = [
      { jobId: job("9"), chunksCompleted: 6, chunksTotal: 12 },
      { jobId: id, chunksCompleted: 4, chunksTotal: 12 },
      { jobId: id, chunksCompleted: 6, chunksTotal: 11 },
      { jobId: id, chunksCompleted: 13, chunksTotal: 12 },
      { jobId: id, chunksCompleted: Number.MAX_SAFE_INTEGER, chunksTotal: 12 },
    ];
    for (const checkpoint of invalid) {
      expect(
        reduceLifecycleCommand(progressed, {
          type: "PROCESSING_PROGRESS",
          projectId,
          generation: 1,
          ...checkpoint,
        }),
      ).toBe(progressed);
    }
  });
  it("cancels and advances generation so old completion is stale", () => {
    const id = job("2");
    let state = processingStarted(selected(), id);
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_CANCEL_REQUESTED",
      projectId,
      generation: 1,
      jobId: id,
    });
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_CANCELLED",
      projectId,
      generation: 1,
      jobId: id,
    });
    expect(state.project.generation).toBe(2);
    expect(state.experience.generation).toBe(2);
    expect(
      reduceLifecycleCommand(state, {
        type: "PROCESSING_COMPLETED",
        projectId,
        generation: 1,
        jobId: id,
      }),
    ).toBe(state);
  });
  it("preserves failed snapshot across retry", () => {
    const id = job("3");
    let state = reduceLifecycleCommand(selected(), {
      type: "PROCESSING_STARTED",
      projectId,
      generation: 1,
      jobId: id,
    });
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_FAILED",
      projectId,
      generation: 1,
      jobId: id,
      message: "failed",
    });
    const snapshot = state.experience.activePlan?.snapshot;
    expect(state.project.phase).toBe("recoverable-error");
    expect(state.experience.phase).toBe("recoverable-error");
    expect(snapshot).toBeDefined();
    const retryId = job("31");
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_RETRY",
      projectId,
      generation: 1,
      jobId: retryId,
    });
    expect(state.project.activeJob?.id).toBe(retryId);
    expect(state.experience.activePlan?.jobId).toBe(retryId);
    expect(state.experience.activePlan?.snapshot).toBe(snapshot);
  });
  it("requires matching export job identity", () => {
    const id = job("4");
    let state = processingStarted(selected(), id);
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_COMPLETED",
      projectId,
      generation: 1,
      jobId: id,
    });
    const exportId = job("5");
    state = reduceLifecycleCommand(state, {
      type: "EXPORT_STARTED",
      projectId,
      generation: 1,
      jobId: exportId,
    });
    expect(
      reduceLifecycleCommand(state, {
        type: "EXPORT_COMPLETED",
        projectId,
        generation: 1,
        jobId: id,
      }),
    ).toBe(state);
    state = reduceLifecycleCommand(state, {
      type: "EXPORT_COMPLETED",
      projectId,
      generation: 1,
      jobId: exportId,
    });
    expect(state.experience.phase).toBe("mix-ready");
  });
  it("rejects the premix control-reset path after mix-ready", () => {
    const id = job("6");
    let state = processingStarted(selected(), id);
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_COMPLETED",
      projectId,
      generation: 1,
      jobId: id,
    });
    state = event(state, {
      type: "FINISHED_MIX_EXPORT_TOGGLE",
      projectId,
      generation: 1,
      include: true,
    });
    const rejected = premix(state, {
      type: "CONTROL_RESET",
      projectId,
      generation: 1,
    });
    expect(rejected).toBe(state);
    expect(rejected.project.phase).toBe("mix-ready");
    expect(rejected.experience.phase).toBe("mix-ready");
  });
  it("invalidates accepted mix when profile or scene changes are made post-mix", () => {
    const id = job("88");
    let state = processingStarted(selected(), id);
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_COMPLETED",
      projectId,
      generation: 1,
      jobId: id,
    });

    state = reduceLifecycleCommand(state, {
      type: "PREMIX_EVENT",
      event: {
        type: "PROFILE_SELECTED",
        projectId,
        generation: 1,
        profileId:
          state.experience.profiles.at(0)?.profileId ?? "xp-high-fidelity",
      },
    });
    expect(state.project.phase).toBe("preview-ready");
    expect(state.experience.phase).toBe("preview-ready");

    state = reduceLifecycleCommand(state, {
      type: "PREMIX_EVENT",
      event: {
        type: "SCENE_REGION_TOGGLE",
        projectId,
        generation: 1,
        included: false,
      },
    });
    expect(state.project.phase).toBe("preview-ready");
    expect(state.experience.phase).toBe("preview-ready");
  });
  it("restores mixed snapshot choices when undoing post-mix profile/scene changes", () => {
    const id = job("9");
    let state = processingStarted(selected(), id);
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_COMPLETED",
      projectId,
      generation: 1,
      jobId: id,
    });

    const committedProfile = state.experience.selectedProfileId;
    const committedScene = state.experience.acousticRegionIncluded;

    state = reduceLifecycleCommand(state, {
      type: "PREMIX_EVENT",
      event: {
        type: "PROFILE_SELECTED",
        projectId,
        generation: 1,
        profileId:
          state.experience.profiles.find((profile) => {
            return profile.profileId !== committedProfile;
          })?.profileId ?? "xp-safe-memory",
      },
    });
    state = reduceLifecycleCommand(state, {
      type: "PREMIX_EVENT",
      event: {
        type: "SCENE_REGION_TOGGLE",
        projectId,
        generation: 1,
        included: !committedScene,
      },
    });
    expect(state.project.phase).toBe("preview-ready");
    expect(state.experience.phase).toBe("preview-ready");
    expect(state.experience.selectedProfileId).not.toBe(committedProfile);
    expect(state.experience.acousticRegionIncluded).toBe(!committedScene);

    state = reduceLifecycleCommand(state, {
      type: "MIX_EDIT_UNDO",
      projectId,
      generation: 1,
    });

    expect(state.project.phase).toBe("mix-ready");
    expect(state.experience.phase).toBe("mix-ready");
    expect(state.experience.selectedProfileId).toBe(committedProfile);
    expect(state.experience.acousticRegionIncluded).toBe(committedScene);
  });
  it("atomically resets the visible project to its original source", () => {
    const id = job("7");
    let state = processingStarted(selected(), id);
    state = reduceLifecycleCommand(state, {
      type: "PROCESSING_COMPLETED",
      projectId,
      generation: 1,
      jobId: id,
    });
    state = reduceLifecycleCommand(state, {
      type: "EXPERIENCE_RESET_TO_SOURCE",
      projectId,
      generation: 1,
    });
    expect(state.project.phase).toBe("source-ready");
    expect(state.experience.phase).toBe("source-selected");
    expect(state.experience.projectId).toBe(projectId);
    expect(state.project.committedMixGeneration).toBeUndefined();
    expect(state.experience.previewAssembled).toBe(false);
  });
});
