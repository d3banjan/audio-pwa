import type * as Ort from "onnxruntime-web";
import wasmAssetUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { CURATED_MODEL_CATALOG } from "./model-catalog";
import {
  StatefulSileroClassifier,
  type SileroSession,
  type SileroTensorFactory,
  type TensorValue,
} from "./silero-classifier";

const MANIFEST = CURATED_MODEL_CATALOG.find(
  (entry) => entry.id === "silero-vad-v6.2.1-16k-op15",
)!;
const MODEL_PATH = "models/silero-vad-v6.2.1/silero_vad_16k_op15.onnx";

export class ModelAssetError extends Error {
  constructor(
    readonly code:
      | "download-failed"
      | "size-mismatch"
      | "checksum-mismatch"
      | "crypto-unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelAssetError";
  }
}

export async function loadVerifiedSileroArtifact(options: {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly crypto?: Crypto;
  readonly signal?: AbortSignal;
}): Promise<Uint8Array> {
  const fetcher = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetcher(new URL(MODEL_PATH, options.baseUrl), {
      cache: "force-cache",
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (cause) {
    throw new ModelAssetError(
      "download-failed",
      "The locally installed Silero model could not be read.",
      { cause },
    );
  }
  if (!response.ok) {
    throw new ModelAssetError(
      "download-failed",
      `The locally installed Silero model returned HTTP ${response.status}.`,
    );
  }
  const contentLength = response.headers.get("content-length");
  const declaredBytes = contentLength === null ? null : Number(contentLength);
  if (
    declaredBytes !== null &&
    Number.isFinite(declaredBytes) &&
    declaredBytes !== MANIFEST.artifactBytes
  ) {
    throw new ModelAssetError(
      "size-mismatch",
      "The installed Silero model has the wrong byte length.",
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== MANIFEST.artifactBytes) {
    throw new ModelAssetError(
      "size-mismatch",
      "The installed Silero model has the wrong byte length.",
    );
  }
  const crypto = options.crypto ?? globalThis.crypto;
  if (!crypto?.subtle) {
    throw new ModelAssetError(
      "crypto-unavailable",
      "Web Crypto is required to verify the installed Silero model.",
    );
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actualHash = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actualHash !== MANIFEST.artifactSha256) {
    bytes.fill(0);
    throw new ModelAssetError(
      "checksum-mismatch",
      "The installed Silero model failed its integrity check.",
    );
  }
  return bytes;
}

export async function createLocalSileroClassifier(options: {
  readonly baseUrl: string;
  readonly generation: number;
  readonly signal?: AbortSignal;
}): Promise<StatefulSileroClassifier> {
  const artifact = await loadVerifiedSileroArtifact({
    baseUrl: options.baseUrl,
    signal: options.signal,
  });
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = {
    wasm: wasmAssetUrl,
  };
  let session: Ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(artifact, {
      executionProviders: ["wasm"],
      interOpNumThreads: 1,
      intraOpNumThreads: 1,
      graphOptimizationLevel: "all",
    });
  } finally {
    artifact.fill(0);
  }
  return new StatefulSileroClassifier(
    wrapSession(session),
    tensorFactory(ort),
    options.generation,
  );
}

function wrapSession(session: Ort.InferenceSession): SileroSession {
  return {
    async run(feeds) {
      return (await session.run(
        feeds as Ort.InferenceSession.FeedsType,
      )) as unknown as Readonly<Record<string, TensorValue>>;
    },
    release: () => session.release(),
  };
}

function tensorFactory(ort: typeof Ort): SileroTensorFactory {
  return {
    float32: (data, dims) => new ort.Tensor("float32", data, [...dims]),
    int64: (data, dims) => new ort.Tensor("int64", data, [...dims]),
  };
}
