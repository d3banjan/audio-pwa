export type ProjectId = `project_${string}`;
export type JobId = `job_${string}`;

export type ProjectPhase =
  | "empty"
  | "source-selected"
  | "validating"
  | "source-ready"
  | "processing"
  | "mix-ready"
  | "preview-ready"
  | "exporting"
  | "recoverable-error";

export type JobKind = "validation" | "processing" | "export";
export type JobStatus = "running" | "paused" | "cancel-pending";
export type TransportPhase = "stopped" | "playing" | "paused" | "buffering";

export interface ActiveJob {
  readonly id: JobId;
  readonly kind: JobKind;
  readonly status: JobStatus;
}

export interface FailedJob {
  readonly kind: JobKind;
  readonly checkpoint?: string;
}

export interface ProjectState {
  readonly phase: ProjectPhase;
  readonly generation: number;
  readonly message: string;
  readonly projectId?: ProjectId;
  readonly fileName?: string;
  readonly activeJob?: ActiveJob;
  readonly failedJob?: FailedJob;
  readonly committedMixGeneration?: number;
  readonly transport: TransportPhase;
  readonly transportBeforeBuffering?: Exclude<TransportPhase, "buffering">;
}

type ProjectIdentity = Readonly<{ projectId: ProjectId; generation: number }>;
type JobIdentity = ProjectIdentity & Readonly<{ jobId: JobId }>;

export type ProjectEvent =
  | ({ type: "FILE_SELECTED"; fileName: string } & ProjectIdentity)
  | ({ type: "VALIDATION_STARTED"; jobId: JobId } & ProjectIdentity)
  | ({ type: "VALIDATION_ACCEPTED" } & JobIdentity)
  | ({ type: "VALIDATION_REJECTED"; message: string } & JobIdentity)
  | ({ type: "PROCESSING_STARTED"; jobId: JobId } & ProjectIdentity)
  | ({ type: "PROCESSING_PAUSED" } & JobIdentity)
  | ({ type: "PROCESSING_RESUMED" } & JobIdentity)
  | ({ type: "PROCESSING_COMPLETE" } & JobIdentity)
  | ({ type: "EXPORT_STARTED"; jobId: JobId } & ProjectIdentity)
  | ({ type: "EXPORT_COMPLETE" } & JobIdentity)
  | ({ type: "JOB_CANCEL_REQUESTED" } & JobIdentity)
  | ({ type: "JOB_CANCELLED" } & JobIdentity)
  | ({ type: "JOB_FAILED"; message: string; checkpoint?: string } & JobIdentity)
  | ({ type: "RECOVERY_STARTED"; jobId: JobId } & ProjectIdentity)
  | ({ type: "PLAYBACK_STARTED" } & ProjectIdentity)
  | ({ type: "PLAYBACK_PAUSED" } & ProjectIdentity)
  | ({ type: "BUFFERING_STARTED" } & ProjectIdentity)
  | ({ type: "BUFFERING_RESOLVED" } & ProjectIdentity)
  | ({ type: "PLAYBACK_STOPPED" } & ProjectIdentity)
  | ({ type: "RESET_TO_SOURCE" } & ProjectIdentity)
  | ({ type: "MIX_EDIT_STARTED" } & ProjectIdentity)
  | ({ type: "MIX_EDIT_UNDO" } & ProjectIdentity)
  | ({ type: "REGION_EDIT_STARTED" } & ProjectIdentity)
  | { type: "PROJECT_RESET"; generation: number };

export const initialProjectState: ProjectState = {
  phase: "empty",
  generation: 0,
  message: "Choose a local audio file to begin.",
  transport: "stopped",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createOpaqueId(
  kind: "project" | "job",
  randomUUID: () => string = () => crypto.randomUUID(),
): ProjectId | JobId {
  const uuid = randomUUID();
  if (!UUID_PATTERN.test(uuid))
    throw new Error("The ID source did not return a valid UUID.");
  return `${kind}_${uuid}`;
}

export function nextGeneration(generation: number): number {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation === Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("Project generation cannot be advanced safely.");
  }
  return generation + 1;
}

function isCurrentProject(
  state: ProjectState,
  event: ProjectIdentity,
): boolean {
  return (
    state.projectId === event.projectId && state.generation === event.generation
  );
}

function isCurrentJob(
  state: ProjectState,
  event: JobIdentity,
  expectedKind?: JobKind,
): boolean {
  return (
    isCurrentProject(state, event) &&
    state.activeJob?.id === event.jobId &&
    (expectedKind === undefined || state.activeJob.kind === expectedKind)
  );
}

function isValidId(id: string, kind: "project" | "job"): boolean {
  return (
    id.startsWith(`${kind}_`) && UUID_PATTERN.test(id.slice(kind.length + 1))
  );
}

function completeCancellation(state: ProjectState): ProjectState {
  const cancelledKind = state.activeJob?.kind;
  const hasMix = state.committedMixGeneration !== undefined;
  const destinationPhase =
    cancelledKind === "validation"
      ? "source-selected"
      : cancelledKind === "export" && hasMix
        ? "mix-ready"
        : "source-ready";
  return {
    ...state,
    phase: destinationPhase,
    generation: nextGeneration(state.generation),
    activeJob: undefined,
    failedJob: undefined,
    transport: "stopped",
    transportBeforeBuffering: undefined,
    message:
      cancelledKind === "validation"
        ? "Validation cancelled. The selected source has not been validated."
        : cancelledKind === "export"
          ? "Export cancelled. The mix is unchanged."
          : "Fixture enhancement cancelled. The source presentation is ready.",
  };
}

export function reduceProjectState(
  state: ProjectState,
  event: ProjectEvent,
): ProjectState {
  switch (event.type) {
    case "FILE_SELECTED":
      if (
        event.generation !== nextGeneration(state.generation) ||
        !isValidId(event.projectId, "project") ||
        event.fileName.trim().length === 0
      ) {
        return state;
      }
      return {
        phase: "source-selected",
        generation: event.generation,
        projectId: event.projectId,
        fileName: event.fileName,
        transport: "stopped",
        message:
          "File selected. Decoder validation has not started in this foundation build.",
      };

    case "VALIDATION_STARTED":
      if (
        state.phase !== "source-selected" ||
        !isCurrentProject(state, event) ||
        !isValidId(event.jobId, "job")
      ) {
        return state;
      }
      return {
        ...state,
        phase: "validating",
        activeJob: { id: event.jobId, kind: "validation", status: "running" },
        message: "Validating the selected file locally.",
      };

    case "VALIDATION_ACCEPTED":
      if (
        state.phase !== "validating" ||
        !isCurrentJob(state, event, "validation") ||
        state.activeJob?.status !== "running"
      )
        return state;
      return {
        ...state,
        phase: "source-ready",
        activeJob: undefined,
        message: "Fixture source metadata validated; no media bytes were read.",
      };

    case "VALIDATION_REJECTED":
      if (
        state.phase !== "validating" ||
        !isCurrentJob(state, event, "validation") ||
        state.activeJob?.status !== "running"
      )
        return state;
      return {
        ...state,
        phase: "recoverable-error",
        activeJob: undefined,
        failedJob: { kind: "validation" },
        message: event.message,
      };

    case "PROCESSING_STARTED":
      if (
        (state.phase !== "source-ready" &&
          state.phase !== "source-selected" &&
          state.phase !== "preview-ready") ||
        !isCurrentProject(state, event) ||
        !isValidId(event.jobId, "job")
      ) {
        return state;
      }
      return {
        ...state,
        phase: "processing",
        activeJob: { id: event.jobId, kind: "processing", status: "running" },
        failedJob: undefined,
        message:
          "Fixture enhancement plan started; no audio is being processed.",
      };

    case "PROCESSING_PAUSED":
      if (
        state.phase !== "processing" ||
        !isCurrentJob(state, event, "processing") ||
        state.activeJob?.status !== "running"
      ) {
        return state;
      }
      return {
        ...state,
        activeJob: { ...state.activeJob, status: "paused" },
        message: "Fixture enhancement plan paused at a safe checkpoint.",
      };

    case "PROCESSING_RESUMED":
      if (
        state.phase !== "processing" ||
        !isCurrentJob(state, event, "processing") ||
        state.activeJob?.status !== "paused"
      ) {
        return state;
      }
      return {
        ...state,
        activeJob: { ...state.activeJob, status: "running" },
        message: "Fixture enhancement plan resumed.",
      };

    case "PROCESSING_COMPLETE":
      if (
        state.phase !== "processing" ||
        !isCurrentJob(state, event, "processing") ||
        state.activeJob?.status !== "running"
      ) {
        return state;
      }
      return {
        ...state,
        phase: "mix-ready",
        activeJob: undefined,
        committedMixGeneration: state.generation,
        transport: "stopped",
        // Fixture contract: I-003 uses this transition for synthetic UI state;
        // fully prepared; no stem decoding/rendering pipeline has actually run.
        message:
          "Fixture workflow reached mix-ready; preview stems are visible in UI only.",
      };

    case "EXPORT_STARTED":
      if (
        state.phase !== "mix-ready" ||
        !isCurrentProject(state, event) ||
        !isValidId(event.jobId, "job")
      ) {
        return state;
      }
      return {
        ...state,
        phase: "exporting",
        activeJob: { id: event.jobId, kind: "export", status: "running" },
        transport: "stopped",
        message: "Fixture export simulation started; no WAV is being rendered.",
      };

    case "EXPORT_COMPLETE":
      if (
        state.phase !== "exporting" ||
        !isCurrentJob(state, event, "export") ||
        state.activeJob?.status !== "running"
      ) {
        return state;
      }
      return {
        ...state,
        phase: "mix-ready",
        activeJob: undefined,
        message:
          "Fixture export simulation complete; no file was rendered or saved.",
      };

    case "JOB_CANCEL_REQUESTED": {
      const activeJob = state.activeJob;
      if (
        !activeJob ||
        !isCurrentJob(state, event) ||
        activeJob.status === "cancel-pending"
      )
        return state;
      return {
        ...state,
        activeJob: { ...activeJob, status: "cancel-pending" },
        message: "Cancellation requested. Waiting for a safe checkpoint.",
      };
    }

    case "JOB_CANCELLED":
      if (
        !isCurrentJob(state, event) ||
        state.activeJob?.status !== "cancel-pending"
      )
        return state;
      return completeCancellation(state);

    case "JOB_FAILED": {
      const activeJob = state.activeJob;
      if (!activeJob || !isCurrentJob(state, event)) return state;
      return {
        ...state,
        phase: "recoverable-error",
        activeJob: undefined,
        failedJob: {
          kind: activeJob.kind,
          ...(event.checkpoint === undefined
            ? {}
            : { checkpoint: event.checkpoint }),
        },
        transport: "stopped",
        message: event.message,
      };
    }

    case "RECOVERY_STARTED": {
      if (
        state.phase !== "recoverable-error" ||
        !isCurrentProject(state, event) ||
        !isValidId(event.jobId, "job")
      ) {
        return state;
      }
      const failedKind = state.failedJob?.kind;
      if (failedKind !== "processing" && failedKind !== "export") return state;
      return {
        ...state,
        phase: failedKind === "processing" ? "processing" : "exporting",
        activeJob: { id: event.jobId, kind: failedKind, status: "running" },
        failedJob: undefined,
        message:
          failedKind === "processing"
            ? "Retrying processing from the last valid checkpoint."
            : "Retrying export.",
      };
    }

    case "PLAYBACK_STARTED":
      if (
        state.phase !== "mix-ready" ||
        !isCurrentProject(state, event) ||
        state.transport === "playing"
      ) {
        return state;
      }
      return {
        ...state,
        transport: "playing",
        transportBeforeBuffering: undefined,
      };

    case "PLAYBACK_PAUSED":
      if (
        state.phase !== "mix-ready" ||
        !isCurrentProject(state, event) ||
        state.transport !== "playing"
      ) {
        return state;
      }
      return {
        ...state,
        transport: "paused",
        transportBeforeBuffering: undefined,
      };

    case "BUFFERING_STARTED":
      if (
        state.phase !== "mix-ready" ||
        !isCurrentProject(state, event) ||
        (state.transport !== "playing" && state.transport !== "paused")
      ) {
        return state;
      }
      return {
        ...state,
        transportBeforeBuffering: state.transport,
        transport: "buffering",
        message: "Playback is buffering all stems.",
      };

    case "BUFFERING_RESOLVED":
      if (
        state.phase !== "mix-ready" ||
        !isCurrentProject(state, event) ||
        state.transport !== "buffering"
      ) {
        return state;
      }
      return {
        ...state,
        transport: state.transportBeforeBuffering ?? "paused",
        transportBeforeBuffering: undefined,
        // Fixture contract: I-003 maps buffering recovery to synthetic UI state, so
        // this is not a claim of newly rendered or audible stems.
        message:
          "Fixture playback state returned to synthetic preview; stems are UI-only.",
      };

    case "PLAYBACK_STOPPED":
      if (
        state.phase !== "mix-ready" ||
        !isCurrentProject(state, event) ||
        state.transport === "stopped"
      ) {
        return state;
      }
      return {
        ...state,
        transport: "stopped",
        transportBeforeBuffering: undefined,
      };

    case "PROJECT_RESET":
      if (event.generation !== nextGeneration(state.generation)) return state;
      return { ...initialProjectState, generation: event.generation };

    case "RESET_TO_SOURCE":
      if (!isCurrentProject(state, event)) return state;
      if (state.phase !== "mix-ready" && state.phase !== "recoverable-error")
        return state;
      return {
        ...state,
        phase: "source-ready",
        activeJob: undefined,
        failedJob: undefined,
        committedMixGeneration: undefined,
        transport: "stopped",
        message: "Reset to the original source. Ready to enhance again.",
      };

    case "MIX_EDIT_STARTED":
      if (state.phase !== "mix-ready" || !isCurrentProject(state, event))
        return state;
      return {
        ...state,
        phase: "preview-ready",
        message:
          "Preview edits are active; the accepted mix remains available.",
      };
    case "MIX_EDIT_UNDO":
      if (state.phase !== "preview-ready" || !isCurrentProject(state, event))
        return state;
      return {
        ...state,
        phase: "mix-ready",
        message: "Accepted mix restored.",
      };
    case "REGION_EDIT_STARTED":
      if (state.phase !== "mix-ready" || !isCurrentProject(state, event))
        return state;
      return {
        ...state,
        phase: "preview-ready",
        message: "Preview region edits are active.",
      };
  }
}

export function acceptsAudioFile(fileName: string): boolean {
  const extension = fileName.toLocaleLowerCase().split(".").at(-1);
  return (
    extension === "wav" ||
    extension === "mp3" ||
    extension === "m4a" ||
    extension === "aac" ||
    extension === "flac"
  );
}
