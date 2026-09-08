export type ModelTask =
  "voice-activity-detection" | "dialogue-enhancement" | "source-separation";

export type ExecutionProvider = "webgpu" | "wasm";

export type QualificationState =
  "identity-verified" | "provider-unqualified" | "qualified" | "blocked";

export interface ArtifactLicense {
  readonly spdx: string;
  readonly url: string;
  readonly notice: string;
}

export interface TensorContract {
  readonly name: string;
  readonly elementType: "float32" | "int64";
  readonly shape: readonly (number | "batch" | "sequence")[];
  readonly meaning: string;
}

export interface ProviderRequirement {
  readonly provider: ExecutionProvider;
  readonly qualification:
    "unqualified" | "reference-parity" | "qualified" | "blocked";
  readonly requiresCrossOriginIsolation: boolean;
  readonly notes: string;
}

export interface CuratedModelManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly task: ModelTask;
  readonly release: string;
  readonly upstreamCommit: string;
  readonly repositoryUrl: string;
  readonly artifactUrl: string;
  readonly artifactPath: string;
  readonly artifactBytes: number;
  readonly artifactSha256: string;
  readonly codeLicense: ArtifactLicense;
  readonly weightsLicense: ArtifactLicense;
  readonly redistributionNotice: string;
  readonly conversion: {
    readonly kind: "upstream-native" | "project-converted";
    readonly procedure: string;
  };
  readonly onnxOpset: number;
  readonly requiredOperators: readonly string[] | null;
  readonly onnxRuntimeWebVersion: string | null;
  readonly audio: {
    readonly sampleRatesHz: readonly number[];
    readonly channels: 1 | 2;
    readonly frameSamples: number;
    readonly contextSamples: number;
    readonly normalization: string;
    readonly algorithmicDelaySamples: number | null;
  };
  readonly inputs: readonly TensorContract[];
  readonly outputs: readonly TensorContract[];
  readonly providers: readonly ProviderRequirement[];
  readonly resourceEvidence: {
    readonly installedBytes: number | null;
    readonly temporaryInstallBytes: number | null;
    readonly peakRamBytes: number | null;
    readonly peakGpuBytes: number | null;
  };
  readonly qualification: QualificationState;
  readonly limitations: readonly string[];
}

const SILERO_LICENSE: ArtifactLicense = {
  spdx: "MIT",
  url: "https://github.com/snakers4/silero-vad/blob/7e30209a3e901f9842f81b225f3e93d8199902b1/LICENSE",
  notice: "Copyright (c) 2020-present Silero Team",
};

/**
 * Identity-audited catalog entries. Presence here does not mean a provider or
 * product outcome is qualified; callers must inspect `qualification`.
 */
export const CURATED_MODEL_CATALOG: readonly CuratedModelManifest[] = [
  {
    schemaVersion: 1,
    id: "silero-vad-v6.2.1-16k-op15",
    displayName: "Silero VAD 6.2.1 (16 kHz, opset 15)",
    task: "voice-activity-detection",
    release: "v6.2.1",
    upstreamCommit: "7e30209a3e901f9842f81b225f3e93d8199902b1",
    repositoryUrl: "https://github.com/snakers4/silero-vad",
    artifactUrl:
      "https://raw.githubusercontent.com/snakers4/silero-vad/7e30209a3e901f9842f81b225f3e93d8199902b1/src/silero_vad/data/silero_vad_16k_op15.onnx",
    artifactPath: "src/silero_vad/data/silero_vad_16k_op15.onnx",
    artifactBytes: 1_289_603,
    artifactSha256:
      "7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49",
    codeLicense: SILERO_LICENSE,
    weightsLicense: SILERO_LICENSE,
    redistributionNotice:
      "Retain the upstream MIT copyright and permission notice with redistributed copies.",
    conversion: {
      kind: "upstream-native",
      procedure:
        "No project conversion; use the ONNX artifact committed by upstream.",
    },
    onnxOpset: 15,
    requiredOperators: null,
    onnxRuntimeWebVersion: "1.29.0",
    audio: {
      sampleRatesHz: [16_000],
      channels: 1,
      frameSamples: 512,
      contextSamples: 64,
      normalization:
        "Upstream wrapper passes linear Float32 PCM without amplitude normalization.",
      algorithmicDelaySamples: null,
    },
    inputs: [
      {
        name: "input",
        elementType: "float32",
        shape: ["batch", "sequence"],
        meaning:
          "One 512-sample frame prefixed by 64 samples of rolling context.",
      },
      {
        name: "state",
        elementType: "float32",
        shape: [2, "batch", 128],
        meaning: "Recurrent state carried between frames.",
      },
      {
        name: "sr",
        elementType: "int64",
        shape: [],
        meaning: "Sample rate scalar; this artifact accepts 16000.",
      },
    ],
    outputs: [
      {
        name: "output",
        elementType: "float32",
        shape: ["batch", 1],
        meaning: "Speech probability for the current frame.",
      },
      {
        name: "stateN",
        elementType: "float32",
        shape: [2, "batch", 128],
        meaning: "Recurrent state for the next frame.",
      },
    ],
    providers: [
      {
        provider: "webgpu",
        qualification: "unqualified",
        requiresCrossOriginIsolation: false,
        notes:
          "Exact graph correctness, memory, and sustained-load behavior are not yet measured.",
      },
      {
        provider: "wasm",
        qualification: "reference-parity",
        requiresCrossOriginIsolation: false,
        notes:
          "Single-thread WASM matches the independent Python reference on silence/tone stateful fixtures within 1e-6; memory, sustained-load, and audio-quality gates remain.",
      },
    ],
    resourceEvidence: {
      installedBytes: null,
      temporaryInstallBytes: null,
      peakRamBytes: null,
      peakGpuBytes: null,
    },
    qualification: "identity-verified",
    limitations: [
      "Identity and upstream license are verified; single-thread WASM has narrow reference parity but is not broadly product-qualified.",
      "Algorithmic delay, calibrated threshold, memory, and processing time remain unmeasured.",
      "Graph operator inventory remains unrecorded and WebGPU remains untested.",
      "The artifact is catalog metadata only and is not bundled or downloaded by this module.",
    ],
  },
] as const;

export function validateModelManifest(
  manifest: CuratedModelManifest,
): readonly string[] {
  const problems: string[] = [];
  if (!/^[a-f0-9]{40}$/.test(manifest.upstreamCommit)) {
    problems.push("upstreamCommit must be a full lowercase Git commit SHA.");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.artifactSha256)) {
    problems.push("artifactSha256 must be a lowercase SHA-256 digest.");
  }
  if (
    !Number.isSafeInteger(manifest.artifactBytes) ||
    manifest.artifactBytes <= 0
  ) {
    problems.push("artifactBytes must be a positive safe integer.");
  }
  if (manifest.audio.sampleRatesHz.length === 0) {
    problems.push("At least one model-boundary sample rate is required.");
  }
  if (manifest.providers.length === 0) {
    problems.push("At least one execution provider requirement is required.");
  }
  if (
    manifest.qualification === "qualified" &&
    manifest.providers.every(
      (provider) => provider.qualification !== "qualified",
    )
  ) {
    problems.push(
      "A qualified model requires at least one qualified provider.",
    );
  }
  return problems;
}
