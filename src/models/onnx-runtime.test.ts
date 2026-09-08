import { describe, expect, test, vi } from "vitest";
import { CURATED_MODEL_CATALOG } from "./model-catalog";
import {
  createLazyRuntimeLoader,
  ModelRuntimeError,
  openModelSession,
  type OnnxRuntime,
  type OnnxSession,
} from "./onnx-runtime";

const manifest = CURATED_MODEL_CATALOG[0]!;
const artifact = new Uint8Array([1, 2, 3]);

describe("lazy ONNX runtime seam", () => {
  test("does not load runtime code until explicitly invoked and memoizes the import", async () => {
    const runtime = fakeRuntime(async () => fakeSession());
    const importer = vi.fn(async () => runtime);
    const load = createLazyRuntimeLoader(importer);

    expect(importer).not.toHaveBeenCalled();
    await Promise.all([load(), load()]);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  test("falls back from WebGPU creation failure to WASM", async () => {
    const created: string[] = [];
    const wasmSession = fakeSession();
    const runtime = fakeRuntime(async (_artifact, options) => {
      const provider = options.executionProviders[0]!;
      created.push(provider);
      if (provider === "webgpu") throw new Error("unsupported operator: STFT");
      return wasmSession;
    });

    const result = await openModelSession({
      manifest,
      artifact,
      loadRuntime: async () => runtime,
      probe: async () => undefined,
    });

    expect(created).toEqual(["webgpu", "wasm"]);
    expect(result.provider).toBe("wasm");
    expect(result.failedAttempts).toEqual([
      {
        provider: "webgpu",
        stage: "session-create",
        code: "session-create-failed",
        message: "unsupported operator: STFT",
      },
    ]);
  });

  test("releases a session whose valid-shape probe fails before fallback", async () => {
    const webgpu = fakeSession();
    const wasm = fakeSession();
    const runtime = fakeRuntime(async (_artifact, options) =>
      options.executionProviders[0] === "webgpu" ? webgpu : wasm,
    );

    const result = await openModelSession({
      manifest,
      artifact,
      loadRuntime: async () => runtime,
      probe: async ({ provider }) => {
        if (provider === "webgpu") throw new Error("wrong reference output");
      },
    });

    expect(webgpu.release).toHaveBeenCalledTimes(1);
    expect(wasm.release).not.toHaveBeenCalled();
    expect(result.provider).toBe("wasm");
    expect(result.failedAttempts[0]?.stage).toBe("valid-shape-probe");
  });

  test("returns truthful structured failures when no provider passes", async () => {
    const runtime = fakeRuntime(async () => {
      throw new Error("backend unavailable");
    });

    await expect(
      openModelSession({
        manifest,
        artifact,
        loadRuntime: async () => runtime,
        probe: async () => undefined,
      }),
    ).rejects.toMatchObject({
      name: "ModelRuntimeError",
      code: "no-provider-qualified",
      attempts: [
        { provider: "webgpu", stage: "session-create" },
        { provider: "wasm", stage: "session-create" },
      ],
    });
  });

  test("fails closed when a failed probe cannot release its session", async () => {
    const webgpu = fakeSession();
    webgpu.release.mockRejectedValueOnce(new Error("release failed"));
    const wasmCreate = vi.fn(async () => fakeSession());
    const runtime = fakeRuntime(async (_artifact, options) => {
      if (options.executionProviders[0] === "wasm") return wasmCreate();
      return webgpu;
    });

    await expect(
      openModelSession({
        manifest,
        artifact,
        loadRuntime: async () => runtime,
        probe: async () => {
          throw new Error("wrong reference output");
        },
      }),
    ).rejects.toMatchObject({
      name: "ModelRuntimeError",
      code: "session-release-failed",
      attempts: [
        { provider: "webgpu", stage: "valid-shape-probe" },
        {
          provider: "webgpu",
          stage: "session-release",
          code: "session-release-failed",
          message: "release failed",
        },
      ],
    });
    expect(wasmCreate).not.toHaveBeenCalled();
  });

  test("distinguishes missing runtime assets and empty model bytes", async () => {
    await expect(
      openModelSession({
        manifest,
        artifact: new Uint8Array(),
        loadRuntime: async () => {
          throw new Error("must not load");
        },
        probe: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "artifact-empty", attempts: [] });

    try {
      await openModelSession({
        manifest,
        artifact,
        loadRuntime: async () => {
          throw new Error("asset absent");
        },
        probe: async () => undefined,
      });
      throw new Error("Expected runtime loading to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRuntimeError);
      expect(error).toMatchObject({
        code: "runtime-load-failed",
        attempts: [],
      });
      expect((error as Error).message).not.toContain("asset absent");
    }
  });
});

function fakeSession(): OnnxSession & { release: ReturnType<typeof vi.fn> } {
  return { release: vi.fn(async () => undefined) };
}

function fakeRuntime(
  create: OnnxRuntime["InferenceSession"]["create"],
): OnnxRuntime {
  return { InferenceSession: { create } };
}
