import type { EnrichmentPageReader } from "./chunk-enrichment";

const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 3;
const CHANNELS = 2;
const SAMPLE_RATE = 48_000;
const MAX_FRAMES = SAMPLE_RATE * 900;
const MAX_PAGE_FRAMES = SAMPLE_RATE * 5;

export interface SeekableByteSink {
  write(bytes: Uint8Array): Promise<void>;
  seek(position: number): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export type WavExportResult = Readonly<{
  frames: number;
  bytes: number;
  sampleRate: 48_000;
  channels: 2;
  bitsPerSample: 24;
}>;

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1)
    view.setUint8(offset + index, value.charCodeAt(index));
};

export const createPcm24WavHeader = (frames: number): Uint8Array => {
  if (!Number.isSafeInteger(frames) || frames <= 0 || frames > MAX_FRAMES)
    throw new RangeError("WAV frame count is outside the MVP limit.");
  const dataBytes = frames * CHANNELS * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, 24, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
};

const writeInt24 = (bytes: Uint8Array, offset: number, sample: number) => {
  const value = Math.max(-8_388_608, Math.min(8_388_607, sample));
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
};

/** Encodes one bounded planar page as interleaved PCM24 with TPDF dither. */
export const encodePcm24Page = (
  channels: readonly [Float32Array, Float32Array],
  validFrames: number,
  random: () => number = Math.random,
): Uint8Array => {
  if (
    !Number.isSafeInteger(validFrames) ||
    validFrames <= 0 ||
    validFrames > MAX_PAGE_FRAMES ||
    channels[0].length !== validFrames ||
    channels[1].length !== validFrames
  )
    throw new RangeError("WAV page must contain exact bounded stereo frames.");
  const bytes = new Uint8Array(validFrames * CHANNELS * BYTES_PER_SAMPLE);
  let offset = 0;
  for (let frame = 0; frame < validFrames; frame += 1) {
    for (let channel = 0; channel < CHANNELS; channel += 1) {
      const sample = channels[channel]![frame]!;
      if (!Number.isFinite(sample))
        throw new RangeError("WAV input samples must be finite.");
      const dither = random() - random();
      writeInt24(bytes, offset, Math.round(sample * 8_388_607 + dither));
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
};

/**
 * LEAKY ABSTRACTION: the MVP writes RIFF/WAV through a seekable browser file
 * sink. A future RF64 or native encoder must retain bounded pages, PCM24 TPDF
 * dither, exact timeline checks, cancellation, and failed-file cleanup.
 * [[Export and Metering]]
 */
export async function exportPcm24Wav(
  reader: EnrichmentPageReader,
  sink: SeekableByteSink,
  options: Readonly<{
    signal?: AbortSignal;
    random?: () => number;
    onProgress?: (completedFrames: number, totalFrames: number) => void;
  }> = {},
): Promise<WavExportResult> {
  if (
    reader.sampleRate !== SAMPLE_RATE ||
    reader.channelCount !== CHANNELS ||
    !Number.isSafeInteger(reader.totalFrames) ||
    reader.totalFrames <= 0 ||
    reader.totalFrames > MAX_FRAMES
  )
    throw new RangeError("WAV export requires bounded canonical stereo PCM.");
  const signal = options.signal ?? new AbortController().signal;
  let nextFrame = 0;
  try {
    await sink.write(new Uint8Array(WAV_HEADER_BYTES));
    if (signal.aborted)
      throw new DOMException("Export cancelled.", "AbortError");
    for await (const page of reader.pages(signal)) {
      if (signal.aborted)
        throw new DOMException("Export cancelled.", "AbortError");
      if (page.startFrame !== nextFrame)
        throw new RangeError("WAV input pages must be contiguous.");
      await sink.write(
        encodePcm24Page(
          page.channels,
          page.validFrames,
          options.random ?? Math.random,
        ),
      );
      if (signal.aborted)
        throw new DOMException("Export cancelled.", "AbortError");
      nextFrame += page.validFrames;
      if (nextFrame > reader.totalFrames)
        throw new RangeError("WAV pages exceed the declared timeline.");
      options.onProgress?.(nextFrame, reader.totalFrames);
    }
    if (nextFrame !== reader.totalFrames)
      throw new RangeError("WAV pages ended before the declared timeline.");
    if (signal.aborted)
      throw new DOMException("Export cancelled.", "AbortError");
    await sink.seek(0);
    await sink.write(createPcm24WavHeader(nextFrame));
    await sink.close();
    return Object.freeze({
      frames: nextFrame,
      bytes: WAV_HEADER_BYTES + nextFrame * CHANNELS * BYTES_PER_SAMPLE,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitsPerSample: 24,
    });
  } catch (cause) {
    await sink.abort(cause).catch(() => undefined);
    throw cause;
  }
}
