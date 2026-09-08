import { chromium } from "playwright";
import { createServer } from "vite";

if (process.env.RUN_WAV_BROWSER_PROBE !== "1") {
  process.stderr.write(
    "Set RUN_WAV_BROWSER_PROBE=1 to run the opt-in Chromium WAV/OPFS probe.\n",
  );
  process.exitCode = 2;
} else {
  await run();
}

async function run() {
  const host = "127.0.0.1";
  const port = Number(process.env.WAV_PROBE_PORT ?? 4319);
  const origin = `http://${host}:${port}`;
  process.stderr.write("wav-probe: creating local Vite server\n");
  const server = await withTimeout(
    createServer({
      base: "/audio-pwa/",
      server: { host, port, strictPort: true },
    }),
    "Vite server creation",
  );
  let browser;
  try {
    await withTimeout(server.listen(), "Vite server startup");
    process.stderr.write("wav-probe: launching Chromium\n");
    browser = await withTimeout(
      chromium.launch({
        executablePath:
          process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox"],
      }),
      "Chromium launch",
    );
    const page = await browser.newPage();
    const externalRequests = [];
    page.on("request", (request) => {
      if (
        !request.url().startsWith(origin) &&
        !request.url().startsWith(`blob:${origin}`)
      )
        externalRequests.push(request.url());
    });
    await withTimeout(page.goto(`${origin}/audio-pwa/`), "fixture navigation");
    process.stderr.write("wav-probe: seeding processed PCM in OPFS\n");
    const result = await withTimeout(
      page.evaluate(async () => {
        const sourceRunId = "i009-wav-browser-probe";
        const resultId = "processing-wav-browser-probe";
        const totalFrames = 4_800;
        const pageFrames = 2_400;
        const hash = (bytes) => {
          let value = 0x811c9dc5;
          for (const byte of bytes) {
            value ^= byte;
            value = Math.imul(value, 0x01000193);
          }
          return (value >>> 0).toString(16).padStart(8, "0");
        };
        const root = await navigator.storage.getDirectory();
        for (const tree of [sourceRunId, resultId, "processed-exports"])
          await root
            .removeEntry(tree, { recursive: true })
            .catch(() => undefined);
        const processedDirectory = await root.getDirectoryHandle(resultId, {
          create: true,
        });
        const descriptors = [];
        for (let pageIndex = 0; pageIndex < 2; pageIndex += 1) {
          const left = Float32Array.from(
            { length: pageFrames },
            (_, index) =>
              Math.sin(
                (2 * Math.PI * 440 * (pageIndex * pageFrames + index)) / 48_000,
              ) * 0.1,
          );
          const right = Float32Array.from(left, (sample) => sample * 0.5);
          const combined = new Float32Array(pageFrames * 2);
          combined.set(left);
          combined.set(right, pageFrames);
          const bytes = new Uint8Array(combined.buffer);
          const channelBytes = pageFrames * 4;
          const file = `page-${pageIndex.toString().padStart(6, "0")}.pcm`;
          const handle = await processedDirectory.getFileHandle(file, {
            create: true,
          });
          const writable = await handle.createWritable();
          await writable.write(bytes);
          await writable.close();
          descriptors.push({
            index: pageIndex,
            validFrames: pageFrames,
            integrity: `${hash(bytes.subarray(0, channelBytes))}:${hash(bytes.subarray(channelBytes))}`,
            file,
          });
        }
        const inputManifest = {
          runId: sourceRunId,
          generation: 1,
          durationSeconds: totalFrames / 48_000,
          sampleRate: 48_000,
          channels: 2,
          layout: "planar-f32le",
          pages: descriptors,
          validFrames: totalFrames,
          targetFrames: totalFrames,
          endFrameExclusive: totalFrames,
          observedFrames: totalFrames,
          tailTrimmedFrames: 0,
          durationAuthority: "html-media-element",
          frameRounding: "nearest",
          state: "complete",
        };
        const processedManifest = {
          schemaVersion: 1,
          resultId,
          sourceRunId,
          sourceGeneration: 1,
          generation: 2,
          sampleRate: 48_000,
          channels: 2,
          layout: "planar-f32le",
          totalFrames,
          pages: descriptors,
          state: "complete",
        };
        await new Promise((resolve, reject) => {
          const open = indexedDB.open("cinematic-audio-i009", 1);
          open.onupgradeneeded = () =>
            open.result.objectStoreNames.contains("manifests") ||
            open.result.createObjectStore("manifests");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction("manifests", "readwrite");
            const store = transaction.objectStore("manifests");
            store.put({ runId: sourceRunId }, "current");
            store.put(inputManifest, sourceRunId);
            store.put({ runId: resultId }, "processing:current");
            store.put(processedManifest, `processing:${resultId}`);
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onerror = () => reject(transaction.error);
          };
        });

        const module =
          await import("/audio-pwa/src/processing/browser-wav-artifact.ts");
        const exportDirectory = await root.getDirectoryHandle(
          "processed-exports",
          { create: true },
        );
        const countEntries = async () => {
          let count = 0;
          for await (const _entry of exportDirectory.values()) count += 1;
          return count;
        };
        let replacementMessage = "";
        try {
          await module.createBrowserWavArtifact({
            sourceName: "obsolete.mp4",
            expectedResultId: "processing-replaced-result",
          });
        } catch (error) {
          replacementMessage =
            error instanceof Error ? error.message : "unknown";
        }
        const entriesAfterReplacement = await countEntries();
        const cancelled = new AbortController();
        let cancellationName = "";
        try {
          await module.createBrowserWavArtifact({
            sourceName: "probe.mp4",
            expectedResultId: resultId,
            signal: cancelled.signal,
            onProgress(completed, total) {
              if (completed < total) cancelled.abort();
            },
          });
        } catch (error) {
          cancellationName = error?.name ?? "unknown";
        }
        const entriesAfterCancel = await countEntries();

        const artifact = await module.createBrowserWavArtifact({
          sourceName: "A field interview.mp4",
          expectedResultId: resultId,
        });
        const header = new Uint8Array(
          await artifact.file.slice(0, 44).arrayBuffer(),
        );
        const text = (start, length) =>
          new TextDecoder().decode(header.subarray(start, start + length));
        const view = new DataView(header.buffer);
        const objectUrl = URL.createObjectURL(artifact.file);
        const audio = new Audio(objectUrl);
        const playability = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve("timeout"), 5_000);
          audio.onloadedmetadata = () => {
            clearTimeout(timeout);
            resolve(
              Number.isFinite(audio.duration) && audio.duration > 0
                ? "loaded"
                : "invalid",
            );
          };
          audio.onerror = () => {
            clearTimeout(timeout);
            resolve("error");
          };
          audio.load();
        });
        URL.revokeObjectURL(objectUrl);
        const beforeDispose = await countEntries();
        await artifact.dispose();
        const afterDispose = await countEntries();
        await root.removeEntry(resultId, { recursive: true });
        await root.removeEntry("processed-exports", { recursive: true });
        return {
          replacementMessage,
          entriesAfterReplacement,
          cancellationName,
          entriesAfterCancel,
          mime: artifact.file.type,
          downloadName: artifact.downloadName,
          size: artifact.file.size,
          riff: text(0, 4),
          wave: text(8, 4),
          channels: view.getUint16(22, true),
          sampleRate: view.getUint32(24, true),
          bitsPerSample: view.getUint16(34, true),
          dataBytes: view.getUint32(40, true),
          playability,
          beforeDispose,
          afterDispose,
        };
      }),
      "OPFS WAV cancellation and success paths",
    );
    const expected = {
      replacementMessage:
        "The processed result changed before WAV export could start.",
      entriesAfterReplacement: 0,
      cancellationName: "AbortError",
      entriesAfterCancel: 0,
      mime: "audio/wav",
      downloadName: "A-field-interview-processed.wav",
      size: 44 + 4_800 * 6,
      riff: "RIFF",
      wave: "WAVE",
      channels: 2,
      sampleRate: 48_000,
      bitsPerSample: 24,
      dataBytes: 4_800 * 6,
      playability: "loaded",
      beforeDispose: 1,
      afterDispose: 0,
    };
    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      throw new Error(
        `Unexpected WAV probe result:\n${JSON.stringify(result, null, 2)}`,
      );
    }
    if (externalRequests.length > 0)
      throw new Error(
        `Unexpected external requests: ${externalRequests.join(", ")}`,
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    process.stderr.write("wav-probe: cleaning up\n");
    await browser?.close();
    await server.close().catch(() => undefined);
  }
}

async function withTimeout(promise, label, milliseconds = 30_000) {
  let handle;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        handle = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds} ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(handle);
  }
}
