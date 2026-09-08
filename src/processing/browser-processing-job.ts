import { CURATED_MODEL_CATALOG } from "../models/model-catalog";
import { createLocalSileroClassifier } from "../models/silero-local-runtime";
import {
  SILERO_CANONICAL_WINDOW_FRAMES,
  type StatefulSileroClassifier,
} from "../models/silero-classifier";
import {
  createTransactionalProcessedWriter,
  openCommittedPcmReader,
  type CanonicalInputManifest,
  type TransactionalProcessedWriter,
} from "./opfs-processing-store";
import {
  runProcessingJob,
  type ProcessingJobEvent,
  type ProcessingJobResult,
  type SegmentationResultStore,
} from "./processing-job";
import {
  dspSpeechLikelihoodClassifier,
  type SegmentationOptions,
  type SpeechLikelihoodClassifier,
} from "./segmentation";
import { createTransactionalSegmentationResultStore } from "./segmentation-result-store";
import type { EnrichmentOptions } from "./chunk-enrichment";

const SILERO_ID = "silero-vad-v6.2.1-16k-op15";

export type BrowserClassifierReport = Readonly<{
  classifierId: string;
  mode: "silero-wasm" | "dsp-fallback";
  fallbackCode?: "provider-not-qualified" | "model-setup-failed";
}>;

export type BrowserProcessingJobRequest = Readonly<{
  jobId: string;
  projectId: string;
  generation: number;
  baseUrl: string;
  signal: AbortSignal;
  isGenerationCurrent: (generation: number) => boolean;
  segmentation?: Omit<
    SegmentationOptions,
    | "generation"
    | "signal"
    | "isGenerationCurrent"
    | "classifier"
    | "onProgress"
  >;
  enrichment?: Omit<
    EnrichmentOptions,
    "generation" | "signal" | "isGenerationCurrent" | "onProgress"
  >;
  onEvent?: (event: ProcessingJobEvent) => void;
}>;

export type BrowserProcessingJobResult = Readonly<{
  job: ProcessingJobResult;
  classifier: BrowserClassifierReport;
  processedResultId: string;
}>;

type CommittedReader = Awaited<ReturnType<typeof openCommittedPcmReader>>;

export type BrowserProcessingBackendDependencies = Readonly<{
  openReader: typeof openCommittedPcmReader;
  createSegmentationStore: () => SegmentationResultStore;
  createWriter: typeof createTransactionalProcessedWriter;
  sileroEligible: () => boolean;
  loadSilero: typeof createLocalSileroClassifier;
}>;

const defaults: BrowserProcessingBackendDependencies = {
  openReader: openCommittedPcmReader,
  createSegmentationStore: createTransactionalSegmentationResultStore,
  createWriter: createTransactionalProcessedWriter,
  sileroEligible: () =>
    CURATED_MODEL_CATALOG.some(
      (model) =>
        model.id === SILERO_ID &&
        model.providers.some(
          (provider) =>
            provider.provider === "wasm" &&
            (provider.qualification === "reference-parity" ||
              provider.qualification === "qualified"),
        ),
    ),
  loadSilero: createLocalSileroClassifier,
};

const sileroAdapter = (
  classifier: StatefulSileroClassifier,
  generation: number,
): SpeechLikelihoodClassifier => ({
  id: `${SILERO_ID}:wasm`,
  async scoreWindow(window, signal) {
    const mono =
      window.mono.length === SILERO_CANONICAL_WINDOW_FRAMES
        ? window.mono
        : (() => {
            const padded = new Float32Array(SILERO_CANONICAL_WINDOW_FRAMES);
            padded.set(window.mono);
            return padded;
          })();
    const result = await classifier.classify({
      mono48k: mono,
      canonicalStartFrame: window.startFrame,
      generation,
      signal,
    });
    return result.probability;
  },
});

async function selectClassifier(
  request: BrowserProcessingJobRequest,
  dependencies: BrowserProcessingBackendDependencies,
): Promise<{
  classifier: SpeechLikelihoodClassifier;
  report: BrowserClassifierReport;
  dispose?: () => Promise<void>;
}> {
  if (!dependencies.sileroEligible())
    return {
      classifier: dspSpeechLikelihoodClassifier,
      report: {
        classifierId: dspSpeechLikelihoodClassifier.id,
        mode: "dsp-fallback",
        fallbackCode: "provider-not-qualified",
      },
    };
  try {
    const silero = await dependencies.loadSilero({
      baseUrl: request.baseUrl,
      generation: request.generation,
      signal: request.signal,
    });
    if (request.signal.aborted) {
      await silero.dispose();
      throw new DOMException("Processing cancelled.", "AbortError");
    }
    const classifier = sileroAdapter(silero, request.generation);
    return {
      classifier,
      report: { classifierId: classifier.id, mode: "silero-wasm" },
      dispose: () => silero.dispose(),
    };
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      classifier: dspSpeechLikelihoodClassifier,
      report: {
        classifierId: dspSpeechLikelihoodClassifier.id,
        mode: "dsp-fallback",
        fallbackCode: "model-setup-failed",
      },
    };
  }
}

/** Runs the direct OPFS → analysis/commit → OPFS enrichment graph in a worker. */
export async function runBrowserProcessingJob(
  request: BrowserProcessingJobRequest,
  dependencies: BrowserProcessingBackendDependencies = defaults,
): Promise<BrowserProcessingJobResult> {
  const segmentationReader = await dependencies.openReader();
  const source = Object.freeze({
    runId: segmentationReader.source.runId,
    generation: segmentationReader.source.generation,
  });
  const selection = await selectClassifier(request, dependencies);
  let enrichmentReader: CommittedReader | undefined;
  let enrichmentWriter: TransactionalProcessedWriter | undefined;
  try {
    const job = await runProcessingJob(
      {
        createSegmentationReader: () => segmentationReader,
        segmentationStore: dependencies.createSegmentationStore(),
        createEnrichmentReader: async () => {
          enrichmentReader = await dependencies.openReader();
          if (
            enrichmentReader.source.runId !== source.runId ||
            enrichmentReader.source.generation !== source.generation
          )
            throw new Error(
              "Committed audio source changed before enrichment.",
            );
          return enrichmentReader;
        },
        createEnrichmentWriter: (context) => {
          if (!enrichmentReader)
            throw new Error("Enrichment source was not opened.");
          enrichmentWriter = dependencies.createWriter(
            enrichmentReader.source as CanonicalInputManifest,
            context.generation,
            {
              signal: context.signal,
              isGenerationCurrent: context.isGenerationCurrent,
            },
          );
          return enrichmentWriter;
        },
      },
      {
        ...request,
        source,
        segmentation: {
          ...request.segmentation,
          classifier: selection.classifier,
          analysisWindowFrames:
            selection.report.mode === "silero-wasm"
              ? SILERO_CANONICAL_WINDOW_FRAMES
              : request.segmentation?.analysisWindowFrames,
        },
      },
    );
    if (job.segmentation.classifierId !== selection.report.classifierId)
      throw new Error("Committed classifier identity does not match the run.");
    const processed = enrichmentWriter?.committed();
    if (
      !processed ||
      processed.generation !== request.generation ||
      processed.sourceRunId !== source.runId ||
      processed.sourceGeneration !== source.generation
    )
      throw new Error(
        "Committed processed output identity does not match the run.",
      );
    return Object.freeze({
      job,
      classifier: Object.freeze(selection.report),
      processedResultId: processed.resultId,
    });
  } finally {
    await selection.dispose?.();
  }
}
