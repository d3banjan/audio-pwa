export type CacheVerification =
  "checking" | "verified" | "incomplete" | "unsupported" | "error";
export type DocumentControl = "controlled" | "uncontrolled";
export type WaitingUpdate =
  "none" | "installing" | "verifying" | "ready" | "error";
export type ModelStatus = "missing" | "hydrating" | "ready" | "error";

export interface ShellState {
  readonly cacheVerification: CacheVerification;
  readonly documentControl: DocumentControl;
  readonly waitingUpdate: WaitingUpdate;
  readonly currentReleaseId?: string;
  readonly waitingReleaseId?: string;
  readonly message: string;
}

export interface DeviceState {
  readonly shell: ShellState;
  readonly models: { readonly status: ModelStatus; readonly message: string };
}

export const initialDeviceState: DeviceState = {
  shell: {
    cacheVerification: "checking",
    documentControl: "uncontrolled",
    waitingUpdate: "none",
    message: "Checking offline shell…",
  },
  models: { status: "missing", message: "Model packages are not installed." },
};

export function isFullyOfflineReady(state: DeviceState): boolean {
  return (
    state.shell.cacheVerification === "verified" &&
    state.shell.documentControl === "controlled" &&
    state.models.status === "ready"
  );
}

export function shellConnectionLabel(
  state: DeviceState,
  online: boolean,
): string {
  const network = online ? "Online" : "Offline";
  if (state.shell.waitingUpdate === "ready")
    return `${network} · update cached`;
  if (state.shell.cacheVerification === "verified") {
    return `${network} · shell cached · ${state.shell.documentControl}`;
  }
  if (
    state.shell.cacheVerification === "error" ||
    state.shell.cacheVerification === "incomplete"
  ) {
    return `${network} · shell unavailable`;
  }
  if (state.shell.cacheVerification === "unsupported")
    return `${network} · offline unsupported`;
  return `${network} · checking shell`;
}
