import type { EnrichmentOptions } from "../processing/chunk-enrichment";

export type PreviewMode = "source" | "preview";

type LoudnessPreset = "preserve-dynamics" | "clear-balanced" | "streaming-loud";

export interface PreviewControls {
  dialogueClean: number;
  musicWeight: number;
  width: number;
  ducking: number;
  loudnessPreset: LoudnessPreset;
}

export type LocalPreviewStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error"
  | "unsupported";

export interface LocalPreviewState {
  readonly mode: PreviewMode;
  readonly status: LocalPreviewStatus;
  readonly message: string;
  readonly durationSeconds?: number;
  readonly positionSeconds: number;
  readonly sourceKind: "audio" | "video" | "unknown";
  readonly sourceName?: string;
}

export interface LocalMediaPreviewController {
  destroy(): void;
  loadSource(file: File): Promise<void>;
  setMode(mode: PreviewMode): void;
  setControls(values: Partial<PreviewControls>): void;
  play(): Promise<void>;
  resume(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  getState(): LocalPreviewState;
  /** The processed bus only; callers must treat the stream as a live browser-owned resource. */
  getProcessedStream(): MediaStream | null;
  onStateChange(listener: (state: LocalPreviewState) => void): () => void;
}

interface ProcessingGraph {
  context: AudioContext;
  sourceNode: MediaElementAudioSourceNode;
  bypassGain: GainNode;
  processedGain: GainNode;
  sourceGain: GainNode;
  highpass: BiquadFilterNode;
  presence: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  split: ChannelSplitterNode;
  leftToMid: GainNode;
  rightToMid: GainNode;
  leftToSide: GainNode;
  rightToSide: GainNode;
  midSum: GainNode;
  sideSum: GainNode;
  midToLeft: GainNode;
  midToRight: GainNode;
  sideToLeft: GainNode;
  sideToRight: GainNode;
  widthMerge: ChannelMergerNode;
  processedDestination: MediaStreamAudioDestinationNode | null;
}

export interface MediaPreviewControllerOptions {
  readonly supports?: (file: File) => boolean;
  readonly crossfadeDurationMs?: number;
  readonly seekStepSeconds?: number;
  readonly onError?: (message: string, cause?: unknown) => void;
}

const DEFAULT_CONTROL_VALUES: PreviewControls = {
  dialogueClean: 50,
  musicWeight: 50,
  width: 50,
  ducking: 30,
  loudnessPreset: "clear-balanced",
};

const DEFAULT_CROSSFADE_MS = 90;
const PREVIEW_TIMEOUT_MS = 30_000;
const DEFAULT_SEEK_STEP_SECONDS = 0.1;

export interface ProcessingParameters {
  highpassFrequency: number;
  highpassQ: number;
  presenceFrequency: number;
  presenceGain: number;
  presenceQ: number;
  compressorThreshold: number;
  compressorRatio: number;
  sideGain: number;
  outputGain: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function isLikelySupportedAudioVideoFile(file: File): boolean {
  if (file.type)
    return file.type.startsWith("audio/") || file.type.startsWith("video/");
  const suffix = file.name.toLowerCase().split(".").pop();
  return (
    suffix === "wav" ||
    suffix === "mp3" ||
    suffix === "m4a" ||
    suffix === "aac" ||
    suffix === "flac" ||
    suffix === "mp4" ||
    suffix === "mov"
  );
}

function isVideo(file: File): boolean {
  const suffix = file.name.toLowerCase().split(".").pop();
  return file.type.startsWith("video/") || suffix === "mp4" || suffix === "mov";
}

export function formatPreviewMode(mode: PreviewMode): string {
  return mode === "source" ? "Source (bypass)" : "Processed preview";
}

export function deriveProcessingParameters(
  controls: PreviewControls,
): ProcessingParameters {
  const dialogue = clamp(controls.dialogueClean, 0, 100);
  const width = clamp(controls.width, 0, 100) / 100;

  return {
    highpassFrequency: clamp(70 + dialogue * 0.5, 60, 120),
    highpassQ: clamp(0.6 + dialogue / 220, 0.6, 1.2),
    presenceFrequency: clamp(2800, 2600, 3200),
    presenceGain: clamp(1 + dialogue / 90, 0.5, 2.4),
    presenceQ: 0.8,
    compressorThreshold: -24,
    compressorRatio: 4,
    sideGain: clamp(0.5 + width, 0.5, 1.5),
    outputGain:
      controls.loudnessPreset === "streaming-loud"
        ? 1.28
        : controls.loudnessPreset === "clear-balanced"
          ? 1.16
          : 1.0,
  };
}

export function deriveBatchEnrichmentOptions(
  controls: PreviewControls,
): Omit<
  EnrichmentOptions,
  "generation" | "signal" | "isGenerationCurrent" | "onProgress"
> {
  const parameters = deriveProcessingParameters(controls);
  return Object.freeze({
    rumbleCut: true,
    highpassFrequency: parameters.highpassFrequency,
    highpassQ: parameters.highpassQ,
    presenceFrequency: parameters.presenceFrequency,
    presenceDb: parameters.presenceGain,
    presenceQ: parameters.presenceQ,
    compressorThresholdDb: parameters.compressorThreshold,
    compressorRatio: parameters.compressorRatio,
    width: parameters.sideGain,
    dialogueGain: parameters.outputGain,
  });
}

export function createDefaultState(): LocalPreviewState {
  return {
    mode: "source",
    status: "idle",
    message: "No source selected.",
    sourceKind: "unknown",
    positionSeconds: 0,
  };
}

export function createRealMediaPreviewController(
  mediaElement: HTMLMediaElement,
  options: MediaPreviewControllerOptions = {},
): LocalMediaPreviewController {
  const onError = options.onError;
  const supports = options.supports ?? isLikelySupportedAudioVideoFile;
  const crossfadeDurationSeconds = Math.max(
    0,
    (options.crossfadeDurationMs ?? DEFAULT_CROSSFADE_MS) / 1000,
  );
  const seekStep = clamp(
    options.seekStepSeconds ?? DEFAULT_SEEK_STEP_SECONDS,
    0.01,
    1,
  );

  let state: LocalPreviewState = createDefaultState();
  let controls: PreviewControls = { ...DEFAULT_CONTROL_VALUES };
  let mode: PreviewMode = "source";
  let graph: ProcessingGraph | null = null;
  let sourceUrl: string | null = null;
  let sourceToken = 0;
  let destroyed = false;
  const listeners = new Set<(state: LocalPreviewState) => void>();

  const update = (next: LocalPreviewState): void => {
    if (destroyed) return;
    state = next;
    for (const listener of listeners) listener(state);
  };

  const setMessage = (status: LocalPreviewStatus, message: string): void => {
    update({
      ...state,
      status,
      message,
      sourceName: state.sourceName,
      sourceKind: state.sourceKind,
      durationSeconds: state.durationSeconds,
      positionSeconds: state.positionSeconds,
    });
  };

  const applyPosition = () => {
    update({
      ...state,
      positionSeconds: Number.isFinite(mediaElement.currentTime)
        ? mediaElement.currentTime
        : 0,
      durationSeconds: Number.isFinite(mediaElement.duration)
        ? mediaElement.duration
        : state.durationSeconds,
      status:
        mediaElement.paused && state.status !== "ended"
          ? "paused"
          : state.status,
      sourceName: state.sourceName,
      sourceKind: state.sourceKind,
      message: state.message,
    });
  };

  const installMediaBindings = () => {
    const onTimeUpdate = () => applyPosition();
    const onPlay = () =>
      update({
        ...state,
        status: "playing",
        message: `${formatPreviewMode(mode)} playback active.`,
      });
    const onPause = () => {
      if (state.status === "ended") return;
      update({
        ...state,
        status: "paused",
        message: `${formatPreviewMode(mode)} paused.`,
      });
    };
    const onEnded = () =>
      update({
        ...state,
        status: "ended",
        message: `${formatPreviewMode(mode)} ended.`,
        positionSeconds: state.durationSeconds ?? 0,
      });
    const onErrorEvent = () => {
      const message = "Browser failed to decode selected media.";
      onError?.(message);
      update({
        ...state,
        status: "error",
        message,
      });
    };
    mediaElement.addEventListener("timeupdate", onTimeUpdate);
    mediaElement.addEventListener("play", onPlay);
    mediaElement.addEventListener("pause", onPause);
    mediaElement.addEventListener("ended", onEnded);
    mediaElement.addEventListener("error", onErrorEvent);
    return () => {
      mediaElement.removeEventListener("timeupdate", onTimeUpdate);
      mediaElement.removeEventListener("play", onPlay);
      mediaElement.removeEventListener("pause", onPause);
      mediaElement.removeEventListener("ended", onEnded);
      mediaElement.removeEventListener("error", onErrorEvent);
    };
  };

  const mediaCleanup = installMediaBindings();

  const detachSource = () => {
    if (!state.sourceName) return;
    mediaElement.pause();
    mediaElement.removeAttribute("src");
    mediaElement.load();
  };

  const closeGraph = () => {
    if (!graph) return;
    const { context, sourceNode } = graph;
    try {
      sourceNode.disconnect();
      for (const node of [
        graph.bypassGain,
        graph.processedGain,
        graph.sourceGain,
        graph.highpass,
        graph.presence,
        graph.compressor,
        graph.split,
        graph.leftToMid,
        graph.rightToMid,
        graph.leftToSide,
        graph.rightToSide,
        graph.midSum,
        graph.sideSum,
        graph.midToLeft,
        graph.midToRight,
        graph.sideToLeft,
        graph.sideToRight,
        ...(graph.processedDestination ? [graph.processedDestination] : []),
      ]) {
        node.disconnect();
      }
      context.close();
    } catch {
      // LEAKY ABSTRACTION: I-004 accepts best-effort Web Audio node cleanup because node
      // lifetime is browser-owned. The limit is that close/disconnect cannot be asserted
      // across browsers; replace with deterministic lifecycle probes while preserving one
      // media element, local object URLs, and safe fallback behavior. [[Implementation Package I-004 - Real Local Preview]]
    } finally {
      graph = null;
    }
  };

  const revokeObjectUrl = () => {
    if (!sourceUrl) return;
    URL.revokeObjectURL(sourceUrl);
    sourceUrl = null;
  };

  const buildGraph = (): ProcessingGraph => {
    const context = new AudioContext();
    // MediaElementSource takes over the element's audio route; clear the markup default so
    // the graph is audible and does not compete with the element's native output route.
    mediaElement.muted = false;
    mediaElement.removeAttribute("muted");
    const sourceNode = context.createMediaElementSource(mediaElement);
    const bypassGain = context.createGain();
    const processedGain = context.createGain();
    const sourceGain = context.createGain();
    const highpass = context.createBiquadFilter();
    const presence = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const split = context.createChannelSplitter(2);
    const leftToMid = context.createGain();
    const rightToMid = context.createGain();
    const leftToSide = context.createGain();
    const rightToSide = context.createGain();
    const midSum = context.createGain();
    const sideSum = context.createGain();
    const midToLeft = context.createGain();
    const midToRight = context.createGain();
    const sideToLeft = context.createGain();
    const sideToRight = context.createGain();
    const widthMerge = context.createChannelMerger(2);
    const processedDestination =
      typeof context.createMediaStreamDestination === "function"
        ? context.createMediaStreamDestination()
        : null;

    highpass.type = "highpass";
    presence.type = "peaking";
    highpass.Q.value = 0.9;
    presence.Q.value = 0.8;
    presence.gain.value = 1;
    sourceNode.connect(sourceGain);
    sourceGain.channelCount = 2;
    sourceGain.channelCountMode = "explicit";
    sourceGain.channelInterpretation = "speakers";
    sourceGain.connect(bypassGain);
    sourceGain.connect(highpass);
    highpass.connect(presence);
    presence.connect(compressor);
    compressor.connect(split);

    split.connect(leftToMid, 0);
    split.connect(rightToMid, 1);
    split.connect(leftToSide, 0);
    split.connect(rightToSide, 1);
    leftToMid.gain.value = 0.5;
    rightToMid.gain.value = 0.5;
    leftToSide.gain.value = 0.5;
    rightToSide.gain.value = -0.5;

    leftToMid.connect(midSum);
    rightToMid.connect(midSum);
    leftToSide.connect(sideSum);
    rightToSide.connect(sideSum);

    midSum.connect(midToLeft);
    midSum.connect(midToRight);
    sideSum.connect(sideToLeft);
    sideSum.connect(sideToRight);
    midToLeft.connect(widthMerge, 0, 0);
    sideToLeft.connect(widthMerge, 0, 0);
    midToRight.connect(widthMerge, 0, 1);
    sideToRight.connect(widthMerge, 0, 1);
    widthMerge.connect(processedGain);
    processedDestination && processedGain.connect(processedDestination);

    bypassGain.connect(context.destination);
    processedGain.connect(context.destination);
    bypassGain.gain.value = 1;
    processedGain.gain.value = 0;

    return {
      context,
      sourceNode,
      bypassGain,
      processedGain,
      sourceGain,
      highpass,
      presence,
      compressor,
      split,
      leftToMid,
      rightToMid,
      leftToSide,
      rightToSide,
      midSum,
      sideSum,
      midToLeft,
      midToRight,
      sideToLeft,
      sideToRight,
      widthMerge,
      processedDestination,
    };
  };

  const applyCrossfade = (target: PreviewMode): void => {
    if (!graph || graph.context.state === "closed") return;
    const now = graph.context.currentTime;
    const processed = target === "preview" ? 1 : 0;
    const bypass = target === "preview" ? 0 : 1;
    graph.processedGain.gain.cancelScheduledValues(now);
    graph.bypassGain.gain.cancelScheduledValues(now);
    graph.processedGain.gain.setValueAtTime(
      graph.processedGain.gain.value,
      now,
    );
    graph.bypassGain.gain.setValueAtTime(graph.bypassGain.gain.value, now);
    graph.processedGain.gain.linearRampToValueAtTime(
      processed,
      now + crossfadeDurationSeconds,
    );
    graph.bypassGain.gain.linearRampToValueAtTime(
      bypass,
      now + crossfadeDurationSeconds,
    );
  };

  const applyControls = (): void => {
    if (!graph || graph.context.state === "closed") return;
    const params = deriveProcessingParameters(controls);
    graph.highpass.frequency.setValueAtTime(
      params.highpassFrequency,
      graph.context.currentTime,
    );
    graph.highpass.Q.setValueAtTime(
      params.highpassQ,
      graph.context.currentTime,
    );
    graph.presence.frequency.setValueAtTime(
      params.presenceFrequency,
      graph.context.currentTime,
    );
    graph.presence.gain.setValueAtTime(
      params.presenceGain,
      graph.context.currentTime,
    );
    graph.presence.Q.setValueAtTime(
      params.presenceQ,
      graph.context.currentTime,
    );
    graph.compressor.threshold.setValueAtTime(
      params.compressorThreshold,
      graph.context.currentTime,
    );
    graph.compressor.ratio.setValueAtTime(
      params.compressorRatio,
      graph.context.currentTime,
    );
    graph.sideToLeft.gain.setValueAtTime(
      params.sideGain,
      graph.context.currentTime,
    );
    graph.sideToRight.gain.setValueAtTime(
      -params.sideGain,
      graph.context.currentTime,
    );
    graph.sourceGain.gain.setValueAtTime(1, graph.context.currentTime);
    graph.processedGain.gain.setValueAtTime(
      params.outputGain,
      graph.context.currentTime,
    );
  };

  const setMode = (next: PreviewMode): void => {
    if (next === mode) return;
    mode = next;
    applyCrossfade(mode);
    const suffix =
      state.status === "ready"
        ? " ready."
        : state.status === "playing"
          ? " playback active."
          : state.status === "paused"
            ? " paused."
            : state.status === "ended"
              ? " ended."
              : "";
    setMessage(state.status, `${formatPreviewMode(mode)}${suffix}`);
  };

  const setControls = (next: Partial<PreviewControls>): void => {
    const updated = { ...controls, ...next };
    if (
      updated.dialogueClean === controls.dialogueClean &&
      updated.musicWeight === controls.musicWeight &&
      updated.width === controls.width &&
      updated.ducking === controls.ducking &&
      updated.loudnessPreset === controls.loudnessPreset
    )
      return;
    controls = updated;
    applyControls();
  };

  const finalizeLoadMetadata = (file: File, token: number) =>
    new Promise<"ready" | "error" | "timeout">((resolve) => {
      if (!graph) return resolve("error");
      let finished = false;
      const cleanup = () => {
        if (!graph) return;
        mediaElement.removeEventListener("loadedmetadata", onLoadedMetadata);
        mediaElement.removeEventListener("error", onLoadError);
      };
      const finish = (status: "ready" | "error" | "timeout") => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        cleanup();
        if (token !== sourceToken || destroyed) return resolve(status);
        if (status === "ready") {
          applyControls();
          applyCrossfade(mode);
          update({
            mode,
            status: "ready",
            sourceKind: isVideo(file) ? "video" : "audio",
            sourceName: file.name,
            message: `${formatPreviewMode(mode)} ready.`,
            durationSeconds: Number.isFinite(mediaElement.duration)
              ? mediaElement.duration
              : 0,
            positionSeconds: 0,
          });
          resolve(status);
          return;
        }
        if (status === "error") {
          const message = "Could not load media for playback.";
          update({
            ...state,
            sourceName: file.name,
            sourceKind: isVideo(file) ? "video" : "audio",
            status: "error",
            message,
            positionSeconds: 0,
          });
          onError?.(message);
        } else {
          update({
            ...state,
            sourceName: file.name,
            sourceKind: isVideo(file) ? "video" : "audio",
            status: "error",
            message: "Timed out loading local source.",
            positionSeconds: 0,
          });
          onError?.("Timed out loading local source.");
        }
        resolve(status);
      };
      const timeoutId = setTimeout(() => finish("timeout"), PREVIEW_TIMEOUT_MS);
      const onLoadedMetadata = () => {
        finish("ready");
      };
      const onLoadError = () => {
        finish("error");
      };
      mediaElement.addEventListener("loadedmetadata", onLoadedMetadata, {
        once: true,
      });
      mediaElement.addEventListener("error", onLoadError, { once: true });
      mediaElement.load();
    });

  const loadSource = async (file: File): Promise<void> => {
    const previousState = { ...state };
    const previousUrl = sourceUrl;
    if (!supports(file)) {
      throw new Error(
        "Unsupported media container. Use WAV, MP3, M4A, AAC, FLAC, or MP4.",
      );
    }
    sourceToken += 1;
    const token = sourceToken;

    const nextUrl = URL.createObjectURL(file);
    mediaElement.pause();
    mediaElement.removeAttribute("src");
    mediaElement.load();
    mediaElement.src = nextUrl;
    update({
      ...state,
      status: "loading",
      sourceKind: isVideo(file) ? "video" : "audio",
      sourceName: file.name,
      message: "Loading local source.",
      positionSeconds: 0,
      durationSeconds: undefined,
    });

    // MediaElementAudioSourceNode can only be created once for a given element.
    // Reuse the graph across source replacements and only close it on destroy.
    if (!graph) graph = buildGraph();
    setMode(mode);
    applyControls();

    const loaded = await finalizeLoadMetadata(file, token);
    if (token !== sourceToken || destroyed) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    if (loaded === "ready") {
      if (previousUrl && previousUrl !== nextUrl)
        URL.revokeObjectURL(previousUrl);
      sourceUrl = nextUrl;
      update({
        ...state,
        status: "ready",
        sourceKind: isVideo(file) ? "video" : "audio",
        durationSeconds: Number.isFinite(mediaElement.duration)
          ? mediaElement.duration
          : state.durationSeconds,
      });
    } else {
      URL.revokeObjectURL(nextUrl);
      if (previousUrl) {
        sourceUrl = previousUrl;
        mediaElement.src = previousUrl;
        mediaElement.load();
        state = previousState;
        update(previousState);
      } else {
        sourceUrl = null;
      }
      throw new Error("Could not load media for playback.");
    }
    return;
  };

  const play = async (): Promise<void> => {
    if (!state.sourceName || state.status === "unsupported") return;
    if (!graph || graph.context.state === "closed") {
      graph = buildGraph();
      applyControls();
      applyCrossfade(mode);
    }
    try {
      if (graph.context.state === "suspended") await graph.context.resume();
      await mediaElement.play();
    } catch (cause) {
      const message =
        "Playback blocked by browser autoplay policy. Use the Play button after a gesture.";
      onError?.(message, cause);
      update({ ...state, status: "error", message });
    }
  };

  const resume = async (): Promise<void> => {
    if (!graph || graph.context.state === "closed") return;
    if (graph.context.state === "suspended") await graph.context.resume();
  };

  const pause = (): void => {
    mediaElement.pause();
    if (state.status !== "ended") {
      setMessage("paused", "Playback paused.");
    }
  };

  const seek = (seconds: number): void => {
    if (!state.durationSeconds || !Number.isFinite(seconds)) return;
    const clipped = clamp(seconds, 0, state.durationSeconds);
    const snapped = Math.round(clipped / seekStep) * seekStep;
    mediaElement.currentTime = snapped;
    applyPosition();
  };

  return {
    destroy() {
      destroyed = true;
      mediaCleanup();
      closeGraph();
      revokeObjectUrl();
      detachSource();
      listeners.clear();
      state = {
        ...state,
        status: "idle",
        sourceName: undefined,
        message: "Preview disposed.",
        durationSeconds: undefined,
        positionSeconds: 0,
      };
    },
    loadSource,
    setMode,
    setControls,
    play,
    resume,
    pause,
    seek,
    getState() {
      return { ...state };
    },
    getProcessedStream() {
      return graph?.processedDestination?.stream ?? null;
    },
    onStateChange(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
