import "./styles.css";
import {
  capabilityLabel,
  collectBrowserCapabilityReport,
  type BrowserCapabilityReport,
  type CapabilityCheck,
} from "./capabilities/browser-capabilities";
import {
  initialDeviceState,
  shellConnectionLabel,
  type DeviceState,
} from "./lib/device-state";
import {
  createOpaqueId,
  nextGeneration,
  type JobId,
  type ProjectId,
} from "./lib/app-state";
import { registerAndVerifyShell } from "./lib/offline-shell";
import {
  compareModeLabel,
  currentExportManifest,
  deriveRegionInCanonicalFrames,
  buildResourceProfiles,
  DEMO_CANONICAL_FRAMES,
  DEMO_FIXTURE,
  type ExperienceEvent,
  type ExperienceState,
  type LoudnessPreset,
  type FrameRange,
  type SourceKind,
  type MixBusId,
  type MixControls,
  sourceKindFromFileName,
  supportsDemoSource,
  toSeconds,
} from "./lib/experience-state";
import {
  LifecycleCoordinator,
  type LifecycleState,
  type LifecycleCommand,
  type PhaseNeutralExperienceEvent,
} from "./lib/lifecycle-coordinator";
import { createDeterministicFixtureDriver } from "./lib/deterministic-driver";
import type {
  ExperienceDriver,
  PreparedSourcePayload,
} from "./lib/experience-state";
import {
  createRealMediaPreviewController,
  type LocalMediaPreviewController,
  type PreviewControls,
} from "./media/real-local-preview";
import {
  startProcessedOutput,
  type ProcessedOutputJob,
} from "./media/processed-output";
import { createLocalAudioExtractionController } from "./media/local-audio-extraction";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root is missing.");
const fixtureMode =
  new URLSearchParams(window.location.search).get("fixture") === "1";

const lifecycleCoordinator = new LifecycleCoordinator();
let lifecycleState: LifecycleState = lifecycleCoordinator.state;
let projectState = lifecycleState.project;
let deviceState: DeviceState = initialDeviceState;
let online = navigator.onLine;
let capabilityReport: BrowserCapabilityReport | undefined;
let capabilityProbeRunning = false;
let capabilityError: string | undefined;
let renderedCapabilityReport: BrowserCapabilityReport | undefined;
let renderedCapabilityError: string | undefined;
let importMessage = "No source selected";
let experienceState: ExperienceState = lifecycleState.experience;
const lifecycleDriver: ExperienceDriver = createDeterministicFixtureDriver();
const mediaMetadataTimeoutMs = 12_000;
let mediaLoadInFlight = false;
const fixtureFailureChunk = Number(
  new URLSearchParams(window.location.search).get("fixtureFailureChunk") ?? 0,
);
const fixtureExportFailure =
  new URLSearchParams(window.location.search).get("fixtureExportFailure") ===
  "true";
const fixtureExportDelayMs = Math.max(
  250,
  Number(
    new URLSearchParams(window.location.search).get("fixtureExportDelayMs") ??
      250,
  ) || 250,
);
let fixtureFailureConsumed = false;
let fixtureExportFailureConsumed = false;
let disposeEnhance: (() => void) | undefined;
let disposeExport: (() => void) | undefined;
let advancedDisclosureInitialized = false;
let exportDisclosureInitialized = false;
let fixtureDisclosureInitialized = false;
let processedOutputJob: ProcessedOutputJob | undefined;
let processedOutputUrl: string | undefined;
let disposeProcessedOutput: (() => Promise<void>) | undefined;

function formatBytes(value: number): string {
  if (value < 1000) return `${value} B`;
  const units = ["kB", "MB", "GB", "TB"] as const;
  let scale = value;
  for (const unit of units) {
    scale /= 1000;
    if (scale < 1000)
      return `${scale >= 100 ? Math.round(scale) : scale.toFixed(1)} ${unit}`;
  }
  return `${scale.toFixed(1)} PB`;
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeText(value: string | null | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toSourceCodec(file: File, kind: SourceKind): string {
  if (kind === "video") {
    return safeText(file.type, "video/mp4");
  }
  return safeText(
    file.type,
    file.name.toLowerCase().endsWith(".wav")
      ? "audio/wav"
      : file.name.toLowerCase().endsWith(".flac")
        ? "audio/flac"
        : file.name.toLowerCase().endsWith(".m4a")
          ? "audio/mp4"
          : "audio/aac",
  );
}

function buildSourceFailureState(
  file: File,
  details?: string,
): PreparedSourcePayload {
  return {
    source: {
      sourceId: `import-fallback-${file.name}-${file.size}`,
      sourceVersion: `size-${file.size}`,
      sourceBytes: file.size,
      sourceDurationSeconds: 0,
      video: {
        codec: "video/mp4",
        fpsApprox: "N/A",
        durationSeconds: 0,
      },
      audio: {
        codec: toSourceCodec(file, sourceKindFromFileName(file.name)),
        durationSeconds: 0,
      },
    },
    sourceKind: sourceKindFromFileName(file.name),
    capabilities: {
      dereverb: "unavailable" as const,
      reason:
        details ??
        "Could not inspect media metadata in browser; preview path remains metadata-only.",
    },
    profiles: fixtureMode ? buildResourceProfiles() : [],
    selectedProfileId: undefined,
  };
}

function mediaMetadataElement(
  sourceKind: SourceKind,
  url: string,
): HTMLVideoElement | HTMLAudioElement {
  const media =
    sourceKind === "video" ? document.createElement("video") : new Audio();
  media.preload = "metadata";
  media.src = url;
  media.muted = true;
  return media;
}

function probeMediaMetadata(file: File): Promise<{
  duration: number;
  width?: number;
  height?: number;
  codec: string;
}> {
  const sourceKind = sourceKindFromFileName(file.name);
  const mediaUrl = URL.createObjectURL(file);
  const media = mediaMetadataElement(sourceKind, mediaUrl);

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      media.remove();
      URL.revokeObjectURL(mediaUrl);
      reject(new Error("Media metadata probe timed out after 12s."));
    }, mediaMetadataTimeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      media.remove();
      URL.revokeObjectURL(mediaUrl);
    };
    media.addEventListener(
      "loadedmetadata",
      () => {
        const duration = safeNumber(media.duration);
        cleanup();
        resolve({
          duration,
          width:
            media instanceof HTMLVideoElement
              ? media.videoWidth || undefined
              : undefined,
          height:
            media instanceof HTMLVideoElement
              ? media.videoHeight || undefined
              : undefined,
          codec: toSourceCodec(file, sourceKind),
        });
      },
      { once: true },
    );
    media.addEventListener(
      "error",
      () => {
        const cause =
          media.error?.message ??
          `Unable to probe ${sourceKind} metadata for ${file.name}`;
        cleanup();
        reject(new Error(cause));
      },
      { once: true },
    );
    media.load();
  });
}

async function buildPreparedSourcePayload(
  file: File,
): Promise<PreparedSourcePayload> {
  const sourceKind = sourceKindFromFileName(file.name);
  const sourceId = `${sourceKind}-import-${file.name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")}-${file.size}`;
  const sourceVersion = `import-${file.lastModified}-${Math.max(file.size, 1)}`;

  const fallback = buildSourceFailureState(file);
  const metadata = await probeMediaMetadata(file).catch((cause) => {
    const reason =
      cause instanceof Error ? cause.message : "media metadata probe failed";
    importMessage = `Falling back to filename heuristics for ${file.name}: ${reason}`;
    updateUi();
    return {
      duration: safeNumber(fallback.source.sourceDurationSeconds),
      width: undefined,
      height: undefined,
      codec: fallback.source.audio.codec,
      isFallback: true,
    };
  });

  const normalizedDuration = safeNumber(metadata.duration);
  // LEAKY ABSTRACTION: I-004 reports browser MIME and duration, while channel count and
  // sample rate remain unknown because metadata probing does not parse bitstream headers.
  // Accepted to avoid whole-file reads; the limit is incomplete source detail. Replace with
  // a bounded container parser when the source contract requires measured audio shape.
  // [[Implementation Package I-004 - Real Local Preview]]
  return {
    source: {
      sourceId,
      sourceVersion,
      sourceBytes: file.size,
      sourceDurationSeconds: normalizedDuration,
      video: {
        codec: metadata.codec,
        width: metadata.width,
        height: metadata.height,
        fpsApprox: sourceKind === "video" ? "probe" : "N/A",
        durationSeconds: normalizedDuration,
      },
      audio: {
        codec: metadata.codec,
        durationSeconds: normalizedDuration,
      },
    },
    sourceKind,
    capabilities: {
      dereverb: "unavailable" as const,
      reason:
        "Experimental dereverb is disabled in this metadata-first ingest path.",
    },
    profiles: fixtureMode ? buildResourceProfiles() : [],
    selectedProfileId: undefined,
  };
}

function statusText(check: CapabilityCheck, value = ""): string {
  const details = check.details ? ` · ${check.details}` : "";
  return escapeHtml(
    `${capabilityLabel(check)}${value ? ` ${value}` : ""}${details}`,
  );
}

function escapeHtml(value: string): string {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function diagnosticsMarkup(report: BrowserCapabilityReport): string {
  const webgpu = report.webgpu;
  const limits =
    Object.entries(webgpu.limits)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ") || "not exposed";
  const lossText = webgpu.deviceLoss.observed
    ? escapeHtml(
        `${webgpu.deviceLoss.reason ?? "unknown reason"}${
          webgpu.deviceLoss.message ? `: ${webgpu.deviceLoss.message}` : ""
        }`,
      )
    : "No loss observed during this probe";
  const computeText = webgpu.computeCheck.expected ?? "";
  const computeActualText =
    webgpu.computeCheck.actual === undefined
      ? ""
      : ` / ${webgpu.computeCheck.actual}`;

  return `<div class="mix-heading">
      <div><p class="eyebrow">LOCAL DIAGNOSTIC</p><h2 id="diagnostics-title" tabindex="-1">Browser capability report</h2></div>
      <time datetime="${escapeHtml(report.generatedAt)}">${escapeHtml(new Date(report.generatedAt).toLocaleString())}</time>
    </div>
    <p class="diagnostic-note">This report stays in this tab. WebGPU availability does not qualify ONNX model operators; model qualification stays in a separate probe.</p>
    <div class="diagnostic-grid">
      <div><h3>Runtime</h3>
        <div class="diagnostic-row"><span>Secure context</span><strong class="diagnostic-${report.secureContext.status}">${statusText(report.secureContext)}</strong></div>
        <div class="diagnostic-row"><span>Cross-origin isolated</span><strong class="diagnostic-${report.crossOriginIsolated.status}">${statusText(report.crossOriginIsolated)}</strong></div>
        <div class="diagnostic-row"><span>CPU threads</span><strong class="diagnostic-${report.hardwareConcurrency.status}">${statusText(report.hardwareConcurrency, report.hardwareConcurrency.value?.toString() ?? "")}</strong></div>
        <div class="diagnostic-row"><span>SharedArrayBuffer</span><strong class="diagnostic-${report.sharedArrayBuffer.status}">${statusText(report.sharedArrayBuffer)}</strong></div>
        <div class="diagnostic-row"><span>WebAssembly</span><strong class="diagnostic-${report.wasm.status}">${statusText(report.wasm)}</strong></div>
      </div>
      <div><h3>Storage and audio</h3>
        <div class="diagnostic-row"><span>Storage</span><strong class="diagnostic-${report.storage.status}">${statusText(report.storage, report.storage.value ? `${formatBytes(report.storage.value.usageBytes ?? 0)} used / ${formatBytes(report.storage.value.quotaBytes ?? 0)} quota` : "")}</strong></div>
        <div class="diagnostic-row"><span>OPFS</span><strong class="diagnostic-${report.opfs.status}">${statusText(report.opfs)}</strong></div>
        <div class="diagnostic-row"><span>IndexedDB</span><strong class="diagnostic-${report.indexedDb.status}">${statusText(report.indexedDb)}</strong></div>
        <div class="diagnostic-row"><span>Service worker API</span><strong class="diagnostic-${report.serviceWorker.status}">${statusText(report.serviceWorker)}</strong></div>
        <div class="diagnostic-row"><span>AudioContext</span><strong class="diagnostic-${report.audio.context.status}">${statusText(report.audio.context, report.audio.actualSampleRateHz ? `${report.audio.actualSampleRateHz} Hz` : "")}</strong></div>
        <div class="diagnostic-row"><span>AudioWorklet</span><strong class="diagnostic-${report.audio.audioWorklet.status}">${statusText(report.audio.audioWorklet)}</strong></div>
      </div>
      <div><h3>WebGPU</h3>
        <div class="diagnostic-row"><span>API</span><strong class="diagnostic-${webgpu.api.status}">${statusText(webgpu.api)}</strong></div>
        <div class="diagnostic-row"><span>Adapter</span><strong class="diagnostic-${webgpu.adapter.status}">${statusText(webgpu.adapter, webgpu.adapterName ? webgpu.adapterName : "")}</strong></div>
        <div class="diagnostic-row"><span>Device</span><strong class="diagnostic-${webgpu.device.status}">${statusText(webgpu.device)}</strong></div>
        <div class="diagnostic-row"><span>Compute check</span><strong class="diagnostic-${webgpu.computeCheck.status}">${statusText(webgpu.computeCheck, `${computeText}${computeActualText}`)}</strong></div>
        <div class="diagnostic-row"><span>ONNX qualification</span><strong class="diagnostic-${webgpu.onnxModelQualification.status}">${statusText(webgpu.onnxModelQualification, "separate probe")}</strong></div>
      </div>
    </div>
    <p class="diagnostic-details"><strong>WebGPU features:</strong> ${escapeHtml(webgpu.features.join(", ") || "none reported")}<br><strong>Selected limits:</strong> ${escapeHtml(limits)}<br><strong>Device loss observed:</strong> ${lossText}</p>
    <details><summary>User agent</summary><code>${escapeHtml(report.userAgent)}</code></details>`;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

app.innerHTML = `<main class="workstation">
  <header class="topbar">
    <a class="brand" href="./" aria-label="Cinematic Audio Workstation home"><span aria-hidden="true">▮▮▮</span> Cinematic Audio</a>
    <output id="connection-status" class="connection" aria-live="polite" aria-atomic="true"></output>
  </header>
  <section class="hero" aria-labelledby="page-title">
    <p class="eyebrow">AUDIO ENHANCEMENT WORKSPACE</p>
      <h1 id="page-title">Make every word easier to hear.</h1>
      <p>${fixtureMode ? "This is a local workflow demo: files stay on this device and the enhancement plan is simulated." : "This is a local workflow: your file stays on this device while its preview and audio preparation run locally."}</p>
  </section>
  <section class="setup-card" aria-labelledby="setup-title">
    <div><p class="eyebrow">DEVICE SETUP</p><h2 id="setup-title">Model packages are not installed</h2><p id="setup-status" aria-live="polite" aria-atomic="true"></p></div>
    <details id="setup-details">
      <summary>Show device diagnostics</summary>
      <p id="setup-help" class="sr-only">Checks browser, storage, audio, and WebGPU APIs locally. Model installation is not implemented.</p>
      <button type="button" class="secondary" id="run-diagnostics" aria-describedby="setup-help">Run setup check</button>
      <p id="diagnostics-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
    </details>
  </section>
  <section id="diagnostics" class="diagnostics" aria-labelledby="diagnostics-title" hidden></section>
  <section class="workspace" aria-label="Project workspace">
    <div class="import-panel">
      <p class="eyebrow">01 · SOURCE</p>
      <h2 id="source-title">Upload a local file</h2>
      <label class="file-picker"><span>Choose file</span><small>WAV, MP3, M4A, AAC, FLAC, or MP4 for local preview and planning</small><input id="media-file" accept="audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/flac,video/mp4,.flac,.wav,.mp3,.m4a,.aac,.mp4" type="file"></label>
      <p id="selection-status" class="selection" role="status" aria-live="polite" aria-atomic="true"></p>
      <p id="audio-cache-status" class="selection" role="status" aria-live="polite" aria-atomic="true"></p>
      <progress id="audio-cache-progress" max="100" value="0" hidden aria-label="Local audio preparation progress"></progress>
      <div class="row-actions">
        <button type="button" id="start-audio-cache" class="secondary" hidden>Start preparation</button>
        <button type="button" id="cancel-audio-cache" class="secondary" hidden>Cancel preparation</button>
      </div>
      <details id="fixture-disclosure" class="fixture-disclosure"${fixtureMode ? " open" : ""}>
        <summary>${fixtureMode ? "Demo mode details" : "Source import note"}</summary>
        <p id="fixture-summary" class="fixture-summary"></p>
      </details>
      <div id="source-metadata" class="metadata"></div>
      <figure id="preview-spotlight" class="preview-spotlight">
        <video id="local-media-preview" aria-label="Local media preview" preload="metadata" playsinline muted></video>
        <div class="row-actions">
          <button type="button" id="preview-play" disabled>Play</button>
          <button type="button" id="preview-pause" disabled>Pause</button>
        </div>
        <label class="control-help" for="preview-seek">Playback position</label>
        <input id="preview-seek" min="0" max="0" step="0.1" type="range" value="0" disabled />
        <p id="preview-status" class="region-guard" aria-live="polite" aria-atomic="true"></p>
      </figure>
      <section class="output-card" aria-labelledby="output-title">
        <h3 id="output-title">Save a processed preview</h3>
        <p class="control-help">Creates an audio-only file from the processed sound. This temporary exporter runs at playback speed and uses the preview player until it finishes or you cancel. Everything stays on this device.</p>
        <progress id="output-progress" value="0" max="100" hidden aria-label="Processed file creation progress" aria-describedby="output-status"></progress>
        <p id="output-status" class="region-guard" role="status" aria-live="polite"></p>
        <div class="row-actions"><button type="button" id="create-output" class="primary">Create processed file</button><button type="button" id="cancel-output" class="secondary">Cancel</button></div>
        <audio id="output-preview" controls hidden></audio>
        <a id="output-download" hidden></a>
      </section>
    </div>
    <div class="mix-panel">
      <div class="mix-heading">
        <div>
          <p class="eyebrow">02 · ENHANCE</p>
          <h2>Your enhancement</h2>
        </div>
        <span id="project-phase" class="phase"></span>
      </div>
      <output id="project-status" class="sr-only" aria-live="polite" aria-atomic="true"></output>
      <div class="status"><strong>Experience status</strong><span id="experience-status" role="status" aria-live="polite" aria-atomic="true"></span></div>
      <section class="recommendation" aria-labelledby="recommendation-heading">
        <p class="eyebrow">RECOMMENDED SETUP</p>
        <h3 id="recommendation-heading">${fixtureMode ? "Start with the default enhancement" : "Start with the balanced processed preview"}</h3>
        <p>${fixtureMode ? "We will start with a balanced preset designed to improve speech clarity while keeping background sound calm and natural." : "The processed preview starts with gentle speech-focused filtering. Listen to Source and Preview, adjust the optional sound controls if needed, then create the audio-only file."}</p>
      </section>
      <div class="journey-grid">
        <details id="advanced-controls" class="advanced-disclosure">
          <summary>Show optional sound details <small>for advanced tuning</small></summary>
          <section class="control-card" aria-labelledby="intention-heading">
          <h3 id="intention-heading">Enhancement intention</h3>
          <p class="control-help">${fixtureMode ? "These controls define how the next simulated enhancement is configured." : "These controls adjust the processed preview you hear and save."}</p>
          <div class="control-row">
            <label for="control-dialogue">Speech clarity <small>Make voices easier to understand</small></label>
            <input type="range" min="0" max="100" step="1" id="control-dialogue" />
            <span id="control-dialogue-value" class="control-value"></span>
          </div>
          <div class="control-row checkbox">
            <input type="checkbox" id="control-dereverb" aria-describedby="dereverb-status" />
            <label for="control-dereverb">Experiment: Dereverb</label>
          </div>
          <p id="dereverb-status" class="region-guard"></p>
          <div class="control-row">
            <label for="control-music">Music level <small>Available after stem separation</small></label>
            <input type="range" min="0" max="100" step="1" id="control-music" />
            <span id="control-music-value" class="control-value"></span>
          </div>
          <div class="control-row">
            <label for="control-width">Stereo width <small>Make sound feel wider or more centered</small></label>
            <input type="range" min="0" max="100" step="1" id="control-width" />
            <span id="control-width-value" class="control-value"></span>
          </div>
          <div class="control-row">
            <label for="control-ducking">Music under speech <small>Available after stem separation</small></label>
            <input type="range" min="0" max="100" step="1" id="control-ducking" />
            <span id="control-ducking-value" class="control-value"></span>
          </div>
          <div class="control-row">
            <label for="control-loudness">Overall loudness <small>Measured loudness control is coming later</small></label>
            <select id="control-loudness">
              <option value="preserve-dynamics">Preserve Dynamics</option>
              <option value="clear-balanced">Clear &amp; Balanced</option>
              <option value="streaming-loud">Streaming Loud</option>
            </select>
          </div>
          <div class="row-actions">
            <button type="button" id="compare-source">Source</button>
            <button type="button" id="compare-preview">Preview</button>
            <button type="button" id="undo-preview">Undo</button>
            <button type="button" id="reset-controls">Reset</button>
          </div>
          </section>

        <section class="control-card" aria-labelledby="preview-heading">
          <h3 id="preview-heading">Preview state</h3>
          <p class="control-help">Review planning parameters for a short segment.</p>
          <div class="control-row">
            <label for="region-start">Start time (seconds)</label>
            <input type="number" min="0" max="${DEMO_CANONICAL_FRAMES / 48000}" id="region-start" step="0.1" />
          </div>
          <div class="control-row">
            <label for="region-end">End time (seconds)</label>
            <input type="number" min="0.1" max="${DEMO_CANONICAL_FRAMES / 48000}" id="region-end" step="0.1" />
          </div>
          <p class="region-guard">This segment selection is preview-only and used for planning visuals.</p>
          </section>

          <section class="control-card" aria-labelledby="plans-heading">
          <h3 id="plans-heading">Quality profiles (D-011)</h3>
          <p class="control-help">A profile is a tradeoff between speed, memory, and sound detail. The recommended option is selected for you.</p>
          <div id="resource-profiles"></div>
          </section>
        </details>

          <details id="simulated-planning" class="advanced-disclosure"${fixtureMode ? " open" : ""}>
          <summary>Demo planning (simulated) <small>for testing the interface</small></summary>
          <section class="control-card" aria-labelledby="progress-heading">
          <h3 id="progress-heading">Enhance</h3>
          <p class="control-help">When you click <strong>Run Enhance</strong>, the page simulates the planned pipeline using source metadata.</p>
          <div class="progress-meta"><span id="plan-chunks">Plan: not started</span><span id="enhance-progress-text">No active plan</span></div>
          <progress id="enhance-progress" value="0" max="100" aria-label="Simulated enhancement plan progress" aria-describedby="enhance-progress-text"></progress>
          <div class="row-actions">
            <button type="button" id="run-enhance" class="primary">Run Enhance</button>
            <button type="button" id="cancel-enhance" class="secondary">Cancel</button>
            <button type="button" id="retry-enhance" class="secondary">Retry</button>
            <button type="button" id="reset-enhance" class="secondary">Reset</button>
          </div>
          <label class="checkbox-line"><input type="checkbox" id="scene-region" /> Include acoustic-scene region (if useful)</label>
          <p id="scene-region-status" class="region-guard"></p>
        </section>
          </details>

        <details id="export-details" class="advanced-disclosure">
          <summary>Optional export options <small>for finished files</small></summary>
          <section class="control-card" aria-labelledby="stem-heading">
          <h3 id="stem-heading">Mix controls and export stems</h3>
          <p class="control-help">Stems are separate sound parts, such as speech or music. Choose which parts to include in a simulated export.</p>
          <div id="stem-controls"></div>
          <label class="checkbox-line"><input type="checkbox" id="finished-mix-export"> Include finished mix in export</label>
          <p id="export-summary" class="region-guard"></p>
          <button type="button" id="run-export" class="primary">Simulate export with selected stems</button>
          <p id="assembled-preview" class="assembled-preview"></p>
          </section>
        </details>
      </div>
    </div>
  </section>
  <footer>Foundation build · No audio leaves this browser</footer>
</main>`;

const connectionStatus =
  requiredElement<HTMLOutputElement>("#connection-status");
const setupStatus = requiredElement<HTMLParagraphElement>("#setup-status");
const diagnostics = requiredElement<HTMLElement>("#diagnostics");
const diagnosticsButton =
  requiredElement<HTMLButtonElement>("#run-diagnostics");
const diagnosticsStatus = requiredElement<HTMLParagraphElement>(
  "#diagnostics-status",
);
const input = requiredElement<HTMLInputElement>("#media-file");
const selectionStatus =
  requiredElement<HTMLParagraphElement>("#selection-status");
const audioCacheStatus = requiredElement<HTMLParagraphElement>(
  "#audio-cache-status",
);
const startAudioCache =
  requiredElement<HTMLButtonElement>("#start-audio-cache");
const cancelAudioCache = requiredElement<HTMLButtonElement>(
  "#cancel-audio-cache",
);
const audioCacheProgress = requiredElement<HTMLProgressElement>(
  "#audio-cache-progress",
);
const projectPhase = requiredElement<HTMLSpanElement>("#project-phase");
const projectStatus = requiredElement<HTMLOutputElement>("#project-status");
const experienceStatus = requiredElement<HTMLSpanElement>("#experience-status");
const fixtureSummary =
  requiredElement<HTMLParagraphElement>("#fixture-summary");
const fixtureDisclosure = requiredElement<HTMLDetailsElement>(
  "#fixture-disclosure",
);
const sourceMetadata = requiredElement<HTMLElement>("#source-metadata");
const profilesContainer = requiredElement<HTMLElement>("#resource-profiles");
const progressText = requiredElement<HTMLSpanElement>("#enhance-progress-text");
const planChunksText = requiredElement<HTMLSpanElement>("#plan-chunks");
const progressBar = requiredElement<HTMLProgressElement>("#enhance-progress");
const runEnhance = requiredElement<HTMLButtonElement>("#run-enhance");
const cancelEnhance = requiredElement<HTMLButtonElement>("#cancel-enhance");
const retryEnhance = requiredElement<HTMLButtonElement>("#retry-enhance");
const resetEnhance = requiredElement<HTMLButtonElement>("#reset-enhance");
const controlDialogue = requiredElement<HTMLInputElement>("#control-dialogue");
const controlDialogueValue = requiredElement<HTMLSpanElement>(
  "#control-dialogue-value",
);
const controlDereverb = requiredElement<HTMLInputElement>("#control-dereverb");
const dereverbStatus =
  requiredElement<HTMLParagraphElement>("#dereverb-status");
const controlMusic = requiredElement<HTMLInputElement>("#control-music");
const controlMusicValue = requiredElement<HTMLSpanElement>(
  "#control-music-value",
);
const controlWidth = requiredElement<HTMLInputElement>("#control-width");
const controlWidthValue = requiredElement<HTMLSpanElement>(
  "#control-width-value",
);
const controlDucking = requiredElement<HTMLInputElement>("#control-ducking");
const controlDuckingValue = requiredElement<HTMLSpanElement>(
  "#control-ducking-value",
);
const controlLoudness = requiredElement<HTMLSelectElement>("#control-loudness");
const compareSource = requiredElement<HTMLButtonElement>("#compare-source");
const comparePreview = requiredElement<HTMLButtonElement>("#compare-preview");
const undoPreview = requiredElement<HTMLButtonElement>("#undo-preview");
const resetControls = requiredElement<HTMLButtonElement>("#reset-controls");
const localMediaElement = requiredElement<HTMLVideoElement>(
  "#local-media-preview",
);
const previewPlayButton = requiredElement<HTMLButtonElement>("#preview-play");
const previewPauseButton = requiredElement<HTMLButtonElement>("#preview-pause");
const previewSeek = requiredElement<HTMLInputElement>("#preview-seek");
const previewStatus = requiredElement<HTMLParagraphElement>("#preview-status");
const outputProgress = requiredElement<HTMLProgressElement>("#output-progress");
const outputStatus = requiredElement<HTMLParagraphElement>("#output-status");
const createOutput = requiredElement<HTMLButtonElement>("#create-output");
const cancelOutput = requiredElement<HTMLButtonElement>("#cancel-output");
const outputPreview = requiredElement<HTMLAudioElement>("#output-preview");
const outputDownload = requiredElement<HTMLAnchorElement>("#output-download");
const regionStart = requiredElement<HTMLInputElement>("#region-start");
const regionEnd = requiredElement<HTMLInputElement>("#region-end");
const stemControls = requiredElement<HTMLElement>("#stem-controls");
const exportSummary = requiredElement<HTMLParagraphElement>("#export-summary");
const runExport = requiredElement<HTMLButtonElement>("#run-export");
const finishedMixExport = requiredElement<HTMLInputElement>(
  "#finished-mix-export",
);
const assembledPreview =
  requiredElement<HTMLParagraphElement>("#assembled-preview");
const sceneRegion = requiredElement<HTMLInputElement>("#scene-region");
const sceneRegionStatus = requiredElement<HTMLParagraphElement>(
  "#scene-region-status",
);
const advancedControls =
  requiredElement<HTMLDetailsElement>("#advanced-controls");
const exportDetails = requiredElement<HTMLDetailsElement>("#export-details");
const localPreviewController: LocalMediaPreviewController =
  createRealMediaPreviewController(localMediaElement, {
    onError(message, cause) {
      importMessage =
        cause instanceof Error ? `${message}: ${cause.message}` : message;
      updateUi();
    },
  });
const audioExtractionController = createLocalAudioExtractionController(
  (message) => {
    audioCacheStatus.textContent = message;
    updateUi();
  },
);
audioExtractionController.onStateChange(() => queueMicrotask(updateUi));
startAudioCache.addEventListener(
  "click",
  () => void audioExtractionController.start(),
);
cancelAudioCache.addEventListener("click", () => {
  cancelAudioCache.disabled = true;
  void audioExtractionController.cancel().finally(updateUi);
});

const syncPreviewControls = (): PreviewControls => ({
  dialogueClean: Number(controlDialogue.value),
  musicWeight: Number(controlMusic.value),
  width: Number(controlWidth.value),
  ducking: Number(controlDucking.value),
  loudnessPreset: fixtureMode
    ? (controlLoudness.value as PreviewControls["loudnessPreset"])
    : "preserve-dynamics",
});

const isLocalBusy = (): boolean =>
  ["enhancing", "exporting"].includes(experienceState.phase) ||
  Boolean(processedOutputJob);

const updateLocalPreviewUi = (): void => {
  const previewState = localPreviewController.getState();
  const canCreateOutput =
    Boolean(previewState.sourceName) &&
    Number.isFinite(previewState.durationSeconds) &&
    (previewState.durationSeconds ?? 0) > 0 &&
    Boolean(localPreviewController.getProcessedStream()) &&
    ["ready", "playing", "paused", "ended"].includes(previewState.status);
  previewStatus.textContent = previewState.message;
  const hasDuration = Number.isFinite(previewState.durationSeconds ?? 0);
  previewSeek.disabled =
    !previewState.sourceName || !hasDuration || isLocalBusy();
  previewPlayButton.disabled = !previewState.sourceName || isLocalBusy();
  previewPauseButton.disabled = !previewState.sourceName || isLocalBusy();
  createOutput.disabled =
    fixtureMode || !canCreateOutput || Boolean(processedOutputJob);
  cancelOutput.disabled = !processedOutputJob;
  previewSeek.max = hasDuration
    ? String(Math.max(0, previewState.durationSeconds!))
    : "0";
  if (!previewSeek.matches(":active")) {
    previewSeek.value = String(
      clamp(previewState.positionSeconds, 0, previewState.durationSeconds ?? 0),
    );
  }
  previewPlayButton.textContent =
    previewState.status === "playing" ? "Resume" : "Play";
};

localPreviewController.onStateChange(() => {
  updateLocalPreviewUi();
});

function syncLifecycle(): void {
  projectState = lifecycleState.project;
  experienceState = lifecycleState.experience;
}

function sendExperienceEvent(event: ExperienceEvent): void {
  const explicit = [
    "CONTROL_CHANGED",
    "CONTROL_RESET",
    "UNDO_PREVIEW",
    "REGION_CHANGED",
  ].includes(event.type);
  lifecycleState = explicit
    ? lifecycleCoordinator.dispatch({
        type: "PREMIX_EVENT",
        event: event as Extract<
          ExperienceEvent,
          {
            type:
              | "CONTROL_CHANGED"
              | "CONTROL_RESET"
              | "UNDO_PREVIEW"
              | "REGION_CHANGED";
          }
        >,
      })
    : lifecycleCoordinator.dispatch({
        type: "EVENT",
        event: event as PhaseNeutralExperienceEvent,
      });
  syncLifecycle();
}

function sendLifecycleCommand(
  command: Exclude<LifecycleCommand, { type: "EVENT" }>,
): void {
  lifecycleState = lifecycleCoordinator.dispatch(command);
  syncLifecycle();
}

function stopEnhanceTimer(): void {
  disposeEnhance?.();
  disposeEnhance = undefined;
}

function selectedProfile(profileId?: string): string | undefined {
  return profileId ?? experienceState.selectedProfileId;
}

function runEnhanceSequence(): void {
  const chosenProfile = experienceState.profiles.find(
    (profile) =>
      profile.profileId === selectedProfile(experienceState.selectedProfileId),
  );
  if (!chosenProfile) return;
  if (
    experienceState.phase !== "enhancing" ||
    experienceState.activePlan?.jobId === undefined
  )
    return;
  const totalChunks = chosenProfile.requiredChunks;

  progressBar.max = totalChunks;
  progressBar.value = 0;
  planChunksText.textContent = `${chosenProfile.requiredChunks} planned chunks`;
  progressText.textContent =
    "Enhance simulation started for this source. No audio is uploaded.";

  stopEnhanceTimer();
  disposeEnhance = lifecycleDriver.startEnhance(
    {
      projectId: experienceState.projectId as ProjectId,
      generation: experienceState.generation,
      jobId: experienceState.activePlan?.jobId as JobId,
      chunksTotal: totalChunks,
      ...(fixtureFailureChunk > 0 && !fixtureFailureConsumed
        ? { failAtChunk: fixtureFailureChunk }
        : {}),
    },
    (event) => {
      if (event.type === "PLAN_PROGRESS") {
        lifecycleState = lifecycleCoordinator.dispatch({
          type: "PROCESSING_PROGRESS",
          projectId: event.projectId,
          generation: event.generation,
          jobId: event.jobId,
          chunksCompleted: event.chunksCompleted,
          chunksTotal: event.chunksTotal,
        });
        syncLifecycle();
        progressBar.value = event.chunksCompleted;
        progressText.textContent = `${Math.round((event.chunksCompleted / event.chunksTotal) * 100)}% of simulated plan checkpoints completed.`;
      } else if (event.type === "PLAN_COMPLETE") {
        sendLifecycleCommand({
          type: "PROCESSING_COMPLETED",
          projectId: event.projectId,
          generation: event.generation,
          jobId: event.jobId,
        });
      } else if (event.type === "PLAN_FAILED") {
        sendLifecycleCommand({
          type: "PROCESSING_FAILED",
          projectId: event.projectId,
          generation: event.generation,
          jobId: event.jobId,
          message: event.message,
        });
      }
      updateUi();
    },
  );
  if (fixtureFailureChunk > 0) fixtureFailureConsumed = true;
}

function runExportSequence(exportJob: JobId): void {
  disposeExport?.();
  disposeExport = lifecycleDriver.startExport(
    {
      projectId: experienceState.projectId as ProjectId,
      generation: experienceState.generation,
      jobId: exportJob,
      ...(fixtureExportFailure && !fixtureExportFailureConsumed
        ? { fail: true }
        : {}),
      delayMs: fixtureExportDelayMs,
    },
    (event) => {
      if (event.type === "EXPORT_COMPLETE")
        sendLifecycleCommand({
          type: "EXPORT_COMPLETED",
          projectId: event.projectId,
          generation: event.generation,
          jobId: event.jobId,
        });
      if (event.type === "EXPORT_FAILED")
        sendLifecycleCommand({
          type: "EXPORT_FAILED",
          projectId: event.projectId,
          generation: event.generation,
          jobId: event.jobId,
          message: event.message,
        });
      updateUi();
    },
  );
  if (fixtureExportFailure) fixtureExportFailureConsumed = true;
}

function updateSourceMetadata(): void {
  if (!experienceState.hasValidSource || !experienceState.selectedFixture) {
    sourceMetadata.replaceChildren(
      Object.assign(document.createElement("p"), {
        className: "metadata-empty",
        textContent: "No source metadata loaded.",
      }),
    );
    return;
  }
  const profile = experienceState.selectedFixture;
  fixtureSummary.textContent = fixtureMode
    ? "Synthetic fixture loaded. This demo only changes UI planning state and does not process real audio."
    : "Real local preview is ready. Audio preparation and processed preview stay on this device.";
  const sourceKind = experienceState.selectedSourceKind ?? "video";
  const paragraph = (label: string, value: string): HTMLParagraphElement => {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}:`;
    p.append(strong, ` ${value}`);
    return p;
  };
  const rows = [
    paragraph(
      "Source",
      `${sourceKind} · ${formatBytes(profile.sourceBytes)} · ${formatDuration(profile.sourceDurationSeconds)} total`,
    ),
  ];
  if (sourceKind === "video") {
    rows.push(
      paragraph(
        "Video",
        `${profile.video.width && profile.video.height ? `${profile.video.width}x${profile.video.height}` : "dimensions not measured"} · ${profile.video.codec} · ${profile.video.fpsApprox} fps`,
      ),
    );
  }
  const audioDetails =
    profile.audio.sampleRate && profile.audio.channels
      ? `${profile.audio.sampleRate} Hz · ${profile.audio.channels} ch`
      : "sample rate/channels not measured";
  rows.push(paragraph("Audio", `${audioDetails} · ${profile.audio.codec}`));
  sourceMetadata.replaceChildren(...rows);
}

function toFixtureRange(range: FrameRange): string {
  const converted = toSeconds(range);
  return `${formatDuration(converted.startSeconds)}–${formatDuration(converted.endSeconds)} (${range.endFrame - range.startFrame} frames)`;
}

function renderProfiles(): void {
  const selectedProfileId = experienceState.selectedProfileId;
  const busy =
    ["enhancing", "exporting"].includes(experienceState.phase) ||
    Boolean(processedOutputJob);
  const existing = new Map(
    Array.from(
      profilesContainer.querySelectorAll<HTMLElement>("[data-profile-id]"),
    ).map((node) => [node.dataset["profileId"], node]),
  );
  const nodes = experienceState.profiles.map((profile) => {
    let card = existing.get(profile.profileId);
    if (!card) {
      card = document.createElement("label");
      card.className = "profile-card";
      card.dataset["profileId"] = profile.profileId;
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "profile";
      radio.dataset["role"] = "profile-radio";
      const title = document.createElement("strong");
      title.dataset["role"] = "profile-title";
      const provider = document.createElement("p");
      provider.dataset["role"] = "provider";
      const identity = document.createElement("p");
      identity.dataset["role"] = "identity";
      const resources = document.createElement("p");
      resources.dataset["role"] = "resources";
      const ram = document.createElement("p");
      ram.dataset["role"] = "ram";
      const eta = document.createElement("p");
      eta.dataset["role"] = "eta";
      const blockers = document.createElement("p");
      blockers.dataset["role"] = "blockers";
      blockers.className = "profile-blockers";
      const tags = document.createElement("p");
      tags.dataset["role"] = "tags";
      tags.className = "profile-tags";
      card.append(
        radio,
        title,
        provider,
        identity,
        resources,
        ram,
        eta,
        blockers,
        tags,
      );
      profilesContainer.append(card);
    }
    const storageTotal =
      profile.persistentBytes.source +
      profile.persistentBytes.models +
      profile.persistentBytes.project +
      profile.persistentBytes.peakTemporary +
      profile.persistentBytes.output +
      profile.persistentBytes.reserve;
    const radio = card.querySelector<HTMLInputElement>(
      '[data-role="profile-radio"]',
    )!;
    radio.value = profile.profileId;
    radio.checked = selectedProfileId === profile.profileId;
    radio.disabled = busy || !profile.feasible;
    card.classList.toggle("is-blocked", !profile.feasible);
    card.querySelector<HTMLElement>(
      '[data-role="profile-title"]',
    )!.textContent = profile.profileId;
    card.querySelector<HTMLElement>('[data-role="provider"]')!.textContent =
      `Provider: ${profile.provider} · ${profile.sourceFidelity}`;
    card.querySelector<HTMLElement>('[data-role="identity"]')!.textContent =
      `Model/artifact: ${profile.modelArtifactIds.join(", ")} · ${profile.sourceVersion}`;
    card.querySelector<HTMLElement>('[data-role="resources"]')!.textContent =
      `Persistent storage: ${formatBytes(storageTotal - profile.persistentBytes.peakTemporary)} · Peak temporary storage: ${formatBytes(profile.persistentBytes.peakTemporary)}`;
    card.querySelector<HTMLElement>('[data-role="ram"]')!.textContent =
      `Peak RAM: ${formatBytes(profile.peakWorkingBytes.estimated)} (${profile.peakWorkingBytes.confidence})`;
    card.querySelector<HTMLElement>('[data-role="eta"]')!.textContent =
      `ETA: ${Math.round(profile.etaSeconds.low)}–${Math.round(profile.etaSeconds.high)}s (${profile.etaSeconds.confidence})`;
    card.querySelector<HTMLElement>('[data-role="blockers"]')!.textContent =
      profile.blockers.length ? `Blockers: ${profile.blockers.join(", ")}` : "";
    card.querySelector<HTMLElement>('[data-role="tags"]')!.textContent =
      `${profile.feasible ? "Feasible" : "Not feasible"} · assumptions: ${profile.assumptions.join(", ")}`;
    return card;
  });
  for (const node of existing.values())
    if (!nodes.includes(node)) node.remove();
  for (const node of nodes) profilesContainer.append(node);
}

function renderStemControls(): void {
  const enabled = experienceState.phase === "mix-ready";
  const busy = ["enhancing", "exporting"].includes(experienceState.phase);
  const existing = new Map(
    Array.from(
      stemControls.querySelectorAll<HTMLElement>("[data-stem-id]"),
    ).map((node) => [node.dataset["stemId"], node]),
  );
  const nodes = experienceState.stems.map((stem) => {
    let card = existing.get(stem.id);
    if (!card) {
      card = document.createElement("fieldset");
      card.className = "stem-card";
      card.dataset["stemId"] = stem.id;
      const legend = document.createElement("legend");
      legend.dataset["role"] = "label";
      card.append(legend);
      for (const [kind, text] of [
        ["mute", "Mute"],
        ["solo", "Solo"],
        ["export", "Include in export stems (D-015)"],
      ] as const) {
        const label = document.createElement("label");
        label.className = "checkbox-line";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset["action"] = kind === "export" ? "export" : "audition";
        input.dataset["kind"] = kind;
        input.dataset["bus"] = stem.id;
        label.append(input, ` ${text}`);
        card.append(label);
      }
      stemControls.append(card);
    }
    const fieldset = card as HTMLFieldSetElement;
    fieldset.disabled = !enabled || busy;
    card.querySelector<HTMLElement>('[data-role="label"]')!.textContent =
      stem.label;
    const inputs = Array.from(card.querySelectorAll<HTMLInputElement>("input"));
    if (inputs.length >= 3) {
      inputs[0]!.checked = stem.audition.muted;
      inputs[1]!.checked = stem.audition.soloed;
      inputs[2]!.checked = stem.exportInclude;
    }
    return card;
  });
  for (const node of existing.values())
    if (!nodes.includes(node)) node.remove();
  for (const node of nodes) stemControls.append(node);
}

function syncControls(): void {
  const busy =
    ["enhancing", "exporting"].includes(experienceState.phase) ||
    Boolean(processedOutputJob);
  // LEAKY ABSTRACTION: I-006 records the live processed preview bus at playback speed.
  // Keep that bus active for the full recording; a routine UI refresh must not switch it
  // back to source/bypass. Replace with a stateful offline renderer that preserves the
  // same committed control snapshot. [[Implementation Package I-006 - Real Bounded Output]]
  localPreviewController.setMode(
    processedOutputJob ? "preview" : experienceState.comparisonMode,
  );
  localPreviewController.setControls(syncPreviewControls());
  controlDialogue.value = String(experienceState.controlWorking.dialogueClean);
  controlDialogueValue.textContent = `${experienceState.controlWorking.dialogueClean}`;
  controlDereverb.checked = experienceState.controlWorking.dereverbEnabled;
  const dereverbUnavailable =
    experienceState.fixtureCapabilities?.dereverb === "unavailable";
  controlDereverb.disabled = busy || dereverbUnavailable;
  dereverbStatus.textContent = dereverbUnavailable
    ? `Unavailable in metadata mode: ${experienceState.fixtureCapabilities?.reason ?? "capability unavailable"}`
    : "Available for this source.";
  controlMusic.value = String(experienceState.controlWorking.musicWeight);
  controlMusicValue.textContent = `${experienceState.controlWorking.musicWeight}`;
  controlWidth.value = String(experienceState.controlWorking.width);
  controlWidthValue.textContent = `${experienceState.controlWorking.width}`;
  controlDucking.value = String(experienceState.controlWorking.ducking);
  controlDuckingValue.textContent = `${experienceState.controlWorking.ducking}`;
  controlLoudness.value = experienceState.controlWorking.loudnessPreset;
  controlLoudness.disabled = busy || !fixtureMode;
  controlLoudness.title = fixtureMode
    ? "Choose the simulated output profile"
    : "Measured loudness processing is deferred until the real export pipeline.";
  for (const control of [
    controlDialogue,
    controlMusic,
    controlWidth,
    controlDucking,
    controlLoudness,
    previewPlayButton,
    previewPauseButton,
    previewSeek,
    compareSource,
    comparePreview,
    undoPreview,
    resetControls,
    regionStart,
    regionEnd,
    sceneRegion,
    finishedMixExport,
    input,
  ]) {
    control.disabled = busy;
  }
  // LEAKY ABSTRACTION: I-004 leaves stem-dependent music/ducking controls disabled even
  // when idle because no separated stems exist in this slice. Accepted for honest behavior;
  // the limit is that these intents cannot affect preview. Replace with stem routing while
  // preserving disabled-state explanation: "Available after stem separation".
  // [[Implementation Package I-004 - Real Local Preview]]
  controlMusic.disabled = true;
  controlDucking.disabled = true;
  compareSource.setAttribute(
    "aria-pressed",
    experienceState.comparisonMode === "source" ? "true" : "false",
  );
  comparePreview.setAttribute(
    "aria-pressed",
    experienceState.comparisonMode === "preview" ? "true" : "false",
  );
  regionStart.value = toSeconds(experienceState.region).startSeconds.toFixed(1);
  regionEnd.value = toSeconds(experienceState.region).endSeconds.toFixed(1);
  sceneRegion.checked = experienceState.acousticRegionIncluded;
  sceneRegionStatus.textContent = experienceState.acousticRegion
    ? `Acoustic scene region ${toFixtureRange(experienceState.acousticRegion)}`
    : "No acoustic scene region present.";
  runEnhance.disabled = !experienceState.hasValidSource;
  cancelEnhance.disabled = !(
    experienceState.phase === "enhancing" &&
    experienceState.activePlan !== undefined
  );

  const selectedProfile = experienceState.profiles.find(
    (profile) => profile.profileId === experienceState.selectedProfileId,
  );
  if (selectedProfile && !selectedProfile.feasible) {
    runEnhance.disabled = true;
  }

  if (experienceState.activePlan) {
    progressBar.value = experienceState.activePlan.chunksCompleted;
    progressBar.max = experienceState.activePlan.chunksTotal;
    progressText.textContent = experienceState.activePlan.statusMessage;
    planChunksText.textContent = `${experienceState.activePlan.chunksCompleted}/${experienceState.activePlan.chunksTotal} chunks`;
  } else {
    progressBar.value = 0;
    progressText.textContent =
      experienceState.phase === "mix-ready"
        ? "Simulated plan is ready."
        : "No active plan yet.";
    planChunksText.textContent = "Plan: not started";
  }
  retryEnhance.disabled = experienceState.phase !== "recoverable-error";
  retryEnhance.textContent =
    lifecycleState.project.failedJob?.kind === "export"
      ? "Retry export"
      : "Retry";
  resetEnhance.disabled =
    !experienceState.hasValidSource ||
    ["enhancing", "exporting"].includes(experienceState.phase);

  const currentOutputs = currentExportManifest(experienceState);
  const snapshotText = experienceState.exportSnapshot
    ? ` · Last export: ${experienceState.exportSnapshot.outputs.join(", ")}`
    : "";
  exportSummary.textContent = currentOutputs.length
    ? `Current export selection: ${currentOutputs.join(", ")}${snapshotText}`
    : "No export outputs selected. Select at least one stem or include the finished mix before exporting.";
  finishedMixExport.checked = experienceState.finishedMixExportInclude;
  assembledPreview.textContent = experienceState.previewAssembled
    ? `Assembled preview: ${compareModeLabel(experienceState.comparisonMode)} + ${experienceState.activePlan?.phase ?? "ready"}`
    : "Assembled preview not ready";

  runEnhance.disabled =
    !fixtureMode ||
    !experienceState.hasValidSource ||
    ["enhancing", "exporting", "mix-ready"].includes(experienceState.phase);
  runExport.disabled =
    !fixtureMode ||
    experienceState.phase !== "mix-ready" ||
    currentOutputs.length === 0;
  updateLocalPreviewUi();
}

function updateUi(): void {
  const focused = document.activeElement;
  const preserveFocus =
    focused instanceof HTMLElement &&
    (focused.closest("#resource-profiles") !== null ||
      focused.closest("#stem-controls") !== null);
  connectionStatus.textContent = shellConnectionLabel(deviceState, online);
  setupStatus.textContent = `${deviceState.models.message} ${deviceState.shell.message}`;
  selectionStatus.textContent = importMessage;
  const audioCacheState = audioExtractionController.getState();
  const extractionActive = ["preparing", "needs-start", "extracting"].includes(
    audioCacheState.status,
  );
  audioCacheStatus.textContent = extractionActive
    ? `${audioCacheState.message} ${Math.round(audioCacheState.progress)}% · ${audioCacheState.pages} page${audioCacheState.pages === 1 ? "" : "s"}.`
    : audioCacheState.message;
  audioCacheProgress.hidden = !extractionActive;
  audioCacheProgress.value = audioCacheState.progress;
  startAudioCache.hidden = audioCacheState.status !== "needs-start";
  cancelAudioCache.hidden = !extractionActive;
  cancelAudioCache.disabled = !extractionActive;
  projectPhase.textContent = projectState.phase.replaceAll("-", " ");
  projectStatus.textContent = projectState.message;
  experienceStatus.textContent = experienceState.message;
  diagnosticsButton.disabled = capabilityProbeRunning;
  diagnosticsButton.textContent = capabilityProbeRunning
    ? "Checking…"
    : "Run device diagnostics";
  diagnosticsStatus.textContent = capabilityProbeRunning
    ? "Checking browser capabilities locally."
    : capabilityError
      ? `Device diagnostics failed: ${capabilityError}`
      : capabilityReport
        ? "Device diagnostics complete."
        : "Device diagnostics have not been run.";
  if (capabilityReport && capabilityReport !== renderedCapabilityReport) {
    diagnostics.innerHTML = diagnosticsMarkup(capabilityReport);
    diagnostics.hidden = false;
    renderedCapabilityReport = capabilityReport;
    renderedCapabilityError = undefined;
  } else if (capabilityError && capabilityError !== renderedCapabilityError) {
    diagnostics.innerHTML = `<p class="diagnostic-error" role="alert">Device diagnostics failed: ${escapeHtml(capabilityError)}</p>`;
    diagnostics.hidden = false;
    renderedCapabilityError = capabilityError;
  }

  if (!experienceState.hasValidSource) fixtureDisclosureInitialized = false;
  if (experienceState.hasValidSource && !fixtureDisclosureInitialized) {
    fixtureDisclosure.open = true;
    fixtureDisclosureInitialized = true;
  }
  if (!experienceState.hasValidSource) advancedDisclosureInitialized = false;
  if (!experienceState.hasValidSource) exportDisclosureInitialized = false;
  if (!advancedDisclosureInitialized) {
    advancedControls.open = false;
    advancedDisclosureInitialized = true;
  }
  if (experienceState.phase !== "mix-ready") {
    exportDisclosureInitialized = false;
    exportDetails.open = false;
  }
  if (experienceState.phase === "mix-ready" && !exportDisclosureInitialized) {
    exportDisclosureInitialized = true;
  }

  updateSourceMetadata();
  renderProfiles();
  renderStemControls();
  syncControls();
  if (
    preserveFocus &&
    focused instanceof HTMLElement &&
    focused.isConnected &&
    !(focused instanceof HTMLInputElement && focused.disabled)
  ) {
    focused.focus();
  }
}

async function refreshConnectivity(): Promise<void> {
  if (!navigator.onLine) {
    online = false;
    updateUi();
    return;
  }
  try {
    const probeUrl = new URL(
      /* @vite-ignore */ "../service-worker.js",
      import.meta.url,
    );
    probeUrl.searchParams.set("connectivity", String(Date.now()));
    await fetch(probeUrl, { method: "HEAD", cache: "no-store" });
    online = true;
  } catch {
    online = false;
  }
  updateUi();
}

function selectRegionFrames(): void {
  const startSeconds = Number(regionStart.value);
  const endSeconds = Number(regionEnd.value);
  try {
    const region = deriveRegionInCanonicalFrames(startSeconds, endSeconds);
    if (projectState.phase === "mix-ready") {
      sendLifecycleCommand({
        type: "REGION_EDIT_STARTED",
        projectId: experienceState.projectId as ProjectId,
        generation: experienceState.generation,
        startFrame: region.startFrame,
        endFrame: region.endFrame,
      });
    } else
      sendExperienceEvent({
        type: "REGION_CHANGED",
        projectId:
          experienceState.projectId ?? (createOpaqueId("project") as ProjectId),
        generation: experienceState.generation,
        startFrame: region.startFrame,
        endFrame: region.endFrame,
      });
    updateUi();
  } catch {
    // ignore malformed ranges during editing.
  }
}

function wireInputs(): void {
  diagnosticsButton.addEventListener("click", () => {
    capabilityProbeRunning = true;
    capabilityError = undefined;
    updateUi();
    void collectBrowserCapabilityReport()
      .then((report) => {
        capabilityReport = report;
      })
      .catch((cause: unknown) => {
        capabilityReport = undefined;
        capabilityError =
          cause instanceof Error ? cause.message : "The browser probe failed.";
      })
      .finally(() => {
        capabilityProbeRunning = false;
        updateUi();
      });
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!supportsDemoSource(file.name)) {
      importMessage = `Unsupported media source: ${file.name}. Use WAV, MP3, M4A, AAC, FLAC, or MP4.`;
      updateUi();
      return;
    }
    void processedOutputJob?.cancel();
    processedOutputJob = undefined;
    if (mediaLoadInFlight) {
      importMessage =
        "Media analysis already in progress. Wait for completion before selecting another file.";
      updateUi();
      return;
    }
    mediaLoadInFlight = true;
    input.disabled = true;
    importMessage = `Inspecting ${file.name}...`;
    updateUi();
    void (async () => {
      try {
        if (!fixtureMode) {
          await localPreviewController.loadSource(file);
          const previewState = localPreviewController.getState();
          if (
            previewState.status === "error" ||
            previewState.status === "unsupported"
          ) {
            importMessage = `Could not load ${file.name}; your previous preview is still available.`;
            return;
          }
        }
        if (processedOutputUrl) {
          URL.revokeObjectURL(processedOutputUrl);
          processedOutputUrl = undefined;
        }
        void disposeProcessedOutput?.();
        disposeProcessedOutput = undefined;
        outputPreview.removeAttribute("src");
        outputPreview.hidden = true;
        outputDownload.removeAttribute("href");
        outputDownload.hidden = true;
        outputStatus.textContent = "";
        outputProgress.hidden = true;
        const projectId = createOpaqueId("project") as ProjectId;
        const next = nextGeneration(projectState.generation);
        const prepared = fixtureMode
          ? {
              source: DEMO_FIXTURE,
              sourceKind: sourceKindFromFileName(file.name),
              capabilities: { dereverb: "available" as const },
              profiles: buildResourceProfiles(),
              selectedProfileId: "xp-high-fidelity",
            }
          : await buildPreparedSourcePayload(file);
        disposeEnhance?.();
        disposeEnhance = undefined;
        disposeExport?.();
        disposeExport = undefined;
        sendLifecycleCommand({
          type: "SOURCE_REPLACED",
          projectId,
          generation: next,
          fileName: file.name,
          prepared,
        });
        localPreviewController.setMode(experienceState.comparisonMode);
        localPreviewController.setControls(syncPreviewControls());
        importMessage = fixtureMode
          ? `Synthetic fixture loaded for ${file.name}.`
          : `Imported source metadata for ${file.name}.`;
        if (
          !fixtureMode &&
          (file.type === "video/mp4" || /\.mp4$/i.test(file.name))
        ) {
          void audioExtractionController.extract(file);
        }
      } catch (cause) {
        importMessage =
          cause instanceof Error
            ? `Could not import media: ${cause.message}`
            : "Could not import selected media.";
      } finally {
        mediaLoadInFlight = false;
        input.disabled = false;
        input.value = "";
        updateUi();
      }
    })();
    // LEAKY ABSTRACTION: I-004 keeps import metadata-only, with no whole-file read/upload.
    // Accepted so playback can stay browser-managed and private; the limit is that decode,
    // segmentation, and persistence are unavailable. Replace with bounded worker streaming
    // while preserving source-level controls and local-only behavior.
    // [[Implementation Package I-004 - Real Local Preview]]
  });

  previewPlayButton.addEventListener("click", async () => {
    localPreviewController.setMode(experienceState.comparisonMode);
    await localPreviewController.play();
  });
  createOutput.addEventListener("click", async () => {
    const previewState = localPreviewController.getState();
    const stream = localPreviewController.getProcessedStream();
    if (!previewState.sourceName || !stream || !previewState.durationSeconds)
      return;
    await localPreviewController.resume();
    processedOutputJob?.cancel();
    if (processedOutputUrl) {
      URL.revokeObjectURL(processedOutputUrl);
      processedOutputUrl = undefined;
    }
    void disposeProcessedOutput?.();
    disposeProcessedOutput = undefined;
    outputProgress.hidden = false;
    outputProgress.value = 0;
    outputStatus.textContent = "Starting local processed output…";
    outputPreview.hidden = true;
    outputDownload.hidden = true;
    localPreviewController.setMode("preview");
    processedOutputJob = startProcessedOutput({
      durationSeconds: previewState.durationSeconds,
      sourceName: previewState.sourceName,
      mediaElement: localMediaElement,
      processedStream: stream,
      onProgress(progress) {
        outputProgress.value = progress.percent;
        outputStatus.textContent = progress.message;
        if (progress.phase === "cancelled") processedOutputJob = undefined;
        updateUi();
      },
    });
    const job = processedOutputJob;
    void job.result
      .then((result) => {
        if (processedOutputJob !== job) {
          void result.dispose();
          return;
        }
        processedOutputJob = undefined;
        if (processedOutputUrl) URL.revokeObjectURL(processedOutputUrl);
        void disposeProcessedOutput?.();
        processedOutputUrl = URL.createObjectURL(result.blob);
        disposeProcessedOutput = result.dispose;
        outputPreview.src = processedOutputUrl;
        outputPreview.hidden = false;
        outputDownload.href = processedOutputUrl;
        outputDownload.download = result.fileName;
        outputDownload.textContent = `Download ${result.fileName}`;
        outputDownload.hidden = false;
        outputProgress.value = 100;
        outputStatus.textContent = `Ready locally as ${result.mimeType}${result.usedOpfs ? " (saved in temporary local storage)" : " (kept within the browser memory limit)"}.`;
        updateUi();
      })
      .catch((error) => {
        if (processedOutputJob !== job) return;
        processedOutputJob = undefined;
        outputStatus.textContent =
          error instanceof Error && error.message === "cancelled"
            ? "Processing cancelled."
            : error instanceof Error
              ? error.message
              : "Could not create the processed file.";
        updateUi();
      });
    updateUi();
  });
  cancelOutput.addEventListener("click", () => {
    void processedOutputJob?.cancel();
  });
  previewPauseButton.addEventListener("click", () => {
    localPreviewController.pause();
  });
  previewSeek.addEventListener("input", () => {
    const value = Number(previewSeek.value);
    if (!Number.isFinite(value)) return;
    localPreviewController.seek(value);
  });

  const controlBindings: Array<{
    input: HTMLInputElement | HTMLSelectElement;
    control: keyof typeof experienceState.controlWorking;
  }> = [
    { input: controlDialogue, control: "dialogueClean" },
    { input: controlDereverb, control: "dereverbEnabled" },
    { input: controlMusic, control: "musicWeight" },
    { input: controlWidth, control: "width" },
    { input: controlDucking, control: "ducking" },
    { input: controlLoudness, control: "loudnessPreset" },
  ];

  for (const { input: controlInput, control } of controlBindings) {
    controlInput.addEventListener("input", () => {
      let value: MixControls[keyof MixControls];

      if (
        controlInput instanceof HTMLInputElement &&
        controlInput.type === "checkbox"
      ) {
        value = controlInput.checked;
      } else if (
        control === "dialogueClean" ||
        control === "musicWeight" ||
        control === "width" ||
        control === "ducking"
      ) {
        value = Number(controlInput.value);
      } else {
        value = controlInput.value as LoudnessPreset;
      }

      if (projectState.phase === "mix-ready") {
        sendLifecycleCommand({
          type: "MIX_EDIT_STARTED",
          projectId: experienceState.projectId as ProjectId,
          generation: experienceState.generation,
          control,
          value,
        });
      } else {
        sendExperienceEvent({
          type: "CONTROL_CHANGED",
          projectId:
            experienceState.projectId ??
            (createOpaqueId("project") as ProjectId),
          generation: experienceState.generation,
          control,
          value,
        });
      }

      localPreviewController.setControls(syncPreviewControls());
      updateUi();
    });
  }

  compareSource.addEventListener("click", () => {
    sendExperienceEvent({
      type: "PREVIEW_TOGGLE",
      projectId: experienceState.projectId as ProjectId,
      generation: experienceState.generation,
      mode: "source",
    });
    localPreviewController.setMode("source");
    updateUi();
  });
  comparePreview.addEventListener("click", () => {
    sendExperienceEvent({
      type: "PREVIEW_TOGGLE",
      projectId: experienceState.projectId as ProjectId,
      generation: experienceState.generation,
      mode: "preview",
    });
    localPreviewController.setMode("preview");
    updateUi();
  });
  undoPreview.addEventListener("click", () => {
    if (projectState.phase === "preview-ready") {
      sendLifecycleCommand({
        type: "MIX_EDIT_UNDO",
        projectId: experienceState.projectId as ProjectId,
        generation: experienceState.generation,
      });
      updateUi();
      return;
    }
    sendExperienceEvent({
      type: "UNDO_PREVIEW",
      projectId: experienceState.projectId as ProjectId,
      generation: experienceState.generation,
    });
    updateUi();
  });
  resetControls.addEventListener("click", () => {
    if (!experienceState.projectId) return;
    lifecycleState = lifecycleCoordinator.dispatch({
      type: "EXPERIENCE_RESET_TO_SOURCE",
      projectId: experienceState.projectId,
      generation: experienceState.generation,
    });
    syncLifecycle();
    updateUi();
  });

  regionStart.addEventListener("change", () => selectRegionFrames());
  regionEnd.addEventListener("change", () => selectRegionFrames());

  profilesContainer.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === "profile") {
      if (projectState.phase === "mix-ready") {
        sendLifecycleCommand({
          type: "PREMIX_EVENT",
          event: {
            type: "PROFILE_SELECTED",
            projectId: experienceState.projectId as ProjectId,
            generation: experienceState.generation,
            profileId: target.value,
          },
        });
      } else {
        sendExperienceEvent({
          type: "PROFILE_SELECTED",
          projectId:
            experienceState.projectId ??
            (createOpaqueId("project") as ProjectId),
          generation: experienceState.generation,
          profileId: target.value,
        });
      }
      updateUi();
    }
  });

  sceneRegion.addEventListener("change", () => {
    if (projectState.phase === "mix-ready") {
      sendLifecycleCommand({
        type: "PREMIX_EVENT",
        event: {
          type: "SCENE_REGION_TOGGLE",
          projectId: experienceState.projectId as ProjectId,
          generation: experienceState.generation,
          included: sceneRegion.checked,
        },
      });
    } else {
      sendExperienceEvent({
        type: "SCENE_REGION_TOGGLE",
        projectId: experienceState.projectId as ProjectId,
        generation: experienceState.generation,
        included: sceneRegion.checked,
      });
    }
    updateUi();
  });

  finishedMixExport.addEventListener("change", () => {
    sendExperienceEvent({
      type: "FINISHED_MIX_EXPORT_TOGGLE",
      projectId: experienceState.projectId as ProjectId,
      generation: experienceState.generation,
      include: finishedMixExport.checked,
    });
    updateUi();
  });

  stemControls.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox")
      return;
    const action =
      target.closest<HTMLElement>("[data-action]")?.dataset["action"];
    const bus = target.closest<HTMLElement>("[data-bus]")?.dataset[
      "bus"
    ] as MixBusId;
    const kind = target.closest<HTMLElement>("[data-kind]")?.dataset["kind"];
    if (!bus || !action) return;

    if (action === "audition" && kind) {
      const stem = experienceState.stems.find((entry) => entry.id === bus);
      if (!stem) return;
      sendExperienceEvent({
        type: "STEM_AUDITION",
        projectId: experienceState.projectId as ProjectId,
        generation: experienceState.generation,
        bus,
        muted: kind === "mute" ? target.checked : stem.audition.muted,
        soloed: kind === "solo" ? target.checked : stem.audition.soloed,
      });
      updateUi();
      return;
    }

    if (action === "export") {
      sendExperienceEvent({
        type: "STEM_EXPORT_TOGGLE",
        projectId: experienceState.projectId as ProjectId,
        generation: experienceState.generation,
        bus,
        include: target.checked,
      });
      updateUi();
    }
  });

  runEnhance.addEventListener("click", () => {
    if (!experienceState.hasValidSource || !experienceState.projectId) return;
    const selectedProfile = experienceState.profiles.find(
      (profile) => profile.profileId === experienceState.selectedProfileId,
    );
    if (!selectedProfile || !selectedProfile.feasible) return;
    const processingJob = createOpaqueId("job") as JobId;

    sendLifecycleCommand({
      type: "PROCESSING_STARTED",
      projectId: experienceState.projectId,
      generation: experienceState.generation,
      jobId: processingJob,
      profileId: experienceState.selectedProfileId,
    });

    if (
      experienceState.phase !== "enhancing" ||
      experienceState.activePlan?.jobId === undefined
    ) {
      updateUi();
      return;
    }

    runEnhanceSequence();
    updateUi();
  });

  cancelEnhance.addEventListener("click", () => {
    if (!experienceState.activePlan) return;
    sendLifecycleCommand({
      type: "PROCESSING_CANCEL_REQUESTED",
      projectId: experienceState.projectId as ProjectId,
      generation: experienceState.generation,
      jobId: experienceState.activePlan.jobId as JobId,
    });
    stopEnhanceTimer();
    sendLifecycleCommand({
      type: "PROCESSING_CANCELLED",
      projectId: experienceState.projectId as ProjectId,
      generation: experienceState.generation,
      jobId: experienceState.activePlan.jobId as JobId,
    });
    updateUi();
  });

  retryEnhance.addEventListener("click", () => {
    if (!experienceState.projectId) return;
    const retryJob = createOpaqueId("job") as JobId;
    if (lifecycleState.project.failedJob?.kind === "export") {
      sendLifecycleCommand({
        type: "EXPORT_RETRY",
        projectId: experienceState.projectId,
        generation: experienceState.generation,
        jobId: retryJob,
      });
      updateUi();
      runExportSequence(retryJob);
      return;
    }
    if (!experienceState.activePlan) return;
    sendLifecycleCommand({
      type: "PROCESSING_RETRY",
      projectId: experienceState.projectId,
      generation: experienceState.generation,
      jobId: retryJob,
    });
    runEnhanceSequence();
    updateUi();
  });

  resetEnhance.addEventListener("click", () => {
    if (!experienceState.projectId) return;
    stopEnhanceTimer();
    lifecycleState = lifecycleCoordinator.dispatch({
      type: "EXPERIENCE_RESET_TO_SOURCE",
      projectId: experienceState.projectId,
      generation: experienceState.generation,
    });
    syncLifecycle();
    updateUi();
  });

  runExport.addEventListener("click", () => {
    if (!experienceState.projectId) return;
    const exportJob = createOpaqueId("job") as JobId;
    sendLifecycleCommand({
      type: "EXPORT_STARTED",
      projectId: experienceState.projectId,
      generation: experienceState.generation,
      jobId: exportJob,
    });
    updateUi();
    runExportSequence(exportJob);
  });
}

window.addEventListener("online", () => {
  online = true;
  updateUi();
});
window.addEventListener("offline", () => {
  online = false;
  updateUi();
});
window.addEventListener("pagehide", () => {
  void audioExtractionController.destroy();
  void processedOutputJob?.cancel();
  void disposeProcessedOutput?.();
  if (processedOutputUrl) URL.revokeObjectURL(processedOutputUrl);
});

wireInputs();
updateUi();
void refreshConnectivity();

const applyShellState = (shell: DeviceState["shell"]): void => {
  deviceState = { ...deviceState, shell };
  updateUi();
};
void registerAndVerifyShell(applyShellState).then(applyShellState);

updateUi();
