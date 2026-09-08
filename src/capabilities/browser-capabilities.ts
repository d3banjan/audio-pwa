/**
 * Read-only browser capability diagnostics.
 *
 * This module deliberately has no telemetry, persistence, or application-state
 * dependencies. It can be called from a user action and its result can be
 * copied into an issue or implementation note by the user.
 */

export type CapabilityStatus =
  "available" | "unavailable" | "unknown" | "error";

export interface CapabilityCheck<T = unknown> {
  status: CapabilityStatus;
  value?: T;
  details?: string;
}

export interface StorageCapability {
  quotaBytes?: number;
  usageBytes?: number;
  persisted: CapabilityCheck<boolean>;
}

export interface AudioCapability {
  context: CapabilityCheck<"AudioContext">;
  actualSampleRateHz?: number;
  audioWorklet: CapabilityCheck<boolean>;
  details?: string;
}

export interface WebGpuComputeCheck {
  status: CapabilityStatus;
  expected?: number;
  actual?: number;
  details?: string;
}

export interface WebGpuCapability {
  api: CapabilityCheck<boolean>;
  adapter: CapabilityCheck<boolean>;
  adapterName?: string;
  device: CapabilityCheck<boolean>;
  features: string[];
  limits: Record<string, number>;
  computeCheck: WebGpuComputeCheck;
  deviceLoss: {
    observed: boolean;
    reason?: string;
    message?: string;
  };
  /** Adapter/device availability does not prove ONNX operator compatibility. */
  onnxModelQualification: CapabilityCheck<"not-tested">;
}

export interface BrowserCapabilityReport {
  generatedAt: string;
  userAgent: string;
  secureContext: CapabilityCheck<boolean>;
  crossOriginIsolated: CapabilityCheck<boolean>;
  hardwareConcurrency: CapabilityCheck<number>;
  storage: CapabilityCheck<StorageCapability>;
  opfs: CapabilityCheck<boolean>;
  indexedDb: CapabilityCheck<boolean>;
  serviceWorker: CapabilityCheck<boolean>;
  sharedArrayBuffer: CapabilityCheck<boolean>;
  wasm: CapabilityCheck<boolean>;
  audio: AudioCapability;
  webgpu: WebGpuCapability;
}

interface StorageManagerLike {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  persisted?: () => Promise<boolean>;
  getDirectory?: () => Promise<unknown>;
}

interface NavigatorLike {
  userAgent?: string;
  hardwareConcurrency?: number;
  storage?: StorageManagerLike;
  serviceWorker?: unknown;
  gpu?: WebGpuApiLike;
}

interface AudioContextLike {
  sampleRate: number;
  audioWorklet?: unknown;
  close?: () => Promise<void>;
}

interface AudioContextConstructorLike {
  new (): AudioContextLike;
}

interface WebGpuApiLike {
  requestAdapter?: () => Promise<WebGpuAdapterLike | null>;
}

interface WebGpuAdapterLike {
  name?: string;
  features?: Iterable<string>;
  limits?: Record<string, number>;
  requestDevice?: () => Promise<WebGpuDeviceLike>;
}

interface WebGpuDeviceLike {
  features?: Iterable<string>;
  limits?: Record<string, number>;
  createShaderModule: (descriptor: { code: string }) => unknown;
  createComputePipeline: (descriptor: {
    layout: "auto";
    compute: { module: unknown; entryPoint: string };
  }) => unknown;
  createBuffer: (descriptor: {
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
  }) => WebGpuBufferLike;
  createCommandEncoder: () => WebGpuCommandEncoderLike;
  queue: {
    writeBuffer: (
      buffer: WebGpuBufferLike,
      offset: number,
      data: ArrayBuffer | ArrayBufferView,
    ) => void;
    submit: (commands: unknown[]) => void;
  };
  /** Present only on test/future wrappers; native GPUDevice has no destroy(). */
  destroy?: () => void;
  lost?: Promise<{ reason?: string; message?: string }>;
}

interface WebGpuBufferLike {
  getMappedRange: () => ArrayBuffer;
  unmap: () => void;
  mapAsync?: (mode: number) => Promise<void>;
  destroy?: () => void;
}

export interface CapabilityProbeOptions {
  /** Maximum time for an individual browser/GPU operation. */
  operationTimeoutMs?: number;
}

interface WebGpuCommandEncoderLike {
  beginComputePass: () => WebGpuComputePassLike;
  copyBufferToBuffer: (
    source: WebGpuBufferLike,
    sourceOffset: number,
    destination: WebGpuBufferLike,
    destinationOffset: number,
    size: number,
  ) => void;
  finish: () => unknown;
}

interface WebGpuComputePassLike {
  setPipeline: (pipeline: unknown) => void;
  setBindGroup: (index: number, bindGroup: unknown) => void;
  dispatchWorkgroups: (count: number) => void;
  end: () => void;
}

const GPU_BUFFER_USAGE_STORAGE = 0x0080;
const GPU_BUFFER_USAGE_COPY_SRC = 0x0004;
const GPU_BUFFER_USAGE_COPY_DST = 0x0008;
const GPU_MAP_MODE_READ = 0x0001;
const DEFAULT_OPERATION_TIMEOUT_MS = 2_000;

class CapabilityProbeTimeout extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs} ms.`);
    this.name = "CapabilityProbeTimeout";
  }
}

/**
 * Bounds an operation without abandoning its rejection handler. Browser APIs
 * have no universal cancellation primitive, so a late resolution can still
 * run a cleanup callback when the caller supplies one.
 */
function settleWithin<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs: number,
  onLateResolve?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      reject(new CapabilityProbeTimeout(label, timeoutMs));
    }, timeoutMs);
    operation.then(
      (value) => {
        if (finished) {
          onLateResolve?.(value);
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function available<T>(value: T, details?: string): CapabilityCheck<T> {
  return { status: "available", value, details };
}

function unavailable(details: string): CapabilityCheck<never> {
  return { status: "unavailable", details };
}

function unknown(details: string): CapabilityCheck<never> {
  return { status: "unknown", details };
}

function error(details: string): CapabilityCheck<never> {
  return { status: "error", details };
}

function booleanCapability(
  value: boolean | undefined,
  availableDetails: string,
  unavailableDetails: string,
): CapabilityCheck<boolean> {
  return value === undefined
    ? unknown("The browser did not expose this capability.")
    : value
      ? available(true, availableDetails)
      : unavailable(unavailableDetails);
}

function getAudioContextConstructor(
  scope: Window | undefined,
): AudioContextConstructorLike | undefined {
  if (!scope) return undefined;
  const audioWindow = scope as Window & {
    AudioContext?: AudioContextConstructorLike;
    webkitAudioContext?: AudioContextConstructorLike;
  };
  const candidate = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  return candidate;
}

async function probeAudio(
  scope: Window | undefined,
  operationTimeoutMs: number,
): Promise<AudioCapability> {
  const constructor = getAudioContextConstructor(scope);
  if (!constructor) {
    return {
      context: unavailable("AudioContext is not exposed."),
      audioWorklet: unknown(
        "AudioContext is unavailable, so AudioWorklet could not be checked.",
      ),
    };
  }

  try {
    const context = new constructor();
    const audioWorkletAvailable =
      "audioWorklet" in context && context.audioWorklet !== undefined;
    const report: AudioCapability = {
      context: available("AudioContext"),
      actualSampleRateHz: context.sampleRate,
      audioWorklet: booleanCapability(
        audioWorkletAvailable,
        "AudioWorklet is exposed on AudioContext.",
        "AudioWorklet is not exposed on AudioContext.",
      ),
    };
    if (context.close) {
      await settleWithin(
        context.close(),
        "AudioContext close",
        operationTimeoutMs,
      ).catch(() => undefined);
    }
    return report;
  } catch (cause) {
    return {
      context: error(`AudioContext construction failed: ${formatError(cause)}`),
      audioWorklet: unknown(
        "AudioContext construction failed, so AudioWorklet could not be checked.",
      ),
    };
  }
}

async function probeWebGpu(
  navigatorLike: NavigatorLike,
  operationTimeoutMs: number,
): Promise<WebGpuCapability> {
  const apiAvailable = navigatorLike.gpu?.requestAdapter !== undefined;
  const base: WebGpuCapability = {
    api: booleanCapability(
      apiAvailable,
      "navigator.gpu.requestAdapter is exposed.",
      "navigator.gpu is unavailable.",
    ),
    adapter: unknown("Adapter has not been requested."),
    device: unknown("Device has not been requested."),
    features: [],
    limits: {},
    computeCheck: {
      status: "unknown",
      details: "Compute correctness was not attempted.",
    },
    deviceLoss: { observed: false },
    onnxModelQualification: unknown(
      "ONNX Runtime model qualification was not tested. WebGPU adapter/device availability does not verify HTDemucs or other model operators.",
    ) as CapabilityCheck<"not-tested">,
  };
  if (!apiAvailable || !navigatorLike.gpu?.requestAdapter) {
    base.adapter = unavailable("WebGPU adapter request is unavailable.");
    base.device = unavailable("WebGPU adapter request is unavailable.");
    base.computeCheck = {
      status: "unavailable",
      details: "WebGPU compute was not attempted.",
    };
    return base;
  }

  let adapter: WebGpuAdapterLike | null;
  try {
    adapter = await settleWithin(
      navigatorLike.gpu.requestAdapter(),
      "WebGPU adapter request",
      operationTimeoutMs,
    );
  } catch (cause) {
    base.adapter = error(
      `WebGPU adapter request failed: ${formatError(cause)}`,
    );
    base.device = error("No device can be requested without an adapter.");
    base.computeCheck = {
      status: "error",
      details: "WebGPU compute was not attempted.",
    };
    return base;
  }
  if (!adapter) {
    base.adapter = unavailable(
      "navigator.gpu is present, but no adapter was returned.",
    );
    base.device = unavailable("No WebGPU adapter was returned.");
    base.computeCheck = {
      status: "unavailable",
      details: "WebGPU compute was not attempted.",
    };
    return base;
  }
  base.adapter = available(true, "A WebGPU adapter was returned.");
  base.adapterName = adapter.name;
  base.features = [...(adapter.features ?? [])];
  base.limits = copyLimits(adapter.limits);
  if (!adapter.requestDevice) {
    base.device = unavailable("The adapter did not expose requestDevice.");
    base.computeCheck = {
      status: "unavailable",
      details: "WebGPU compute was not attempted.",
    };
    return base;
  }

  let device: WebGpuDeviceLike;
  try {
    device = await settleWithin(
      adapter.requestDevice(),
      "WebGPU device request",
      operationTimeoutMs,
      (lateDevice) => lateDevice.destroy?.(),
    );
  } catch (cause) {
    base.device = error(`WebGPU device request failed: ${formatError(cause)}`);
    base.computeCheck = {
      status: "error",
      details: "WebGPU compute was not attempted.",
    };
    return base;
  }
  base.device = available(true, "A WebGPU device was created.");
  base.features = [...(device.features ?? base.features)];
  base.limits = copyLimits(device.limits ?? adapter.limits);
  let teardownRequested = false;
  let lossDuringProbe: { reason?: string; message?: string } | undefined;
  if (device.lost) {
    void device.lost
      .then((loss) => {
        // GPUDevice.lost also resolves after deliberate teardown in wrappers
        // that expose destroy(). Only retain losses that happened before the
        // probe began cleanup.
        if (!teardownRequested) lossDuringProbe = loss;
      })
      .catch(() => {
        // Device loss is reported through the returned diagnostic when possible.
      });
  }
  try {
    base.computeCheck = await runWebGpuComputeCheck(device, operationTimeoutMs);
    return base;
  } finally {
    teardownRequested = true;
    device.destroy?.();
    if (lossDuringProbe) {
      base.deviceLoss.observed = true;
      base.deviceLoss.reason = lossDuringProbe.reason;
      base.deviceLoss.message = lossDuringProbe.message;
    }
  }
}

function copyLimits(
  limits: Record<string, number> | undefined,
): Record<string, number> {
  if (!limits) return {};
  const selected = [
    "maxBufferSize",
    "maxStorageBufferBindingSize",
    "maxComputeWorkgroupsPerDimension",
    "maxComputeInvocationsPerWorkgroup",
  ];
  const result: Record<string, number> = {};
  for (const key of selected) {
    const value = limits[key];
    if (typeof value === "number") result[key] = value;
  }
  return result;
}

async function runWebGpuComputeCheck(
  device: WebGpuDeviceLike,
  operationTimeoutMs: number,
): Promise<WebGpuComputeCheck> {
  let input: WebGpuBufferLike | undefined;
  let output: WebGpuBufferLike | undefined;
  let readback: WebGpuBufferLike | undefined;
  let readbackMapped = false;
  try {
    const shader = device.createShaderModule({
      code: `@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(1) fn main() { output[0] = input[0] + 1u; }`,
    });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: shader, entryPoint: "main" },
    });
    input = device.createBuffer({
      size: 4,
      usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_DST,
    });
    output = device.createBuffer({
      size: 4,
      usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_SRC,
    });
    readback = device.createBuffer({
      size: 4,
      usage: GPU_BUFFER_USAGE_COPY_DST | 0x0001,
    });
    const inputData = new Uint32Array([41]);
    device.queue.writeBuffer(input, 0, inputData);
    const bindGroup = (
      device as WebGpuDeviceLike & {
        createBindGroup?: (descriptor: unknown) => unknown;
      }
    ).createBindGroup?.({
      layout: (
        pipeline as { getBindGroupLayout: (index: number) => unknown }
      ).getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: input } },
        { binding: 1, resource: { buffer: output } },
      ],
    });
    if (!bindGroup)
      return {
        status: "unknown",
        details: "The device did not expose createBindGroup.",
      };
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, 4);
    device.queue.submit([encoder.finish()]);
    if (!readback.mapAsync)
      return {
        status: "unknown",
        details: "The device did not expose buffer mapAsync.",
      };
    await settleWithin(
      readback.mapAsync(GPU_MAP_MODE_READ),
      "WebGPU readback map",
      operationTimeoutMs,
      () => {
        try {
          readback?.unmap();
        } catch {
          // A late map resolution may race device teardown; cleanup is best effort.
        }
      },
    );
    readbackMapped = true;
    const actual = new Uint32Array(readback.getMappedRange())[0];
    readback.unmap();
    return actual === 42
      ? {
          status: "available",
          expected: 42,
          actual,
          details:
            "A tiny storage-buffer compute pass returned the expected result.",
        }
      : {
          status: "error",
          expected: 42,
          actual,
          details:
            "The compute pass completed but returned an unexpected result.",
        };
  } catch (cause) {
    return {
      status: "error",
      details: `WebGPU compute correctness check failed: ${formatError(cause)}`,
    };
  } finally {
    if (readbackMapped) {
      try {
        readback?.unmap();
      } catch {
        // Already unmapped or invalidated by device loss.
      }
    }
    input?.destroy?.();
    output?.destroy?.();
    readback?.destroy?.();
  }
}

function formatError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function collectBrowserCapabilityReport(
  scope: Window = window,
  options: CapabilityProbeOptions = {},
): Promise<BrowserCapabilityReport> {
  const operationTimeoutMs = Math.max(
    1,
    options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
  );
  const navigatorLike = scope.navigator as NavigatorLike;
  const storageManager = navigatorLike.storage;
  const storageEstimate = storageManager?.estimate
    ? await settleWithin(
        storageManager.estimate(),
        "Storage estimate",
        operationTimeoutMs,
      ).catch(() => undefined)
    : undefined;
  const persisted = storageManager?.persisted
    ? await settleWithin(
        storageManager.persisted(),
        "Storage persistence check",
        operationTimeoutMs,
      )
        .then((value) => available(value))
        .catch((cause) =>
          error(`Storage persistence check failed: ${formatError(cause)}`),
        )
    : unknown("Storage persistence API is unavailable.");
  const storage = storageEstimate
    ? available({
        quotaBytes: storageEstimate.quota,
        usageBytes: storageEstimate.usage,
        persisted,
      })
    : storageManager
      ? unknown("Storage estimate was unavailable.")
      : unavailable("StorageManager is unavailable.");
  const opfs = storageManager?.getDirectory
    ? await settleWithin(
        storageManager.getDirectory(),
        "OPFS access",
        operationTimeoutMs,
      )
        .then(() =>
          available(
            true,
            "Origin Private File System directory is accessible.",
          ),
        )
        .catch((cause) => error(`OPFS access failed: ${formatError(cause)}`))
    : unavailable("Origin Private File System is not exposed.");
  const indexedDb =
    typeof scope.indexedDB !== "undefined"
      ? available(true, "IndexedDB is exposed.")
      : unavailable("IndexedDB is not exposed.");
  const wasm =
    typeof WebAssembly !== "undefined" &&
    WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
      ? available(true, "WebAssembly validation succeeded.")
      : unavailable("WebAssembly validation is unavailable or failed.");
  const sharedArrayBuffer = booleanCapability(
    typeof (scope as Window & { SharedArrayBuffer?: unknown })
      .SharedArrayBuffer !== "undefined",
    "SharedArrayBuffer is exposed.",
    "SharedArrayBuffer is unavailable; cross-origin isolation may be required.",
  );
  const audio = await probeAudio(scope, operationTimeoutMs);
  const webgpu = await probeWebGpu(navigatorLike, operationTimeoutMs);

  return {
    generatedAt: new Date().toISOString(),
    userAgent: navigatorLike.userAgent ?? "unknown",
    secureContext: booleanCapability(
      scope.isSecureContext,
      "The page is in a secure context.",
      "The page is not in a secure context.",
    ),
    crossOriginIsolated: booleanCapability(
      scope.crossOriginIsolated,
      "Cross-origin isolation is enabled.",
      "Cross-origin isolation is disabled.",
    ),
    hardwareConcurrency:
      typeof navigatorLike.hardwareConcurrency === "number"
        ? available(
            navigatorLike.hardwareConcurrency,
            "navigator.hardwareConcurrency was reported by the browser.",
          )
        : unknown("navigator.hardwareConcurrency is unavailable."),
    storage,
    opfs,
    indexedDb,
    serviceWorker:
      navigatorLike.serviceWorker !== undefined
        ? available(true, "Service worker API is exposed.")
        : unavailable("Service worker API is unavailable."),
    sharedArrayBuffer,
    wasm,
    audio,
    webgpu,
  };
}

export function capabilityLabel(check: CapabilityCheck): string {
  if (check.status === "available") return "Available";
  if (check.status === "unavailable") return "Unavailable";
  if (check.status === "error") return "Error";
  return "Unknown";
}
