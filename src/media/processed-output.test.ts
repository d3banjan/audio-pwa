import { describe, expect, it } from "vitest";
import {
  chooseRecorderMimeType,
  estimateRecordedBytes,
  outputName,
  startProcessedOutput,
  waitForMediaReady,
  type ChunkStore,
  type ProcessedOutputDependencies,
  type ProcessedOutputProgress,
} from "./processed-output";

class FakeMediaElement extends EventTarget {
  currentTime = 0;
  duration = 4;
  ended = false;
  paused = true;
  readyState = 4;
  playCalls = 0;
  pauseCalls = 0;
  private readonly listenerCounts = new Map<string, number>();

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options);
    this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) + 1);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(type, callback, options);
    this.listenerCounts.set(
      type,
      Math.max(0, (this.listenerCounts.get(type) ?? 0) - 1),
    );
  }

  listenerCount(type: string): number {
    return this.listenerCounts.get(type) ?? 0;
  }

  async play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }
}

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported(type: string): boolean {
    return type === "audio/webm;codecs=opus";
  }

  state: RecordingState = "inactive";
  readonly mimeType = "audio/ogg;codecs=opus";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  startCalls = 0;
  stopCalls = 0;

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
    FakeRecorder.instances.push(this);
  }

  start(_timeslice?: number): void {
    this.startCalls += 1;
    this.state = "recording";
  }

  stop(): void {
    if (this.state === "inactive") return;
    this.stopCalls += 1;
    this.state = "inactive";
    this.onstop?.();
  }

  emitData(data: Blob): void {
    this.ondataavailable?.({ data } as BlobEvent);
  }
}

class FakeChunkStore implements ChunkStore {
  usedOpfs = true;
  appendCalls = 0;
  finishCalls = 0;
  cancelCalls = 0;
  disposeCalls = 0;
  appendImplementation: (chunk: Blob) => Promise<void> = async () => undefined;
  finishBlob = new Blob(["encoded-audio"]);

  async append(chunk: Blob): Promise<void> {
    this.appendCalls += 1;
    await this.appendImplementation(chunk);
  }

  async finish(): Promise<Blob> {
    this.finishCalls += 1;
    return this.finishBlob;
  }

  async cancel(): Promise<void> {
    this.cancelCalls += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for test condition.");
}

function createHarness(overrides: Partial<ProcessedOutputDependencies> = {}) {
  FakeRecorder.instances = [];
  const media = new FakeMediaElement();
  const store = new FakeChunkStore();
  let frame: FrameRequestCallback | undefined;
  const cancelledFrames: number[] = [];
  const progress: ProcessedOutputProgress[] = [];
  const dependencies: ProcessedOutputDependencies = {
    recorderCtor: FakeRecorder as unknown as typeof MediaRecorder,
    createStore: async () => store,
    waitForReady: async () => undefined,
    requestFrame(callback) {
      frame = callback;
      return 17;
    },
    cancelFrame(handle) {
      cancelledFrames.push(handle);
    },
    ...overrides,
  };
  const start = () =>
    startProcessedOutput(
      {
        durationSeconds: media.duration,
        sourceName: "interview.mp4",
        mediaElement: media as unknown as HTMLMediaElement,
        processedStream: {} as MediaStream,
        onProgress: (event) => progress.push(event),
      },
      dependencies,
    );
  return {
    media,
    store,
    progress,
    cancelledFrames,
    get frame() {
      return frame;
    },
    start,
  };
}

describe("processed output helpers", () => {
  it("selects the first supported recorder format", () => {
    const supported = new Set(["audio/ogg;codecs=opus"]);
    expect(
      chooseRecorderMimeType({
        isTypeSupported: (type) => supported.has(type),
      }),
    ).toBe("audio/ogg;codecs=opus");
  });

  it("reports no format when the browser supports none", () => {
    expect(chooseRecorderMimeType({ isTypeSupported: () => false })).toBe("");
  });

  it("estimates fallback admission conservatively from duration", () => {
    expect(estimateRecordedBytes(0)).toBe(0);
    expect(estimateRecordedBytes(60)).toBe(2_112_000);
    expect(estimateRecordedBytes(Number.NaN)).toBe(0);
  });

  it("uses the actual recorder container in the download name", () => {
    expect(outputName("interview.mp4", "audio/ogg;codecs=opus")).toBe(
      "interview-processed.ogg",
    );
    expect(outputName("voice.wav", "audio/webm;codecs=opus")).toBe(
      "voice-processed.webm",
    );
  });

  it("cancels media readiness and removes its browser listeners", async () => {
    const media = new FakeMediaElement();
    media.readyState = 1;
    const abort = new AbortController();
    const ready = waitForMediaReady(
      media as unknown as HTMLMediaElement,
      abort.signal,
      true,
    );
    abort.abort();
    await expect(ready).rejects.toThrow("cancelled");

    for (const event of ["canplay", "loadeddata", "seeked", "error", "abort"])
      expect(media.listenerCount(event)).toBe(0);

    media.readyState = 4;
    media.dispatchEvent(new Event("canplay"));
    media.dispatchEvent(new Event("seeked"));
  });
});

describe("processed output lifecycle", () => {
  it("never starts when cancelled during media readiness", async () => {
    const readiness = deferred();
    let readinessSignal: AbortSignal | undefined;
    const harness = createHarness({
      waitForReady: (_media, signal) => {
        readinessSignal = signal;
        return new Promise<void>((resolve, reject) => {
          readiness.promise.then(resolve, reject);
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
      },
    });
    harness.media.currentTime = 2;
    const job = harness.start();
    const rejected = expect(job.result).rejects.toThrow("cancelled");
    await waitUntil(() => readinessSignal !== undefined);

    await job.cancel();
    readiness.resolve();
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const recorder = FakeRecorder.instances[0]!;
    expect(readinessSignal?.aborted).toBe(true);
    expect(harness.media.currentTime).toBe(0);
    expect(harness.media.playCalls).toBe(0);
    expect(recorder.startCalls).toBe(0);
    expect(harness.store.cancelCalls).toBe(1);
    expect(harness.store.finishCalls).toBe(0);
    await job.cancel();
    expect(harness.store.cancelCalls).toBe(1);
  });

  it("fails at the pending-write cap and cancels the store exactly once", async () => {
    const blockedWrite = deferred();
    const harness = createHarness({ maxPendingWriteBytes: 10 });
    harness.store.appendImplementation = () => blockedWrite.promise;
    const job = harness.start();
    const rejected = expect(job.result).rejects.toThrow(
      "could not keep up with local output storage",
    );
    await waitUntil(() => FakeRecorder.instances[0]?.startCalls === 1);
    const recorder = FakeRecorder.instances[0]!;

    recorder.emitData(new Blob(["123456"]));
    await waitUntil(() => harness.store.appendCalls === 1);
    recorder.emitData(new Blob(["abcdef"]));
    expect(recorder.stopCalls).toBe(1);
    expect(harness.cancelledFrames).toContain(17);

    blockedWrite.resolve();
    await rejected;
    expect(harness.store.cancelCalls).toBe(1);
    expect(harness.store.finishCalls).toBe(0);
  });

  it("stops directly on ended and returns one typed, playable result", async () => {
    const harness = createHarness();
    const job = harness.start();
    await waitUntil(() => FakeRecorder.instances[0]?.startCalls === 1);
    const recorder = FakeRecorder.instances[0]!;

    recorder.emitData(new Blob(["encoded"]));
    harness.media.currentTime = 2;
    harness.frame?.(16);
    expect(harness.progress).toContainEqual(
      expect.objectContaining({ phase: "recording", percent: 50 }),
    );

    harness.media.ended = true;
    harness.media.dispatchEvent(new Event("ended"));
    const output = await job.result;

    expect(recorder.stopCalls).toBe(1);
    expect(harness.store.appendCalls).toBe(1);
    expect(harness.store.finishCalls).toBe(1);
    expect(harness.store.cancelCalls).toBe(0);
    expect(output.mimeType).toBe("audio/ogg;codecs=opus");
    expect(output.fileName).toBe("interview-processed.ogg");
    expect(output.blob.type).toBe("audio/ogg;codecs=opus");
    expect(output.blob.size).toBeGreaterThan(0);

    await job.cancel();
    expect(harness.store.finishCalls).toBe(1);
    expect(harness.store.cancelCalls).toBe(0);
  });
});
