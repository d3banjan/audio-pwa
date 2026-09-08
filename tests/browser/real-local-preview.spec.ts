import { expect, test, type Page } from "@playwright/test";

const fixtureOrigin = `http://127.0.0.1:${Number(process.env.PWA_TEST_PORT ?? 4173)}`;
const generatedMp4 = new URL(
  "../fixtures/generated-tone-aac.mp4",
  import.meta.url,
).pathname;

function tinyWav(samples = 2_000): Buffer {
  const sampleRate = 8_000;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(
      Math.round(Math.sin(index / 8) * 2_000),
      44 + index * 2,
    );
  }
  return buffer;
}

async function resetAndOpen(page: Page): Promise<void> {
  await page.request.post(`${fixtureOrigin}/__reset`);
  await page.goto("./");
}

test("real mode leads with local preview and hides simulated planning", async ({
  page,
}) => {
  await resetAndOpen(page);
  await expect(page.locator("#page-title")).toHaveText(
    "Make every word easier to hear.",
  );
  await expect(page.locator("#audio-cache-status")).toHaveText(
    "Choose a video to prepare its audio locally.",
  );
  await expect(page.locator("#simulated-planning")).toBeHidden();
  await expect(page.locator("#media-file").locator("..")).not.toContainText(
    "planning",
  );
  await expect(page.locator("#recommendation-heading")).toHaveText(
    "Start with the balanced processed preview",
  );
  await expect(page.locator("#advanced-controls")).toContainText(
    "These controls adjust the processed preview you hear and save.",
  );
  await expect(page.locator("#output-progress")).toHaveAttribute(
    "aria-label",
    "Processed file creation progress",
  );
});

test("browser channel contract centers mono and preserves natural stereo", async ({
  page,
}) => {
  await resetAndOpen(page);
  const rendered = await page.evaluate(async () => {
    const render = async (input: readonly number[]) => {
      const context = new OfflineAudioContext(2, 128, 48_000);
      const source = context.createBufferSource();
      const buffer = context.createBuffer(input.length, 128, 48_000);
      input.forEach((value, channel) =>
        buffer.getChannelData(channel).fill(value),
      );
      source.buffer = buffer;
      const stereoInput = context.createGain();
      stereoInput.channelCount = 2;
      stereoInput.channelCountMode = "explicit";
      stereoInput.channelInterpretation = "speakers";
      const split = context.createChannelSplitter(2);
      const leftToMid = context.createGain();
      const rightToMid = context.createGain();
      const leftToSide = context.createGain();
      const rightToSide = context.createGain();
      const mid = context.createGain();
      const side = context.createGain();
      const midToLeft = context.createGain();
      const midToRight = context.createGain();
      const sideToLeft = context.createGain();
      const sideToRight = context.createGain();
      const merge = context.createChannelMerger(2);
      leftToMid.gain.value = 0.5;
      rightToMid.gain.value = 0.5;
      leftToSide.gain.value = 0.5;
      rightToSide.gain.value = -0.5;
      midToLeft.gain.value = 1;
      midToRight.gain.value = 1;
      sideToLeft.gain.value = 1;
      sideToRight.gain.value = -1;
      source.connect(stereoInput).connect(split);
      split.connect(leftToMid, 0);
      split.connect(rightToMid, 1);
      split.connect(leftToSide, 0);
      split.connect(rightToSide, 1);
      leftToMid.connect(mid);
      rightToMid.connect(mid);
      leftToSide.connect(side);
      rightToSide.connect(side);
      mid.connect(midToLeft).connect(merge, 0, 0);
      mid.connect(midToRight).connect(merge, 0, 1);
      side.connect(sideToLeft).connect(merge, 0, 0);
      side.connect(sideToRight).connect(merge, 0, 1);
      merge.connect(context.destination);
      source.start();
      const output = await context.startRendering();
      return [output.getChannelData(0)[64], output.getChannelData(1)[64]];
    };
    return {
      mono: await render([0.25]),
      stereo: await render([0.25, -0.125]),
    };
  });

  expect(rendered.mono[0]).toBeCloseTo(0.25, 5);
  expect(rendered.mono[1]).toBeCloseTo(0.25, 5);
  expect(rendered.stereo[0]).toBeCloseTo(0.25, 5);
  expect(rendered.stereo[1]).toBeCloseTo(-0.125, 5);
});

test("real local preview stays private and supports basic transport", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(File.prototype, "arrayBuffer", {
      configurable: true,
      value: () => {
        throw new Error("whole-file reads are forbidden in I-004");
      },
    });
    Object.defineProperty(File.prototype, "bytes", {
      configurable: true,
      value: () => {
        throw new Error("whole-file reads are forbidden in I-004");
      },
    });
  });
  await resetAndOpen(page);

  await page.locator("#media-file").setInputFiles({
    name: "voice.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });

  await expect(page.locator("#project-phase")).toHaveText("source selected");
  await expect(page.locator("#selection-status")).toContainText(
    "Imported source metadata",
  );
  await expect(page.locator("#preview-status")).toContainText("ready");
  await expect(page.locator("#preview-play")).toBeEnabled();
  await expect(page.locator("#preview-seek")).toBeEnabled();

  await page.locator("#preview-play").click();
  await expect(page.locator("#preview-play")).toHaveText("Pause");
  await expect(page.locator("#preview-status")).toContainText(
    "playback active",
  );
  await page.locator("#preview-play").click();
  await expect(page.locator("#preview-play")).toHaveText("Resume");
  await expect(page.locator("#preview-status")).toContainText("paused");

  const seek = page.locator("#preview-seek");
  await seek.fill("0.1");
  await seek.dispatchEvent("input");
  await expect(seek).toHaveValue("0.1");

  await page.locator("#advanced-controls summary").click();
  await page.locator("#compare-preview").click();
  await expect(page.locator("#preview-status")).toContainText(
    "Processed preview",
  );
  await page.locator("#compare-source").click();
  await expect(page.locator("#preview-status")).toContainText(
    "Source (bypass)",
  );

  await page.locator("#create-output").click();
  await expect(page.locator("#output-status")).toContainText("Ready locally", {
    timeout: 10_000,
  });
  await expect(page.locator("#output-preview")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("#output-preview")
        .evaluate((node: HTMLAudioElement) => node.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator("#output-download")).toBeVisible();
  await expect(page.locator("#output-download")).toHaveAttribute(
    "download",
    /voice-processed\.(webm|ogg|m4a)/,
  );
  const decodedOutput = await page
    .locator("#output-preview")
    .evaluate(async (node: HTMLAudioElement) => {
      const bytes = await (await fetch(node.src)).arrayBuffer();
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(bytes.slice(0));
        const left = decoded.getChannelData(0);
        const right =
          decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
        let energy = 0;
        let difference = 0;
        for (let index = 0; index < left.length; index += 1) {
          energy += left[index]! * left[index]! + right[index]! * right[index]!;
          const delta = left[index]! - right[index]!;
          difference += delta * delta;
        }
        return {
          duration: decoded.duration,
          energy,
          centeredError: energy ? difference / energy : 1,
        };
      } finally {
        await context.close();
      }
    });
  expect(decodedOutput.duration).toBeGreaterThan(0.1);
  expect(decodedOutput.energy).toBeGreaterThan(0.000_001);
  expect(decodedOutput.centeredError).toBeLessThan(0.02);

  await expect(page.locator("#control-music")).toBeDisabled();
  await expect(page.locator("#control-ducking")).toBeDisabled();
  await expect(
    page.locator("#control-music").locator("xpath=.."),
  ).toContainText("Available after stem separation");

  await page.locator("#media-file").setInputFiles({
    name: "picture.png",
    mimeType: "image/png",
    buffer: Buffer.from("not-an-image"),
  });
  await expect(page.locator("#selection-status")).toContainText(
    "Unsupported media source",
  );
  await expect(page.locator("#preview-play")).toBeEnabled();
});

test("extracts a real generated MP4/AAC fixture to an exact canonical manifest", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);
  const status = page.locator("#audio-cache-status");
  await expect(status).toHaveText(
    /Audio cache is ready\. Keep this tab active, then click Start preparation\.|Preparing locally at playback speed/,
    { timeout: 15_000 },
  );
  const start = page.locator("#start-audio-cache");
  if (await start.isVisible()) await start.click();
  await expect(status).toContainText("Local audio cache is ready.", {
    timeout: 15_000,
  });
  const manifest = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cinematic-audio-i009", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("manifests"))
          request.result.createObjectStore("manifests");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const transaction = db.transaction("manifests", "readonly");
        const store = transaction.objectStore("manifests");
        const pointerRequest = store.get("current");
        pointerRequest.onsuccess = () => {
          const runId = (pointerRequest.result as { runId: string }).runId;
          const manifestRequest = store.get(runId);
          manifestRequest.onsuccess = () => resolve(manifestRequest.result);
          manifestRequest.onerror = () => reject(manifestRequest.error);
        };
        pointerRequest.onerror = () => reject(pointerRequest.error);
        transaction.oncomplete = () => db.close();
      },
    );
    return result;
  });
  expect(manifest.validFrames).toBe(manifest.targetFrames);
  expect(manifest.endFrameExclusive).toBe(manifest.targetFrames);
  expect(manifest.observedFrames as number).toBeGreaterThanOrEqual(
    manifest.targetFrames as number,
  );
  expect(manifest.tailTrimmedFrames).toBe(
    (manifest.observedFrames as number) - (manifest.targetFrames as number),
  );
  expect(manifest.durationAuthority).toBe("html-media-element");
  expect(manifest.frameRounding).toBe("nearest");
  await expect(page.locator("#preview-play")).toBeEnabled();
  expect(pageErrors).not.toContain("Unable to load a worklet's module.");
});

test("processes a committed MP4 cache in the worker and returns a real PCM24 WAV", async ({
  page,
}) => {
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);
  const cacheStatus = page.locator("#audio-cache-status");
  await expect(cacheStatus).toHaveText(
    /Audio cache is ready\. Keep this tab active, then click Start preparation\.|Preparing locally at playback speed/,
    { timeout: 15_000 },
  );
  const start = page.locator("#start-audio-cache");
  if (await start.isVisible()) await start.click();
  await expect(cacheStatus).toContainText("Local audio cache is ready.", {
    timeout: 15_000,
  });
  await expect(page.locator("#output-help")).toContainText("local chunks");

  await page.locator("#create-output").click();
  await expect(page.locator("#preview-play")).toHaveText(/Play|Resume/);
  await expect(page.locator("#output-status")).toContainText(
    /Analyzing|Applying|Creating/,
    { timeout: 15_000 },
  );
  await expect(page.locator("#output-status")).toContainText(
    "Ready locally as audio/wav",
    { timeout: 30_000 },
  );
  await expect(page.locator("#output-download")).toHaveAttribute(
    "download",
    /-processed\.wav$/,
  );
  await expect
    .poll(() =>
      page
        .locator("#output-preview")
        .evaluate((node: HTMLAudioElement) => node.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  const artifact = await page
    .locator("#output-preview")
    .evaluate(async (node: HTMLAudioElement) => {
      let response: Response;
      try {
        response = await fetch(node.src);
      } catch (error) {
        return {
          fetchError: error instanceof Error ? error.message : String(error),
          src: node.src,
          readyState: node.readyState,
          mediaError: node.error?.message,
        };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        type: response.headers.get("content-type"),
        riff: new TextDecoder().decode(bytes.slice(0, 4)),
        wave: new TextDecoder().decode(bytes.slice(8, 12)),
        format: bytes[20]! | (bytes[21]! << 8),
        channels: bytes[22]! | (bytes[23]! << 8),
        bits: bytes[34]! | (bytes[35]! << 8),
        bytes: bytes.length,
      };
    });
  expect(artifact).not.toHaveProperty("fetchError");
  expect(artifact).toMatchObject({
    type: "audio/wav",
    riff: "RIFF",
    wave: "WAVE",
    format: 1,
    channels: 2,
    bits: 24,
  });
  expect(artifact.bytes).toBeGreaterThan(44);

  const pointers = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cinematic-audio-i009", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = db.transaction("manifests", "readonly");
      const store = transaction.objectStore("manifests");
      const requests = [
        store.get("segmentation:current"),
        store.get("processing:current"),
      ];
      transaction.oncomplete = () => {
        db.close();
        resolve(requests.map((request) => request.result));
      };
      transaction.onerror = () => reject(transaction.error);
    });
    return values;
  });
  expect(pointers[0]).toMatchObject({ resultId: expect.any(String) });
  expect(pointers[1]).toMatchObject({ runId: expect.any(String) });
});

test("stops prepared processing before the worker when local storage is insufficient", async ({
  page,
}) => {
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);
  const cacheStatus = page.locator("#audio-cache-status");
  await expect(cacheStatus).toHaveText(
    /Audio cache is ready\. Keep this tab active, then click Start preparation\.|Preparing locally at playback speed/,
    { timeout: 15_000 },
  );
  const start = page.locator("#start-audio-cache");
  if (await start.isVisible()) await start.click();
  await expect(cacheStatus).toContainText("Local audio cache is ready.", {
    timeout: 15_000,
  });

  await page.evaluate(() => {
    Object.defineProperty(StorageManager.prototype, "estimate", {
      configurable: true,
      value: async () => ({ quota: 1, usage: 0 }),
    });
  });
  await page.locator("#create-output").click();

  await expect(page.locator("#output-status")).toHaveText(
    "There is not enough free local storage for this processed file. Free some space and try again.",
  );
  await expect(page.locator("#output-progress")).toHaveAttribute("hidden", "");
  await expect(page.locator("#output-download")).toBeHidden();
});

test("a delayed storage check accepts only one rapid processed-file launch", async ({
  page,
}) => {
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);
  const cacheStatus = page.locator("#audio-cache-status");
  await expect(cacheStatus).toHaveText(
    /Audio cache is ready\. Keep this tab active, then click Start preparation\.|Preparing locally at playback speed/,
    { timeout: 15_000 },
  );
  const start = page.locator("#start-audio-cache");
  if (await start.isVisible()) await start.click();
  await expect(cacheStatus).toContainText("Local audio cache is ready.", {
    timeout: 15_000,
  });
  await page.evaluate(() => {
    let release = () => undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = { calls: 0, release };
    (
      window as unknown as {
        processingStorageGate: typeof gate;
      }
    ).processingStorageGate = gate;
    Object.defineProperty(StorageManager.prototype, "estimate", {
      configurable: true,
      value: async () => {
        gate.calls += 1;
        await wait;
        return { quota: 10_000_000_000, usage: 0 };
      },
    });
  });

  await page.locator("#create-output").click();
  await expect(page.locator("#create-output")).toBeDisabled();
  await page.evaluate(() =>
    document.querySelector<HTMLButtonElement>("#create-output")?.click(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              processingStorageGate: { calls: number };
            }
          ).processingStorageGate.calls,
      ),
    )
    .toBe(1);
  await page.evaluate(() =>
    (
      window as unknown as {
        processingStorageGate: { release: () => void };
      }
    ).processingStorageGate.release(),
  );
  await expect(page.locator("#output-status")).toContainText(
    "Ready locally as audio/wav",
    { timeout: 30_000 },
  );
});

test("source replacement invalidates a launch waiting for storage", async ({
  page,
}) => {
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);
  const cacheStatus = page.locator("#audio-cache-status");
  await expect(cacheStatus).toHaveText(
    /Audio cache is ready\. Keep this tab active, then click Start preparation\.|Preparing locally at playback speed/,
    { timeout: 15_000 },
  );
  const start = page.locator("#start-audio-cache");
  if (await start.isVisible()) await start.click();
  await expect(cacheStatus).toContainText("Local audio cache is ready.", {
    timeout: 15_000,
  });
  await page.evaluate(() => {
    let release = () => undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = { release };
    (
      window as unknown as {
        processingStorageGate: typeof gate;
      }
    ).processingStorageGate = gate;
    Object.defineProperty(StorageManager.prototype, "estimate", {
      configurable: true,
      value: async () => {
        await wait;
        return { quota: 10_000_000_000, usage: 0 };
      },
    });
  });

  await page.locator("#create-output").click();
  await expect(page.locator("#create-output")).toBeDisabled();
  await page.locator("#media-file").setInputFiles({
    name: "replacement-during-check.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });
  await expect(page.locator("#selection-status")).toContainText(
    "Imported source metadata",
  );
  await page.evaluate(() =>
    (
      window as unknown as {
        processingStorageGate: { release: () => void };
      }
    ).processingStorageGate.release(),
  );

  await expect(page.locator("#output-help")).toContainText(
    "runs at playback speed",
  );
  await expect(page.locator("#output-download")).toBeHidden();
  await expect(page.locator("#output-status")).not.toContainText(
    "Ready locally as audio/wav",
  );
});

test("a replacement audio source cannot process the previous MP4 cache", async ({
  page,
}) => {
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);
  const cacheStatus = page.locator("#audio-cache-status");
  await expect(cacheStatus).toHaveText(
    /Audio cache is ready\. Keep this tab active, then click Start preparation\.|Preparing locally at playback speed/,
    { timeout: 15_000 },
  );
  const start = page.locator("#start-audio-cache");
  if (await start.isVisible()) await start.click();
  await expect(cacheStatus).toContainText("Local audio cache is ready.", {
    timeout: 15_000,
  });

  await page.locator("#media-file").setInputFiles({
    name: "replacement.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });
  await expect(page.locator("#output-help")).toContainText(
    "runs at playback speed",
  );
  await page.locator("#create-output").click();
  await expect(page.locator("#output-status")).toContainText("Ready locally", {
    timeout: 10_000,
  });
  await expect(page.locator("#output-download")).toHaveAttribute(
    "download",
    /replacement-processed\.(webm|ogg|m4a)$/,
  );
});

test("cancels prepared worker processing without publishing a WAV", async ({
  page,
}) => {
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);
  const cacheStatus = page.locator("#audio-cache-status");
  await expect(cacheStatus).toHaveText(
    /Audio cache is ready\. Keep this tab active, then click Start preparation\.|Preparing locally at playback speed/,
    { timeout: 15_000 },
  );
  const start = page.locator("#start-audio-cache");
  if (await start.isVisible()) await start.click();
  await expect(cacheStatus).toContainText("Local audio cache is ready.", {
    timeout: 15_000,
  });

  await page.locator("#create-output").click();
  await page.locator("#cancel-output").click();
  await expect(page.locator("#output-status")).toContainText(
    "Processing cancelled.",
    { timeout: 15_000 },
  );
  await expect(page.locator("#output-download")).toBeHidden();
  await expect(page.locator("#preview-play")).toBeEnabled();
});

test("cancels native preparation without disturbing the visible preview", async ({
  page,
}) => {
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);
  const start = page.locator("#start-audio-cache");
  const cancel = page.locator("#cancel-audio-cache");
  // A successful user-gesture play can replace the brief Start state with
  // Cancel between two DOM reads. A short failed click is therefore benign;
  // the assertion below waits for either route to enter the running state.
  await start.click({ timeout: 500 }).catch(() => undefined);
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.locator("#audio-cache-status")).toContainText(
    "Audio preparation cancelled.",
  );
  await expect(cancel).toBeHidden();
  await expect(page.locator("#preview-play")).toBeEnabled();
});

test("manual recovery pauses native preparation and keeps Start available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    let rejectedOnce = false;
    HTMLMediaElement.prototype.play = function () {
      // The hidden extraction element has no id; leave the visible preview
      // available so this test isolates the browser autoplay failure.
      if (!this.id && !rejectedOnce) {
        rejectedOnce = true;
        Object.assign(globalThis, { i009RecoveryMedia: this });
        void nativePlay.call(this).catch(() => undefined);
        return new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new DOMException("autoplay blocked", "NotAllowedError")),
            300,
          ),
        );
      }
      return nativePlay.call(this);
    };
  });
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles(generatedMp4);

  const status = page.locator("#audio-cache-status");
  await expect(status).toContainText("Resume preparation", { timeout: 15_000 });
  await expect(page.locator("#start-audio-cache")).toBeVisible();
  await expect(page.locator("#cancel-audio-cache")).toBeVisible();
  const paused = await page.evaluate(() => {
    const media = (
      globalThis as typeof globalThis & {
        i009RecoveryMedia: HTMLMediaElement;
      }
    ).i009RecoveryMedia;
    return { currentTime: media.currentTime, paused: media.paused };
  });
  expect(paused.currentTime).toBeGreaterThan(0);
  expect(paused.paused).toBe(true);
  await page.waitForTimeout(1_000);
  const stillPausedAt = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          i009RecoveryMedia: HTMLMediaElement;
        }
      ).i009RecoveryMedia.currentTime,
  );
  expect(stillPausedAt).toBeCloseTo(paused.currentTime, 2);
  await expect(status).toContainText("Resume preparation");
  await page.locator("#start-audio-cache").click();
  await expect(status).toContainText("Local audio cache is ready.", {
    timeout: 15_000,
  });
});

test("startup cleanup preserves current and cross-tab locked PCM trees", async ({
  page,
  context,
}) => {
  await resetAndOpen(page);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.getDirectoryHandle("i009-current-test", { create: true });
    await root.getDirectoryHandle("i009-orphan-test", { create: true });
    await root.getDirectoryHandle("i009-locked-test", { create: true });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cinematic-audio-i009", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("manifests"))
          request.result.createObjectStore("manifests");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("manifests", "readwrite");
      transaction
        .objectStore("manifests")
        .put({ runId: "i009-current-test" }, "current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  const lockHolder = await context.newPage();
  await lockHolder.goto("./");
  await lockHolder.evaluate(async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    Object.assign(globalThis, { releaseI009TestLock: release });
    await new Promise<void>((resolve, reject) => {
      navigator.locks
        .request("cinematic-audio-i009-run:i009-locked-test", async () => {
          resolve();
          await held;
        })
        .catch(reject);
    });
  });
  await page.reload();
  const treeNames = async () =>
    page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names: string[] = [];
      for await (const [name] of root.entries()) names.push(name);
      return names;
    });
  await expect.poll(treeNames).not.toContain("i009-orphan-test");
  expect(await treeNames()).toContain("i009-current-test");
  expect(await treeNames()).toContain("i009-locked-test");
  await lockHolder.evaluate(() =>
    (
      globalThis as typeof globalThis & { releaseI009TestLock(): void }
    ).releaseI009TestLock(),
  );
  await lockHolder.close();
  await page.reload();
  await expect.poll(treeNames).not.toContain("i009-locked-test");
  expect(await treeNames()).toContain("i009-current-test");
});

test("preserves a valid source after decode failure and supports replacement", async ({
  page,
}) => {
  await resetAndOpen(page);
  const picker = page.locator("#media-file");
  await picker.setInputFiles({
    name: "first.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });
  await expect(page.locator("#preview-status")).toContainText("ready");

  await picker.setInputFiles({
    name: "disguised.mp4",
    mimeType: "image/png",
    buffer: Buffer.from("not a video"),
  });
  await expect(page.locator("#selection-status")).toContainText(
    "Unsupported media container",
  );
  await expect(page.locator("#preview-play")).toBeEnabled();

  await picker.setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not a wav"),
  });
  await expect(page.locator("#selection-status")).toContainText(
    "Could not import media",
  );
  await expect(page.locator("#project-phase")).toHaveText("source selected");
  await expect(page.locator("#preview-play")).toBeEnabled();

  await picker.setInputFiles({
    name: "second.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(),
  });
  await expect(page.locator("#selection-status")).toContainText(
    "Imported source metadata for second.wav",
  );
  await expect(page.locator("#preview-status")).toContainText("ready");

  await page.locator("#create-output").click();
  await expect(page.locator("#output-status")).toContainText("Ready locally", {
    timeout: 10_000,
  });
});

test("cancels an active processed output and returns to preview", async ({
  page,
}) => {
  await resetAndOpen(page);
  await page.locator("#media-file").setInputFiles({
    name: "longer.wav",
    mimeType: "audio/wav",
    buffer: tinyWav(24_000),
  });
  await expect(page.locator("#create-output")).toBeEnabled();
  await page.locator("#create-output").click();
  await expect(page.locator("#cancel-output")).toBeEnabled();
  await expect(page.locator("#preview-status")).toContainText(
    "Processed preview playback active",
  );
  await page.locator("#cancel-output").click();
  await expect(page.locator("#output-status")).toContainText(
    "Processing cancelled",
  );
  await expect(page.locator("#create-output")).toBeEnabled();
  await expect(page.locator("#preview-play")).toBeEnabled();
});
