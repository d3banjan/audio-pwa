import { describe, expect, test } from "vitest";
import {
  capabilityLabel,
  collectBrowserCapabilityReport,
} from "./browser-capabilities";

describe("browser capability diagnostics", () => {
  test("reports baseline capabilities without requiring WebGPU", async () => {
    const fakeScope = {
      navigator: {
        userAgent: "test-browser",
        hardwareConcurrency: 4,
        storage: {
          estimate: async () => ({ quota: 1000, usage: 250 }),
          persisted: async () => true,
          getDirectory: async () => ({}),
        },
        serviceWorker: {},
      },
      indexedDB: {},
      SharedArrayBuffer: class SharedArrayBuffer {},
      isSecureContext: true,
      crossOriginIsolated: true,
      AudioContext: class {
        sampleRate = 48000;
        audioWorklet = {};
        close = async () => undefined;
      },
    } as unknown as Window;

    const report = await collectBrowserCapabilityReport(fakeScope);

    expect(report.userAgent).toBe("test-browser");
    expect(report.hardwareConcurrency.value).toBe(4);
    expect(report.storage.value?.quotaBytes).toBe(1000);
    expect(report.storage.value?.persisted.value).toBe(true);
    expect(report.opfs.status).toBe("available");
    expect(report.audio.actualSampleRateHz).toBe(48000);
    expect(report.webgpu.api.status).toBe("unavailable");
    expect(report.webgpu.onnxModelQualification.status).toBe("unknown");
  });

  test("keeps unavailable and unknown separate from errors", () => {
    expect(capabilityLabel({ status: "available" })).toBe("Available");
    expect(capabilityLabel({ status: "unavailable" })).toBe("Unavailable");
    expect(capabilityLabel({ status: "unknown" })).toBe("Unknown");
    expect(capabilityLabel({ status: "error" })).toBe("Error");
  });

  test("reports a null WebGPU adapter as unavailable", async () => {
    const scope = testScope({
      requestAdapter: async () => null,
    });
    const report = await collectBrowserCapabilityReport(scope, {
      operationTimeoutMs: 10,
    });
    expect(report.webgpu.api.status).toBe("available");
    expect(report.webgpu.adapter.status).toBe("unavailable");
    expect(report.webgpu.device.status).toBe("unavailable");
  });

  test("bounds a hanging WebGPU adapter request", async () => {
    const scope = testScope({
      requestAdapter: () => new Promise<null>(() => undefined),
    });
    const report = await collectBrowserCapabilityReport(scope, {
      operationTimeoutMs: 5,
    });
    expect(report.webgpu.adapter.status).toBe("error");
    expect(report.webgpu.adapter.details).toContain("timed out");
    expect(report.webgpu.computeCheck.status).toBe("error");
  });

  test("turns a rejected WebGPU device request into an error result", async () => {
    const scope = testScope({
      requestAdapter: async () => ({
        requestDevice: async () => {
          throw new Error("device denied");
        },
      }),
    });
    const report = await collectBrowserCapabilityReport(scope, {
      operationTimeoutMs: 10,
    });
    expect(report.webgpu.adapter.status).toBe("available");
    expect(report.webgpu.device.status).toBe("error");
    expect(report.webgpu.device.details).toContain("device denied");
  });

  test("reports a wrong compute result and destroys all allocated buffers", async () => {
    const destroyed: string[] = [];
    const devices = { value: 0 };
    const scope = testScope({
      requestAdapter: async () => ({
        requestDevice: async () =>
          fakeDevice(destroyed, 7, false, undefined, undefined, devices),
      }),
    });
    const report = await collectBrowserCapabilityReport(scope, {
      operationTimeoutMs: 20,
    });
    expect(report.webgpu.computeCheck.status).toBe("error");
    expect(report.webgpu.computeCheck.actual).toBe(7);
    expect(destroyed).toEqual(["buffer", "buffer", "buffer"]);
    expect(devices.value).toBe(1);
  });

  test("bounds a hanging readback map and still cleans up buffers", async () => {
    const destroyed: string[] = [];
    const scope = testScope({
      requestAdapter: async () => ({
        requestDevice: async () => fakeDevice(destroyed, 42, true),
      }),
    });
    const report = await collectBrowserCapabilityReport(scope, {
      operationTimeoutMs: 5,
    });
    expect(report.webgpu.computeCheck.status).toBe("error");
    expect(report.webgpu.computeCheck.details).toContain("timed out");
    expect(destroyed).toEqual(["buffer", "buffer", "buffer"]);
  });

  test("handles a readback map that resolves after timeout", async () => {
    const destroyed: string[] = [];
    const unmaps = { value: 0 };
    let resolveMap!: () => void;
    const pendingMap = new Promise<void>((resolve) => {
      resolveMap = resolve;
    });
    const scope = testScope({
      requestAdapter: async () => ({
        requestDevice: async () =>
          fakeDevice(destroyed, 42, false, pendingMap, unmaps),
      }),
    });
    const report = await collectBrowserCapabilityReport(scope, {
      operationTimeoutMs: 5,
    });
    expect(report.webgpu.computeCheck.status).toBe("error");
    expect(destroyed).toEqual(["buffer", "buffer", "buffer"]);
    resolveMap();
    await Promise.resolve();
    await Promise.resolve();
    expect(unmaps.value).toBe(1);
  });

  test("cleans up a device that resolves after the device timeout", async () => {
    const destroyed: string[] = [];
    const devices = { value: 0 };
    let resolveDevice!: (device: unknown) => void;
    const pendingDevice = new Promise<unknown>((resolve) => {
      resolveDevice = resolve;
    });
    const scope = testScope({
      requestAdapter: async () => ({
        requestDevice: () => pendingDevice,
      }),
    });
    const report = await collectBrowserCapabilityReport(scope, {
      operationTimeoutMs: 5,
    });
    expect(report.webgpu.device.status).toBe("error");
    resolveDevice(
      fakeDevice(destroyed, 42, false, undefined, undefined, devices),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(devices.value).toBe(1);
  });

  test("does not report deliberate probe teardown as device loss", async () => {
    const destroyed: string[] = [];
    const teardownLoss: { resolve?: () => void } = {};
    const scope = testScope({
      requestAdapter: async () => ({
        requestDevice: async () =>
          fakeDevice(
            destroyed,
            42,
            false,
            undefined,
            undefined,
            undefined,
            teardownLoss,
          ),
      }),
    });
    const report = await collectBrowserCapabilityReport(scope, {
      operationTimeoutMs: 20,
    });
    await Promise.resolve();
    expect(teardownLoss.resolve).toBeDefined();
    expect(report.webgpu.deviceLoss.observed).toBe(false);
    expect(report.webgpu.deviceLoss.reason).toBeUndefined();
  });
});

function testScope(gpu: unknown): Window {
  return {
    navigator: { gpu },
    isSecureContext: true,
    crossOriginIsolated: false,
  } as unknown as Window;
}

function fakeDevice(
  destroyed: string[],
  result: number,
  hangingMap = false,
  mapPromise?: Promise<void>,
  counters?: { value: number },
  deviceCleanup?: { value: number },
  teardownLoss?: { resolve?: () => void },
): unknown {
  const makeBuffer = () => ({
    destroy: () => destroyed.push("buffer"),
    getMappedRange: () => new Uint32Array([result]).buffer,
    unmap: () => {
      if (counters) counters.value += 1;
    },
    mapAsync: () =>
      mapPromise ??
      (hangingMap ? new Promise<void>(() => undefined) : Promise.resolve()),
  });
  return {
    createShaderModule: () => ({}),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: makeBuffer,
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => undefined,
        setBindGroup: () => undefined,
        dispatchWorkgroups: () => undefined,
        end: () => undefined,
      }),
      copyBufferToBuffer: () => undefined,
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: () => undefined,
      submit: () => undefined,
    },
    destroy: () => {
      if (deviceCleanup) deviceCleanup.value += 1;
      teardownLoss?.resolve?.();
    },
    lost: teardownLoss
      ? new Promise<{ reason: string }>((resolve) => {
          teardownLoss.resolve = () => resolve({ reason: "destroyed" });
        })
      : undefined,
  };
}
