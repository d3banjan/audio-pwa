import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAndVerifyShell } from "./offline-shell";

class FakeMessageChannel {
  readonly port1: {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
  } = { onmessage: null };
  readonly port2 = { channel: this };
}

function worker(releaseId: string, state = "activated", delayResponse = false) {
  const listeners = new Map<string, () => void>();
  let pendingChannel: FakeMessageChannel | undefined;
  const sendStatus = (channel: FakeMessageChannel): void => {
    queueMicrotask(() =>
      channel.port1.onmessage?.({
        data: {
          type: "SHELL_STATUS",
          releaseId,
          ready: true,
          cachedAssets: 6,
          requiredAssets: 6,
        },
      } as MessageEvent<unknown>),
    );
  };
  return {
    state,
    listeners,
    addEventListener: vi.fn((type: string, listener: () => void) =>
      listeners.set(type, listener),
    ),
    postMessage: vi.fn(
      (_message: unknown, ports: Array<{ channel: FakeMessageChannel }>) => {
        const channel = ports[0]?.channel;
        if (!channel) throw new Error("test message channel missing");
        if (delayResponse) pendingChannel = channel;
        else sendStatus(channel);
      },
    ),
    respond: () => {
      if (!pendingChannel) throw new Error("no delayed response pending");
      sendStatus(pendingChannel);
      pendingChannel = undefined;
    },
  };
}

describe("offline shell registration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not classify the initial installing worker as a waiting update", async () => {
    const initialWorker = worker("release-1", "installing");
    const registrationListeners = new Map<string, () => void>();
    const registration = {
      active: null,
      waiting: null,
      installing: initialWorker,
      addEventListener: vi.fn((type: string, listener: () => void) =>
        registrationListeners.set(type, listener),
      ),
    };
    const container = {
      controller: null,
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal("navigator", { serviceWorker: container });
    const observed: string[] = [];

    const resultPromise = registerAndVerifyShell((state) =>
      observed.push(state.waitingUpdate),
    );
    await vi.waitFor(() =>
      expect(registrationListeners.has("updatefound")).toBe(true),
    );
    registrationListeners.get("updatefound")?.();
    initialWorker.state = "activated";
    initialWorker.listeners.get("statechange")?.();

    await expect(resultPromise).resolves.toMatchObject({
      cacheVerification: "verified",
      currentReleaseId: "release-1",
      waitingUpdate: "none",
    });
    expect(observed).not.toContain("installing");
  });

  it("observes an update already installing beside an existing active release", async () => {
    const active = worker("release-1");
    const candidate = worker("release-2", "installing");
    const registration = {
      active,
      waiting: null,
      installing: candidate,
      addEventListener: vi.fn(),
    };
    const container = {
      controller: active,
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal("navigator", { serviceWorker: container });

    await expect(registerAndVerifyShell()).resolves.toMatchObject({
      cacheVerification: "verified",
      currentReleaseId: "release-1",
      waitingUpdate: "installing",
    });
    expect(candidate.addEventListener).toHaveBeenCalledWith(
      "statechange",
      expect.any(Function),
    );
  });

  it("represents the controlling release and verified waiting update separately", async () => {
    const active = worker("release-1");
    const waiting = worker("release-2", "installed");
    const registration = {
      active,
      waiting,
      installing: null,
      addEventListener: vi.fn(),
    };
    const container = {
      controller: active,
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal("navigator", { serviceWorker: container });

    await expect(registerAndVerifyShell()).resolves.toMatchObject({
      cacheVerification: "verified",
      documentControl: "controlled",
      currentReleaseId: "release-1",
      waitingUpdate: "ready",
      waitingReleaseId: "release-2",
    });
    expect(waiting.addEventListener).not.toHaveBeenCalled();
  });

  it("observes update installation and controller changes", async () => {
    const active = worker("release-1");
    const candidate = worker("release-2", "installing");
    const registrationListeners = new Map<string, () => void>();
    const containerListeners = new Map<string, () => void>();
    const registration = {
      active,
      waiting: null as ReturnType<typeof worker> | null,
      installing: null as ReturnType<typeof worker> | null,
      addEventListener: vi.fn((type: string, listener: () => void) =>
        registrationListeners.set(type, listener),
      ),
    };
    const container = {
      controller: active,
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn((type: string, listener: () => void) =>
        containerListeners.set(type, listener),
      ),
    };
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal("navigator", { serviceWorker: container });
    const observed: string[] = [];

    await registerAndVerifyShell((state) =>
      observed.push(`${state.waitingUpdate}:${state.currentReleaseId}`),
    );
    registration.installing = candidate;
    registrationListeners.get("updatefound")?.();
    candidate.state = "installed";
    candidate.listeners.get("statechange")?.();
    await vi.waitFor(() => expect(observed).toContain("ready:release-1"));

    registration.active = candidate;
    registration.waiting = null;
    container.controller = candidate;
    candidate.state = "activated";
    containerListeners.get("controllerchange")?.();
    await vi.waitFor(() => expect(observed).toContain("none:release-2"));
  });

  it("does not miss an updatefound event during initial cache verification", async () => {
    const active = worker("release-1", "activated", true);
    const candidate = worker("release-2", "installing");
    const registrationListeners = new Map<string, () => void>();
    const registration = {
      active,
      waiting: null as ReturnType<typeof worker> | null,
      installing: null as ReturnType<typeof worker> | null,
      addEventListener: vi.fn((type: string, listener: () => void) =>
        registrationListeners.set(type, listener),
      ),
    };
    const container = {
      controller: active,
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    vi.stubGlobal("navigator", { serviceWorker: container });
    const observed: string[] = [];

    const resultPromise = registerAndVerifyShell((state) =>
      observed.push(state.waitingUpdate),
    );
    await vi.waitFor(() =>
      expect(registrationListeners.has("updatefound")).toBe(true),
    );
    registration.installing = candidate;
    registrationListeners.get("updatefound")?.();
    registration.waiting = candidate;
    candidate.state = "installed";
    candidate.listeners.get("statechange")?.();
    active.respond();

    await expect(resultPromise).resolves.toMatchObject({
      cacheVerification: "verified",
      waitingUpdate: "ready",
      currentReleaseId: "release-1",
      waitingReleaseId: "release-2",
    });
    expect(observed).toEqual(
      expect.arrayContaining(["installing", "verifying", "ready"]),
    );
  });
});
