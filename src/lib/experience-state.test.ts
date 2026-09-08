import { describe, expect, it } from "vitest";
import {
  DEMO_STEM_ORDER,
  type ExperienceEvent,
  type ExperienceState,
  type FrameRange,
  initialExperienceState,
  reduceExperienceState,
  buildResourceProfiles,
  currentExportManifest,
  DEMO_STEMS,
  supportsDemoSource,
  toSeconds,
  makeDefaultStems,
  sourceKindFromFileName,
} from "./experience-state";

import { createOpaqueId, type ProjectId, type JobId } from "./app-state";
import { deterministicFixtureAdapter } from "./deterministic-source-adapter";

function preparedFixture(file = "take.mp4") {
  const result = deterministicFixtureAdapter.prepare(file);
  if (!result.accepted) throw new Error(result.reason);
  return result.prepared;
}

function fileSource(projectId: ProjectId, file = "take.mp4"): ExperienceState {
  const select: ExperienceEvent = {
    type: "SOURCE_SELECTED",
    projectId,
    generation: 1,
    fileName: file,
    prepared: preparedFixture(file),
  };
  return reduceExperienceState(initialExperienceState, select);
}

function applyPlanStarted(
  state: ExperienceState,
  projectId: ProjectId,
): ExperienceState {
  const profileId = state.selectedProfileId ?? "xp-high-fidelity";
  const jobId = createOpaqueId(
    "job",
    () => "20000000-0000-4000-8000-000000000002",
  ) as JobId;
  return reduceExperienceState(state, {
    type: "PLAN_STARTED",
    projectId,
    generation: state.generation,
    jobId,
    profileId,
  });
}

describe("experience reducer", () => {
  const projectId = createOpaqueId(
    "project",
    () => "10000000-0000-4000-8000-000000000001",
  ) as ProjectId;

  it("loads the deterministic fixture and exposes a previewable profile state", () => {
    const selected = fileSource(projectId);
    const firstProfile = selected.profiles.find(
      (profile) => profile.profileId === "xp-high-fidelity",
    );

    expect(selected).toMatchObject({
      phase: "source-selected",
      generation: 1,
      hasValidSource: true,
      comparisonMode: "source",
      controlWorking: { dialogueClean: 45, musicWeight: 50 },
    });
    expect(selected.selectedFixture).toBeDefined();
    expect(selected.selectedFixture?.video.width).toBe(1024);
    expect(firstProfile?.feasible).toBe(true);
    expect(selected.region.startFrame).toBeLessThan(selected.region.endFrame);
    expect(selected.selectedSourceKind).toBe("video");
  });

  it("labels audio fixtures from their filename", () => {
    expect(sourceKindFromFileName("VOICE.WAV")).toBe("audio");
    expect(fileSource(projectId, "voice.m4a").selectedSourceKind).toBe("audio");
  });

  it("accepts an alternate adapter payload and selects its feasible profile", () => {
    const alternate = deterministicFixtureAdapter.prepare("voice.mp4");
    if (!alternate.accepted) throw new Error(alternate.reason);
    const prepared = {
      ...alternate.prepared,
      sourceKind: "audio" as const,
      profiles: alternate.prepared.profiles.map((profile, index) => ({
        ...profile,
        profileId: `alternate-${index}`,
        feasible: index === 1,
      })),
      selectedProfileId: "alternate-1",
    };
    const state = reduceExperienceState(initialExperienceState, {
      type: "SOURCE_SELECTED",
      projectId: createOpaqueId("project") as ProjectId,
      generation: 1,
      fileName: "normally-unsupported.custom",
      prepared,
    });
    expect(state.selectedSourceKind).toBe("audio");
    expect(state.selectedProfileId).toBe("alternate-1");
    expect(state.profiles.map((profile) => profile.profileId)).toContain(
      "alternate-1",
    );
  });

  it("preserves the established unsupported-source display message and code", () => {
    const result = deterministicFixtureAdapter.prepare("notes.txt");
    expect(result).toEqual({
      accepted: false,
      code: "unsupported-source",
      reason: "Choose a WAV, MP3, M4A, AAC, FLAC, or MP4 file.",
    });
  });

  it("ignores stale events and unsupported files", () => {
    const untouched = fileSource(projectId);
    expect(
      reduceExperienceState(untouched, {
        type: "SOURCE_SELECTED",
        projectId,
        generation: 1,
        fileName: "take.mp4",
        prepared: preparedFixture(),
      }),
    ).toBe(untouched);
    expect(
      reduceExperienceState(initialExperienceState, {
        type: "SOURCE_SELECTED",
        projectId,
        generation: 0,
        fileName: "notes.txt",
        prepared: preparedFixture(),
      }),
    ).toBe(initialExperienceState);
  });

  it("supports preview controls, A/B state and undo to committed controls", () => {
    const state = fileSource(projectId);
    const edited = reduceExperienceState(state, {
      type: "CONTROL_CHANGED",
      projectId,
      generation: 1,
      control: "musicWeight",
      value: 62,
    });
    expect(edited.comparisonMode).toBe("preview");
    expect(edited.phase).toBe("preview-ready");
    const reset = reduceExperienceState(edited, {
      type: "UNDO_PREVIEW",
      projectId,
      generation: 1,
    });
    expect(reset.controlWorking.musicWeight).toBe(
      state.controlCommitted.musicWeight,
    );
    expect(reset.comparisonMode).toBe("source");
  });

  it("undo restores accepted profile and scene choices from snapshot", () => {
    const source = fileSource(projectId);
    const baseline = applyPlanStarted(source, projectId);
    const completed = reduceExperienceState(baseline, {
      type: "PLAN_COMPLETE",
      projectId,
      generation: 1,
      jobId: baseline.activePlan?.jobId as JobId,
    });
    const originalProfile = completed.selectedProfileId;
    const originalScene = completed.acousticRegionIncluded;

    const editedProfile = reduceExperienceState(completed, {
      type: "PROFILE_SELECTED",
      projectId,
      generation: 1,
      profileId:
        completed.profiles.at(1)?.profileId ?? completed.profiles[0]!.profileId,
    });
    const editedScene = reduceExperienceState(editedProfile, {
      type: "SCENE_REGION_TOGGLE",
      projectId,
      generation: 1,
      included: true,
    });
    expect(editedScene.phase).toBe("preview-ready");

    const reverted = reduceExperienceState(editedScene, {
      type: "UNDO_PREVIEW",
      projectId,
      generation: 1,
    });
    expect(reverted.phase).toBe("mix-ready");
    expect(reverted.selectedProfileId).toBe(originalProfile);
    expect(reverted.acousticRegionIncluded).toBe(originalScene);
    expect(reverted.controlWorking).toMatchObject(reverted.controlCommitted);
  });

  it("exports from committed snapshot values after undoing working changes", () => {
    const source = fileSource(projectId);
    const started = applyPlanStarted(source, projectId);
    const completed = reduceExperienceState(started, {
      type: "PLAN_COMPLETE",
      projectId,
      generation: 1,
      jobId: started.activePlan?.jobId as JobId,
    });
    const originalProfile = completed.selectedProfileId;
    const editedProfile = reduceExperienceState(completed, {
      type: "PROFILE_SELECTED",
      projectId,
      generation: 1,
      profileId:
        completed.profiles.at(1)?.profileId ?? completed.profiles[0]!.profileId,
    });
    const editedScene = reduceExperienceState(editedProfile, {
      type: "SCENE_REGION_TOGGLE",
      projectId,
      generation: 1,
      included: true,
    });
    const reverted = reduceExperienceState(editedScene, {
      type: "UNDO_PREVIEW",
      projectId,
      generation: 1,
    });
    const exportState = reduceExperienceState(reverted, {
      type: "EXPORTING_STARTED",
      projectId,
      generation: 1,
      jobId: createOpaqueId(
        "job",
        () => "30000000-0000-4000-8000-000000000030",
      ) as JobId,
    });

    expect(exportState.phase).toBe("exporting");
    expect(exportState.exportSnapshot?.profileId).toBe(originalProfile);
    expect(exportState.exportSnapshot?.sceneIncluded).toBe(
      reverted.acousticRegionIncluded,
    );
    expect(exportState.exportSnapshot?.region).toEqual(
      completed.activePlan?.snapshot.region,
    );
  });

  it("runs deterministic plan progress and supports cancel transitions", () => {
    const source = fileSource(projectId);
    const started = applyPlanStarted(source, projectId);
    expect(started.phase).toBe("enhancing");
    const profile = started.profiles.find(
      (item) => item.profileId === started.selectedProfileId,
    );
    expect(profile).toBeDefined();

    const progressed = reduceExperienceState(started, {
      type: "PLAN_PROGRESS",
      projectId,
      generation: started.generation,
      jobId: started.activePlan?.jobId as JobId,
      chunksCompleted: 2,
      chunksTotal: profile?.requiredChunks ?? 10,
    });
    expect(progressed.activePlan?.chunksCompleted).toBe(2);
    expect(progressed.activePlan?.chunksTotal).toBe(profile?.requiredChunks);

    const cancelRequested = reduceExperienceState(progressed, {
      type: "PLAN_CANCEL_REQUESTED",
      projectId,
      generation: started.generation,
      jobId: started.activePlan?.jobId as JobId,
    });
    expect(cancelRequested.activePlan?.phase).toBe("cancel-requested");
    const cancelled = reduceExperienceState(cancelRequested, {
      type: "PLAN_CANCELLED",
      projectId,
      generation: started.generation,
      jobId: started.activePlan?.jobId as JobId,
    });
    expect(cancelled.phase).toBe("source-selected");
    expect(cancelled.activePlan).toBeUndefined();
  });

  it("rejects non-finite and unsafe progress without changing state", () => {
    const started = applyPlanStarted(fileSource(projectId), projectId);
    for (const [chunksCompleted, chunksTotal] of [
      [NaN, 4],
      [1, Infinity],
      [-1, 4],
      [Number.MAX_SAFE_INTEGER + 1, 4],
    ] as Array<[number, number]>) {
      const rejected = reduceExperienceState(started, {
        type: "PLAN_PROGRESS",
        projectId,
        generation: 1,
        jobId: started.activePlan!.jobId as JobId,
        chunksCompleted,
        chunksTotal,
      });
      expect(rejected).toBe(started);
    }
  });

  it("retries a recoverable plan and preserves its immutable snapshot", () => {
    const started = applyPlanStarted(fileSource(projectId), projectId);
    const failed = reduceExperienceState(started, {
      type: "PLAN_FAILED",
      projectId,
      generation: 1,
      jobId: started.activePlan!.jobId as JobId,
      message: "temporary",
    });
    const snapshot = failed.activePlan!.snapshot;
    const retried = reduceExperienceState(failed, {
      type: "PLAN_RETRY",
      projectId,
      generation: 1,
      jobId: failed.activePlan!.jobId as JobId,
    });
    expect(retried.phase).toBe("enhancing");
    expect(retried.activePlan!.snapshot).toBe(snapshot);
    expect(retried.activePlan!.chunksCompleted).toBe(0);
  });

  it("keeps finished mix inclusion independent from audition state", () => {
    const ready = fileSource(projectId);
    const mix = reduceExperienceState(ready, {
      type: "FINISHED_MIX_EXPORT_TOGGLE",
      projectId,
      generation: 1,
      include: true,
    });
    const muted = reduceExperienceState(mix, {
      type: "STEM_AUDITION",
      projectId,
      generation: 1,
      bus: "music",
      muted: true,
      soloed: false,
    });
    expect(currentExportManifest(muted)[0]).toBe("finished-mix");
  });

  it("builds independent audition and export stem state for D-015", () => {
    const ready = fileSource(projectId);
    const auditionMuted = reduceExperienceState(ready, {
      type: "STEM_AUDITION",
      projectId,
      generation: 1,
      bus: "dialogue",
      muted: true,
      soloed: false,
    });
    const exportRemoved = reduceExperienceState(auditionMuted, {
      type: "STEM_EXPORT_TOGGLE",
      projectId,
      generation: 1,
      bus: "dialogue",
      include: false,
    });
    const manifest = currentExportManifest(exportRemoved);
    expect(exportRemoved.stems[0]?.audition.muted).toBe(true);
    expect(manifest).not.toContain("dialogue");
    expect(manifest).toEqual(["music", "ambience", "effects"]);
  });

  it("builds resource profiles with feasible/infeasible states", () => {
    const constrained = buildResourceProfiles({
      memoryBytes: 1_000_000_000,
      storageBytes: 2_000_000_000,
    });
    const feasible = constrained.find((profile) => profile.feasible);
    const infeasible = constrained.find((profile) => !profile.feasible);
    expect(feasible).toBeDefined();
    expect(infeasible).toBeDefined();
    expect(infeasible?.blockers.length).toBeGreaterThan(0);
  });

  it("tracks profile and region time conversion without reading media bytes", () => {
    const region: FrameRange = {
      startFrame: 2_880_000,
      endFrame: 3_840_000,
    };
    const fixtureSeconds = toSeconds(region);
    expect(fixtureSeconds.startSeconds).toBe(60);
    expect(fixtureSeconds.endSeconds).toBe(80);
    expect(supportsDemoSource("sample.mp4")).toBe(true);
    expect(supportsDemoSource("sample.wav")).toBe(true);
    expect(supportsDemoSource("sample.txt")).toBe(false);
  });

  it("preserves committed controls on completed preview planning", () => {
    const source = fileSource(projectId);
    const edited = reduceExperienceState(source, {
      type: "CONTROL_CHANGED",
      projectId,
      generation: 1,
      control: "ducking",
      value: 66,
    });
    const started = applyPlanStarted(edited, projectId);
    const completed = reduceExperienceState(started, {
      type: "PLAN_COMPLETE",
      projectId,
      generation: 1,
      jobId: started.activePlan?.jobId as JobId,
    });
    expect(completed.phase).toBe("mix-ready");
    expect(completed.previewAssembled).toBe(true);
    expect(completed.controlCommitted.ducking).toBe(66);
    expect(completed.controlWorking).toMatchObject(completed.controlCommitted);
  });

  it("snapshots only the selected outputs when planning starts", () => {
    const source = fileSource(projectId);
    const deselected = reduceExperienceState(source, {
      type: "STEM_EXPORT_TOGGLE",
      projectId,
      generation: 1,
      bus: "music",
      include: false,
    });
    const started = applyPlanStarted(deselected, projectId);
    expect(started.activePlan?.snapshot.outputs).toEqual([
      "dialogue",
      "ambience",
      "effects",
    ]);
  });

  it("invalidates an accepted mix when profile or scene selection changes", () => {
    const source = fileSource(projectId);
    let edited = reduceExperienceState(
      reduceExperienceState(source, {
        type: "CONTROL_CHANGED",
        projectId,
        generation: 1,
        control: "musicWeight",
        value: 24,
      }),
      {
        type: "PLAN_STARTED",
        projectId,
        generation: 1,
        jobId: createOpaqueId(
          "job",
          () => "20000000-0000-4000-8000-000000000012",
        ) as JobId,
      },
    );
    edited = reduceExperienceState(edited, {
      type: "PLAN_COMPLETE",
      projectId,
      generation: 1,
      jobId: edited.activePlan!.jobId as JobId,
    });
    expect(edited.phase).toBe("mix-ready");

    const profile = edited.profiles.at(0);
    if (!profile) throw new Error("No profile available");
    const afterProfile = reduceExperienceState(edited, {
      type: "PROFILE_SELECTED",
      projectId,
      generation: 1,
      profileId: profile.profileId,
    });
    expect(afterProfile.phase).toBe("preview-ready");

    const withScene = reduceExperienceState(afterProfile, {
      type: "SCENE_REGION_TOGGLE",
      projectId,
      generation: 1,
      included: false,
    });
    expect(withScene.phase).toBe("preview-ready");
  });

  it("ignores stale plan transitions and ignores incompatible profile selection", () => {
    const source = fileSource(projectId);
    const started = applyPlanStarted(source, projectId);
    expect(started.phase).toBe("enhancing");

    const staleComplete = reduceExperienceState(source, {
      type: "PLAN_COMPLETE",
      projectId,
      generation: 1,
      jobId: started.activePlan?.jobId as JobId,
    });
    expect(staleComplete).toBe(source);

    const profileLocked = reduceExperienceState(started, {
      type: "PROFILE_SELECTED",
      projectId,
      generation: 1,
      profileId: "not-a-profile",
    });
    expect(profileLocked.selectedProfileId).toBe(started.selectedProfileId);
  });

  it("blocks plan execution when profile is infeasible", () => {
    const blocked = buildResourceProfiles({
      memoryBytes: 1,
      storageBytes: 1,
    })[0]!;
    expect(blocked.feasible).toBe(false);

    const source = {
      ...fileSource(projectId),
      profiles: buildResourceProfiles({ memoryBytes: 1, storageBytes: 1 }),
    };

    const blockedSelected = reduceExperienceState(source as ExperienceState, {
      type: "PROFILE_SELECTED",
      projectId,
      generation: 1,
      profileId: blocked.profileId,
    });
    expect(blockedSelected.selectedProfileId).toBe(blocked.profileId);

    const impossible = reduceExperienceState(blockedSelected, {
      type: "PLAN_STARTED",
      projectId,
      generation: 1,
      jobId: createOpaqueId(
        "job",
        () => "50000000-0000-4000-8000-000000000005",
      ) as JobId,
      profileId: blocked.profileId,
    });
    expect(impossible).toBe(blockedSelected);
  });

  it("uses deterministic stem labels and ids", () => {
    const stems = makeDefaultStems();
    expect(stems).toHaveLength(DEMO_STEM_ORDER.length);
    for (const stemId of DEMO_STEM_ORDER) {
      const stem = stems.find((candidate) => candidate.id === stemId);
      expect(stem?.audition).toEqual({ muted: false, soloed: false });
      expect(stem?.exportInclude).toBe(true);
    }
    expect(DEMO_STEMS.map((stem) => stem.id)).toEqual(DEMO_STEM_ORDER);
  });
});
