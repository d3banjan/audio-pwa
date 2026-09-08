import { describe, expect, test, vi } from "vitest";
import {
  createPcm24WavHeader,
  encodePcm24Page,
  exportPcm24Wav,
  type SeekableByteSink,
} from "./processed-wav-export";

const text = (bytes: Uint8Array, start: number, length: number) =>
  new TextDecoder().decode(bytes.subarray(start, start + length));

describe("bounded PCM24 WAV export", () => {
  test("writes a canonical RIFF header", () => {
    const header = createPcm24WavHeader(48_000);
    const view = new DataView(header.buffer);
    expect(text(header, 0, 4)).toBe("RIFF");
    expect(text(header, 8, 4)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint32(40, true)).toBe(48_000 * 6);
  });

  test("interleaves stereo samples and rejects non-finite PCM", () => {
    const bytes = encodePcm24Page(
      [Float32Array.from([0, 1]), Float32Array.from([-1, 0.5])],
      2,
      () => 0.5,
    );
    expect([...bytes.slice(0, 6)]).toEqual([0, 0, 0, 1, 0, 128]);
    expect(() =>
      encodePcm24Page(
        [Float32Array.from([Number.NaN]), Float32Array.from([0])],
        1,
      ),
    ).toThrow("finite");
  });

  test("streams pages, patches the header, and closes exactly once", async () => {
    const writes: Uint8Array[] = [];
    const sink: SeekableByteSink = {
      write: vi.fn(async (bytes) => {
        writes.push(Uint8Array.from(bytes));
      }),
      seek: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    const result = await exportPcm24Wav(
      {
        sampleRate: 48_000,
        channelCount: 2,
        totalFrames: 2,
        async *pages() {
          yield {
            startFrame: 0,
            validFrames: 2,
            channels: [
              Float32Array.from([0, 0.25]),
              Float32Array.from([0, -0.25]),
            ],
          };
        },
      },
      sink,
      { random: () => 0.5 },
    );
    expect(result).toMatchObject({ frames: 2, bytes: 56, bitsPerSample: 24 });
    expect(writes.map((write) => write.byteLength)).toEqual([44, 12, 44]);
    expect(sink.seek).toHaveBeenCalledWith(0);
    expect(sink.close).toHaveBeenCalledOnce();
    expect(sink.abort).not.toHaveBeenCalled();
  });

  test("aborts the partial sink on a page gap", async () => {
    const sink: SeekableByteSink = {
      write: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    await expect(
      exportPcm24Wav(
        {
          sampleRate: 48_000,
          channelCount: 2,
          totalFrames: 1,
          async *pages() {
            yield {
              startFrame: 1,
              validFrames: 1,
              channels: [new Float32Array(1), new Float32Array(1)],
            };
          },
        },
        sink,
      ),
    ).rejects.toThrow("contiguous");
    expect(sink.abort).toHaveBeenCalledOnce();
  });

  test("aborts after cancellation during a completed page write", async () => {
    const controller = new AbortController();
    let writes = 0;
    const sink: SeekableByteSink = {
      write: vi.fn(async () => {
        writes += 1;
        if (writes === 2) controller.abort();
      }),
      seek: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    await expect(
      exportPcm24Wav(
        {
          sampleRate: 48_000,
          channelCount: 2,
          totalFrames: 2,
          async *pages() {
            yield {
              startFrame: 0,
              validFrames: 2,
              channels: [new Float32Array(2), new Float32Array(2)],
            };
          },
        },
        sink,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sink.abort).toHaveBeenCalledOnce();
    expect(sink.close).not.toHaveBeenCalled();
  });
});
