import { describe, expect, it } from "vitest";
import {
  initialDeviceState,
  isFullyOfflineReady,
  shellConnectionLabel,
} from "./device-state";

describe("device state", () => {
  it("represents cache verification, document control, and updates independently", () => {
    const shellReady = {
      ...initialDeviceState,
      shell: {
        cacheVerification: "verified" as const,
        documentControl: "controlled" as const,
        waitingUpdate: "none" as const,
        currentReleaseId: "abc",
        message: "cached",
      },
    };
    expect(isFullyOfflineReady(shellReady)).toBe(false);
    expect(shellConnectionLabel(shellReady, false)).toBe(
      "Offline · shell cached · controlled",
    );
  });

  it("requires verified shell, current document control, and model readiness", () => {
    const uncontrolled = {
      shell: {
        cacheVerification: "verified" as const,
        documentControl: "uncontrolled" as const,
        waitingUpdate: "ready" as const,
        message: "cached update",
      },
      models: { status: "ready" as const, message: "verified" },
    };
    expect(isFullyOfflineReady(uncontrolled)).toBe(false);
    expect(
      isFullyOfflineReady({
        ...uncontrolled,
        shell: { ...uncontrolled.shell, documentControl: "controlled" },
      }),
    ).toBe(true);
  });
});
