import { secondsToFrames, type FrameRounding } from "../audio-domain/timeline";
import type { JobId, ProjectId } from "./app-state";

export const DEMO_SOURCE_BYTES = 54_636_200;
export const DEMO_DURATION_SECONDS = 533.010658;
export const DEMO_VIDEO_DURATION_SECONDS = 532.99;
export const DEMO_AUDIO_SAMPLE_RATE = 44_100;
export const DEMO_CANONICAL_SAMPLE_RATE = 48_000;
export const DEMO_CANONICAL_FRAMES = 25_584_511;

export type LoudnessPreset =
  "preserve-dynamics" | "clear-balanced" | "streaming-loud";

export type MixBusId = "dialogue" | "music" | "ambience" | "effects";

export type ComparisonMode = "source" | "preview";
export type SourceKind = "audio" | "video";
export const EXPERIENCE_CONTRACT_VERSION = 1 as const;
export const FIXTURE_PIPELINE_VERSION = "i003-fixture-pipeline-v2" as const;

export type ExperiencePhase =
  | "setup-required"
  | "source-selected"
  | "preview-ready"
  | "enhancing"
  | "mix-ready"
  | "exporting"
  | "recoverable-error";

export type Confidence = "low" | "medium" | "high";

export interface FrameRange {
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface DemoFixtureSource {
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly sourceBytes: number;
  readonly sourceDurationSeconds: number;
  readonly video: {
    readonly codec: string;
    readonly width?: number;
    readonly height?: number;
    readonly fpsApprox: string;
    readonly durationSeconds: number;
  };
  readonly audio: {
    readonly codec: string;
    readonly sampleRate?: number;
    readonly channels?: number;
    readonly durationSeconds: number;
  };
}

export interface FixtureCapability {
  readonly dereverb: "available" | "unavailable";
  readonly reason?: string;
}

export interface PreparedSourcePayload {
  readonly source: DemoFixtureSource;
  readonly sourceKind: SourceKind;
  readonly capabilities: FixtureCapability;
  readonly profiles: readonly ExperienceResourceProfile[];
  readonly selectedProfileId?: string;
}
export type SourcePreparation =
  | { readonly accepted: true; readonly prepared: PreparedSourcePayload }
  | {
      readonly accepted: false;
      readonly code: "unsupported-source";
      readonly reason: string;
    };

/** Adapter boundary for the deterministic fixture. A worker/OPFS adapter can
 * implement this interface without changing the reducer or presentation. */
export interface ExperienceSourceAdapter {
  readonly id: string;
  prepare(fileName: string): SourcePreparation;
  profiles(
    capacity?: Partial<ResourceCapacity>,
  ): readonly ExperienceResourceProfile[];
}

export interface ExperienceDriver {
  startEnhance(
    input: Readonly<{
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
      chunksTotal: number;
      failAtChunk?: number;
    }>,
    emit: (event: ExperienceEvent) => void,
  ): () => void;
  startExport(
    input: Readonly<{
      projectId: ProjectId;
      generation: number;
      jobId: JobId;
      fail?: boolean;
      delayMs?: number;
    }>,
    emit: (event: ExperienceEvent) => void,
  ): () => void;
}

export type ResourceConfidence = Confidence;

export interface ExperienceResourceProfile {
  readonly contractVersion: typeof EXPERIENCE_CONTRACT_VERSION;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly quotaInput: number;
  readonly capabilityInput: string;
  readonly modelBenchmarkInput: string;
  readonly measurementId: string;
  readonly measuredAt: string;
  readonly stale: boolean;
  readonly profileId: string;
  readonly sourceFidelity: "preserved-picture" | "audio-only";
  readonly modelArtifactIds: readonly string[];
  readonly provider: "webgpu" | "wasm-mt" | "wasm-st";
  readonly persistentBytes: {
    readonly source: number;
    readonly models: number;
    readonly project: number;
    readonly peakTemporary: number;
    readonly output: number;
    readonly reserve: number;
  };
  readonly peakWorkingBytes: {
    readonly estimated: number;
    readonly confidence: ResourceConfidence;
  };
  readonly etaSeconds: {
    readonly low: number;
    readonly high: number;
    readonly confidence: ResourceConfidence;
  };
  readonly assumptions: readonly string[];
  readonly feasible: boolean;
  readonly blockers: readonly string[];
  readonly requiredChunks: number;
}

export interface MixControls {
  readonly dialogueClean: number;
  readonly dereverbEnabled: boolean;
  readonly musicWeight: number;
  readonly width: number;
  readonly ducking: number;
  readonly loudnessPreset: LoudnessPreset;
}

export interface StemState {
  readonly id: MixBusId;
  readonly label: string;
  readonly audition: {
    readonly muted: boolean;
    readonly soloed: boolean;
  };
  readonly exportInclude: boolean;
}

export interface PreviewPlan {
  readonly startedAt: string;
  readonly generation: number;
  readonly jobId: string;
  readonly profileId: string;
  readonly chunksCompleted: number;
  readonly chunksTotal: number;
  readonly cancelPending: boolean;
  readonly phase: "running" | "cancel-requested" | "complete" | "failed";
  readonly statusMessage: string;
  readonly snapshot: Readonly<{
    readonly contractVersion: typeof EXPERIENCE_CONTRACT_VERSION;
    readonly sourceId: string;
    readonly sourceVersion: string;
    readonly pipelineVersion: string;
    readonly provider: ExperienceResourceProfile["provider"];
    readonly modelArtifactIds: readonly string[];
    readonly measurementId: string;
    readonly stale: boolean;
    profileId: string;
    controls: MixControls;
    region: FrameRange;
    sceneIncluded: boolean;
    outputs: readonly string[];
  }>;
}

export interface ExperienceState {
  readonly phase: ExperiencePhase;
  readonly generation: number;
  readonly projectId?: ProjectId;
  readonly demoActive: boolean;
  readonly message: string;
  readonly selectedFixture?: DemoFixtureSource;
  readonly fixtureCapabilities?: FixtureCapability;
  readonly selectedSourceKind?: SourceKind;
  readonly region: FrameRange;
  readonly selectedProfileId?: string;
  readonly controlWorking: MixControls;
  readonly controlCommitted: MixControls;
  readonly stems: readonly StemState[];
  readonly comparisonMode: ComparisonMode;
  readonly hasValidSource: boolean;
  readonly profiles: readonly ExperienceResourceProfile[];
  readonly activePlan?: PreviewPlan;
  readonly previewAssembled: boolean;
  readonly acousticRegion?: FrameRange;
  readonly acousticRegionIncluded: boolean;
  readonly finishedMixExportInclude: boolean;
  readonly exportJobId?: JobId;
  readonly exportSnapshot?: Readonly<{
    readonly contractVersion: typeof EXPERIENCE_CONTRACT_VERSION;
    readonly sourceId: string;
    readonly sourceVersion: string;
    readonly pipelineVersion: string;
    readonly profileId: string;
    readonly provider: ExperienceResourceProfile["provider"];
    readonly modelArtifactIds: readonly string[];
    readonly measurementId: string;
    readonly estimateStale: boolean;
    readonly controls: MixControls;
    readonly region: FrameRange;
    readonly sceneIncluded: boolean;
    readonly outputs: readonly (MixBusId | "finished-mix")[];
  }>;
}

export interface ResourceCapacity {
  readonly memoryBytes: number;
  readonly storageBytes: number;
}

type ControlValue = MixControls[keyof MixControls];

export type ExperienceEvent =
  | ({
      type: "SOURCE_SELECTED";
      fileName: string;
      prepared: PreparedSourcePayload;
    } & IdentityEvent)
  | ({
      type: "CONTROL_CHANGED";
      control: keyof MixControls;
      value: ControlValue;
    } & IdentityEvent)
  | ({ type: "CONTROL_RESET" } & IdentityEvent)
  | ({ type: "PREVIEW_TOGGLE"; mode: ComparisonMode } & IdentityEvent)
  | ({ type: "UNDO_PREVIEW" } & IdentityEvent)
  | ({
      type: "REGION_CHANGED";
      startFrame: number;
      endFrame: number;
    } & IdentityEvent)
  | ({ type: "PROFILE_SELECTED"; profileId: string } & IdentityEvent)
  | ({ type: "PLAN_STARTED"; jobId: JobId; profileId?: string } & IdentityEvent)
  | ({
      type: "PLAN_PROGRESS";
      jobId: JobId;
      chunksCompleted: number;
      chunksTotal: number;
    } & IdentityEvent)
  | ({ type: "PLAN_COMPLETE"; jobId: JobId } & IdentityEvent)
  | ({ type: "PLAN_CANCEL_REQUESTED"; jobId: JobId } & IdentityEvent)
  | ({ type: "PLAN_CANCELLED"; jobId: JobId } & IdentityEvent)
  | ({ type: "PLAN_FAILED"; jobId: JobId; message: string } & IdentityEvent)
  | ({ type: "PLAN_RETRY"; jobId: JobId } & IdentityEvent)
  | ({ type: "EXPORTING_STARTED"; jobId: JobId } & IdentityEvent)
  | ({ type: "EXPORT_COMPLETE"; jobId: JobId } & IdentityEvent)
  | ({ type: "EXPORT_FAILED"; jobId: JobId; message: string } & IdentityEvent)
  | ({ type: "EXPORT_RETRY"; jobId: JobId } & IdentityEvent)
  | ({ type: "FINISHED_MIX_EXPORT_TOGGLE"; include: boolean } & IdentityEvent)
  | ({
      type: "STEM_AUDITION";
      bus: MixBusId;
      muted: boolean;
      soloed: boolean;
    } & IdentityEvent)
  | ({
      type: "STEM_EXPORT_TOGGLE";
      bus: MixBusId;
      include: boolean;
    } & IdentityEvent)
  | ({ type: "SCENE_REGION_TOGGLE"; included: boolean } & IdentityEvent)
  | { type: "RESET_SESSION"; generation: number; projectId: ProjectId };

interface IdentityEvent {
  readonly projectId: ProjectId;
  readonly generation: number;
}

const FRAME_ROUNDING: FrameRounding = "floor";
const DEFAULT_PREVIEW_REGION = {
  startFrame: 4_800_000,
  endFrame: 6_720_000,
};
const DEFAULT_ACOUSTIC_REGION: FrameRange = {
  startFrame: 2_400_000,
  endFrame: 3_360_000,
};

const DEFAULT_CONTROL_SET: MixControls = Object.freeze({
  dialogueClean: 45,
  dereverbEnabled: false,
  musicWeight: 50,
  width: 80,
  ducking: 30,
  loudnessPreset: "clear-balanced",
});

function freeze<T>(value: T): T {
  if (value && typeof value === "object") return Object.freeze(value) as T;
  return value;
}

function assertFrameBoundary(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampPreset(value: LoudnessPreset): LoudnessPreset {
  if (
    value === "preserve-dynamics" ||
    value === "clear-balanced" ||
    value === "streaming-loud"
  )
    return value;
  return "clear-balanced";
}

function normalizeControls(
  controls: MixControls,
  updates: Partial<MixControls>,
): MixControls {
  const next: MixControls = { ...controls, ...updates };
  return freeze({
    dialogueClean: clamp01(next.dialogueClean),
    dereverbEnabled: Boolean(next.dereverbEnabled),
    musicWeight: clamp01(next.musicWeight),
    width: clamp01(next.width),
    ducking: clamp01(next.ducking),
    loudnessPreset: clampPreset(next.loudnessPreset),
  });
}

function isWithinFrameRange(value: number, total: number, name: string): void {
  assertFrameBoundary(total, `${name} maximum`);
  if (value > total) {
    throw new RangeError(`${name} exceeds available timeline`);
  }
}

function sortedFrameRange(region: FrameRange): FrameRange {
  const startFrame = Math.min(region.startFrame, region.endFrame);
  const endFrame = Math.max(region.startFrame, region.endFrame);
  if (startFrame === endFrame) {
    throw new RangeError("preview region must contain a positive duration");
  }
  return freeze({ startFrame, endFrame });
}

export const DEMO_FIXTURE: DemoFixtureSource = freeze({
  sourceId: "i003-demo-feature-film",
  sourceVersion: "fixture-2026-09-07",
  sourceBytes: DEMO_SOURCE_BYTES,
  sourceDurationSeconds: DEMO_DURATION_SECONDS,
  video: {
    codec: "h264-baseline",
    width: 1024,
    height: 576,
    fpsApprox: "23.98",
    durationSeconds: DEMO_VIDEO_DURATION_SECONDS,
  },
  audio: {
    codec: "aac-lc",
    sampleRate: DEMO_AUDIO_SAMPLE_RATE,
    channels: 2,
    durationSeconds: DEMO_DURATION_SECONDS,
  },
});

export const DEMO_STEM_ORDER: readonly MixBusId[] = Object.freeze([
  "dialogue",
  "music",
  "ambience",
  "effects",
]);

export const DEMO_STEMS: readonly Omit<
  StemState,
  "audition" | "exportInclude"
>[] = freeze([
  { id: "dialogue", label: "Dialogue" },
  { id: "music", label: "Music" },
  { id: "ambience", label: "Ambience" },
  { id: "effects", label: "Effects" },
]);

export const defaultStemStates: readonly StemState[] = makeDefaultStems();

export function supportsDemoSource(fileName: string): boolean {
  const extension = fileName.toLocaleLowerCase().split(".").at(-1);
  return (
    extension === "wav" ||
    extension === "mp3" ||
    extension === "m4a" ||
    extension === "aac" ||
    extension === "flac" ||
    extension === "mp4"
  );
}

function frameRangeWithinSource(
  region: FrameRange,
  durationFrames: number,
): FrameRange {
  const normalized = sortedFrameRange(region);
  isWithinFrameRange(
    normalized.startFrame,
    durationFrames,
    "region.startFrame",
  );
  isWithinFrameRange(normalized.endFrame, durationFrames, "region.endFrame");
  return normalized;
}

export function deriveRegionInCanonicalFrames(
  startSeconds: number,
  endSeconds: number,
  rounding: FrameRounding = FRAME_ROUNDING,
): FrameRange {
  const start = secondsToFrames(
    startSeconds,
    DEMO_CANONICAL_SAMPLE_RATE,
    rounding,
  );
  const end = secondsToFrames(endSeconds, DEMO_CANONICAL_SAMPLE_RATE, rounding);
  return frameRangeWithinSource(
    { startFrame: start, endFrame: end },
    DEMO_CANONICAL_FRAMES,
  );
}

export function makeDefaultStems(): readonly StemState[] {
  return freeze(
    DEMO_STEMS.map((stem) =>
      freeze({
        id: stem.id,
        label: stem.label,
        audition: { muted: false, soloed: false },
        exportInclude: true,
      }),
    ),
  );
}

export function demoFixture(): DemoFixtureSource {
  return DEMO_FIXTURE;
}

export function buildResourceProfiles(
  capacity?: Partial<ResourceCapacity>,
): readonly ExperienceResourceProfile[] {
  const memoryBytes = capacity?.memoryBytes ?? 2_100_000_000;
  const storageBytes = capacity?.storageBytes ?? 12_000_000_000;

  const profiles: readonly ExperienceResourceProfile[] = freeze([
    freeze({
      contractVersion: EXPERIENCE_CONTRACT_VERSION,
      sourceId: DEMO_FIXTURE.sourceId,
      sourceVersion: DEMO_FIXTURE.sourceVersion,
      quotaInput: storageBytes,
      capabilityInput: "fixture-webgpu-qualified",
      modelBenchmarkInput: "fixture-benchmark-2026-09-07",
      measurementId: "fixture-measurement-webgpu-v1",
      measuredAt: "2026-09-07T00:00:00.000Z",
      stale: false,
      profileId: "xp-high-fidelity",
      sourceFidelity: "preserved-picture",
      modelArtifactIds: Object.freeze(["htdemucs-4-stem-fp16-v1"]),
      provider: "webgpu",
      persistentBytes: {
        source: DEMO_SOURCE_BYTES,
        models: 740_000_000,
        project: 28_000_000,
        peakTemporary: 140_000_000,
        output: 180_000_000,
        reserve: 24_000_000,
      },
      peakWorkingBytes: { estimated: 910_000_000, confidence: "medium" },
      etaSeconds: { low: 112, high: 185, confidence: "medium" },
      assumptions: Object.freeze([
        "Source metadata fixtures only; no decoding is performed.",
        "Peak working set observed on a modern WebGPU browser.",
      ]),
      feasible: true,
      blockers: Object.freeze([]),
      requiredChunks: 12,
    }),
    freeze({
      contractVersion: EXPERIENCE_CONTRACT_VERSION,
      sourceId: DEMO_FIXTURE.sourceId,
      sourceVersion: DEMO_FIXTURE.sourceVersion,
      quotaInput: storageBytes,
      capabilityInput: "fixture-wasm-mt-qualified",
      modelBenchmarkInput: "fixture-benchmark-2026-09-07",
      measurementId: "fixture-measurement-wasm-mt-v1",
      measuredAt: "2026-09-07T00:00:00.000Z",
      stale: false,
      profileId: "xp-safe-memory",
      sourceFidelity: "preserved-picture",
      modelArtifactIds: Object.freeze(["htdemucs-4-stem-fp16-v2"]),
      provider: "wasm-mt",
      persistentBytes: {
        source: DEMO_SOURCE_BYTES,
        models: 520_000_000,
        project: 22_000_000,
        peakTemporary: 320_000_000,
        output: 185_000_000,
        reserve: 18_000_000,
      },
      peakWorkingBytes: { estimated: 690_000_000, confidence: "medium" },
      etaSeconds: { low: 180, high: 280, confidence: "low" },
      assumptions: Object.freeze([
        "Fallback WASM path uses the same output policy as preview.",
        "A sample of the selected media is not decoded in this package.",
      ]),
      feasible: true,
      blockers: Object.freeze([]),
      requiredChunks: 16,
    }),
    freeze({
      contractVersion: EXPERIENCE_CONTRACT_VERSION,
      sourceId: DEMO_FIXTURE.sourceId,
      sourceVersion: DEMO_FIXTURE.sourceVersion,
      quotaInput: storageBytes,
      capabilityInput: "fixture-wasm-st-qualified",
      modelBenchmarkInput: "fixture-benchmark-2026-09-07",
      measurementId: "fixture-measurement-wasm-st-v1",
      measuredAt: "2026-09-07T00:00:00.000Z",
      stale: false,
      profileId: "xp-audio-only",
      sourceFidelity: "audio-only",
      modelArtifactIds: Object.freeze(["htdemucs-4-stem-fp16-audio-only"]),
      provider: "wasm-st",
      persistentBytes: {
        source: DEMO_SOURCE_BYTES,
        models: 540_000_000,
        project: 12_000_000,
        peakTemporary: 180_000_000,
        output: 95_000_000,
        reserve: 12_000_000,
      },
      peakWorkingBytes: { estimated: 1_080_000_000, confidence: "low" },
      etaSeconds: { low: 210, high: 360, confidence: "low" },
      assumptions: Object.freeze([
        "Enhanced waveform is generated as a preview representation only.",
        "Encoder must remux picture unchanged.",
      ]),
      feasible: true,
      blockers: Object.freeze([
        "Picture passthrough path requires the audio-only profile and the same output policy.",
      ]),
      requiredChunks: 14,
    }),
  ]);

  const evaluated = profiles.map((profile) => {
    const requiredStorage =
      profile.persistentBytes.source +
      profile.persistentBytes.models +
      profile.persistentBytes.project +
      profile.persistentBytes.output +
      profile.persistentBytes.reserve +
      profile.persistentBytes.peakTemporary;
    const blockedByMemory = profile.peakWorkingBytes.estimated > memoryBytes;
    const blockedByStorage = requiredStorage > storageBytes;
    const capacityBlockers = [
      ...(blockedByStorage
        ? [
            `insufficient storage for persistent reservation (${requiredStorage} needed / ${storageBytes} available)`,
          ]
        : []),
      ...(blockedByMemory
        ? [
            `insufficient peak RAM for requested provider and model package (${profile.peakWorkingBytes.estimated} needed / ${memoryBytes} available)`,
          ]
        : []),
    ];
    const blockers = [...profile.blockers, ...capacityBlockers];
    return freeze({
      ...profile,
      feasible: blockers.length === 0,
      blockers: freeze(blockers),
    });
  });

  return freeze(evaluated);
}

export const initialExperienceState: ExperienceState = Object.freeze({
  phase: "setup-required",
  generation: 0,
  demoActive: false,
  message: "Select a local audio/video file to begin.",
  region: freeze(DEFAULT_PREVIEW_REGION),
  selectedFixture: undefined,
  fixtureCapabilities: undefined,
  selectedProfileId: undefined,
  controlWorking: DEFAULT_CONTROL_SET,
  controlCommitted: DEFAULT_CONTROL_SET,
  stems: makeDefaultStems(),
  comparisonMode: "source",
  hasValidSource: false,
  profiles: buildResourceProfiles(),
  previewAssembled: false,
  acousticRegionIncluded: false,
  finishedMixExportInclude: false,
  exportJobId: undefined,
  exportSnapshot: undefined,
});

export function isExperienceProjectState(
  state: ExperienceState,
  event: IdentityEvent,
): boolean {
  return (
    state.projectId === event.projectId && state.generation === event.generation
  );
}

function isActivePlan(
  state: ExperienceState,
  event: { jobId: JobId },
): boolean {
  return Boolean(state.activePlan && state.activePlan.jobId === event.jobId);
}

function isValidJobId(id: string): id is JobId {
  return /^job_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}

function baselineMessageForPhase(phase: ExperienceState["phase"]): string {
  switch (phase) {
    case "setup-required":
      return "Select a local audio/video file to begin.";
    case "source-selected":
      return "Source metadata loaded for planning; processing simulation is active.";
    case "preview-ready":
      return "Preview controls are available for the imported source.";
    case "enhancing":
      return "Simulated preview plan is advancing; no media is decoded or processed.";
    case "mix-ready":
      return "Preview is assembled; export remains a simulation.";
    case "exporting":
      return "Export simulation is in progress; no file is being rendered.";
    case "recoverable-error":
      return "The simulated job failed. You can retry or reset.";
  }
}

export function sourceKindFromFileName(fileName: string): SourceKind {
  return fileName.toLocaleLowerCase().endsWith(".mp4") ? "video" : "audio";
}

function nextRegionFromDefaults(): FrameRange {
  return sortedFrameRange(DEFAULT_PREVIEW_REGION);
}

function setStemState(
  stems: readonly StemState[],
  bus: MixBusId,
  mutate: (stem: StemState) => StemState,
): readonly StemState[] {
  return freeze(
    stems.map((stem) => (stem.id === bus ? freeze(mutate(stem)) : stem)),
  );
}

export function currentExportManifest(
  state: ExperienceState,
): readonly (MixBusId | "finished-mix")[] {
  return freeze([
    ...(state.finishedMixExportInclude ? ["finished-mix" as const] : []),
    ...state.stems.filter((stem) => stem.exportInclude).map((stem) => stem.id),
  ]);
}

export function selectBestProfile(
  profiles: readonly ExperienceResourceProfile[],
): string | undefined {
  for (const profile of profiles) {
    if (profile.feasible) return profile.profileId;
  }
  return profiles.at(-1)?.profileId;
}

export function profileById(
  profiles: readonly ExperienceResourceProfile[],
  profileId?: string,
): ExperienceResourceProfile | undefined {
  return profiles.find((profile) => profile.profileId === profileId);
}

export function toSeconds(range: FrameRange): {
  startSeconds: number;
  endSeconds: number;
} {
  // LEAKY ABSTRACTION: I-004 uses the product's 48 kHz canonical timeline for region math
  // while browser media retains its native rate. Accepted because preview seeks are bounded
  // to this contract; the limit is frame-rate conversion accuracy until a sample-rate-aware
  // timeline adapter replaces this helper. [[Implementation Package I-004 - Real Local Preview]]
  return Object.freeze({
    startSeconds: range.startFrame / DEMO_CANONICAL_SAMPLE_RATE,
    endSeconds: range.endFrame / DEMO_CANONICAL_SAMPLE_RATE,
  });
}

export function compareModeLabel(mode: ComparisonMode): string {
  return mode === "source" ? "Source" : "Preview";
}

export const MAX_SAFE_BYTES = Number.MAX_SAFE_INTEGER;

export function reduceExperienceState(
  state: ExperienceState,
  event: ExperienceEvent,
): ExperienceState {
  switch (event.type) {
    case "SOURCE_SELECTED":
      if (event.generation !== state.generation + 1) {
        return state;
      }
      const adapted = event.prepared;
      return freeze({
        ...state,
        phase: "source-selected",
        generation: event.generation,
        projectId: event.projectId,
        demoActive: true,
        selectedFixture: adapted.source,
        fixtureCapabilities: adapted.capabilities,
        selectedSourceKind: adapted.sourceKind,
        selectedProfileId:
          adapted.selectedProfileId ?? selectBestProfile(adapted.profiles),
        profiles: adapted.profiles,
        region: nextRegionFromDefaults(),
        controlWorking: DEFAULT_CONTROL_SET,
        controlCommitted: DEFAULT_CONTROL_SET,
        comparisonMode: "source",
        hasValidSource: true,
        message: baselineMessageForPhase("source-selected"),
        previewAssembled: false,
        acousticRegion: DEFAULT_ACOUSTIC_REGION,
        acousticRegionIncluded: false,
        activePlan: undefined,
        stems: makeDefaultStems(),
        finishedMixExportInclude: false,
        exportJobId: undefined,
        exportSnapshot: undefined,
      });

    case "CONTROL_CHANGED":
      if (!state.hasValidSource || state.phase === "setup-required")
        return state;
      if (!isExperienceProjectState(state, event)) return state;
      if (
        event.control === "dereverbEnabled" &&
        event.value === true &&
        state.fixtureCapabilities?.dereverb !== "available"
      )
        return state;
      if (
        !["source-selected", "preview-ready", "mix-ready"].includes(state.phase)
      )
        return state;
      return freeze({
        ...state,
        controlWorking: normalizeControls(state.controlWorking, {
          [event.control]: event.value,
        } as Partial<MixControls>),
        comparisonMode: "preview",
        phase: "preview-ready",
        message: "Control edits are represented in the preview state.",
      });

    case "CONTROL_RESET":
      if (!isExperienceProjectState(state, event)) return state;
      if (["enhancing", "exporting"].includes(state.phase)) return state;
      return freeze({
        ...state,
        phase:
          state.phase === "setup-required" || !state.hasValidSource
            ? state.phase
            : "source-selected",
        controlWorking: DEFAULT_CONTROL_SET,
        comparisonMode: "source",
        controlCommitted:
          state.phase === "setup-required" || !state.hasValidSource
            ? state.controlCommitted
            : DEFAULT_CONTROL_SET,
        message: baselineMessageForPhase(
          state.phase === "setup-required" || !state.hasValidSource
            ? "setup-required"
            : "source-selected",
        ),
        previewAssembled: false,
      });

    case "PREVIEW_TOGGLE":
      if (!isExperienceProjectState(state, event)) return state;
      if (["enhancing", "exporting"].includes(state.phase)) return state;
      if (event.mode === state.comparisonMode) return state;
      if (!state.hasValidSource) return state;
      if (event.mode === "preview") {
        return freeze({
          ...state,
          comparisonMode: "preview",
          message:
            "Preview display is showing the planned configuration snapshot.",
        });
      }
      return freeze({
        ...state,
        comparisonMode: event.mode,
        message: "Displaying the source configuration snapshot.",
      });

    case "UNDO_PREVIEW":
      if (!isExperienceProjectState(state, event)) return state;
      if (["enhancing", "exporting"].includes(state.phase)) return state;
      if (!state.hasValidSource) return state;
      const acceptedSnapshot = state.activePlan?.snapshot;
      return freeze({
        ...state,
        region: acceptedSnapshot?.region ?? state.region,
        selectedProfileId:
          acceptedSnapshot?.profileId ?? state.selectedProfileId,
        acousticRegionIncluded:
          acceptedSnapshot?.sceneIncluded ?? state.acousticRegionIncluded,
        controlWorking: state.controlCommitted,
        comparisonMode: "source",
        phase:
          state.phase === "enhancing" ||
          state.phase === "mix-ready" ||
          state.phase === "recoverable-error" ||
          state.previewAssembled ||
          state.activePlan?.phase === "complete"
            ? "mix-ready"
            : "source-selected",
        message: baselineMessageForPhase(
          state.phase === "enhancing" || state.phase === "recoverable-error"
            ? state.phase
            : "source-selected",
        ),
      });

    case "REGION_CHANGED":
      if (!isExperienceProjectState(state, event) || !state.hasValidSource) {
        return state;
      }
      if (["enhancing", "exporting"].includes(state.phase)) return state;
      return freeze({
        ...state,
        region: frameRangeWithinSource(
          { startFrame: event.startFrame, endFrame: event.endFrame },
          DEMO_CANONICAL_FRAMES,
        ),
        phase: "preview-ready",
        comparisonMode: "source",
        previewAssembled: false,
        message: "Representative preview region is updated.",
      });

    case "PROFILE_SELECTED":
      if (!isExperienceProjectState(state, event) || !state.hasValidSource)
        return state;
      if (["enhancing", "exporting"].includes(state.phase)) return state;
      if (
        !state.profiles.some((profile) => profile.profileId === event.profileId)
      ) {
        return state;
      }
      return freeze({
        ...state,
        selectedProfileId: event.profileId,
        phase: state.phase === "mix-ready" ? "preview-ready" : state.phase,
        message: `Selected profile ${event.profileId}.`,
      });

    case "PLAN_STARTED": {
      if (!isExperienceProjectState(state, event) || !state.hasValidSource)
        return state;
      if (
        !["source-selected", "preview-ready", "mix-ready"].includes(state.phase)
      )
        return state;
      const selectedProfile =
        profileById(state.profiles, event.profileId) ??
        profileById(state.profiles, state.selectedProfileId);
      if (!selectedProfile || !selectedProfile.feasible) return state;
      return freeze({
        ...state,
        phase: "enhancing",
        activePlan: freeze({
          startedAt: new Date().toISOString(),
          generation: event.generation,
          jobId: event.jobId,
          profileId: selectedProfile.profileId,
          chunksCompleted: 0,
          chunksTotal: selectedProfile.requiredChunks,
          cancelPending: false,
          phase: "running",
          statusMessage: "Enhancement job is running.",
          snapshot: freeze({
            profileId: selectedProfile.profileId,
            controls: freeze({ ...state.controlWorking }),
            region: freeze({ ...state.region }),
            sceneIncluded: state.acousticRegionIncluded,
            contractVersion: EXPERIENCE_CONTRACT_VERSION,
            sourceId: state.selectedFixture?.sourceId ?? "unknown",
            sourceVersion: state.selectedFixture?.sourceVersion ?? "unknown",
            pipelineVersion: FIXTURE_PIPELINE_VERSION,
            provider: selectedProfile.provider,
            modelArtifactIds: selectedProfile.modelArtifactIds,
            measurementId: selectedProfile.measurementId,
            stale: selectedProfile.stale,
            outputs: currentExportManifest(state),
          }),
        }),
        selectedProfileId: selectedProfile.profileId,
        controlCommitted: state.controlWorking,
        comparisonMode: "preview",
        message: baselineMessageForPhase("enhancing"),
      });
    }

    case "PLAN_PROGRESS":
      if (
        !isExperienceProjectState(state, event) ||
        !isActivePlan(state, event)
      ) {
        return state;
      }
      if (!state.activePlan || state.activePlan.phase !== "running")
        return state;
      if (
        !Number.isSafeInteger(event.chunksTotal) ||
        event.chunksTotal !== state.activePlan.chunksTotal ||
        !Number.isSafeInteger(event.chunksCompleted) ||
        event.chunksCompleted < state.activePlan.chunksCompleted ||
        event.chunksCompleted < 0 ||
        event.chunksCompleted > state.activePlan.chunksTotal
      )
        return state;
      const total = state.activePlan.chunksTotal;
      const completed = event.chunksCompleted;
      return freeze({
        ...state,
        activePlan: {
          ...state.activePlan,
          chunksCompleted: completed,
          chunksTotal: total,
          statusMessage: `Plan checkpoint ${completed}/${total}; no media is processed.`,
        },
      });

    case "PLAN_CANCEL_REQUESTED":
      if (
        !isExperienceProjectState(state, event) ||
        !isActivePlan(state, event)
      )
        return state;
      if (!state.activePlan || state.activePlan.phase !== "running")
        return state;
      return freeze({
        ...state,
        activePlan: {
          ...state.activePlan,
          cancelPending: true,
          phase: "cancel-requested",
          statusMessage:
            "Enhancement cancel requested. Stopping after the next checkpoint.",
        },
      });

    case "PLAN_CANCELLED":
      if (
        !isExperienceProjectState(state, event) ||
        !isActivePlan(state, event)
      ) {
        return state;
      }
      return freeze({
        ...state,
        phase: "source-selected",
        generation: state.generation + 1,
        activePlan: undefined,
        previewAssembled: false,
        message: "Enhancement cancelled. Working mix remains unchanged.",
      });

    case "PLAN_COMPLETE":
      if (
        !isExperienceProjectState(state, event) ||
        !isActivePlan(state, event)
      )
        return state;
      if (!state.activePlan || state.activePlan.phase !== "running")
        return state;
      const completedPlan = state.activePlan;
      return freeze({
        ...state,
        phase: "mix-ready",
        controlCommitted: state.controlWorking,
        controlWorking: state.controlWorking,
        previewAssembled: true,
        activePlan: {
          ...completedPlan,
          chunksCompleted: completedPlan.chunksTotal,
          phase: "complete",
          statusMessage:
            "Simulated preview plan complete. Stem presentation is ready for audit; no audio was rendered.",
          cancelPending: false,
        },
        message: baselineMessageForPhase("mix-ready"),
      });

    case "PLAN_FAILED":
      if (
        !isExperienceProjectState(state, event) ||
        !isActivePlan(state, event)
      )
        return state;
      if (!state.activePlan || state.activePlan.phase !== "running")
        return state;
      return freeze({
        ...state,
        phase: "recoverable-error",
        activePlan: freeze({
          ...(state.activePlan ?? {
            startedAt: new Date().toISOString(),
            generation: event.generation,
            jobId: event.jobId,
            profileId: state.selectedProfileId ?? "unknown",
            chunksCompleted: 0,
            chunksTotal: 1,
            cancelPending: false,
            snapshot: freeze({
              contractVersion: EXPERIENCE_CONTRACT_VERSION,
              sourceId: state.selectedFixture?.sourceId ?? "unknown",
              sourceVersion: state.selectedFixture?.sourceVersion ?? "unknown",
              pipelineVersion: FIXTURE_PIPELINE_VERSION,
              provider:
                profileById(state.profiles, state.selectedProfileId)
                  ?.provider ?? "wasm-st",
              modelArtifactIds:
                profileById(state.profiles, state.selectedProfileId)
                  ?.modelArtifactIds ?? [],
              measurementId:
                profileById(state.profiles, state.selectedProfileId)
                  ?.measurementId ?? "unknown",
              stale:
                profileById(state.profiles, state.selectedProfileId)?.stale ??
                true,
              profileId: state.selectedProfileId ?? "unknown",
              controls: freeze({ ...state.controlWorking }),
              region: freeze({ ...state.region }),
              sceneIncluded: state.acousticRegionIncluded,
              outputs: currentExportManifest(state),
            }),
          }),
          phase: "failed",
          statusMessage: event.message,
        }),
        message: `The simulated preview plan failed: ${event.message}`,
      });

    case "PLAN_RETRY":
      if (
        state.phase !== "recoverable-error" ||
        !isExperienceProjectState(state, event) ||
        !state.activePlan ||
        state.activePlan.phase !== "failed"
      )
        return state;
      return freeze({
        ...state,
        phase: "enhancing",
        activePlan: freeze({
          ...state.activePlan,
          jobId: event.jobId,
          phase: "running",
          cancelPending: false,
          chunksCompleted: 0,
          statusMessage: "Retrying enhancement from the saved plan snapshot.",
        }),
        message: baselineMessageForPhase("enhancing"),
      });

    case "EXPORTING_STARTED":
      if (
        state.phase !== "mix-ready" ||
        !isExperienceProjectState(state, event) ||
        currentExportManifest(state).length === 0
      )
        return state;
      if (!isValidJobId(event.jobId)) return state;
      const acceptedExportSnapshot = state.activePlan?.snapshot;
      return freeze({
        ...state,
        phase: "exporting",
        exportJobId: event.jobId,
        exportSnapshot: freeze({
          contractVersion: EXPERIENCE_CONTRACT_VERSION,
          sourceId: state.selectedFixture?.sourceId ?? "unknown",
          sourceVersion: state.selectedFixture?.sourceVersion ?? "unknown",
          pipelineVersion: FIXTURE_PIPELINE_VERSION,
          profileId:
            acceptedExportSnapshot?.profileId ??
            state.selectedProfileId ??
            "unknown",
          provider: acceptedExportSnapshot?.provider ?? "wasm-st",
          modelArtifactIds: acceptedExportSnapshot?.modelArtifactIds ?? [],
          measurementId: acceptedExportSnapshot?.measurementId ?? "unknown",
          estimateStale: acceptedExportSnapshot?.stale ?? true,
          controls: freeze({ ...state.controlCommitted }),
          region: acceptedExportSnapshot
            ? freeze({ ...acceptedExportSnapshot.region })
            : freeze({ ...state.region }),
          sceneIncluded:
            acceptedExportSnapshot?.sceneIncluded ??
            state.acousticRegionIncluded,
          outputs: currentExportManifest(state),
        }),
        message: baselineMessageForPhase("exporting"),
      });

    case "EXPORT_COMPLETE":
      if (
        state.phase !== "exporting" ||
        !isExperienceProjectState(state, event) ||
        state.exportJobId !== event.jobId
      )
        return state;
      return freeze({
        ...state,
        phase: "mix-ready",
        exportJobId: undefined,
        message: "Export simulation complete; no file was rendered or saved.",
      });

    case "EXPORT_FAILED":
      if (
        state.phase !== "exporting" ||
        !isExperienceProjectState(state, event) ||
        state.exportJobId !== event.jobId
      )
        return state;
      return freeze({
        ...state,
        phase: "recoverable-error",
        exportJobId: undefined,
        message: `Export failed: ${event.message}`,
      });

    case "EXPORT_RETRY":
      if (
        state.phase !== "recoverable-error" ||
        !isExperienceProjectState(state, event) ||
        !state.exportSnapshot ||
        !isValidJobId(event.jobId)
      )
        return state;
      return freeze({
        ...state,
        phase: "exporting",
        exportJobId: event.jobId,
        message: baselineMessageForPhase("exporting"),
      });

    case "STEM_AUDITION":
      if (!isExperienceProjectState(state, event)) return state;
      if (["enhancing", "exporting"].includes(state.phase)) return state;
      return freeze({
        ...state,
        stems: setStemState(state.stems, event.bus, (stem) => ({
          ...stem,
          audition: {
            muted: event.muted,
            soloed: event.soloed,
          },
        })),
      });

    case "STEM_EXPORT_TOGGLE":
      if (!isExperienceProjectState(state, event)) return state;
      if (["enhancing", "exporting"].includes(state.phase)) return state;
      return freeze({
        ...state,
        stems: setStemState(state.stems, event.bus, (stem) => ({
          ...stem,
          exportInclude: event.include,
        })),
      });

    case "FINISHED_MIX_EXPORT_TOGGLE":
      if (
        !isExperienceProjectState(state, event) ||
        ["enhancing", "exporting"].includes(state.phase)
      )
        return state;
      return freeze({ ...state, finishedMixExportInclude: event.include });

    case "SCENE_REGION_TOGGLE":
      if (!isExperienceProjectState(state, event) || !state.acousticRegion) {
        return state;
      }
      if (["enhancing", "exporting"].includes(state.phase)) return state;
      return freeze({
        ...state,
        acousticRegionIncluded: event.included,
        phase: state.phase === "mix-ready" ? "preview-ready" : state.phase,
        message: event.included
          ? "Acoustic-scene region is included in this preview."
          : "Acoustic-scene region is skipped.",
      });

    case "RESET_SESSION":
      return Object.freeze({
        ...initialExperienceState,
        generation: event.generation,
      });
  }
}
