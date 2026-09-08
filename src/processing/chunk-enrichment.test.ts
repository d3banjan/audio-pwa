import { describe, expect, test, vi } from "vitest";
import {
  enrichPcmPages,
  MAX_PAGE_FRAMES,
  type EnrichmentPageReader,
  type EnrichmentPageWriter,
  type EnrichmentPcmPage,
} from "./chunk-enrichment";

const readerFor = (
  pages: readonly EnrichmentPcmPage[],
  totalFrames = pages.reduce((sum, page) => sum + page.validFrames, 0),
): EnrichmentPageReader => ({
  sampleRate: 48_000,
  channelCount: 2,
  totalFrames,
  async *pages() {
    yield* pages;
  },
});

const page = (
  startFrame: number,
  left: readonly number[],
  right = left,
): EnrichmentPcmPage => ({
  startFrame,
  validFrames: left.length,
  channels: [Float32Array.from(left), Float32Array.from(right)],
});

const writerFor = () => {
  const written: EnrichmentPcmPage[] = [];
  const writer: EnrichmentPageWriter = {
    write: vi.fn(async (value) => {
      written.push(value);
    }),
    close: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  };
  return { writer, written };
};

describe("bounded chunk enrichment", () => {
  test("preserves page boundaries and filter state across pages", async () => {
    const { writer, written } = writerFor();
    const result = await enrichPcmPages(
      readerFor([page(0, [1, 0, 0]), page(3, [0, 0, 0])]),
      writer,
      { generation: 4 },
    );
    expect(result).toMatchObject({ generation: 4, totalFrames: 6, pages: 2 });
    expect(written.map((item) => [item.startFrame, item.validFrames])).toEqual([
      [0, 3],
      [3, 3],
    ]);
    expect(written[0]?.channels[0][0]).toBeLessThan(1);
    expect(written[1]?.channels[0].some((value) => value !== 0)).toBe(true);
  });

  test("reports progress only after each committed page", async () => {
    const progress: number[] = [];
    const { writer } = writerFor();
    await enrichPcmPages(
      readerFor([page(0, [0, 0]), page(2, [0, 0])]),
      writer,
      {
        generation: 2,
        onProgress: (value) => progress.push(value.completedFrames),
      },
    );
    expect(progress).toEqual([2, 4]);
    expect(writer.close).toHaveBeenCalledOnce();
  });

  test("keeps symmetric input symmetric through dynamics", async () => {
    const { writer, written } = writerFor();
    await enrichPcmPages(
      readerFor([page(0, [1, -1, 1, -1], [1, -1, 1, -1])]),
      writer,
      { generation: 8, rumbleCut: false, presenceDb: 0 },
    );
    const output = written[0]?.channels[0];
    expect(output?.[0]).toBeCloseTo(-(output?.[1] ?? 0), 6);
    expect(output?.[2]).toBeCloseTo(-(output?.[3] ?? 0), 6);
  });

  test("never boosts a quiet sample while the compressor envelope releases", async () => {
    const loud = new Array(2_000).fill(1);
    const quiet = 0.01;
    const { writer, written } = writerFor();
    await enrichPcmPages(readerFor([page(0, [...loud, quiet])]), writer, {
      generation: 8,
      rumbleCut: false,
      presenceDb: 0,
    });
    expect(Math.abs(written[0]!.channels[0][2_000]!)).toBeLessThanOrEqual(
      quiet,
    );
  });

  test("uses linked stereo gain reduction", async () => {
    const { writer, written } = writerFor();
    await enrichPcmPages(
      readerFor([
        page(0, new Array(2_000).fill(1), new Array(2_000).fill(0.1)),
      ]),
      writer,
      { generation: 8, rumbleCut: false, presenceDb: 0 },
    );
    const output = written[0]!;
    expect(output.channels[0][1_999]! / output.channels[1][1_999]!).toBeCloseTo(
      10,
      4,
    );
  });

  test("cancels before a write and aborts the writer", async () => {
    const controller = new AbortController();
    const { writer } = writerFor();
    controller.abort();
    await expect(
      enrichPcmPages(readerFor([page(0, [0])]), writer, {
        generation: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(writer.write).not.toHaveBeenCalled();
    expect(writer.abort).toHaveBeenCalledOnce();
    expect(writer.close).not.toHaveBeenCalled();
  });

  test("rejects a stale generation after page processing", async () => {
    const { writer } = writerFor();
    await expect(
      enrichPcmPages(readerFor([page(0, [0])]), writer, {
        generation: 3,
        isGenerationCurrent: () => false,
      }),
    ).rejects.toMatchObject({ name: "StaleEnrichmentError" });
    expect(writer.write).not.toHaveBeenCalled();
    expect(writer.abort).toHaveBeenCalledOnce();
  });

  test("rejects a generation that becomes stale while the writer closes", async () => {
    let current = true;
    const { writer } = writerFor();
    writer.close = vi.fn(async () => {
      current = false;
    });
    await expect(
      enrichPcmPages(readerFor([page(0, [0])]), writer, {
        generation: 3,
        isGenerationCurrent: () => current,
      }),
    ).rejects.toMatchObject({ name: "StaleEnrichmentError" });
    expect(writer.abort).toHaveBeenCalledOnce();
  });

  test("rejects gaps, oversized pages, and an early EOF", async () => {
    const { writer: gapWriter } = writerFor();
    await expect(
      enrichPcmPages(readerFor([page(1, [0])]), gapWriter, { generation: 1 }),
    ).rejects.toThrow(/contiguous/);
    const { writer: largeWriter } = writerFor();
    await expect(
      enrichPcmPages(
        readerFor([page(0, new Array(MAX_PAGE_FRAMES + 1).fill(0))]),
        largeWriter,
        { generation: 1 },
      ),
    ).rejects.toThrow(/bounded/);
    const { writer: eofWriter } = writerFor();
    await expect(
      enrichPcmPages(readerFor([page(0, [0])], 2), eofWriter, {
        generation: 1,
      }),
    ).rejects.toThrow(/ended/);

    const oversizedAllocation = new Float32Array(MAX_PAGE_FRAMES + 1);
    const { writer: allocationWriter } = writerFor();
    await expect(
      enrichPcmPages(
        readerFor([
          {
            startFrame: 0,
            validFrames: 1,
            channels: [oversizedAllocation, oversizedAllocation],
          },
        ]),
        allocationWriter,
        { generation: 1 },
      ),
    ).rejects.toThrow(/allocation/);
  });

  test("rejects non-finite PCM before it poisons persistent filter state", async () => {
    const { writer } = writerFor();
    await expect(
      enrichPcmPages(readerFor([page(0, [Number.NaN])]), writer, {
        generation: 1,
      }),
    ).rejects.toThrow(/finite/);
    expect(writer.write).not.toHaveBeenCalled();
    expect(writer.abort).toHaveBeenCalledOnce();
  });

  test("enforces canonical stereo input", async () => {
    const { writer } = writerFor();
    await expect(
      enrichPcmPages(
        { ...readerFor([]), sampleRate: 44_100 as 48_000 },
        writer,
        { generation: 1 },
      ),
    ).rejects.toThrow(/48 kHz stereo/);
  });
});
