import type { ShellState } from "./device-state";

interface ShellStatusMessage {
  readonly type: "SHELL_STATUS";
  readonly releaseId: string;
  readonly ready: boolean;
  readonly cachedAssets: number;
  readonly requiredAssets: number;
}

export type ShellStateListener = (state: ShellState) => void;

function waitForWorker(worker: ServiceWorker): Promise<ServiceWorker> {
  if (worker.state === "activated") return Promise.resolve(worker);
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new Error("Service worker activation timed out.")),
      10_000,
    );
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        globalThis.clearTimeout(timeout);
        resolve(worker);
      } else if (worker.state === "redundant") {
        globalThis.clearTimeout(timeout);
        reject(new Error("Service worker installation failed."));
      }
    });
  });
}

function queryShell(worker: ServiceWorker): Promise<ShellStatusMessage> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = globalThis.setTimeout(
      () => reject(new Error("Offline shell verification timed out.")),
      5_000,
    );
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      globalThis.clearTimeout(timeout);
      const message = event.data as Partial<ShellStatusMessage>;
      if (
        message.type !== "SHELL_STATUS" ||
        typeof message.releaseId !== "string"
      ) {
        reject(new Error("Offline shell returned an invalid status."));
        return;
      }
      resolve(message as ShellStatusMessage);
    };
    worker.postMessage({ type: "CHECK_SHELL" }, [channel.port2]);
  });
}

function verificationFields(
  status: ShellStatusMessage,
): Pick<ShellState, "cacheVerification" | "currentReleaseId" | "message"> {
  return status.ready
    ? {
        cacheVerification: "verified",
        currentReleaseId: status.releaseId,
        message: "The application shell is cached for offline reload.",
      }
    : {
        cacheVerification: "incomplete",
        currentReleaseId: status.releaseId,
        message: `Offline shell is incomplete (${status.cachedAssets}/${status.requiredAssets} assets).`,
      };
}

async function inspectRegistration(
  registration: ServiceWorkerRegistration,
): Promise<ShellState> {
  let currentWorker = navigator.serviceWorker.controller ?? registration.active;
  if (!currentWorker && registration.installing)
    currentWorker = await waitForWorker(registration.installing);
  if (!currentWorker)
    throw new Error("The browser did not expose the installed service worker.");

  const current = verificationFields(await queryShell(currentWorker));
  const waiting = registration.waiting;
  if (!waiting) {
    return {
      ...current,
      documentControl: navigator.serviceWorker.controller
        ? "controlled"
        : "uncontrolled",
      waitingUpdate: "none",
    };
  }
  const waitingStatus = await queryShell(waiting);
  return {
    ...current,
    documentControl: navigator.serviceWorker.controller
      ? "controlled"
      : "uncontrolled",
    waitingUpdate: waitingStatus.ready ? "ready" : "error",
    waitingReleaseId: waitingStatus.releaseId,
    message: waitingStatus.ready
      ? "An offline update is cached and will apply after all app tabs close."
      : "A waiting update has an incomplete application cache.",
  };
}

export async function registerAndVerifyShell(
  onChange?: ShellStateListener,
): Promise<ShellState> {
  if (!("serviceWorker" in navigator)) {
    return {
      cacheVerification: "unsupported",
      documentControl: "uncontrolled",
      waitingUpdate: "none",
      message: "This browser cannot install the offline shell.",
    };
  }

  try {
    const scriptUrl = new URL(
      /* @vite-ignore */ "../service-worker.js",
      import.meta.url,
    );
    const scope = new URL(/* @vite-ignore */ "../", import.meta.url).pathname;
    const registration = await navigator.serviceWorker.register(scriptUrl, {
      scope,
    });
    const currentWorkerAtRegistration =
      navigator.serviceWorker.controller ?? registration.active;
    let state: ShellState = {
      cacheVerification: "checking",
      documentControl: navigator.serviceWorker.controller
        ? "controlled"
        : "uncontrolled",
      waitingUpdate: "none",
      message: "Checking offline shell…",
    };
    let updateObservedDuringInspection = false;
    const observedCandidates = new WeakSet<ServiceWorker>();

    const publish = (next: ShellState): void => {
      state = next;
      onChange?.(next);
    };

    const observeCandidate = (candidate: ServiceWorker): void => {
      if (observedCandidates.has(candidate)) return;
      observedCandidates.add(candidate);
      updateObservedDuringInspection = true;
      publish({
        ...state,
        waitingUpdate: "installing",
        waitingReleaseId: undefined,
        message: "Installing an application update.",
      });
      candidate.addEventListener("statechange", () => {
        if (candidate.state === "installed") {
          publish({
            ...state,
            waitingUpdate: "verifying",
            message: "Verifying the cached application update.",
          });
          void queryShell(candidate)
            .then((status) => {
              publish({
                ...state,
                waitingUpdate: status.ready ? "ready" : "error",
                waitingReleaseId: status.releaseId,
                message: status.ready
                  ? "An offline update is cached and will apply after all app tabs close."
                  : "The application update cache is incomplete.",
              });
            })
            .catch((cause: unknown) => {
              publish({
                ...state,
                waitingUpdate: "error",
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Application update verification failed.",
              });
            });
        } else if (candidate.state === "redundant") {
          publish({
            ...state,
            waitingUpdate: "error",
            message: "Application update installation failed.",
          });
        }
      });
    };

    // Attach observers before the first asynchronous cache inspection. A worker
    // update can otherwise install and become waiting while CHECK_SHELL is in flight.
    registration.addEventListener("updatefound", () => {
      const candidate = registration.installing;
      if (
        candidate &&
        (currentWorkerAtRegistration !== null ||
          state.currentReleaseId !== undefined)
      ) {
        observeCandidate(candidate);
      }
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      void inspectRegistration(registration)
        .then(publish)
        .catch((cause: unknown) => {
          publish({
            ...state,
            cacheVerification: "error",
            documentControl: navigator.serviceWorker.controller
              ? "controlled"
              : "uncontrolled",
            message:
              cause instanceof Error
                ? cause.message
                : "Controller verification failed.",
          });
        });
    });

    // register() may resolve after updatefound has already fired for an update.
    if (registration.installing && currentWorkerAtRegistration !== null) {
      observeCandidate(registration.installing);
    }

    const inspected = await inspectRegistration(registration);
    state = updateObservedDuringInspection
      ? {
          ...inspected,
          waitingUpdate: state.waitingUpdate,
          waitingReleaseId: state.waitingReleaseId,
          message: state.message,
        }
      : inspected;

    return state;
  } catch (cause) {
    return {
      cacheVerification: "error",
      documentControl: navigator.serviceWorker.controller
        ? "controlled"
        : "uncontrolled",
      waitingUpdate: "none",
      message:
        cause instanceof Error
          ? cause.message
          : "Offline shell installation failed.",
    };
  }
}
