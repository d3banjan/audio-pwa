import { openCommittedProcessedPcmReader } from "./opfs-processing-store";
import {
  exportPcm24Wav,
  type SeekableByteSink,
  type WavExportResult,
} from "./processed-wav-export";

const EXPORT_DIRECTORY = "processed-exports";

type WritableHandle = FileSystemWritableFileStream & {
  abort(reason?: unknown): Promise<void>;
};

export type BrowserWavArtifact = Readonly<{
  file: Blob;
  downloadName: string;
  result: WavExportResult;
  dispose(): Promise<void>;
}>;

const safeBaseName = (sourceName: string) => {
  const withoutExtension = sourceName.replace(/\.[^.]+$/, "");
  const cleaned = withoutExtension
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "audio";
};

export async function createBrowserWavArtifact(
  options: Readonly<{
    sourceName: string;
    expectedResultId: string;
    signal?: AbortSignal;
    onProgress?: (completedFrames: number, totalFrames: number) => void;
  }>,
): Promise<BrowserWavArtifact> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(EXPORT_DIRECTORY, {
    create: true,
  });
  const localName = `${crypto.randomUUID()}.wav`;
  const handle = await directory.getFileHandle(localName, { create: true });
  const writable = (await handle.createWritable()) as WritableHandle;
  let closed = false;
  const sink: SeekableByteSink = {
    write: (bytes) => writable.write(Uint8Array.from(bytes)),
    seek: (position) => writable.seek(position),
    async close() {
      await writable.close();
      closed = true;
    },
    async abort(reason) {
      if (!closed) await writable.abort(reason).catch(() => undefined);
      await directory.removeEntry(localName).catch(() => undefined);
    },
  };
  try {
    const reader = await openCommittedProcessedPcmReader();
    if (reader.result.resultId !== options.expectedResultId)
      throw new Error(
        "The processed result changed before WAV export could start.",
      );
    const result = await exportPcm24Wav(reader, sink, options);
    const storedFile = await handle.getFile();
    // OPFS files have no portable MIME metadata. Blob.slice supplies the
    // truthful WAV type without assembling the whole artifact in JavaScript.
    const file = storedFile.slice(0, storedFile.size, "audio/wav");
    return Object.freeze({
      file,
      downloadName: `${safeBaseName(options.sourceName)}-processed.wav`,
      result,
      async dispose() {
        await directory.removeEntry(localName).catch(() => undefined);
      },
    });
  } catch (cause) {
    await sink.abort(cause).catch(() => undefined);
    throw cause;
  }
}
