import type {
  EnrichmentPageReader,
  EnrichmentPageWriter,
  EnrichmentPcmPage,
} from "./chunk-enrichment";
import type { SegmentationPageReader } from "./segmentation";

const DATABASE_NAME = "cinematic-audio-i009";
const STORE_NAME = "manifests";
const INPUT_POINTER_KEY = "current";
const RESULT_POINTER_KEY = "processing:current";
const RESULT_KEY_PREFIX = "processing:";
const INPUT_TREE_PREFIX = "i009-";
const RESULT_TREE_PREFIX = "processing-";
const MAX_PAGE_FRAMES = 48_000 * 5;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

export type PcmPageDescriptor = Readonly<{
  index: number;
  startFrame: number;
  validFrames: number;
  byteLength: number;
  integrity: string;
  file: string;
}>;

export type CanonicalInputManifest = Readonly<{
  runId: string;
  generation: number;
  sampleRate: 48_000;
  channels: 2;
  layout: "planar-f32le";
  validFrames: number;
  pages: readonly PcmPageDescriptor[];
}>;

export type ProcessedOutputManifest = Readonly<{
  schemaVersion: 1;
  resultId: string;
  sourceRunId: string;
  sourceGeneration: number;
  generation: number;
  sampleRate: 48_000;
  channels: 2;
  layout: "planar-f32le";
  totalFrames: number;
  pages: readonly PcmPageDescriptor[];
  state: "complete";
}>;

export interface ProcessingManifestRepository {
  readInputPointer(): Promise<unknown>;
  readInputManifest(runId: string): Promise<unknown>;
  commitProcessed(
    manifest: ProcessedOutputManifest,
    expectedInput: Readonly<{ runId: string; generation: number }>,
    stillCurrent: () => void,
  ): Promise<string | undefined>;
  readProcessedPointer(): Promise<unknown>;
  readProcessedManifest?(resultId: string): Promise<unknown>;
  deleteProcessedManifest(resultId: string): Promise<void>;
}

export interface ProcessingPageFilesystem {
  read(tree: string, file: string): Promise<ArrayBuffer>;
  write(tree: string, file: string, bytes: Uint8Array): Promise<void>;
  removeTree(tree: string): Promise<void>;
}

export type ProcessingStoreDependencies = Readonly<{
  manifests: ProcessingManifestRepository;
  files: ProcessingPageFilesystem;
  randomId: () => string;
}>;

const abortError = () =>
  new DOMException("Processing cancelled.", "AbortError");
const fail = (message: string): never => {
  throw new Error(message);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const safeInteger = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && (value as number) >= minimum;
const safeName = (value: unknown) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.includes("/") &&
  value !== "." &&
  value !== "..";

const checksum = (bytes: Uint8Array): string => {
  let value = 0x811c9dc5;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
};

const pageIntegrity = (buffer: ArrayBuffer, frames: number) => {
  const channelBytes = frames * FLOAT_BYTES;
  return `${checksum(new Uint8Array(buffer, 0, channelBytes))}:${checksum(
    new Uint8Array(buffer, channelBytes, channelBytes),
  )}`;
};

const inputPage = (
  value: unknown,
  expectedIndex: number,
  startFrame: number,
): PcmPageDescriptor => {
  if (!isRecord(value))
    throw new Error("Audio cache contains an invalid page descriptor.");
  const index = value["index"];
  const validFrames = value["validFrames"];
  const integrity = value["integrity"];
  const file = value["file"];
  if (index !== expectedIndex || !safeInteger(validFrames, 1))
    fail("Audio cache pages are not ordered and contiguous.");
  if ((validFrames as number) > MAX_PAGE_FRAMES)
    fail("Audio cache page exceeds the five-second bound.");
  if (
    typeof integrity !== "string" ||
    !/^[a-f0-9]{8}:[a-f0-9]{8}$/.test(integrity)
  )
    fail("Audio cache page has invalid integrity metadata.");
  if (!safeName(file)) fail("Audio cache page has an unsafe file name.");
  const parsedIndex = index as number;
  const parsedFrames = validFrames as number;
  return Object.freeze({
    index: parsedIndex,
    startFrame,
    validFrames: parsedFrames,
    byteLength: parsedFrames * 2 * FLOAT_BYTES,
    integrity: integrity as string,
    file: file as string,
  });
};

export const validateInputManifest = (
  pointer: unknown,
  value: unknown,
): CanonicalInputManifest => {
  if (!isRecord(pointer) || typeof pointer["runId"] !== "string")
    throw new Error("No committed audio cache is available.");
  if (!isRecord(value) || value["runId"] !== pointer["runId"])
    throw new Error("The audio cache pointer and manifest do not match.");
  const runId = value["runId"];
  const generation = value["generation"];
  const validFrames = value["validFrames"];
  const observedFrames = value["observedFrames"];
  const rawPages = value["pages"];
  if (
    typeof runId !== "string" ||
    !runId.startsWith(INPUT_TREE_PREFIX) ||
    !safeName(runId) ||
    !safeInteger(generation, 1) ||
    value["sampleRate"] !== 48_000 ||
    value["channels"] !== 2 ||
    value["layout"] !== "planar-f32le" ||
    value["state"] !== "complete" ||
    !safeInteger(validFrames, 1) ||
    (validFrames as number) > 48_000 * 900 ||
    validFrames !== value["targetFrames"] ||
    validFrames !== value["endFrameExclusive"] ||
    !safeInteger(observedFrames, validFrames as number) ||
    value["tailTrimmedFrames"] !==
      (observedFrames as number) - (validFrames as number) ||
    !Number.isFinite(value["durationSeconds"]) ||
    (value["durationSeconds"] as number) <= 0 ||
    (value["durationSeconds"] as number) > 900 ||
    value["durationAuthority"] !== "html-media-element" ||
    value["frameRounding"] !== "nearest" ||
    !Array.isArray(rawPages)
  )
    fail("The committed audio cache manifest is invalid.");
  const parsedGeneration = generation as number;
  const parsedFrames = validFrames as number;
  const parsedPages = rawPages as unknown[];
  let startFrame = 0;
  const pages = parsedPages.map((page: unknown, index: number) => {
    const parsed = inputPage(page, index, startFrame);
    if (parsed.file !== `page-${index.toString().padStart(6, "0")}.pcm`)
      fail("Audio cache page file names do not match their indices.");
    startFrame += parsed.validFrames;
    return parsed;
  });
  if (pages.length === 0 || startFrame !== parsedFrames)
    fail("Audio cache page totals do not match its timeline.");
  return Object.freeze({
    runId,
    generation: parsedGeneration,
    sampleRate: 48_000,
    channels: 2,
    layout: "planar-f32le",
    validFrames: parsedFrames,
    pages: Object.freeze(pages),
  });
};

const currentRunId = (value: unknown): string | undefined =>
  isRecord(value) && typeof value["runId"] === "string"
    ? value["runId"]
    : undefined;

/**
 * LEAKY ABSTRACTION: OPFS returns each page as one file-backed ArrayBuffer. The
 * adapter exposes planar views into that buffer, so consumers must finish with
 * a yielded page before requesting the next one and must never retain it.
 * [[Implementation Package I-012 - OPFS Processing Store]]
 */
export async function openCommittedPcmReader(
  dependencies: ProcessingStoreDependencies = browserProcessingStore(),
): Promise<
  SegmentationPageReader &
    EnrichmentPageReader & { readonly source: CanonicalInputManifest }
> {
  const pointer = await dependencies.manifests.readInputPointer();
  const runId = currentRunId(pointer);
  if (!runId) throw new Error("No committed audio cache is available.");
  const source = validateInputManifest(
    pointer,
    await dependencies.manifests.readInputManifest(runId),
  );
  return Object.freeze({
    sampleRate: 48_000 as const,
    channelCount: 2 as const,
    totalFrames: source.validFrames,
    source,
    async *pages(signal: AbortSignal) {
      for (const page of source.pages) {
        if (signal.aborted) throw abortError();
        const latest = await dependencies.manifests.readInputPointer();
        if (currentRunId(latest) !== source.runId)
          fail("Audio cache changed while processing.");
        const bytes = await dependencies.files.read(source.runId, page.file);
        if (signal.aborted) throw abortError();
        if (bytes.byteLength !== page.byteLength)
          fail(`Audio cache page ${page.index} has an invalid byte length.`);
        if (pageIntegrity(bytes, page.validFrames) !== page.integrity)
          fail(`Audio cache page ${page.index} failed its integrity check.`);
        const channelBytes = page.validFrames * FLOAT_BYTES;
        yield Object.freeze({
          startFrame: page.startFrame,
          validFrames: page.validFrames,
          channels: [
            new Float32Array(bytes, 0, page.validFrames),
            new Float32Array(bytes, channelBytes, page.validFrames),
          ] as const,
        });
      }
    },
  });
}

export const validateProcessedManifest = (
  pointer: unknown,
  value: unknown,
  source: CanonicalInputManifest,
): ProcessedOutputManifest => {
  const resultId = currentRunId(pointer);
  if (!resultId || !resultId.startsWith(RESULT_TREE_PREFIX))
    throw new Error("No committed processed audio is available.");
  if (!isRecord(value))
    throw new Error("The processed audio manifest is invalid.");
  if (value["resultId"] !== resultId)
    throw new Error("The processed audio pointer and manifest do not match.");
  const sourceRunId = value["sourceRunId"];
  const sourceGeneration = value["sourceGeneration"];
  const generation = value["generation"];
  const totalFrames = value["totalFrames"];
  const rawPages = value["pages"];
  if (
    value["schemaVersion"] !== 1 ||
    typeof sourceRunId !== "string" ||
    sourceRunId !== source.runId ||
    !sourceRunId.startsWith(INPUT_TREE_PREFIX) ||
    !safeInteger(sourceGeneration, 1) ||
    sourceGeneration !== source.generation ||
    !safeInteger(generation, 1) ||
    value["sampleRate"] !== 48_000 ||
    value["channels"] !== 2 ||
    value["layout"] !== "planar-f32le" ||
    value["state"] !== "complete" ||
    !safeInteger(totalFrames, 1) ||
    (totalFrames as number) > 48_000 * 900 ||
    totalFrames !== source.validFrames ||
    !Array.isArray(rawPages)
  )
    fail("The committed processed audio manifest is invalid.");
  let startFrame = 0;
  const pages = (rawPages as unknown[]).map((page, index) => {
    const parsed = inputPage(page, index, startFrame);
    if (parsed.file !== `page-${index.toString().padStart(6, "0")}.pcm`)
      fail("Processed audio page file names do not match their indices.");
    startFrame += parsed.validFrames;
    return parsed;
  });
  if (pages.length === 0 || startFrame !== totalFrames)
    fail("Processed audio page totals do not match its timeline.");
  const parsedSourceRunId = sourceRunId as string;
  return Object.freeze({
    schemaVersion: 1,
    resultId,
    sourceRunId: parsedSourceRunId,
    sourceGeneration: sourceGeneration as number,
    generation: generation as number,
    sampleRate: 48_000,
    channels: 2,
    layout: "planar-f32le",
    totalFrames: totalFrames as number,
    pages: Object.freeze(pages),
    state: "complete",
  });
};

/** Opens only the currently published, source-matching processed result. */
export async function openCommittedProcessedPcmReader(
  dependencies: ProcessingStoreDependencies = browserProcessingStore(),
): Promise<
  EnrichmentPageReader & { readonly result: ProcessedOutputManifest }
> {
  const readManifest = dependencies.manifests.readProcessedManifest;
  if (!readManifest)
    throw new Error("Processed manifest reads are unavailable.");
  const pointer = await dependencies.manifests.readProcessedPointer();
  const resultId = currentRunId(pointer);
  if (!resultId) throw new Error("No committed processed audio is available.");
  const inputPointer = await dependencies.manifests.readInputPointer();
  const inputRunId = currentRunId(inputPointer);
  if (!inputRunId) throw new Error("No committed audio cache is available.");
  const source = validateInputManifest(
    inputPointer,
    await dependencies.manifests.readInputManifest(inputRunId),
  );
  const result = validateProcessedManifest(
    pointer,
    await readManifest(resultId),
    source,
  );
  return Object.freeze({
    sampleRate: 48_000 as const,
    channelCount: 2 as const,
    totalFrames: result.totalFrames,
    result,
    async *pages(signal: AbortSignal) {
      for (const page of result.pages) {
        if (signal.aborted) throw abortError();
        const latestResultPointer =
          await dependencies.manifests.readProcessedPointer();
        const latestInputPointer =
          await dependencies.manifests.readInputPointer();
        if (
          currentRunId(latestResultPointer) !== result.resultId ||
          currentRunId(latestInputPointer) !== result.sourceRunId
        )
          fail("Processed audio changed while it was being read.");
        const latestSource = validateInputManifest(
          latestInputPointer,
          await dependencies.manifests.readInputManifest(result.sourceRunId),
        );
        if (latestSource.generation !== result.sourceGeneration)
          fail("Processed audio changed while it was being read.");
        const latestResult = validateProcessedManifest(
          latestResultPointer,
          await readManifest(result.resultId),
          latestSource,
        );
        if (
          latestResult.generation !== result.generation ||
          latestResult.totalFrames !== result.totalFrames
        )
          fail("Processed audio changed while it was being read.");
        const bytes = await dependencies.files.read(result.resultId, page.file);
        if (signal.aborted) throw abortError();
        if (bytes.byteLength !== page.byteLength)
          fail(
            `Processed audio page ${page.index} has an invalid byte length.`,
          );
        if (pageIntegrity(bytes, page.validFrames) !== page.integrity)
          fail(
            `Processed audio page ${page.index} failed its integrity check.`,
          );
        const channelBytes = page.validFrames * FLOAT_BYTES;
        yield Object.freeze({
          startFrame: page.startFrame,
          validFrames: page.validFrames,
          channels: [
            new Float32Array(bytes, 0, page.validFrames),
            new Float32Array(bytes, channelBytes, page.validFrames),
          ] as const,
        });
      }
    },
  });
}

export interface TransactionalProcessedWriter extends EnrichmentPageWriter {
  readonly resultId: string;
  committed(): ProcessedOutputManifest | undefined;
}

export function createTransactionalProcessedWriter(
  source: CanonicalInputManifest,
  generation: number,
  options: Readonly<{
    signal?: AbortSignal;
    isGenerationCurrent?: (generation: number) => boolean;
    dependencies?: ProcessingStoreDependencies;
  }> = {},
): TransactionalProcessedWriter {
  if (!safeInteger(generation, 1))
    throw new RangeError("generation must be a positive safe integer");
  const dependencies = options.dependencies ?? browserProcessingStore();
  const resultId = `${RESULT_TREE_PREFIX}${dependencies.randomId()}`;
  if (!safeName(resultId))
    throw new Error("Processed result identity is unsafe.");
  let nextFrame = 0;
  let pageIndex = 0;
  let state: "open" | "writing" | "committed" | "aborted" = "open";
  let result: ProcessedOutputManifest | undefined;
  const pages: PcmPageDescriptor[] = [];
  const stopIfNeeded = () => {
    if (options.signal?.aborted) throw abortError();
    if (options.isGenerationCurrent && !options.isGenerationCurrent(generation))
      throw new Error(
        "Processed output belongs to a stale project generation.",
      );
  };
  const cleanup = async () => {
    await dependencies.files.removeTree(resultId).catch(() => undefined);
  };
  return {
    resultId,
    committed: () => result,
    async write(page: EnrichmentPcmPage) {
      if (state !== "open") throw new Error("Processed writer is not open.");
      try {
        stopIfNeeded();
        if (
          !safeInteger(page.startFrame) ||
          page.startFrame !== nextFrame ||
          !safeInteger(page.validFrames, 1) ||
          page.validFrames > MAX_PAGE_FRAMES ||
          nextFrame + page.validFrames > source.validFrames ||
          page.channels.length !== 2 ||
          page.channels[0].length !== page.validFrames ||
          page.channels[1].length !== page.validFrames
        )
          throw new RangeError("Processed PCM page layout is invalid.");
        const combined = new Float32Array(page.validFrames * 2);
        for (let channel = 0; channel < 2; channel += 1)
          for (let frame = 0; frame < page.validFrames; frame += 1) {
            const sample = page.channels[channel]![frame]!;
            if (!Number.isFinite(sample))
              throw new RangeError("Processed PCM samples must be finite.");
            combined[channel * page.validFrames + frame] = sample;
          }
        const file = `page-${pageIndex.toString().padStart(6, "0")}.pcm`;
        const descriptor = Object.freeze({
          index: pageIndex,
          startFrame: nextFrame,
          validFrames: page.validFrames,
          byteLength: combined.byteLength,
          integrity: pageIntegrity(combined.buffer, page.validFrames),
          file,
        });
        state = "writing";
        await dependencies.files.write(
          resultId,
          file,
          new Uint8Array(combined.buffer),
        );
        stopIfNeeded();
        pages.push(descriptor);
        nextFrame += page.validFrames;
        pageIndex += 1;
        state = "open";
      } catch (cause) {
        state = "aborted";
        await cleanup();
        throw cause;
      }
    },
    async close() {
      if (state !== "open") throw new Error("Processed writer is not open.");
      try {
        stopIfNeeded();
        if (nextFrame !== source.validFrames || pages.length === 0)
          throw new Error(
            "Processed output does not cover the complete source timeline.",
          );
        const manifest: ProcessedOutputManifest = Object.freeze({
          schemaVersion: 1,
          resultId,
          sourceRunId: source.runId,
          sourceGeneration: source.generation,
          generation,
          sampleRate: 48_000,
          channels: 2,
          layout: "planar-f32le",
          totalFrames: nextFrame,
          pages: Object.freeze([...pages]),
          state: "complete",
        });
        state = "writing";
        const previous = await dependencies.manifests.commitProcessed(
          manifest,
          {
            runId: source.runId,
            generation: source.generation,
          },
          stopIfNeeded,
        );
        state = "committed";
        result = manifest;
        if (previous && previous !== resultId) {
          const latest = currentRunId(
            await dependencies.manifests
              .readProcessedPointer()
              .catch(() => undefined),
          );
          if (latest !== previous) {
            await dependencies.files
              .removeTree(previous)
              .catch(() => undefined);
            await dependencies.manifests
              .deleteProcessedManifest(previous)
              .catch(() => undefined);
          }
        }
      } catch (cause) {
        state = "aborted";
        await cleanup();
        throw cause;
      }
    },
    async abort() {
      if (state === "committed" || state === "aborted") return;
      if (state === "writing")
        throw new Error(
          "Cannot abort while a page or commit is being written.",
        );
      state = "aborted";
      await cleanup();
    },
  };
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Manifest storage failed."));
    request.onsuccess = () => resolve(request.result);
  });

const idbRead = async (key: string): Promise<unknown> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Manifest storage failed."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

const browserManifests = (): ProcessingManifestRepository => ({
  readInputPointer: () => idbRead(INPUT_POINTER_KEY),
  readInputManifest: (runId) => idbRead(runId),
  readProcessedPointer: () => idbRead(RESULT_POINTER_KEY),
  readProcessedManifest: (resultId) =>
    idbRead(`${RESULT_KEY_PREFIX}${resultId}`),
  commitProcessed: async (manifest, expected, stillCurrent) => {
    const db = await openDatabase();
    return new Promise<string | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      let previous: string | undefined;
      const inputPointer = store.get(INPUT_POINTER_KEY);
      inputPointer.onsuccess = () => {
        try {
          stillCurrent();
        } catch {
          return transaction.abort();
        }
        const pointerRunId = currentRunId(inputPointer.result);
        if (pointerRunId !== expected.runId) return transaction.abort();
        const inputManifest = store.get(expected.runId);
        inputManifest.onsuccess = () => {
          try {
            stillCurrent();
          } catch {
            return transaction.abort();
          }
          const value = inputManifest.result as
            Record<string, unknown> | undefined;
          if (value?.["generation"] !== expected.generation)
            return transaction.abort();
          const old = store.get(RESULT_POINTER_KEY);
          old.onsuccess = () => {
            try {
              stillCurrent();
            } catch {
              return transaction.abort();
            }
            previous = currentRunId(old.result);
            store.put(manifest, `${RESULT_KEY_PREFIX}${manifest.resultId}`);
            store.put({ runId: manifest.resultId }, RESULT_POINTER_KEY);
          };
          old.onerror = () => transaction.abort();
        };
        inputManifest.onerror = () => transaction.abort();
      };
      inputPointer.onerror = () => transaction.abort();
      transaction.oncomplete = () => {
        db.close();
        resolve(previous);
      };
      transaction.onabort = transaction.onerror = () => {
        db.close();
        reject(
          transaction.error ??
            new Error("Processed output publication was rejected as stale."),
        );
      };
    });
  },
  deleteProcessedManifest: async (resultId) => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const current = store.get(RESULT_POINTER_KEY);
      current.onsuccess = () => {
        if (currentRunId(current.result) !== resultId)
          store.delete(`${RESULT_KEY_PREFIX}${resultId}`);
      };
      current.onerror = () => transaction.abort();
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = transaction.onerror = () => {
        db.close();
        reject(
          transaction.error ?? new Error("Processed manifest cleanup failed."),
        );
      };
    });
  },
});

type OpfsDirectory = FileSystemDirectoryHandle & {
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
};

const browserFiles = (): ProcessingPageFilesystem => ({
  async read(tree, file) {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(tree);
    return (
      await (await directory.getFileHandle(file)).getFile()
    ).arrayBuffer();
  },
  async write(tree, file, bytes) {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(tree, { create: true });
    const handle = await directory.getFileHandle(file, { create: true });
    // LEAKY ABSTRACTION: createWritable publishes a complete page only on close;
    // the manifest transaction is still the publication boundary for the result.
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();
  },
  async removeTree(tree) {
    const root = (await navigator.storage.getDirectory()) as OpfsDirectory;
    await root.removeEntry(tree, { recursive: true });
  },
});

export const browserProcessingStore = (): ProcessingStoreDependencies => ({
  manifests: browserManifests(),
  files: browserFiles(),
  randomId: () => crypto.randomUUID(),
});
