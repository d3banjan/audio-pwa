/** D-024 browser-native MP4 audio extraction. Browser demux/decode is intentionally leaky. */

import pcmWorkletUrl from "./i009-pcm-worklet.ts?worker&url";
import { secondsToFrames } from "../audio-domain/timeline";

export const PCM_SAMPLE_RATE = 48_000;
export const PCM_PAGE_FRAMES = PCM_SAMPLE_RATE * 5;
export const PCM_PAGE_BYTES =
  PCM_PAGE_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT;
export const PCM_POOL_PAGES = 4;
export const PCM_HIGH_WATER_PAGES = 3;
export const PCM_LOW_WATER_PAGES = 1;
const MAX_DURATION_SECONDS = 900;
const STORAGE_RESERVE_RATIO = 0.2;
const STALL_CHECK_MS = 2_000;
const STALL_LIMIT_MS = 6_000;
const RUN_DIRECTORY_PREFIX = "i009-";
const RUN_LOCK_PREFIX = "cinematic-audio-i009-run:";
const CLEANUP_LOCK = "cinematic-audio-i009-cleanup";

type Status =
  | "idle"
  | "preparing"
  | "needs-start"
  | "extracting"
  | "complete"
  | "cancelled"
  | "error";

export interface ExtractionState {
  status: Status;
  message: string;
  progress: number;
  generation: number;
  pages: number;
  validFrames: number;
}

export interface LocalAudioExtractionController {
  extract(file: File): Promise<void>;
  start(): Promise<void>;
  cancel(): Promise<void>;
  destroy(): Promise<void>;
  getState(): ExtractionState;
  onStateChange(listener: (state: ExtractionState) => void): () => void;
}

type PageRecord = Readonly<{
  index: number;
  validFrames: number;
  integrity: string;
  file: string;
}>;

type CacheManifest = Readonly<{
  runId: string;
  generation: number;
  durationSeconds: number;
  sampleRate: number;
  channels: 2;
  layout: "planar-f32le";
  pages: readonly PageRecord[];
  validFrames: number;
  targetFrames: number;
  endFrameExclusive: number;
  observedFrames: number;
  tailTrimmedFrames: number;
  durationAuthority: "html-media-element";
  frameRounding: "nearest";
  state: "complete";
}>;

type Run = {
  readonly generation: number;
  readonly runId: string;
  readonly duration: number;
  readonly targetFrames: number;
  readonly audio: HTMLAudioElement;
  readonly url: string;
  context?: AudioContext;
  source?: MediaElementAudioSourceNode;
  node?: AudioWorkletNode;
  gain?: GainNode;
  writer?: Worker;
  cancelled: boolean;
  flushed: boolean;
  pending: number;
  pageIndex: number;
  validFrames: number;
  observedFrames: number;
  retainedFrames: number;
  tailTrimmedFrames: number;
  pages: PageRecord[];
  flushResolve?: () => void;
  ended?: Promise<void>;
  completion?: Promise<void>;
  committing?: Promise<string | undefined>;
  pausedForBackpressure: boolean;
  playbackEnded: boolean;
  lastClockSeconds: number;
  lastClockAdvanceAt: number;
  watchdog?: ReturnType<typeof setInterval>;
  releaseLock?: () => void;
  lockTask?: Promise<unknown>;
};

type WriterMessage = {
  type: string;
  generation?: number;
  runId?: string;
  index?: number;
  left?: ArrayBuffer;
  right?: ArrayBuffer;
  validFrames?: number;
  integrity?: string;
  message?: string;
  observedFrames?: number;
  retainedFrames?: number;
  tailTrimmedFrames?: number;
};

type ValidWriterAck = WriterMessage & {
  type: "ack";
  left: ArrayBuffer;
  right: ArrayBuffer;
  index: number;
  validFrames: number;
  integrity: string;
};

export const isValidWriterAck = (
  message: WriterMessage,
  pending: number,
): message is ValidWriterAck =>
  message.type === "ack" &&
  message.left instanceof ArrayBuffer &&
  message.right instanceof ArrayBuffer &&
  Number.isSafeInteger(message.index) &&
  message.index! >= 0 &&
  typeof message.integrity === "string" &&
  message.integrity.length > 0 &&
  Number.isSafeInteger(message.validFrames) &&
  message.validFrames! > 0 &&
  message.validFrames! <= PCM_PAGE_FRAMES &&
  message.left.byteLength >=
    message.validFrames! * Float32Array.BYTES_PER_ELEMENT &&
  message.right.byteLength >=
    message.validFrames! * Float32Array.BYTES_PER_ELEMENT &&
  pending > 0;

type PendingSource = {
  request: number;
  audio: HTMLAudioElement;
  url: string;
  cancelMetadata?: () => void;
};

const empty = (): ExtractionState => ({
  status: "idle",
  message: "Choose a video to prepare its audio locally.",
  progress: 0,
  generation: 0,
  pages: 0,
  validFrames: 0,
});

export const isAdmittedMp4 = (name: string, type: string) =>
  type.toLowerCase() === "video/mp4" && /\.mp4$/i.test(name);

export const canonicalTargetFrames = (durationSeconds: number) =>
  secondsToFrames(durationSeconds, PCM_SAMPLE_RATE, "nearest");

export const requiredPcmStorageBytes = (durationSeconds: number) => {
  const pcmBytes = canonicalTargetFrames(durationSeconds) * 2 * 4;
  return (
    pcmBytes +
    Math.max(PCM_PAGE_BYTES, Math.ceil(pcmBytes * STORAGE_RESERVE_RATIO))
  );
};

export type CanonicalFlushStats = Readonly<{
  observedFrames: number;
  retainedFrames: number;
  tailTrimmedFrames: number;
}>;

export const validateCanonicalFlush = (
  targetFrames: number,
  stats: CanonicalFlushStats,
): CanonicalFlushStats => {
  for (const [name, value] of Object.entries(stats))
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`Audio extraction returned invalid ${name}.`);
  if (stats.observedFrames < targetFrames)
    throw new Error(
      `Audio extraction ended ${targetFrames - stats.observedFrames} frames early; no cache was committed.`,
    );
  if (
    stats.retainedFrames !== targetFrames ||
    stats.tailTrimmedFrames !== stats.observedFrames - stats.retainedFrames
  )
    throw new Error(
      "Audio extraction timeline did not match the source duration.",
    );
  return stats;
};

export const shouldRemoveStoppedRunTree = (
  removalRequested: boolean,
  commitStarted: boolean,
  runId: string,
  currentRunId: string | undefined,
) => removalRequested && (!commitStarted || currentRunId !== runId);

export const needsClockRecovery = (
  contextState: AudioContextState,
  mediaPaused: boolean,
  pausedForBackpressure: boolean,
  elapsedWithoutProgressMs: number,
) =>
  !pausedForBackpressure &&
  (contextState !== "running" ||
    mediaPaused ||
    elapsedWithoutProgressMs >= STALL_LIMIT_MS);

export const shouldResumeAfterWriterAck = (
  pendingPages: number,
  mediaPaused: boolean,
  flushed: boolean,
  pausedForBackpressure: boolean,
) =>
  pausedForBackpressure &&
  pendingPages <= PCM_LOW_WATER_PAGES &&
  mediaPaused &&
  !flushed;

const removeTree = async (name: string): Promise<void> => {
  try {
    await (
      await navigator.storage.getDirectory()
    ).removeEntry(name, {
      recursive: true,
    });
  } catch {
    // OPFS cleanup follows a successful commit and must never invalidate it.
  }
};

const openManifestDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("cinematic-audio-i009", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("manifests"))
        request.result.createObjectStore("manifests");
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Manifest storage failed."));
    request.onsuccess = () => resolve(request.result);
  });

/** Publish a complete staged run and its current pointer in one IDB transaction. */
const commitManifest = async (
  manifest: CacheManifest,
  stillCurrent: () => boolean,
): Promise<string | undefined> => {
  const db = await openManifestDatabase();
  return new Promise<string | undefined>((resolve, reject) => {
    const transaction = db.transaction("manifests", "readwrite");
    const store = transaction.objectStore("manifests");
    let previousRunId: string | undefined;
    const previous = store.get("current");
    previous.onsuccess = () => {
      if (!stillCurrent()) {
        transaction.abort();
        return;
      }
      const pointer = previous.result as { runId?: unknown } | undefined;
      previousRunId =
        typeof pointer?.runId === "string" ? pointer.runId : undefined;
      store.put(manifest, manifest.runId);
      store.put({ runId: manifest.runId }, "current");
    };
    previous.onerror = () => transaction.abort();
    transaction.oncomplete = () => {
      db.close();
      resolve(previousRunId);
    };
    transaction.onabort = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Manifest publication was cancelled."),
      );
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Manifest storage failed."));
    };
  });
};

const currentManifestRunId = async (): Promise<string | undefined> => {
  const db = await openManifestDatabase();
  return new Promise<string | undefined>((resolve, reject) => {
    const transaction = db.transaction("manifests", "readonly");
    const request = transaction.objectStore("manifests").get("current");
    request.onsuccess = () => {
      const pointer = request.result as { runId?: unknown } | undefined;
      resolve(typeof pointer?.runId === "string" ? pointer.runId : undefined);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Manifest storage failed."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

const deleteManifestRecord = async (runId: string): Promise<void> => {
  const db = await openManifestDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("manifests", "readwrite");
    const store = transaction.objectStore("manifests");
    const current = store.get("current");
    current.onsuccess = () => {
      const pointer = current.result as { runId?: unknown } | undefined;
      if (pointer?.runId !== runId) store.delete(runId);
    };
    current.onerror = () => transaction.abort();
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onabort = transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Manifest cleanup failed."));
    };
  });
};

type IterableDirectory = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

/** Remove only non-current I-009 trees whose per-run lock is not held by another tab. */
const cleanupOrphanedRuns = async (): Promise<void> => {
  if (!navigator.storage?.getDirectory || !navigator.locks) return;
  await navigator.locks.request(CLEANUP_LOCK, async () => {
    const root = (await navigator.storage.getDirectory()) as IterableDirectory;
    const entries: string[] = [];
    for await (const [name, handle] of root.entries())
      if (handle.kind === "directory" && name.startsWith(RUN_DIRECTORY_PREFIX))
        entries.push(name);
    for (const runId of entries) {
      await navigator.locks.request(
        `${RUN_LOCK_PREFIX}${runId}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock || (await currentManifestRunId()) === runId) return;
          await removeTree(runId);
          await deleteManifestRecord(runId).catch(() => undefined);
        },
      );
    }
  });
};

const holdRunLock = async (run: Run): Promise<void> => {
  if (!navigator.locks) return;
  let acquired!: () => void;
  let acquisitionFailed!: (cause: unknown) => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    acquisitionFailed = reject;
  });
  const held = new Promise<void>((resolve) => (release = resolve));
  const lockTask = navigator.locks.request(
    `${RUN_LOCK_PREFIX}${run.runId}`,
    async () => {
      acquired();
      await held;
    },
  );
  run.lockTask = lockTask;
  lockTask.catch(acquisitionFailed);
  run.releaseLock = release;
  await ready;
};

/** A collector may only remove an old, no-longer-current committed run. */
export const shouldCollectPreviousRun = (
  previousRunId: string | undefined,
  newRunId: string,
  currentRunId: string | undefined,
) =>
  Boolean(
    previousRunId &&
    previousRunId !== newRunId &&
    currentRunId !== previousRunId,
  );

export function createLocalAudioExtractionController(
  onError?: (message: string, cause?: unknown) => void,
): LocalAudioExtractionController {
  let state = empty();
  let generation = 0;
  let requestId = 0;
  let destroyed = false;
  let active: Run | undefined;
  let pendingSource: PendingSource | undefined;
  const listeners = new Set<(state: ExtractionState) => void>();
  const update = (next: Partial<ExtractionState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener({ ...state });
  };
  const isActive = (run: Run) => active === run && !run.cancelled && !destroyed;

  // Cleanup is deliberately lock-protected: another tab may still own a staged run.
  void cleanupOrphanedRuns().catch(() => undefined);

  const releasePending = (pending = pendingSource) => {
    if (!pending) return;
    if (pendingSource === pending) pendingSource = undefined;
    pending.cancelMetadata?.();
    pending.cancelMetadata = undefined;
    pending.audio.removeAttribute("src");
    pending.audio.load();
    URL.revokeObjectURL(pending.url);
  };

  const dispose = async (run: Run, removeStaging: boolean) => {
    run.cancelled = true;
    run.node?.port.postMessage({ type: "cancel" });
    run.audio.pause();
    if (run.watchdog) clearInterval(run.watchdog);
    run.source?.disconnect();
    run.node?.disconnect();
    run.gain?.disconnect();
    run.writer?.terminate();
    await run.context?.close().catch(() => undefined);
    run.audio.removeAttribute("src");
    run.audio.load();
    URL.revokeObjectURL(run.url);
    if (active === run) active = undefined;
    if (removeStaging) await removeTree(run.runId);
    run.releaseLock?.();
    await run.lockTask?.catch(() => undefined);
  };

  const stopActive = async (removeStaging: boolean) => {
    const run = active;
    if (!run) return;
    run.cancelled = true;
    // A replacement waits for an already-started atomic commit. The old cache
    // remains current until that transaction either commits or aborts.
    const commitStarted = Boolean(run.committing);
    await run.committing?.catch(() => undefined);
    const currentRunId = commitStarted
      ? await currentManifestRunId().catch(() => run.runId)
      : undefined;
    await dispose(
      run,
      shouldRemoveStoppedRunTree(
        removeStaging,
        commitStarted,
        run.runId,
        currentRunId,
      ),
    );
  };

  const fail = async (run: Run, message: string, cause?: unknown) => {
    if (!isActive(run)) return;
    update({ status: "error", message });
    onError?.(message, cause);
    await dispose(run, true);
  };

  const startRun = async (run: Run) => {
    if (!isActive(run) || !run.context) return;
    try {
      await run.context.resume();
      if (!isActive(run)) return;
      await run.audio.play();
      if (isActive(run)) {
        run.lastClockSeconds = run.audio.currentTime;
        run.lastClockAdvanceAt = performance.now();
        update({
          status: "extracting",
          message:
            "Preparing locally at playback speed. Keep this tab active; preparation may pause if the browser or device is suspended.",
        });
        if (!run.watchdog)
          run.watchdog = setInterval(() => {
            if (!isActive(run) || run.playbackEnded || run.flushed) return;
            const now = performance.now();
            if (run.audio.currentTime > run.lastClockSeconds + 0.001) {
              run.lastClockSeconds = run.audio.currentTime;
              run.lastClockAdvanceAt = now;
              update({
                progress: Math.min(
                  99,
                  (run.audio.currentTime / run.duration) * 100,
                ),
              });
              return;
            }
            if (
              needsClockRecovery(
                run.context!.state,
                run.audio.paused,
                run.pausedForBackpressure,
                now - run.lastClockAdvanceAt,
              )
            ) {
              run.audio.pause();
              if (run.watchdog) {
                clearInterval(run.watchdog);
                run.watchdog = undefined;
              }
              update({
                status: "needs-start",
                message:
                  "Audio preparation paused. Keep this tab active, then click Resume preparation.",
              });
            }
          }, STALL_CHECK_MS);
        void completeAfterPlayback(run);
      }
    } catch (cause) {
      if (isActive(run)) {
        // LEAKY ABSTRACTION: play() can reject after the browser has already
        // advanced the media clock. A recoverable needs-start state must stop
        // that clock before exposing its manual action, or pages keep arriving
        // while the UI claims preparation is paused.
        run.audio.pause();
        if (run.watchdog) {
          clearInterval(run.watchdog);
          run.watchdog = undefined;
        }
        run.pausedForBackpressure = false;
        update({
          status: "needs-start",
          message:
            "Audio preparation is paused. Keep this tab active, then click Resume preparation.",
        });
        onError?.(state.message, cause);
      }
    }
  };

  const finish = async (run: Run) => {
    const pageRecords = [...run.pages].sort((a, b) => a.index - b.index);
    if (
      pageRecords.length !== run.pageIndex ||
      pageRecords.some((page, index) => page.index !== index) ||
      run.validFrames !== run.targetFrames ||
      run.retainedFrames !== run.targetFrames
    )
      throw new Error(
        "Audio cache pages were incomplete; no cache was committed.",
      );
    const manifest: CacheManifest = {
      runId: run.runId,
      generation: run.generation,
      durationSeconds: run.duration,
      sampleRate: PCM_SAMPLE_RATE,
      channels: 2,
      layout: "planar-f32le",
      pages: pageRecords,
      validFrames: run.validFrames,
      targetFrames: run.targetFrames,
      endFrameExclusive: run.targetFrames,
      observedFrames: run.observedFrames,
      tailTrimmedFrames: run.tailTrimmedFrames,
      durationAuthority: "html-media-element",
      frameRounding: "nearest",
      state: "complete",
    };
    const commit = commitManifest(manifest, () => isActive(run));
    run.committing = commit;
    const previousRunId = await commit;
    run.committing = undefined;
    if (!isActive(run)) return;
    // This run is now the committed current tree. Clear ownership before the
    // observable completion state so a replacement cannot treat it as staging.
    if (active === run) active = undefined;
    update({
      status: "complete",
      progress: 100,
      message: "Local audio cache is ready.",
    });
    await dispose(run, false);
    // The committed pointer was re-read before collection, so a late newer run
    // can never lose its tree. Cleanup failure is intentionally non-fatal.
    if (previousRunId) {
      try {
        if (
          shouldCollectPreviousRun(
            previousRunId,
            manifest.runId,
            await currentManifestRunId(),
          )
        )
          await removeTree(previousRunId);
        await deleteManifestRecord(previousRunId).catch(() => undefined);
      } catch {
        // A stale tree costs space but does not change the committed cache.
      }
    }
  };

  const completeAfterPlayback = (run: Run) => {
    if (run.completion || !run.ended) return;
    run.completion = (async () => {
      try {
        await run.ended;
        if (!isActive(run)) return;
        const drained = new Promise<void>((resolve) => {
          run.flushResolve = resolve;
        });
        run.node?.port.postMessage({ type: "flush" });
        await drained;
        if (isActive(run)) await finish(run);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Audio preparation failed.";
        await fail(run, message, cause);
      }
    })();
  };

  const extract = async (file: File) => {
    if (!isAdmittedMp4(file.name, file.type))
      throw new Error(
        "Local audio preparation requires an MP4 file reported by the browser as video/mp4.",
      );
    const request = ++requestId;
    await stopActive(true);
    if (destroyed || request !== requestId) return;
    releasePending();
    const currentGeneration = ++generation;
    const runId = `i009-${Date.now().toString(36)}-${crypto.randomUUID()}`;
    const audio = document.createElement("audio");
    audio.preload = "auto";
    // Muting a media element suppresses its source in Chromium. The graph's
    // zero-gain node, not element mute/volume, is the silent playback boundary.
    audio.muted = false;
    audio.defaultMuted = false;
    audio.volume = 1;
    audio.style.display = "none";
    const url = URL.createObjectURL(file);
    audio.src = url;
    const pending: PendingSource = { request, audio, url };
    pendingSource = pending;
    const metadata = new Promise<number>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        audio.onloadedmetadata = null;
        audio.onerror = null;
      };
      const finishMetadata = (value?: number, error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        error ? reject(error) : resolve(value!);
      };
      const timer = setTimeout(
        () =>
          finishMetadata(
            undefined,
            new Error("Timed out reading media duration."),
          ),
        12_000,
      );
      pending.cancelMetadata = () =>
        finishMetadata(undefined, new Error("Audio preparation cancelled."));
      audio.onloadedmetadata = () => finishMetadata(audio.duration);
      audio.onerror = () =>
        finishMetadata(
          undefined,
          new Error("The browser could not decode audio from this MP4 source."),
        );
      audio.load();
    });
    let duration: number;
    try {
      duration = await metadata;
    } catch (cause) {
      releasePending(pending);
      if (request !== requestId || destroyed) return;
      throw cause;
    }
    if (request !== requestId || destroyed || pendingSource !== pending) {
      releasePending(pending);
      return;
    }
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > MAX_DURATION_SECONDS
    ) {
      releasePending(pending);
      throw new Error("This video duration is outside the supported range.");
    }
    pendingSource = undefined;
    pending.cancelMetadata = undefined;
    const targetFrames = canonicalTargetFrames(duration);
    const run: Run = {
      generation: currentGeneration,
      runId,
      duration,
      targetFrames,
      audio,
      url,
      cancelled: false,
      flushed: false,
      pending: 0,
      pageIndex: 0,
      validFrames: 0,
      observedFrames: 0,
      retainedFrames: 0,
      tailTrimmedFrames: 0,
      pages: [],
      pausedForBackpressure: false,
      playbackEnded: false,
      lastClockSeconds: 0,
      lastClockAdvanceAt: performance.now(),
    };
    active = run;
    update({
      generation: currentGeneration,
      status: "preparing",
      message: "Preparing local audio cache…",
      progress: 0,
      pages: 0,
      validFrames: 0,
    });
    try {
      if (!navigator.storage?.getDirectory || !globalThis.indexedDB)
        throw new Error("Local audio storage is unavailable.");
      const estimate = await navigator.storage.estimate();
      const required = requiredPcmStorageBytes(duration);
      if (
        (estimate.quota ?? 0) > 0 &&
        estimate.quota! - (estimate.usage ?? 0) < required
      )
        throw new Error(
          "There is not enough local storage for the audio cache.",
        );
      const context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
      run.context = context;
      if (context.sampleRate !== PCM_SAMPLE_RATE || !context.audioWorklet)
        throw new Error(
          "48 kHz AudioWorklet audio is unavailable in this browser.",
        );
      await context.audioWorklet.addModule(pcmWorkletUrl);
      if (!isActive(run)) return;
      await holdRunLock(run);
      if (!isActive(run)) return;
      run.source = context.createMediaElementSource(audio);
      run.node = new AudioWorkletNode(context, "i009-native-pcm", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCountMode: "max",
        channelInterpretation: "discrete",
        processorOptions: { targetFrames },
      });
      run.gain = context.createGain();
      run.gain.gain.value = 0;
      // LEAKY ABSTRACTION: the browser owns MP4 demux, audio-codec decode, resampling,
      // trim, scheduling, and codec identity. A replacement must preserve this page/timing/cancel
      // contract. [[Implementation Package I-009 - Local Audio Extraction Cache]]
      run.source
        .connect(run.node)
        .connect(run.gain)
        .connect(context.destination);
      const writer = new Worker(
        new URL("./i009-pcm-writer.worker.ts", import.meta.url),
        { type: "module" },
      );
      run.writer = writer;
      writer.onerror = () =>
        void fail(run, "Audio cache writer stopped unexpectedly.");
      writer.onmessage = (event: MessageEvent<WriterMessage>) => {
        const message = event.data;
        if (
          !isActive(run) ||
          message.generation !== run.generation ||
          message.runId !== run.runId
        )
          return;
        if (message.type === "error") {
          void fail(run, message.message ?? "Audio cache write failed.");
          return;
        }
        if (!isValidWriterAck(message, run.pending)) {
          void fail(run, "Audio cache writer returned an invalid page.");
          return;
        }
        run.pending--;
        run.validFrames += message.validFrames;
        run.pages.push({
          index: message.index,
          validFrames: message.validFrames,
          integrity: message.integrity,
          file: `page-${message.index.toString().padStart(6, "0")}.pcm`,
        });
        run.node?.port.postMessage(
          { type: "recycle", left: message.left, right: message.right },
          [message.left, message.right],
        );
        update({
          status: state.status === "needs-start" ? "needs-start" : "extracting",
          pages: run.pages.length,
          validFrames: run.validFrames,
          progress: Math.min(99, (audio.currentTime / duration) * 100),
        });
        if (
          shouldResumeAfterWriterAck(
            run.pending,
            audio.paused,
            run.flushed,
            run.pausedForBackpressure,
          )
        ) {
          run.pausedForBackpressure = false;
          void startRun(run);
        }
        if (run.flushed && run.pending === 0) run.flushResolve?.();
      };
      run.node.port.onmessage = (event: MessageEvent<WriterMessage>) => {
        if (!isActive(run)) return;
        if (event.data.type === "overrun") {
          void fail(
            run,
            "Audio extraction could not keep up; no cache was committed.",
          );
          return;
        }
        if (event.data.type === "unsupported-channel-count") {
          void fail(
            run,
            "This video does not have a supported mono or stereo audio program.",
          );
          return;
        }
        if (event.data.type === "flushed") {
          try {
            const stats = validateCanonicalFlush(run.targetFrames, {
              observedFrames: event.data.observedFrames!,
              retainedFrames: event.data.retainedFrames!,
              tailTrimmedFrames: event.data.tailTrimmedFrames!,
            });
            run.observedFrames = stats.observedFrames;
            run.retainedFrames = stats.retainedFrames;
            run.tailTrimmedFrames = stats.tailTrimmedFrames;
            run.flushed = true;
          } catch (cause) {
            void fail(
              run,
              cause instanceof Error
                ? cause.message
                : "Audio extraction timeline was invalid.",
              cause,
            );
            return;
          }
          if (run.pending === 0) run.flushResolve?.();
          return;
        }
        if (
          event.data.type !== "page" ||
          !event.data.left ||
          !event.data.right ||
          !event.data.validFrames
        )
          return;
        run.pending++;
        if (run.pending >= PCM_HIGH_WATER_PAGES) {
          run.pausedForBackpressure = true;
          audio.pause();
        }
        writer.postMessage(
          {
            type: "page",
            generation: run.generation,
            runId: run.runId,
            index: run.pageIndex++,
            left: event.data.left,
            right: event.data.right,
            validFrames: event.data.validFrames,
          },
          [event.data.left, event.data.right],
        );
      };
      run.node.onprocessorerror = () =>
        void fail(run, "Audio extraction processor stopped unexpectedly.");
      run.ended = new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          run.playbackEnded = true;
          resolve();
        };
        audio.onerror = () =>
          reject(new Error("Browser failed while extracting audio."));
      });
      update({
        status: "needs-start",
        message:
          "Audio cache is ready. Keep this tab active, then click Start preparation.",
      });
      await startRun(run);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Audio preparation failed.";
      await fail(run, message, cause);
    }
  };

  return {
    extract: async (file) => {
      try {
        await extract(file);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Audio preparation failed.";
        update({ status: "error", message });
        onError?.(message, cause);
      }
    },
    start: async () => {
      if (active && state.status === "needs-start") await startRun(active);
    },
    cancel: async () => {
      requestId++;
      releasePending();
      await stopActive(true);
      generation++;
      update({
        generation,
        status: "cancelled",
        progress: 0,
        message: "Audio preparation cancelled.",
      });
    },
    destroy: async () => {
      destroyed = true;
      requestId++;
      releasePending();
      await stopActive(true);
      generation++;
      listeners.clear();
    },
    getState: () => ({ ...state }),
    onStateChange: (listener) => {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
  };
}
