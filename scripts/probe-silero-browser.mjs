import { chromium } from "playwright";
import { createServer } from "vite";

if (process.env.RUN_SILERO_BROWSER_PROBE !== "1") {
  process.stderr.write(
    "Set RUN_SILERO_BROWSER_PROBE=1 to run the opt-in real Chromium model probe.\n",
  );
  process.exitCode = 2;
} else {
  await run();
}

async function run() {
  const host = "127.0.0.1";
  const port = Number(process.env.SILERO_PROBE_PORT ?? 4318);
  const origin = `http://${host}:${port}`;
  process.stderr.write("silero-probe: creating local Vite server\n");
  const server = await withTimeout(
    createServer({
      base: "/audio-pwa/",
      server: { host, port, strictPort: true },
    }),
    "Vite server creation",
  );
  let browser;
  try {
    process.stderr.write("silero-probe: listening\n");
    await withTimeout(server.listen(), "Vite server startup");
    process.stderr.write("silero-probe: launching Chromium\n");
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
      if (!request.url().startsWith(origin))
        externalRequests.push(request.url());
    });
    process.stderr.write("silero-probe: loading same-origin fixture\n");
    await withTimeout(page.goto(`${origin}/audio-pwa/`), "fixture navigation");
    process.stderr.write("silero-probe: running model\n");
    const measured = await withTimeout(
      page.evaluate(async () => {
        const module =
          await import("/audio-pwa/src/models/silero-local-runtime.ts");
        const classifier = await module.createLocalSileroClassifier({
          baseUrl: document.baseURI,
          generation: 1,
        });
        const silence = await classifier.classify({
          mono48k: new Float32Array(1_536),
          canonicalStartFrame: 0,
          generation: 1,
        });
        const toneInput = Float32Array.from({ length: 1_536 }, (_, index) =>
          Math.sin((2 * Math.PI * 440 * (1_536 + index)) / 48_000),
        );
        const tone = await classifier.classify({
          mono48k: toneInput,
          canonicalStartFrame: 1_536,
          generation: 1,
        });
        await classifier.dispose();
        return [silence.probability, tone.probability];
      }),
      "model load and two inferences",
    );
    const pythonReference = [0.0016697943210601807, 0.011689633131027222];
    measured.forEach((value, index) => {
      if (Math.abs(value - pythonReference[index]) > 1e-6) {
        throw new Error(
          `Browser probability ${value} differs from Python reference ${pythonReference[index]}.`,
        );
      }
    });
    if (externalRequests.length > 0) {
      throw new Error(
        `Unexpected external requests: ${externalRequests.join(", ")}`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({ provider: "wasm", measured, pythonReference }, null, 2)}\n`,
    );
  } finally {
    process.stderr.write("silero-probe: cleaning up\n");
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
