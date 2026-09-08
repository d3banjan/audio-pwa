/** Stateful, bounded canonical dialogue/bus enrichment for I-011. */

export const ENRICHMENT_SAMPLE_RATE = 48_000;
export const MAX_ENRICHMENT_FRAMES = ENRICHMENT_SAMPLE_RATE * 900;
export const MAX_PAGE_FRAMES = ENRICHMENT_SAMPLE_RATE * 5;
const LIMIT_LINEAR = 10 ** (-1 / 20);
const DEFAULT_COMPRESSOR_THRESHOLD_DB = -18;
const DEFAULT_COMPRESSOR_RATIO = 2;
const ATTACK_COEFFICIENT = 0.0033;
const RELEASE_COEFFICIENT = 0.000208;

export type EnrichmentChannels = readonly [Float32Array, Float32Array];

export type EnrichmentPcmPage = Readonly<{
  startFrame: number;
  validFrames: number;
  channels: EnrichmentChannels;
}>;

export interface EnrichmentPageReader {
  readonly sampleRate: 48_000;
  readonly totalFrames: number;
  readonly channelCount: 2;
  pages(signal: AbortSignal): AsyncIterable<EnrichmentPcmPage>;
}

export interface EnrichmentPageWriter {
  write(page: EnrichmentPcmPage): Promise<void>;
  close(): Promise<void>;
  abort?(reason: unknown): Promise<void>;
}

export type EnrichmentOptions = Readonly<{
  generation: number;
  signal?: AbortSignal;
  isGenerationCurrent?: (generation: number) => boolean;
  rumbleCut?: boolean;
  highpassFrequency?: number;
  highpassQ?: number;
  presenceDb?: number;
  presenceFrequency?: number;
  presenceQ?: number;
  width?: number;
  dialogueGain?: number;
  compressorThresholdDb?: number;
  compressorRatio?: number;
  onProgress?: (progress: EnrichmentProgress) => void;
}>;

export type EnrichmentProgress = Readonly<{
  generation: number;
  completedFrames: number;
  totalFrames: number;
  completedPages: number;
}>;

export type EnrichmentResult = Readonly<{
  schemaVersion: 1;
  generation: number;
  sampleRate: 48_000;
  totalFrames: number;
  pages: number;
}>;

export class StaleEnrichmentError extends Error {
  constructor() {
    super("Enrichment result belongs to a stale project generation.");
    this.name = "StaleEnrichmentError";
  }
}

const cancelled = () => new DOMException("Enrichment cancelled.", "AbortError");
const finiteInteger = (value: number, name: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
};
const finiteRange = (
  value: number,
  minimum: number,
  maximum: number,
  name: string,
) => {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
};
const stopIfNeeded = (
  signal: AbortSignal,
  generation: number,
  current?: (generation: number) => boolean,
) => {
  if (signal.aborted) throw cancelled();
  if (current && !current(generation)) throw new StaleEnrichmentError();
};

type Biquad = {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

const highPass = (frequency: number, q: number): Biquad => {
  const w = (2 * Math.PI * frequency) / ENRICHMENT_SAMPLE_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return {
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
    b0: (1 + c) / 2 / a0,
    b1: -(1 + c) / a0,
    b2: (1 + c) / 2 / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha) / a0,
  };
};

const presence = (db: number, frequency: number, q: number): Biquad => {
  const w = (2 * Math.PI * frequency) / ENRICHMENT_SAMPLE_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a = 10 ** (db / 40);
  const a0 = 1 + alpha / a;
  return {
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
    b0: (1 + alpha * a) / a0,
    b1: (-2 * c) / a0,
    b2: (1 - alpha * a) / a0,
    a1: (-2 * c) / a0,
    a2: (1 - alpha / a) / a0,
  };
};

const runBiquad = (filter: Biquad, input: number) => {
  const output =
    filter.b0 * input +
    filter.b1 * filter.x1 +
    filter.b2 * filter.x2 -
    filter.a1 * filter.y1 -
    filter.a2 * filter.y2;
  filter.x2 = filter.x1;
  filter.x1 = input;
  filter.y2 = filter.y1;
  filter.y1 = output;
  return output;
};

/**
 * LEAKY ABSTRACTION: JavaScript owns this bounded sample loop until a qualified
 * worker/WASM renderer exists; it caps pages at five seconds and preserves all
 * filter/dynamics state, which a replacement must retain. [[Implementation Package I-011 - Chunk Enrichment]]
 */
export async function enrichPcmPages(
  reader: EnrichmentPageReader,
  writer: EnrichmentPageWriter,
  options: EnrichmentOptions,
): Promise<EnrichmentResult> {
  if (reader.sampleRate !== ENRICHMENT_SAMPLE_RATE || reader.channelCount !== 2)
    throw new RangeError(
      "Enrichment input must be canonical 48 kHz stereo PCM",
    );
  finiteInteger(reader.totalFrames, "reader.totalFrames");
  if (reader.totalFrames > MAX_ENRICHMENT_FRAMES)
    throw new RangeError("Enrichment input exceeds the 900 second limit");
  finiteInteger(options.generation, "generation");
  const presenceDb = options.presenceDb ?? 2.5;
  const presenceFrequency = options.presenceFrequency ?? 3_500;
  const presenceQ = options.presenceQ ?? 0.8;
  const highpassFrequency = options.highpassFrequency ?? 80;
  const highpassQ = options.highpassQ ?? 0.707;
  const width = options.width ?? 1;
  const gain = options.dialogueGain ?? 1;
  const compressorThresholdDb =
    options.compressorThresholdDb ?? DEFAULT_COMPRESSOR_THRESHOLD_DB;
  const compressorRatio = options.compressorRatio ?? DEFAULT_COMPRESSOR_RATIO;
  finiteRange(presenceDb, -6, 6, "presenceDb");
  finiteRange(presenceFrequency, 2_000, 6_000, "presenceFrequency");
  finiteRange(presenceQ, 0.1, 10, "presenceQ");
  finiteRange(highpassFrequency, 40, 180, "highpassFrequency");
  finiteRange(highpassQ, 0.5, 2, "highpassQ");
  finiteRange(width, 0, 2, "width");
  finiteRange(gain, 0, 4, "dialogueGain");
  finiteRange(compressorThresholdDb, -60, 0, "compressorThresholdDb");
  finiteRange(compressorRatio, 1, 20, "compressorRatio");
  const signal = options.signal ?? new AbortController().signal;
  const filters = [
    highPass(highpassFrequency, highpassQ),
    highPass(highpassFrequency, highpassQ),
  ];
  const eq = [
    presence(presenceDb, presenceFrequency, presenceQ),
    presence(presenceDb, presenceFrequency, presenceQ),
  ];
  const compressorThreshold = 10 ** (compressorThresholdDb / 20);
  // One detector preserves the left/right relationship through gain reduction.
  let envelope = 0;
  let nextFrame = 0;
  let pages = 0;
  try {
    stopIfNeeded(signal, options.generation, options.isGenerationCurrent);
    for await (const page of reader.pages(signal)) {
      stopIfNeeded(signal, options.generation, options.isGenerationCurrent);
      finiteInteger(page.startFrame, "page.startFrame");
      finiteInteger(page.validFrames, "page.validFrames", 1);
      if (
        page.startFrame !== nextFrame ||
        page.validFrames > MAX_PAGE_FRAMES ||
        nextFrame + page.validFrames > reader.totalFrames
      )
        throw new RangeError("Enrichment pages must be contiguous and bounded");
      if (
        page.channels[0].length < page.validFrames ||
        page.channels[1].length < page.validFrames
      )
        throw new RangeError(
          "Enrichment page channels are shorter than validFrames",
        );
      if (
        page.channels[0].length > MAX_PAGE_FRAMES ||
        page.channels[1].length > MAX_PAGE_FRAMES
      )
        throw new RangeError(
          "Enrichment page allocation exceeds the five-second limit",
        );
      const left = new Float32Array(page.validFrames);
      const right = new Float32Array(page.validFrames);
      for (let i = 0; i < page.validFrames; i += 1) {
        let l = page.channels[0][i] ?? 0;
        let r = page.channels[1][i] ?? 0;
        if (!Number.isFinite(l) || !Number.isFinite(r))
          throw new RangeError("Enrichment PCM samples must be finite");
        if (options.rumbleCut !== false) {
          l = runBiquad(filters[0]!, l);
          r = runBiquad(filters[1]!, r);
        }
        l = runBiquad(eq[0]!, l);
        r = runBiquad(eq[1]!, r);
        const m = (l + r) * 0.5;
        const s = (l - r) * 0.5;
        l = (m + width * s) * gain;
        r = (m - width * s) * gain;
        const level = Math.max(Math.abs(l), Math.abs(r));
        const coefficient =
          level > envelope ? ATTACK_COEFFICIENT : RELEASE_COEFFICIENT;
        envelope += coefficient * (level - envelope);
        const compressedEnvelope =
          envelope > compressorThreshold
            ? compressorThreshold +
              (envelope - compressorThreshold) / compressorRatio
            : envelope;
        const compressorGain =
          envelope > 0 ? Math.min(1, compressedEnvelope / envelope) : 1;
        left[i] = Math.max(
          -LIMIT_LINEAR,
          Math.min(LIMIT_LINEAR, l * compressorGain),
        );
        right[i] = Math.max(
          -LIMIT_LINEAR,
          Math.min(LIMIT_LINEAR, r * compressorGain),
        );
      }
      stopIfNeeded(signal, options.generation, options.isGenerationCurrent);
      await writer.write(
        Object.freeze({
          startFrame: page.startFrame,
          validFrames: page.validFrames,
          channels: [left, right] as const,
        }),
      );
      stopIfNeeded(signal, options.generation, options.isGenerationCurrent);
      nextFrame += page.validFrames;
      pages += 1;
      options.onProgress?.(
        Object.freeze({
          generation: options.generation,
          completedFrames: nextFrame,
          totalFrames: reader.totalFrames,
          completedPages: pages,
        }),
      );
    }
    if (nextFrame !== reader.totalFrames)
      throw new RangeError("Enrichment pages ended before totalFrames");
    stopIfNeeded(signal, options.generation, options.isGenerationCurrent);
    await writer.close();
    stopIfNeeded(signal, options.generation, options.isGenerationCurrent);
    return Object.freeze({
      schemaVersion: 1,
      generation: options.generation,
      sampleRate: ENRICHMENT_SAMPLE_RATE,
      totalFrames: nextFrame,
      pages,
    });
  } catch (error) {
    try {
      await writer.abort?.(error);
    } catch {
      // Preserve the processing failure; cleanup failure is adapter diagnostics.
    }
    throw error;
  }
}
