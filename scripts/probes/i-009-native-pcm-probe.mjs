#!/usr/bin/env node
/**
 * Local-only feasibility probe for the media-element -> AudioWorklet PCM seam.
 *
 * Usage: I009_PRIVATE_TESTCASE_PATH=/path/to/sample.mp4 node scripts/probes/i-009-native-pcm-probe.mjs
 * The input path is consumed by Playwright only and is never printed or written.
 */
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

const inputPath = process.env.I009_PRIVATE_TESTCASE_PATH;
if (!inputPath || !existsSync(inputPath)) {
  console.error(
    "I-009 probe skipped: I009_PRIVATE_TESTCASE_PATH is not set or does not exist.",
  );
  process.exitCode = 2;
  process.exit();
}

const executablePath =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/usr/bin/chromium";
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(
    '<input id="pick" type="file"><video id="visible" muted></video>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const serverAddress = server.address();
if (!serverAddress || typeof serverAddress === "string")
  throw new Error("probe server failed");
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${serverAddress.port}/`);
  await page.locator("#pick").setInputFiles(inputPath);
  const result = await page.evaluate(async () => {
    const file = document.querySelector("#pick").files?.[0];
    if (!file) throw new Error("file selection failed");
    const visible = document.querySelector("#visible");
    const extractor = document.createElement("audio");
    extractor.preload = "auto";
    // Keep the element unmuted so MediaElementAudioSource exposes decoded PCM;
    // the downstream zero-gain node prevents speaker output.
    extractor.src = URL.createObjectURL(file);
    document.body.append(extractor);
    const context = new AudioContext();
    if (!context.audioWorklet)
      return {
        supported: false,
        reason: "AudioWorklet unavailable in this browser context",
      };
    const workletSource = `class P extends AudioWorkletProcessor { process(inputs) { const ch = inputs[0]?.[0]; if (ch?.length) this.port.postMessage({ samples: ch }); return true; } } registerProcessor('i009-pcm', P);`;
    const moduleUrl = URL.createObjectURL(
      new Blob([workletSource], { type: "text/javascript" }),
    );
    await context.audioWorklet.addModule(moduleUrl);
    const source = context.createMediaElementSource(extractor);
    const node = new AudioWorkletNode(context, "i009-pcm", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const silent = context.createGain();
    silent.gain.value = 0;
    const queueCap = 64;
    let queued = 0;
    let blocks = 0;
    let samples = 0;
    let nonZero = false;
    let peakQueue = 0;
    let cancelled = false;
    let blocksAtCancel = 0;
    node.port.onmessage = ({ data }) => {
      if (cancelled) return;
      if (queued >= queueCap) return;
      queued += 1;
      peakQueue = Math.max(peakQueue, queued);
      blocks += 1;
      samples += data.samples.length;
      for (const sample of data.samples)
        if (Math.abs(sample) > 1e-7) {
          nonZero = true;
          break;
        }
      // Simulate a bounded consumer: release one page per callback turn.
      queueMicrotask(() => {
        queued = Math.max(0, queued - 1);
      });
    };
    source.connect(node).connect(silent).connect(context.destination);
    await context.resume();
    await new Promise((resolve, reject) => {
      if (extractor.readyState >= 2) return resolve();
      extractor.addEventListener("canplay", resolve, { once: true });
      extractor.addEventListener(
        "error",
        () => reject(new Error("media decode failed")),
        { once: true },
      );
    });
    const startedAt = performance.now();
    await extractor.play();
    while ((!nonZero || blocks < 4) && performance.now() - startedAt < 8_000)
      await new Promise((r) => setTimeout(r, 50));
    const clockBeforeCancel = extractor.currentTime;
    cancelled = true;
    blocksAtCancel = blocks;
    extractor.pause();
    node.port.postMessage({ type: "cancel" });
    await new Promise((r) => setTimeout(r, 150));
    const clockAfterCancel = extractor.currentTime;
    const output = {
      decoded: blocks > 0,
      nonZero,
      blocks,
      samples,
      peakQueue,
      queueCap,
      cancellationStable: blocks === blocksAtCancel,
      mediaClockAdvanced: clockBeforeCancel > 0,
      clockBeforeCancel,
      clockAfterCancel,
      visiblePreviewIndependent: visible.src === "",
    };
    node.disconnect();
    source.disconnect();
    silent.disconnect();
    await context.close();
    URL.revokeObjectURL(moduleUrl);
    URL.revokeObjectURL(extractor.src);
    extractor.remove();
    return output;
  });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
