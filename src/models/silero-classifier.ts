export const SILERO_CANONICAL_WINDOW_FRAMES = 1_536;
export const SILERO_MODEL_FRAME_SAMPLES = 512;
export const SILERO_CONTEXT_SAMPLES = 64;
export const SILERO_STATE_VALUES = 2 * 1 * 128;
export const SILERO_RESAMPLER_DELAY_CANONICAL_FRAMES = 31;

export interface TensorValue {
  readonly type: string;
  readonly dims: readonly number[];
  readonly data: Float32Array | BigInt64Array;
}

export interface SileroSession {
  run(
    feeds: Readonly<Record<string, TensorValue>>,
  ): Promise<Readonly<Record<string, TensorValue>>>;
  release(): Promise<void> | void;
}

export interface SileroTensorFactory {
  float32(data: Float32Array, dims: readonly number[]): TensorValue;
  int64(data: BigInt64Array, dims: readonly number[]): TensorValue;
}

export interface SileroClassification {
  readonly generation: number;
  readonly canonicalStartFrame: number;
  readonly canonicalEndFrame: number;
  readonly probability: number;
}

export class SileroClassifierError extends Error {
  constructor(
    readonly code:
      | "wrong-window-size"
      | "stale-generation"
      | "cancelled"
      | "busy"
      | "disposed"
      | "invalid-output",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SileroClassifierError";
  }
}

/**
 * Causal 63-tap Hamming-windowed sinc decimator. The fixed 3:1 ratio and a
 * 1,536-frame input keep the output at exactly 512 model samples per call.
 */
export class Stateful48To16kDecimator {
  private history = new Float32Array(62);
  private readonly coefficients = makeLowPassCoefficients();

  preview(input: Float32Array): {
    readonly output: Float32Array;
    readonly nextHistory: Float32Array;
  } {
    if (input.length !== SILERO_CANONICAL_WINDOW_FRAMES) {
      throw new SileroClassifierError(
        "wrong-window-size",
        `Silero requires exactly ${SILERO_CANONICAL_WINDOW_FRAMES} canonical frames.`,
      );
    }
    const extended = new Float32Array(this.history.length + input.length);
    extended.set(this.history);
    extended.set(input, this.history.length);
    const output = new Float32Array(SILERO_MODEL_FRAME_SAMPLES);
    for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
      const newest = this.history.length + outputIndex * 3;
      let sample = 0;
      for (let tap = 0; tap < this.coefficients.length; tap += 1) {
        sample += this.coefficients[tap]! * extended[newest - tap]!;
      }
      output[outputIndex] = sample;
    }
    return {
      output,
      nextHistory: extended.slice(extended.length - this.history.length),
    };
  }

  commit(nextHistory: Float32Array): void {
    if (nextHistory.length !== this.history.length) {
      throw new Error("Invalid decimator history length.");
    }
    this.history.set(nextHistory);
  }

  reset(): void {
    this.history.fill(0);
  }
}

export class StatefulSileroClassifier {
  private readonly decimator = new Stateful48To16kDecimator();
  private context = new Float32Array(SILERO_CONTEXT_SAMPLES);
  private state = new Float32Array(SILERO_STATE_VALUES);
  private busy = false;
  private disposed = false;

  constructor(
    private readonly session: SileroSession,
    private readonly tensors: SileroTensorFactory,
    private generation: number,
  ) {}

  async classify(options: {
    readonly mono48k: Float32Array;
    readonly canonicalStartFrame: number;
    readonly generation: number;
    readonly signal?: AbortSignal;
  }): Promise<SileroClassification> {
    if (this.disposed) {
      throw new SileroClassifierError(
        "disposed",
        "The classifier is disposed.",
      );
    }
    if (this.busy) {
      throw new SileroClassifierError(
        "busy",
        "Stateful Silero windows must be classified sequentially.",
      );
    }
    this.assertCurrent(options.generation, options.signal);
    if (
      !Number.isSafeInteger(options.canonicalStartFrame) ||
      options.canonicalStartFrame < 0
    ) {
      throw new RangeError(
        "canonicalStartFrame must be a non-negative safe integer.",
      );
    }

    const resampled = this.decimator.preview(options.mono48k);
    const modelInput = new Float32Array(
      SILERO_CONTEXT_SAMPLES + SILERO_MODEL_FRAME_SAMPLES,
    );
    modelInput.set(this.context);
    modelInput.set(resampled.output, SILERO_CONTEXT_SAMPLES);
    const stateInput = this.state.slice();

    this.busy = true;
    try {
      const outputs = await this.session.run({
        input: this.tensors.float32(modelInput, [1, modelInput.length]),
        state: this.tensors.float32(stateInput, [2, 1, 128]),
        sr: this.tensors.int64(new BigInt64Array([16_000n]), []),
      });
      this.assertCurrent(options.generation, options.signal);
      const probability = readProbability(outputs["output"]);
      const nextState = readState(outputs["stateN"]);

      this.decimator.commit(resampled.nextHistory);
      this.context = resampled.output.slice(-SILERO_CONTEXT_SAMPLES);
      this.state = nextState.slice();
      return {
        generation: options.generation,
        canonicalStartFrame: options.canonicalStartFrame,
        canonicalEndFrame:
          options.canonicalStartFrame + SILERO_CANONICAL_WINDOW_FRAMES,
        probability,
      };
    } finally {
      this.busy = false;
    }
  }

  reset(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new RangeError("generation must be a non-negative safe integer.");
    }
    if (this.busy) {
      throw new SileroClassifierError(
        "busy",
        "Cannot reset while a classifier call is running.",
      );
    }
    this.generation = generation;
    this.decimator.reset();
    this.context.fill(0);
    this.state.fill(0);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    if (this.busy) {
      throw new SileroClassifierError(
        "busy",
        "Wait for the current classifier call before disposal.",
      );
    }
    this.disposed = true;
    this.context.fill(0);
    this.state.fill(0);
    this.decimator.reset();
    await this.session.release();
  }

  private assertCurrent(generation: number, signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new SileroClassifierError(
        "cancelled",
        "Classification was cancelled.",
      );
    }
    if (generation !== this.generation) {
      throw new SileroClassifierError(
        "stale-generation",
        "The classifier result belongs to an obsolete project generation.",
      );
    }
  }
}

function readProbability(value: TensorValue | undefined): number {
  if (
    value?.type !== "float32" ||
    !sameShape(value.dims, [1, 1]) ||
    !(value.data instanceof Float32Array) ||
    value.data.length !== 1
  ) {
    throw new SileroClassifierError(
      "invalid-output",
      "Silero returned an invalid probability tensor.",
    );
  }
  const probability = value.data[0]!;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new SileroClassifierError(
      "invalid-output",
      "Silero returned a non-finite or out-of-range probability.",
    );
  }
  return probability;
}

function readState(value: TensorValue | undefined): Float32Array {
  if (
    value?.type !== "float32" ||
    !sameShape(value.dims, [2, 1, 128]) ||
    !(value.data instanceof Float32Array) ||
    value.data.length !== SILERO_STATE_VALUES ||
    value.data.some((sample) => !Number.isFinite(sample))
  ) {
    throw new SileroClassifierError(
      "invalid-output",
      "Silero returned an invalid recurrent state tensor.",
    );
  }
  return value.data;
}

function sameShape(
  actual: readonly number[],
  expected: readonly number[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((dimension, index) => dimension === expected[index])
  );
}

function makeLowPassCoefficients(): Float64Array {
  const taps = 63;
  const midpoint = (taps - 1) / 2;
  const cutoffCyclesPerInputSample = 0.15;
  const coefficients = new Float64Array(taps);
  let sum = 0;
  for (let index = 0; index < taps; index += 1) {
    const offset = index - midpoint;
    const ideal =
      offset === 0
        ? 2 * cutoffCyclesPerInputSample
        : Math.sin(2 * Math.PI * cutoffCyclesPerInputSample * offset) /
          (Math.PI * offset);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (taps - 1));
    const coefficient = ideal * hamming;
    coefficients[index] = coefficient;
    sum += coefficient;
  }
  for (let index = 0; index < taps; index += 1) {
    coefficients[index] = coefficients[index]! / sum;
  }
  return coefficients;
}
