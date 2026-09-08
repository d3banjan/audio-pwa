import { describe, expect, test, vi } from "vitest";
import {
  createTransactionalProcessedWriter,
  openCommittedPcmReader,
  openCommittedProcessedPcmReader,
  validateInputManifest,
  validateProcessedManifest,
  type CanonicalInputManifest,
  type ProcessedOutputManifest,
  type ProcessingStoreDependencies,
} from "./opfs-processing-store";

const hash = (bytes: Uint8Array) => {
  let value = 0x811c9dc5;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
};

const packed = (left: readonly number[], right: readonly number[]) => {
  const pcm = new Float32Array([...left, ...right]);
  const channelBytes = left.length * 4;
  const bytes = new Uint8Array(pcm.buffer);
  return {
    buffer: pcm.buffer,
    integrity: `${hash(bytes.subarray(0, channelBytes))}:${hash(bytes.subarray(channelBytes))}`,
  };
};

const inputFixture = () => {
  const first = packed([1, 2], [3, 4]);
  const second = packed([5], [6]);
  const value = {
    runId: "i009-source",
    generation: 7,
    durationSeconds: 3 / 48_000,
    sampleRate: 48_000,
    channels: 2,
    layout: "planar-f32le",
    pages: [
      {
        index: 0,
        validFrames: 2,
        integrity: first.integrity,
        file: "page-000000.pcm",
      },
      {
        index: 1,
        validFrames: 1,
        integrity: second.integrity,
        file: "page-000001.pcm",
      },
    ],
    validFrames: 3,
    targetFrames: 3,
    endFrameExclusive: 3,
    observedFrames: 3,
    tailTrimmedFrames: 0,
    durationAuthority: "html-media-element",
    frameRounding: "nearest",
    state: "complete",
  };
  return { pointer: { runId: value.runId }, value, first, second };
};

const dependencies = (): ProcessingStoreDependencies & {
  written: Map<string, Uint8Array>;
  removed: string[];
  commits: ProcessedOutputManifest[];
  inputPointer: { runId: string };
  processedPointer: { runId: string };
} => {
  const fixture = inputFixture();
  const written = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const commits: ProcessedOutputManifest[] = [];
  const processed = {
    schemaVersion: 1,
    resultId: "processing-new",
    sourceRunId: fixture.value.runId,
    sourceGeneration: fixture.value.generation,
    generation: 9,
    sampleRate: 48_000,
    channels: 2,
    layout: "planar-f32le",
    totalFrames: 3,
    pages: fixture.value.pages,
    state: "complete",
  };
  return {
    inputPointer: fixture.pointer,
    processedPointer: { runId: "processing-old" },
    written,
    removed,
    commits,
    randomId: () => "new",
    files: {
      read: async (_tree, file) =>
        file.endsWith("000000.pcm")
          ? fixture.first.buffer
          : fixture.second.buffer,
      write: async (tree, file, bytes) => {
        written.set(`${tree}/${file}`, Uint8Array.from(bytes));
      },
      removeTree: async (tree) => {
        removed.push(tree);
      },
    },
    manifests: {
      readInputPointer: async () => ({ ...fixture.pointer }),
      readInputManifest: async () => ({ ...fixture.value }),
      commitProcessed: async (manifest, expected) => {
        expect(expected).toEqual({ runId: "i009-source", generation: 7 });
        commits.push(manifest);
        return "processing-old";
      },
      readProcessedPointer: async () => ({ runId: "processing-new" }),
      readProcessedManifest: async () => ({ ...processed }),
      deleteProcessedManifest: vi.fn(async () => undefined),
    },
  };
};

describe("I-012 committed processed PCM reader", () => {
  test("streams only a complete result matching the current source", async () => {
    const deps = dependencies();
    const reader = await openCommittedProcessedPcmReader(deps);
    const pages = [];
    for await (const page of reader.pages(new AbortController().signal))
      pages.push(page);
    expect(reader.result.resultId).toBe("processing-new");
    expect(pages.map((page) => page.validFrames)).toEqual([2, 1]);
    expect([...pages[1]!.channels[1]]).toEqual([6]);
  });

  test("rejects a result for a replaced source", async () => {
    const deps = dependencies();
    const value = await deps.manifests.readProcessedManifest!("processing-new");
    const source = validateInputManifest(
      inputFixture().pointer,
      inputFixture().value,
    );
    expect(() =>
      validateProcessedManifest({ runId: "processing-new" }, value, {
        ...source,
        runId: "i009-replacement",
      }),
    ).toThrow("manifest is invalid");
    expect(() =>
      validateProcessedManifest({ runId: "processing-new" }, value, {
        ...source,
        generation: 8,
      }),
    ).toThrow("manifest is invalid");
    expect(() =>
      validateProcessedManifest({ runId: "processing-new" }, value, {
        ...source,
        validFrames: 4,
      }),
    ).toThrow("manifest is invalid");
  });

  test("rejects corrupt processed bytes", async () => {
    const deps = dependencies();
    deps.files.read = async (_tree, file) => {
      const original = file.endsWith("000000.pcm")
        ? inputFixture().first.buffer
        : inputFixture().second.buffer;
      const copy = original.slice(0);
      const bytes = new Uint8Array(copy);
      bytes[0] = bytes[0]! ^ 1;
      return copy;
    };
    const reader = await openCommittedProcessedPcmReader(deps);
    await expect(async () => {
      for await (const page of reader.pages(new AbortController().signal))
        void page;
    }).rejects.toThrow("integrity check");
  });

  test("stops if the source generation changes without changing its run id", async () => {
    const deps = dependencies();
    let reads = 0;
    deps.manifests.readInputManifest = async () => {
      const fixture = inputFixture().value;
      return reads++ < 2 ? fixture : { ...fixture, generation: 8 };
    };
    const reader = await openCommittedProcessedPcmReader(deps);
    await expect(async () => {
      for await (const page of reader.pages(new AbortController().signal))
        void page;
    }).rejects.toThrow("changed while it was being read");
  });

  test("stops if the processed generation is replaced under the same result id", async () => {
    const deps = dependencies();
    const readOriginal = deps.manifests.readProcessedManifest!;
    let reads = 0;
    deps.manifests.readProcessedManifest = async (resultId) => {
      const value = await readOriginal(resultId);
      return reads++ < 2 ? value : { ...(value as object), generation: 10 };
    };
    const reader = await openCommittedProcessedPcmReader(deps);
    await expect(async () => {
      for await (const page of reader.pages(new AbortController().signal))
        void page;
    }).rejects.toThrow("changed while it was being read");
  });

  test("rejects invalid processed totals and cancellation before page IO", async () => {
    const deps = dependencies();
    const value = await deps.manifests.readProcessedManifest!("processing-new");
    const source = validateInputManifest(
      inputFixture().pointer,
      inputFixture().value,
    );
    expect(() =>
      validateProcessedManifest(
        { runId: "processing-new" },
        { ...(value as object), totalFrames: 2 },
        source,
      ),
    ).toThrow("manifest is invalid");

    const reader = await openCommittedProcessedPcmReader(deps);
    const controller = new AbortController();
    controller.abort();
    await expect(async () => {
      for await (const page of reader.pages(controller.signal)) void page;
    }).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("I-012 committed PCM reader", () => {
  test("validates and streams exact planar views one page at a time", async () => {
    const deps = dependencies();
    const reader = await openCommittedPcmReader(deps);
    const pages = [];
    for await (const page of reader.pages(new AbortController().signal))
      pages.push(page);
    expect(reader.totalFrames).toBe(3);
    expect(pages.map((page) => [page.startFrame, page.validFrames])).toEqual([
      [0, 2],
      [2, 1],
    ]);
    expect([...pages[0]!.channels[0]]).toEqual([1, 2]);
    expect(Array.from(pages[0]!.channels[1]!)).toEqual([3, 4]);
  });

  test("rejects corrupt descriptors and inconsistent totals", () => {
    const fixture = inputFixture();
    expect(() =>
      validateInputManifest(fixture.pointer, {
        ...fixture.value,
        sampleRate: 44_100,
      }),
    ).toThrow("manifest is invalid");
    expect(() =>
      validateInputManifest(fixture.pointer, {
        ...fixture.value,
        pages: [
          { ...fixture.value.pages[0], index: 1 },
          fixture.value.pages[1],
        ],
      }),
    ).toThrow("ordered and contiguous");
    expect(() =>
      validateInputManifest(fixture.pointer, {
        ...fixture.value,
        validFrames: 4,
        targetFrames: 4,
        endFrameExclusive: 4,
        observedFrames: 4,
      }),
    ).toThrow("page totals");
  });

  test("rejects truncated and corrupt page bytes", async () => {
    const truncated = dependencies();
    truncated.files.read = async () => new ArrayBuffer(4);
    const reader = await openCommittedPcmReader(truncated);
    await expect(async () => {
      for await (const _page of reader.pages(new AbortController().signal))
        void _page;
    }).rejects.toThrow("invalid byte length");

    const corrupt = dependencies();
    corrupt.files.read = async (_tree, file) => {
      const original = file.endsWith("000000.pcm")
        ? inputFixture().first.buffer
        : inputFixture().second.buffer;
      const copy = original.slice(0);
      const bytes = new Uint8Array(copy);
      bytes[0] = (bytes[0] ?? 0) ^ 1;
      return copy;
    };
    const corruptReader = await openCommittedPcmReader(corrupt);
    await expect(async () => {
      for await (const _page of corruptReader.pages(
        new AbortController().signal,
      ))
        void _page;
    }).rejects.toThrow("integrity check");
  });

  test("stops when the committed source changes between pages", async () => {
    const deps = dependencies();
    let reads = 0;
    deps.manifests.readInputPointer = async () => ({
      runId: reads++ < 2 ? "i009-source" : "i009-replacement",
    });
    const reader = await openCommittedPcmReader(deps);
    await expect(async () => {
      for await (const _page of reader.pages(new AbortController().signal))
        void _page;
    }).rejects.toThrow("changed while processing");
  });
});

describe("I-012 transactional processed writer", () => {
  const source = (): CanonicalInputManifest =>
    validateInputManifest(inputFixture().pointer, inputFixture().value);
  const page = (startFrame: number, left: number[], right: number[]) => ({
    startFrame,
    validFrames: left.length,
    channels: [Float32Array.from(left), Float32Array.from(right)] as const,
  });

  test("publishes only a closed exact result, then collects its predecessor", async () => {
    const deps = dependencies();
    const writer = createTransactionalProcessedWriter(source(), 9, {
      dependencies: deps,
    });
    await writer.write(page(0, [1, 2], [3, 4]));
    expect(deps.commits).toHaveLength(0);
    await writer.write(page(2, [5], [6]));
    await writer.close();
    expect(deps.commits[0]).toMatchObject({
      resultId: "processing-new",
      totalFrames: 3,
      generation: 9,
    });
    expect(deps.written.size).toBe(2);
    expect(deps.removed).toContain("processing-old");
    expect(writer.committed()).toBe(deps.commits[0]);
  });

  test("rejects non-finite, gapped, and partial output without publication", async () => {
    for (const invalid of [page(0, [Number.NaN], [0]), page(1, [0], [0])]) {
      const deps = dependencies();
      const writer = createTransactionalProcessedWriter(source(), 9, {
        dependencies: deps,
      });
      await expect(writer.write(invalid)).rejects.toThrow();
      expect(deps.commits).toHaveLength(0);
    }
    const deps = dependencies();
    const writer = createTransactionalProcessedWriter(source(), 9, {
      dependencies: deps,
    });
    await writer.write(page(0, [0], [0]));
    await expect(writer.close()).rejects.toThrow("complete source timeline");
    expect(deps.commits).toHaveLength(0);
  });

  test("cancellation removes staging and preserves the committed result", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    const writer = createTransactionalProcessedWriter(source(), 9, {
      dependencies: deps,
      signal: controller.signal,
    });
    await writer.write(page(0, [1, 2], [3, 4]));
    controller.abort();
    await expect(writer.write(page(2, [5], [6]))).rejects.toMatchObject({
      name: "AbortError",
    });
    await writer.abort?.(controller.signal.reason);
    expect(deps.removed).toContain("processing-new");
    expect(deps.commits).toHaveLength(0);
    expect(deps.processedPointer.runId).toBe("processing-old");
  });

  test("stale atomic commit removes staging and cannot replace prior output", async () => {
    const deps = dependencies();
    deps.manifests.commitProcessed = async () => {
      throw new Error("Processed output publication was rejected as stale.");
    };
    const writer = createTransactionalProcessedWriter(source(), 9, {
      dependencies: deps,
    });
    await writer.write(page(0, [1, 2], [3, 4]));
    await writer.write(page(2, [5], [6]));
    await expect(writer.close()).rejects.toThrow("rejected as stale");
    expect(deps.removed).toContain("processing-new");
    expect(deps.processedPointer.runId).toBe("processing-old");
  });

  test("does not collect a predecessor that became current again", async () => {
    const deps = dependencies();
    deps.manifests.readProcessedPointer = async () => ({
      runId: "processing-old",
    });
    const writer = createTransactionalProcessedWriter(source(), 9, {
      dependencies: deps,
    });
    await writer.write(page(0, [1, 2], [3, 4]));
    await writer.write(page(2, [5], [6]));
    await writer.close();
    expect(deps.removed).not.toContain("processing-old");
  });
});
