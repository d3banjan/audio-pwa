import type { CuratedModelManifest, ExecutionProvider } from "./model-catalog";

export interface OnnxSession {
  release(): Promise<void> | void;
}

export interface OnnxRuntime {
  readonly InferenceSession: {
    create(
      artifact: Uint8Array,
      options: { readonly executionProviders: readonly ExecutionProvider[] },
    ): Promise<OnnxSession>;
  };
}

export type RuntimeLoader = () => Promise<OnnxRuntime>;

export interface ProviderAttempt {
  readonly provider: ExecutionProvider;
  readonly stage: "session-create" | "valid-shape-probe" | "session-release";
  readonly code:
    | "session-create-failed"
    | "valid-shape-probe-failed"
    | "session-release-failed";
  readonly message: string;
}

export interface OpenModelSessionResult {
  readonly provider: ExecutionProvider;
  readonly session: OnnxSession;
  readonly failedAttempts: readonly ProviderAttempt[];
}

export class ModelRuntimeError extends Error {
  readonly code:
    | "runtime-load-failed"
    | "artifact-empty"
    | "no-provider-qualified"
    | "session-release-failed";
  readonly attempts: readonly ProviderAttempt[];

  constructor(
    code: ModelRuntimeError["code"],
    message: string,
    attempts: readonly ProviderAttempt[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelRuntimeError";
    this.code = code;
    this.attempts = attempts;
  }
}

export interface SessionProbeContext {
  readonly manifest: CuratedModelManifest;
  readonly provider: ExecutionProvider;
  readonly session: OnnxSession;
}

export type ValidShapeProbe = (context: SessionProbeContext) => Promise<void>;

/** Creates a memoized importer without loading runtime code during construction. */
export function createLazyRuntimeLoader(
  importer: () => Promise<OnnxRuntime>,
): RuntimeLoader {
  let pending: Promise<OnnxRuntime> | undefined;
  return () => {
    pending ??= importer();
    return pending;
  };
}

/**
 * Opens the first provider that creates the exact graph and passes a
 * model-specific valid-shape probe. Artifact acquisition and hashing happen
 * outside this seam, so importing this module cannot trigger network access.
 */
export async function openModelSession(options: {
  readonly manifest: CuratedModelManifest;
  readonly artifact: Uint8Array;
  readonly loadRuntime: RuntimeLoader;
  readonly probe: ValidShapeProbe;
  readonly providerOrder?: readonly ExecutionProvider[];
}): Promise<OpenModelSessionResult> {
  if (options.artifact.byteLength === 0) {
    throw new ModelRuntimeError(
      "artifact-empty",
      "The model artifact is empty.",
    );
  }

  let runtime: OnnxRuntime;
  try {
    runtime = await options.loadRuntime();
  } catch (cause) {
    throw new ModelRuntimeError(
      "runtime-load-failed",
      "ONNX Runtime Web could not be loaded from the installed application assets.",
      [],
      { cause },
    );
  }

  const attempts: ProviderAttempt[] = [];
  const order = options.providerOrder ?? ["webgpu", "wasm"];
  for (const provider of order) {
    let session: OnnxSession;
    try {
      session = await runtime.InferenceSession.create(options.artifact, {
        executionProviders: [provider],
      });
    } catch (error) {
      attempts.push({
        provider,
        stage: "session-create",
        code: "session-create-failed",
        message: errorMessage(error),
      });
      continue;
    }

    try {
      await options.probe({ manifest: options.manifest, provider, session });
      return { provider, session, failedAttempts: attempts };
    } catch (error) {
      attempts.push({
        provider,
        stage: "valid-shape-probe",
        code: "valid-shape-probe-failed",
        message: errorMessage(error),
      });
      try {
        await session.release();
      } catch (releaseError) {
        const releaseAttempt: ProviderAttempt = {
          provider,
          stage: "session-release",
          code: "session-release-failed",
          message: errorMessage(releaseError),
        };
        attempts.push(releaseAttempt);
        throw new ModelRuntimeError(
          "session-release-failed",
          "The failed model session could not be released safely; provider fallback was stopped.",
          attempts,
          { cause: releaseError },
        );
      }
    }
  }

  throw new ModelRuntimeError(
    "no-provider-qualified",
    "The model did not pass its required probe on any available execution provider.",
    attempts,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
