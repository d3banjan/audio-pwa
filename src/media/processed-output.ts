export interface ProcessedOutputProgress {
  readonly phase:
    "recording" | "finalizing" | "complete" | "cancelled" | "error";
  readonly completedSeconds: number;
  readonly durationSeconds: number;
  readonly percent: number;
  readonly message: string;
}

export interface ProcessedOutputResult {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly fileName: string;
  readonly usedOpfs: boolean;
  readonly dispose: () => Promise<void>;
}

export interface ProcessedOutputJob {
  cancel(): Promise<void>;
  result: Promise<ProcessedOutputResult>;
}

export interface ProcessedOutputOptions {
  readonly durationSeconds: number;
  readonly sourceName: string;
  readonly mediaElement: HTMLMediaElement;
  readonly processedStream: MediaStream;
  readonly maxFallbackBytes?: number;
  readonly timesliceMs?: number;
  readonly onProgress?: (progress: ProcessedOutputProgress) => void;
}

export interface ProcessedOutputDependencies {
  readonly recorderCtor?: typeof MediaRecorder;
  readonly createStore?: (
    mimeType: string,
    maxFallbackBytes: number,
  ) => Promise<ChunkStore>;
  readonly waitForReady?: (
    media: HTMLMediaElement,
    signal: AbortSignal,
    requireSeek: boolean,
  ) => Promise<void>;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (handle: number) => void;
  readonly maxPendingWriteBytes?: number;
}

const DEFAULT_TIMESLICE_MS = 1000;
const DEFAULT_FALLBACK_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_WRITE_BYTES = 8 * 1024 * 1024;
const CONSERVATIVE_OUTPUT_BITS_PER_SECOND = 256_000;
const MEDIA_READY_TIMEOUT_MS = 15_000;

export function waitForMediaReady(
  media: HTMLMediaElement,
  signal: AbortSignal,
  requireSeek: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      media.removeEventListener("canplay", ready);
      media.removeEventListener("loadeddata", ready);
      media.removeEventListener("seeked", seekReady);
      media.removeEventListener("error", failed);
      media.removeEventListener("abort", failed);
      signal.removeEventListener("abort", aborted);
    };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    let decodedReady = media.readyState >= 2;
    let seekComplete = !requireSeek;
    const ready = () => {
      decodedReady = media.readyState >= 2;
      if (decodedReady && seekComplete) finish();
    };
    const seekReady = () => {
      seekComplete = true;
      if (decodedReady && seekComplete) finish();
    };
    const failed = () =>
      finish(new Error("The browser could not prepare the local output."));
    const aborted = () => finish(new Error("cancelled"));
    media.addEventListener("canplay", ready);
    media.addEventListener("loadeddata", ready);
    media.addEventListener("seeked", seekReady);
    media.addEventListener("error", failed);
    media.addEventListener("abort", failed);
    signal.addEventListener("abort", aborted, { once: true });
    timer = globalThis.setTimeout(
      () => finish(new Error("Timed out preparing the local output.")),
      MEDIA_READY_TIMEOUT_MS,
    );
    if (signal.aborted) aborted();
    else if (decodedReady && seekComplete) finish();
  });
}

export function estimateRecordedBytes(durationSeconds: number): number {
  const seconds = Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds)
    : 0;
  return Math.ceil((seconds * CONSERVATIVE_OUTPUT_BITS_PER_SECOND * 1.1) / 8);
}

export function chooseRecorderMimeType(
  recorderCtor: Pick<typeof MediaRecorder, "isTypeSupported"> = MediaRecorder,
): string {
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ]) {
    if (recorderCtor.isTypeSupported(type)) return type;
  }
  return "";
}

export function outputName(sourceName: string, mimeType: string): string {
  const stem = sourceName.replace(/\.[^./]+$/, "") || "enhanced-audio";
  const extension = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "m4a"
      : "webm";
  return `${stem}-processed.${extension}`;
}

export interface ChunkStore {
  append(chunk: Blob): Promise<void>;
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  usedOpfs: boolean;
}

async function createChunkStore(
  mimeType: string,
  maxFallbackBytes: number,
): Promise<ChunkStore> {
  const root = (navigator as Navigator & { storage?: StorageManager }).storage;
  try {
    if (!root?.getDirectory) throw new Error("OPFS unavailable");
    const directory = await root.getDirectory();
    const handle = await directory.getFileHandle(
      `processed-${crypto.randomUUID()}.part`,
      { create: true },
    );
    const writer = await handle.createWritable();
    let closed = false;
    return {
      usedOpfs: true,
      async append(chunk) {
        await writer.write(await chunk.arrayBuffer());
      },
      async finish() {
        try {
          if (!closed) {
            await writer.close();
            closed = true;
          }
          return await handle.getFile();
        } catch (error) {
          if (!closed) {
            await writer.abort().catch(() => undefined);
            closed = true;
          }
          await directory.removeEntry(handle.name).catch(() => undefined);
          throw error;
        }
      },
      async cancel() {
        if (!closed) {
          await writer.abort();
          closed = true;
        }
        await directory.removeEntry(handle.name);
      },
      async dispose() {
        if (!closed) {
          await writer.close();
          closed = true;
        }
        await directory.removeEntry(handle.name).catch(() => undefined);
      },
    };
  } catch {
    const chunks: Blob[] = [];
    let bytes = 0;
    return {
      usedOpfs: false,
      async append(chunk) {
        bytes += chunk.size;
        if (bytes > maxFallbackBytes)
          throw new Error(
            "This browser cannot keep the processed output within its temporary memory limit.",
          );
        chunks.push(chunk);
      },
      async finish() {
        return new Blob(chunks, { type: mimeType });
      },
      async cancel() {
        chunks.length = 0;
      },
      async dispose() {
        chunks.length = 0;
      },
    };
  }
}

export function startProcessedOutput(
  options: ProcessedOutputOptions,
  dependencies: ProcessedOutputDependencies = {},
): ProcessedOutputJob {
  const recorderCtor =
    dependencies.recorderCtor ?? globalThis.MediaRecorder ?? undefined;
  const mimeType = recorderCtor ? chooseRecorderMimeType(recorderCtor) : "";
  const createStore = dependencies.createStore ?? createChunkStore;
  const prepareMedia = dependencies.waitForReady ?? waitForMediaReady;
  const requestFrame =
    dependencies.requestFrame ??
    globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame =
    dependencies.cancelFrame ??
    globalThis.cancelAnimationFrame.bind(globalThis);
  const maxPendingWriteBytes =
    dependencies.maxPendingWriteBytes ?? MAX_PENDING_WRITE_BYTES;
  let cancelled = false;
  let recorder: MediaRecorder | undefined;
  let store: ChunkStore | undefined;
  let settled = false;
  let stopCapture: (() => void) | undefined;
  let pendingWrites = Promise.resolve();
  let pendingBytes = 0;
  let terminalKind: "finish" | "cancel" | "error" | undefined;
  let terminalPromise: Promise<void> | undefined;
  let storeTerminal: "finish" | "cancel" | undefined;
  const readiness = new AbortController();
  let markStoreReady!: () => void;
  const storeReady = new Promise<void>((resolve) => {
    markStoreReady = resolve;
  });
  let storeReadyMarked = false;
  const completeStoreSetup = () => {
    if (storeReadyMarked) return;
    storeReadyMarked = true;
    markStoreReady();
  };
  const duration = Math.max(0, options.durationSeconds);
  let resolveResult!: (result: ProcessedOutputResult) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<ProcessedOutputResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const stopTransport = () => {
    readiness.abort();
    options.mediaElement.pause();
    stopCapture?.();
    stopCapture = undefined;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const cancelStoreOnce = async (): Promise<void> => {
    await storeReady;
    await pendingWrites.catch(() => undefined);
    if (!store || storeTerminal) return;
    storeTerminal = "cancel";
    await store.cancel();
  };

  const rejectTerminal = (
    kind: "cancel" | "error",
    error: unknown,
  ): { started: boolean; promise: Promise<void> } => {
    if (terminalPromise) return { started: false, promise: terminalPromise };
    terminalKind = kind;
    stopTransport();
    terminalPromise = (async () => {
      try {
        await cancelStoreOnce();
      } catch {
        // The primary failure remains the actionable error. OPFS cleanup is best effort
        // after its own stream has already rejected or the page is being discarded.
      } finally {
        settled = true;
        rejectResult(error);
      }
    })();
    return { started: true, promise: terminalPromise };
  };

  const finishTerminal = (): Promise<void> => {
    if (terminalPromise) return terminalPromise;
    terminalKind = "finish";
    options.mediaElement.pause();
    stopCapture?.();
    stopCapture = undefined;
    terminalPromise = (async () => {
      try {
        await pendingWrites;
        if (!store)
          throw new Error("Local output storage was not initialized.");
        storeTerminal = "finish";
        const storedBlob = await store.finish();
        const actualMimeType = recorder?.mimeType || mimeType;
        const blob =
          storedBlob.type === actualMimeType
            ? storedBlob
            : new Blob([storedBlob], { type: actualMimeType });
        settled = true;
        resolveResult({
          blob,
          mimeType: actualMimeType,
          fileName: outputName(options.sourceName, actualMimeType),
          usedOpfs: store.usedOpfs,
          dispose: () => store!.dispose(),
        });
      } catch (error) {
        if (!storeTerminal) await cancelStoreOnce().catch(() => undefined);
        settled = true;
        rejectResult(error);
      }
    })();
    return terminalPromise;
  };

  void (async () => {
    try {
      if (!mimeType)
        throw new Error(
          "This browser cannot create a local processed audio file.",
        );
      const fallbackLimit = options.maxFallbackBytes ?? DEFAULT_FALLBACK_BYTES;
      store = await createStore(mimeType, fallbackLimit);
      completeStoreSetup();
      if (terminalKind || cancelled || settled) return;
      const estimatedBytes = estimateRecordedBytes(duration);
      if (!store.usedOpfs && estimatedBytes > fallbackLimit) {
        throw new Error(
          `This source is estimated to need ${Math.ceil(estimatedBytes / 1024 / 1024)} MB, but this browser's safe temporary-memory limit is ${Math.floor(fallbackLimit / 1024 / 1024)} MB. Use a shorter source or a browser with local file storage.`,
        );
      }
      // LEAKY ABSTRACTION: MediaRecorder chooses the codec and OPFS owns the temporary file.
      // Preserve bounded timeslices, local-only output, cancellation cleanup, and truthful MIME labels when replaced.
      // [[Implementation Package I-006 - Real Bounded Output]]
      recorder = new recorderCtor(options.processedStream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (terminalKind || !event.data.size) return;
        pendingBytes += event.data.size;
        if (pendingBytes > maxPendingWriteBytes) {
          pendingBytes -= event.data.size;
          rejectTerminal(
            "error",
            new Error(
              "The browser could not keep up with local output storage.",
            ),
          );
          return;
        }
        pendingWrites = pendingWrites
          .then(() => store!.append(event.data))
          .finally(() => {
            pendingBytes -= event.data.size;
          });
        pendingWrites.catch((error) => {
          rejectTerminal("error", error);
        });
      };
      recorder.onerror = () =>
        rejectTerminal(
          "error",
          new Error("The browser could not encode the processed preview."),
        );
      const ended = () => {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      };
      options.mediaElement.addEventListener("ended", ended, { once: true });
      let frame = 0;
      stopCapture = () => {
        cancelFrame(frame);
        options.mediaElement.removeEventListener("ended", ended);
      };
      recorder.onstop = () => {
        stopCapture?.();
        stopCapture = undefined;
        if (terminalKind) return;
        options.onProgress?.({
          phase: "finalizing",
          completedSeconds: duration,
          durationSeconds: duration,
          percent: 100,
          message: "Preparing your local preview…",
        });
        void finishTerminal();
      };
      const seekWasNeeded = options.mediaElement.currentTime !== 0;
      options.mediaElement.pause();
      const mediaReady = prepareMedia(
        options.mediaElement,
        readiness.signal,
        seekWasNeeded,
      );
      options.mediaElement.currentTime = 0;
      await mediaReady;
      if (terminalKind || cancelled || settled) return;
      recorder.start(options.timesliceMs ?? DEFAULT_TIMESLICE_MS);
      await options.mediaElement.play();
      const tick = () => {
        if (!recorder || recorder.state === "inactive") return;
        const completed = Math.min(
          duration,
          Math.max(0, options.mediaElement.currentTime),
        );
        options.onProgress?.({
          phase: "recording",
          completedSeconds: completed,
          durationSeconds: duration,
          percent: duration ? Math.round((completed / duration) * 100) : 0,
          message: `Processing ${Math.round((completed / Math.max(duration, 1)) * 100)}%`,
        });
        if (options.mediaElement.ended || completed >= duration)
          recorder.stop();
        else frame = requestFrame(tick);
      };
      frame = requestFrame(tick);
    } catch (error) {
      if (!terminalKind) rejectTerminal("error", error);
    } finally {
      completeStoreSetup();
    }
  })();
  return {
    result,
    async cancel() {
      cancelled = true;
      const terminal = rejectTerminal("cancel", new Error("cancelled"));
      if (terminal.started)
        options.onProgress?.({
          phase: "cancelled",
          completedSeconds: 0,
          durationSeconds: duration,
          percent: 0,
          message: "Processing cancelled.",
        });
      await terminal.promise;
    },
  };
}
