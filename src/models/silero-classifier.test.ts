import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import {
  SILERO_CANONICAL_WINDOW_FRAMES,
  SILERO_CONTEXT_SAMPLES,
  SILERO_STATE_VALUES,
  Stateful48To16kDecimator,
  StatefulSileroClassifier,
  type SileroSession,
  type SileroTensorFactory,
  type TensorValue,
} from "./silero-classifier";
import { loadVerifiedSileroArtifact } from "./silero-local-runtime";

const tensors: SileroTensorFactory = {
  float32: (data, dims) => ({ type: "float32", data, dims }),
  int64: (data, dims) => ({ type: "int64", data, dims }),
};

describe("stateful 48 to 16 kHz boundary", () => {
  test("returns exactly 512 samples and carries filter history", () => {
    const decimator = new Stateful48To16kDecimator();
    const first = decimator.preview(sine(997, 0));
    decimator.commit(first.nextHistory);
    const second = decimator.preview(sine(997, SILERO_CANONICAL_WINDOW_FRAMES));
    const reset = new Stateful48To16kDecimator().preview(
      sine(997, SILERO_CANONICAL_WINDOW_FRAMES),
    );
    expect(first.output).toHaveLength(512);
    expect(second.output).toHaveLength(512);
    expect(second.output.slice(0, 20)).not.toEqual(reset.output.slice(0, 20));
  });

  test("attenuates energy above the output Nyquist band", () => {
    const low = decimatedRms(1_000);
    const high = decimatedRms(12_000);
    expect(low).toBeGreaterThan(0.6);
    expect(high).toBeLessThan(low * 0.03);
  });
});

describe("stateful Silero classifier", () => {
  test("passes exact tensors, carries state/context, and maps half-open windows", async () => {
    const feeds: Readonly<Record<string, TensorValue>>[] = [];
    const carriedState = new Float32Array(SILERO_STATE_VALUES).fill(0.25);
    const session = fakeSession(async (input) => {
      feeds.push(input);
      return outputs(feeds.length === 1 ? 0.25 : 0.75, carriedState);
    });
    const classifier = new StatefulSileroClassifier(session, tensors, 7);
    const first = await classifier.classify({
      mono48k: sine(440, 0),
      canonicalStartFrame: 3_072,
      generation: 7,
    });
    await classifier.classify({
      mono48k: sine(440, SILERO_CANONICAL_WINDOW_FRAMES),
      canonicalStartFrame: 4_608,
      generation: 7,
    });

    expect(first).toEqual({
      generation: 7,
      canonicalStartFrame: 3_072,
      canonicalEndFrame: 4_608,
      probability: 0.25,
    });
    expect(feeds[0]?.["input"]?.dims).toEqual([1, 576]);
    expect(feeds[0]?.["state"]?.dims).toEqual([2, 1, 128]);
    expect(feeds[0]?.["sr"]?.data).toEqual(new BigInt64Array([16_000n]));
    expect(feeds[1]?.["state"]?.data).toEqual(carriedState);
    const firstInput = feeds[0]?.["input"]?.data as Float32Array;
    const secondInput = feeds[1]?.["input"]?.data as Float32Array;
    expect(secondInput.slice(0, SILERO_CONTEXT_SAMPLES)).toEqual(
      firstInput.slice(-SILERO_CONTEXT_SAMPLES),
    );
  });

  test("does not commit state when cancelled during inference", async () => {
    const controller = new AbortController();
    const feeds: Readonly<Record<string, TensorValue>>[] = [];
    const session = fakeSession(async (input) => {
      feeds.push(input);
      if (feeds.length === 1) controller.abort();
      return outputs(0.5, new Float32Array(SILERO_STATE_VALUES).fill(1));
    });
    const classifier = new StatefulSileroClassifier(session, tensors, 2);
    await expect(
      classifier.classify({
        mono48k: sine(440, 0),
        canonicalStartFrame: 0,
        generation: 2,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    await classifier.classify({
      mono48k: sine(440, 0),
      canonicalStartFrame: 0,
      generation: 2,
    });
    expect(feeds[1]?.["input"]?.data).toEqual(feeds[0]?.["input"]?.data);
    expect(feeds[1]?.["state"]?.data).toEqual(
      new Float32Array(SILERO_STATE_VALUES),
    );
  });

  test("rejects stale generation and invalid probability, then disposes once", async () => {
    const session = fakeSession(async () =>
      outputs(Number.NaN, new Float32Array(SILERO_STATE_VALUES)),
    );
    const classifier = new StatefulSileroClassifier(session, tensors, 3);
    await expect(classifyZeros(classifier, 4)).rejects.toMatchObject({
      code: "stale-generation",
    });
    await expect(classifyZeros(classifier, 3)).rejects.toMatchObject({
      code: "invalid-output",
    });
    await classifier.dispose();
    await classifier.dispose();
    expect(session.release).toHaveBeenCalledTimes(1);
  });
});

describe("local model admission", () => {
  test("accepts the tracked artifact after exact SHA-256 verification", async () => {
    const bytes = await readFile(
      new URL(
        "../../public/models/silero-vad-v6.2.1/silero_vad_16k_op15.onnx",
        import.meta.url,
      ),
    );
    const loaded = await loadVerifiedSileroArtifact({
      baseUrl: "https://local.invalid/audio-pwa/",
      fetch: async () => new Response(bytes),
      crypto: webcrypto as unknown as Crypto,
    });
    expect(loaded.byteLength).toBe(1_289_603);
  });

  test("ignores compressed transfer Content-Length and verifies decoded bytes", async () => {
    const bytes = await readFile(
      new URL(
        "../../public/models/silero-vad-v6.2.1/silero_vad_16k_op15.onnx",
        import.meta.url,
      ),
    );
    const loaded = await loadVerifiedSileroArtifact({
      baseUrl: "https://local.invalid/audio-pwa/",
      fetch: async () =>
        new Response(bytes, { headers: { "content-length": "398271" } }),
      crypto: webcrypto as unknown as Crypto,
    });
    expect(loaded.byteLength).toBe(1_289_603);
  });

  test("rejects the wrong byte length before session creation", async () => {
    await expect(
      loadVerifiedSileroArtifact({
        baseUrl: "https://local.invalid/",
        fetch: async () => new Response(new Uint8Array([1, 2, 3])),
        crypto: webcrypto as unknown as Crypto,
      }),
    ).rejects.toMatchObject({ code: "size-mismatch" });
  });
});

function fakeSession(
  run: SileroSession["run"],
): SileroSession & { release: ReturnType<typeof vi.fn> } {
  return { run, release: vi.fn(async () => undefined) };
}

function outputs(probability: number, state: Float32Array) {
  return {
    output: {
      type: "float32",
      dims: [1, 1],
      data: new Float32Array([probability]),
    },
    stateN: { type: "float32", dims: [2, 1, 128], data: state },
  };
}

function sine(frequency: number, start: number): Float32Array {
  return Float32Array.from(
    { length: SILERO_CANONICAL_WINDOW_FRAMES },
    (_, index) =>
      Math.sin((2 * Math.PI * frequency * (start + index)) / 48_000),
  );
}

function decimatedRms(frequency: number): number {
  const decimator = new Stateful48To16kDecimator();
  const first = decimator.preview(sine(frequency, 0));
  decimator.commit(first.nextHistory);
  const output = decimator.preview(
    sine(frequency, SILERO_CANONICAL_WINDOW_FRAMES),
  ).output;
  return Math.sqrt(
    output.reduce((sum, value) => sum + value * value, 0) / output.length,
  );
}

function classifyZeros(
  classifier: StatefulSileroClassifier,
  generation: number,
) {
  return classifier.classify({
    mono48k: new Float32Array(SILERO_CANONICAL_WINDOW_FRAMES),
    canonicalStartFrame: 0,
    generation,
  });
}
