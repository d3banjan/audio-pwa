import {
  initialProjectState,
  reduceProjectState,
  type JobId,
  type ProjectId,
  type ProjectEvent,
  type ProjectState,
} from "./app-state";
import {
  initialExperienceState,
  reduceExperienceState,
  type ExperienceEvent,
  type ExperienceState,
  type PreparedSourcePayload,
  type MixControls,
} from "./experience-state";

export interface LifecycleState {
  readonly project: ProjectState;
  readonly experience: ExperienceState;
}
export type PremixEditEvent = Extract<
  ExperienceEvent,
  {
    type:
      "CONTROL_CHANGED" | "CONTROL_RESET" | "UNDO_PREVIEW" | "REGION_CHANGED";
  }
>;

export type ReprocessableEditEvent = Extract<
  ExperienceEvent,
  {
    type: "PROFILE_SELECTED" | "SCENE_REGION_TOGGLE";
  }
>;

export type PhaseNeutralExperienceEvent = Extract<
  ExperienceEvent,
  {
    type:
      | "PREVIEW_TOGGLE"
      | "PROFILE_SELECTED"
      | "STEM_AUDITION"
      | "STEM_EXPORT_TOGGLE"
      | "FINISHED_MIX_EXPORT_TOGGLE"
      | "SCENE_REGION_TOGGLE";
  }
>;

export type LifecycleCommand =
  | {
      type: "SOURCE_REPLACED";
      projectId: ProjectId;
      generation: number;
      fileName: string;
      prepared: PreparedSourcePayload;
    }
  | {
      type: "PROCESSING_STARTED";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
      profileId?: string;
    }
  | {
      type: "PROCESSING_CANCEL_REQUESTED";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
    }
  | {
      type: "PROCESSING_CANCELLED";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
    }
  | {
      type: "PROCESSING_COMPLETED";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
    }
  | {
      type: "PROCESSING_FAILED";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
      message: string;
    }
  | {
      type: "PROCESSING_RETRY";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
    }
  | {
      type: "EXPORT_STARTED";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
    }
  | {
      type: "EXPORT_COMPLETED";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
    }
  | {
      type: "EXPORT_FAILED";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
      message: string;
    }
  | {
      type: "EXPORT_RETRY";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
    }
  | {
      type: "EXPERIENCE_RESET_TO_SOURCE";
      projectId: ProjectId;
      generation: number;
    }
  | {
      type: "MIX_EDIT_STARTED";
      projectId: ProjectId;
      generation: number;
      control: keyof MixControls;
      value: MixControls[keyof MixControls];
    }
  | { type: "MIX_EDIT_UNDO"; projectId: ProjectId; generation: number }
  | {
      type: "REGION_EDIT_STARTED";
      projectId: ProjectId;
      generation: number;
      startFrame: number;
      endFrame: number;
    }
  | {
      type: "PREMIX_EVENT";
      event: PremixEditEvent | ReprocessableEditEvent;
    }
  | {
      type: "PROCESSING_PROGRESS";
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
      chunksCompleted: number;
      chunksTotal: number;
    }
  | { type: "EVENT"; event: PhaseNeutralExperienceEvent };

/** Single atomic boundary for project and experience lifecycle events. */
function reduceDomainEvent(
  state: LifecycleState,
  event: ProjectEvent | ExperienceEvent,
): LifecycleState {
  const projectTypes = new Set([
    "FILE_SELECTED",
    "VALIDATION_STARTED",
    "VALIDATION_ACCEPTED",
    "VALIDATION_REJECTED",
    "PROCESSING_STARTED",
    "PROCESSING_PAUSED",
    "PROCESSING_RESUMED",
    "PROCESSING_COMPLETE",
    "EXPORT_STARTED",
    "EXPORT_COMPLETE",
    "JOB_CANCEL_REQUESTED",
    "JOB_CANCELLED",
    "JOB_FAILED",
    "RECOVERY_STARTED",
    "PLAYBACK_STARTED",
    "PLAYBACK_PAUSED",
    "BUFFERING_STARTED",
    "BUFFERING_RESOLVED",
    "PLAYBACK_STOPPED",
    "PROJECT_RESET",
    "RESET_TO_SOURCE",
    "MIX_EDIT_STARTED",
    "MIX_EDIT_UNDO",
    "REGION_EDIT_STARTED",
  ]);
  const cancellation = event.type === "PLAN_CANCELLED";
  const project = cancellation
    ? reduceProjectState(state.project, {
        type: "JOB_CANCELLED",
        projectId: event.projectId,
        generation: event.generation,
        jobId: event.jobId,
      })
    : projectTypes.has(event.type)
      ? reduceProjectState(state.project, event as ProjectEvent)
      : state.project;
  const experience = cancellation
    ? reduceExperienceState(state.experience, event as ExperienceEvent)
    : projectTypes.has(event.type)
      ? state.experience
      : reduceExperienceState(state.experience, event as ExperienceEvent);
  // Shared identity must never be allowed to drift after a transition.
  if (
    project.projectId !== undefined &&
    experience.projectId !== undefined &&
    (project.projectId !== experience.projectId ||
      project.generation !== experience.generation)
  ) {
    return state;
  }
  if (project === state.project && experience === state.experience)
    return state;
  return Object.freeze({ project, experience });
}

export function reduceLifecycleCommand(
  state: LifecycleState,
  command: LifecycleCommand,
): LifecycleState {
  if (!command || typeof command !== "object" || !("type" in command))
    return state;
  if (command.type === "EVENT") {
    const safe = new Set([
      "PREVIEW_TOGGLE",
      "PROFILE_SELECTED",
      "STEM_AUDITION",
      "STEM_EXPORT_TOGGLE",
      "FINISHED_MIX_EXPORT_TOGGLE",
      "SCENE_REGION_TOGGLE",
    ]);
    return safe.has(command.event.type)
      ? reduceDomainEvent(state, command.event)
      : state;
  }
  const e = command;
  if (e.type === "PREMIX_EVENT") {
    if (
      ![
        "CONTROL_CHANGED",
        "CONTROL_RESET",
        "UNDO_PREVIEW",
        "REGION_CHANGED",
        "PROFILE_SELECTED",
        "SCENE_REGION_TOGGLE",
      ].includes(e.event.type)
    )
      return state;
    if (
      state.project.phase === "mix-ready" &&
      e.event.type === "CONTROL_RESET"
    ) {
      return state;
    }
    const project =
      state.project.phase === "mix-ready"
        ? reduceProjectState(state.project, {
            type: "MIX_EDIT_STARTED",
            projectId: e.event.projectId,
            generation: e.event.generation,
          })
        : state.project;
    const experience = reduceExperienceState(state.experience, e.event);
    if (
      experience.projectId !== project.projectId ||
      experience.generation !== project.generation
    )
      return state;
    if (
      state.experience.phase === "enhancing" ||
      state.experience.phase === "exporting"
    )
      return state;
    return Object.freeze({ project, experience });
  }
  if (e.type === "PROCESSING_PROGRESS") {
    if (
      state.project.phase !== "processing" ||
      state.project.activeJob?.id !== e.jobId
    )
      return state;
    const experience = reduceExperienceState(state.experience, {
      type: "PLAN_PROGRESS",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
      chunksCompleted: e.chunksCompleted,
      chunksTotal: e.chunksTotal,
    });
    if (
      experience.phase !== "enhancing" ||
      experience.activePlan?.jobId !== e.jobId ||
      experience.activePlan.chunksCompleted !== e.chunksCompleted
    )
      return state;
    return Object.freeze({ project: state.project, experience });
  }
  const events: (ProjectEvent | ExperienceEvent)[] = [];
  if (e.type === "SOURCE_REPLACED") {
    const project = reduceProjectState(state.project, {
      type: "FILE_SELECTED",
      projectId: e.projectId,
      generation: e.generation,
      fileName: e.fileName,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "SOURCE_SELECTED",
      projectId: e.projectId,
      generation: e.generation,
      fileName: e.fileName,
      prepared: e.prepared,
    });
    if (
      project.projectId !== experience.projectId ||
      project.generation !== experience.generation
    )
      return state;
    return Object.freeze({ project, experience });
  } else if (e.type === "MIX_EDIT_STARTED") {
    const project = reduceProjectState(state.project, {
      type: "MIX_EDIT_STARTED",
      projectId: e.projectId,
      generation: e.generation,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "CONTROL_CHANGED",
      projectId: e.projectId,
      generation: e.generation,
      control: e.control,
      value: e.value,
    });
    if (
      project.phase !== "preview-ready" ||
      experience.phase !== "preview-ready"
    )
      return state;
    return Object.freeze({ project, experience });
  } else if (e.type === "MIX_EDIT_UNDO") {
    const project = reduceProjectState(state.project, {
      type: "MIX_EDIT_UNDO",
      projectId: e.projectId,
      generation: e.generation,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "UNDO_PREVIEW",
      projectId: e.projectId,
      generation: e.generation,
    });
    if (project.phase !== "mix-ready" || experience.phase !== "mix-ready")
      return state;
    return Object.freeze({ project, experience });
  } else if (e.type === "REGION_EDIT_STARTED") {
    const project = reduceProjectState(state.project, {
      type: "REGION_EDIT_STARTED",
      projectId: e.projectId,
      generation: e.generation,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "REGION_CHANGED",
      projectId: e.projectId,
      generation: e.generation,
      startFrame: e.startFrame,
      endFrame: e.endFrame,
    });
    if (
      project.phase !== "preview-ready" ||
      experience.phase !== "preview-ready"
    )
      return state;
    return Object.freeze({ project, experience });
  } else if (e.type === "EXPERIENCE_RESET_TO_SOURCE") {
    const project = reduceProjectState(state.project, {
      type: "RESET_TO_SOURCE",
      projectId: e.projectId,
      generation: e.generation,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "CONTROL_RESET",
      projectId: e.projectId,
      generation: e.generation,
    });
    if (
      project.phase !== "source-ready" ||
      experience.phase !== "source-selected" ||
      project.projectId !== experience.projectId ||
      project.generation !== experience.generation
    )
      return state;
    return Object.freeze({ project, experience });
  } else if (e.type === "PROCESSING_STARTED") {
    events.push({
      type: "VALIDATION_STARTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    events.push({
      type: "VALIDATION_ACCEPTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    events.push({
      type: "PROCESSING_STARTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    events.push({
      type: "PLAN_STARTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
      profileId: e.profileId,
    });
  } else if (e.type === "PROCESSING_CANCEL_REQUESTED") {
    events.push({
      type: "JOB_CANCEL_REQUESTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    events.push({
      type: "PLAN_CANCEL_REQUESTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
  } else if (e.type === "PROCESSING_CANCELLED") {
    events.push({
      type: "PLAN_CANCELLED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    events.push({
      type: "JOB_CANCELLED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
  } else if (e.type === "PROCESSING_COMPLETED") {
    events.push({
      type: "PROCESSING_COMPLETE",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    events.push({
      type: "PLAN_COMPLETE",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
  } else if (e.type === "PROCESSING_FAILED") {
    events.push({
      type: "JOB_FAILED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
      message: e.message,
    });
    events.push({
      type: "PLAN_FAILED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
      message: e.message,
    });
  } else if (e.type === "PROCESSING_RETRY") {
    events.push({
      type: "RECOVERY_STARTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    events.push({
      type: "PLAN_RETRY",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
  } else if (e.type === "EXPORT_STARTED") {
    const project = reduceProjectState(state.project, {
      type: "EXPORT_STARTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "EXPORTING_STARTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    if (
      project.phase !== "exporting" ||
      experience.phase !== "exporting" ||
      project.activeJob?.id !== e.jobId ||
      experience.exportJobId !== e.jobId
    )
      return state;
    return Object.freeze({ project, experience });
  } else if (e.type === "EXPORT_COMPLETED") {
    if (
      state.project.activeJob?.id !== e.jobId ||
      state.experience.exportJobId !== e.jobId
    )
      return state;
    const project = reduceProjectState(state.project, {
      type: "EXPORT_COMPLETE",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "EXPORT_COMPLETE",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    if (
      project.phase !== "mix-ready" ||
      experience.phase !== "mix-ready" ||
      project.activeJob !== undefined ||
      experience.exportJobId !== undefined
    )
      return state;
    return Object.freeze({ project, experience });
  } else if (e.type === "EXPORT_FAILED") {
    if (
      state.project.activeJob?.id !== e.jobId ||
      state.experience.exportJobId !== e.jobId
    )
      return state;
    const project = reduceProjectState(state.project, {
      type: "JOB_FAILED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
      message: e.message,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "EXPORT_FAILED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
      message: e.message,
    });
    if (
      project.phase !== "recoverable-error" ||
      experience.phase !== "recoverable-error" ||
      project.failedJob?.kind !== "export"
    )
      return state;
    return Object.freeze({ project, experience });
  } else if (e.type === "EXPORT_RETRY") {
    const project = reduceProjectState(state.project, {
      type: "RECOVERY_STARTED",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    const experience = reduceExperienceState(state.experience, {
      type: "EXPORT_RETRY",
      projectId: e.projectId,
      generation: e.generation,
      jobId: e.jobId,
    });
    if (
      project.phase !== "exporting" ||
      experience.phase !== "exporting" ||
      project.activeJob?.id !== e.jobId ||
      experience.exportJobId !== e.jobId
    )
      return state;
    return Object.freeze({ project, experience });
  }
  let next = state;
  for (const event of events) next = reduceDomainEvent(next, event);
  const accepted =
    e.type === "PROCESSING_STARTED"
      ? next.project.phase === "processing" &&
        next.experience.phase === "enhancing" &&
        next.project.activeJob?.id === e.jobId &&
        next.experience.activePlan?.jobId === e.jobId
      : e.type === "PROCESSING_COMPLETED"
        ? next.project.phase === "mix-ready" &&
          next.experience.phase === "mix-ready"
        : e.type === "PROCESSING_CANCELLED"
          ? next.project.generation === state.project.generation + 1 &&
            next.experience.generation === state.experience.generation + 1
          : e.type === "PROCESSING_RETRY"
            ? next.project.activeJob?.id === e.jobId &&
              next.experience.activePlan?.jobId === e.jobId
            : e.type === "PROCESSING_FAILED"
              ? next.project.phase === "recoverable-error" &&
                next.experience.phase === "recoverable-error"
              : true;
  if (!accepted) return state;
  return next;
}

export function reduceLifecycle(
  state: LifecycleState,
  command: LifecycleCommand,
): LifecycleState {
  return reduceLifecycleCommand(state, command);
}

export function createLifecycleState(): LifecycleState {
  return Object.freeze({
    project: initialProjectState,
    experience: initialExperienceState,
  });
}

export class LifecycleCoordinator {
  private current: LifecycleState = createLifecycleState();
  get state(): LifecycleState {
    return this.current;
  }
  dispatch(command: LifecycleCommand): LifecycleState {
    this.current = reduceLifecycleCommand(this.current, command);
    return this.current;
  }
}
