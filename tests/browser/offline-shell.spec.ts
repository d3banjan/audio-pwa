import { expect, test, type Page } from "@playwright/test";

const fixtureOrigin = `http://127.0.0.1:${Number(process.env.PWA_TEST_PORT ?? 4173)}`;

function validTinyWav(): Buffer {
  const samples = 800;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

async function resetFixture(page: Page): Promise<void> {
  await page.request.post(`${fixtureOrigin}/__reset`);
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page.locator("#connection-status")).toContainText(
    "shell cached",
    { timeout: 15_000 },
  );
}

async function ensureControlled(page: Page): Promise<void> {
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
}

async function controllerRelease(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const worker = navigator.serviceWorker.controller;
        if (!worker) return resolve(null);
        const channel = new MessageChannel();
        const timeout = window.setTimeout(() => resolve(null), 2_000);
        channel.port1.onmessage = (event) => {
          window.clearTimeout(timeout);
          resolve((event.data as { releaseId?: string }).releaseId ?? null);
        };
        worker.postMessage({ type: "CHECK_SHELL" }, [channel.port2]);
      }),
  );
}

async function shellCacheAndAsset(
  page: Page,
): Promise<{ cacheName: string; assetPath: string }> {
  return page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((name) =>
      name.startsWith("cinematic-audio-shell-"),
    );
    if (!cacheName) throw new Error("shell cache missing");
    const entries = await (await caches.open(cacheName)).keys();
    const assetPath = entries
      .map((entry) => new URL(entry.url).pathname)
      .find((path) => /\/assets\/.*\.js$/.test(path));
    if (!assetPath) throw new Error("script asset missing");
    return { cacheName, assetPath };
  });
}

test("installs under the GitHub Pages subpath and reloads offline", async ({
  context,
  page,
}) => {
  await resetFixture(page);
  await page.goto("./");
  await waitForShell(page);
  await ensureControlled(page);
  expect(await controllerRelease(page)).toBe("fixture-release-1");
  expect(
    await page.locator('meta[name="fixture-release"]').getAttribute("content"),
  ).toBe("1");

  const evidence = await shellCacheAndAsset(page);
  expect(evidence.assetPath).toMatch(/^\/audio-pwa\/assets\//);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Make every word easier to hear.",
    }),
  ).toBeVisible();
  await expect(page.locator("#connection-status")).toContainText(
    "Offline · shell cached · controlled",
  );
});

test("keeps an old controlled tab on release one until safe activation", async ({
  context,
  page,
}) => {
  await resetFixture(page);
  await page.goto("./");
  await waitForShell(page);
  await ensureControlled(page);

  const siblingCache = `cinematic-audio-shell-${encodeURIComponent(`${fixtureOrigin}/sibling/`)}-keep`;
  await page.evaluate((name) => caches.open(name), siblingCache);
  await page.request.post(`${fixtureOrigin}/__release?value=2`);
  await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration())?.update(),
  );
  await expect
    .poll(() =>
      page.evaluate(async () =>
        Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
      ),
    )
    .toBe(true);

  await page.reload();
  expect(await controllerRelease(page)).toBe("fixture-release-1");
  expect(
    await page.locator('meta[name="fixture-release"]').getAttribute("content"),
  ).toBe("1");

  await page.close();
  const nextPage = await context.newPage();
  await nextPage.goto("./");
  await expect
    .poll(() => controllerRelease(nextPage))
    .toBe("fixture-release-2");
  expect(
    await nextPage
      .locator('meta[name="fixture-release"]')
      .getAttribute("content"),
  ).toBe("2");
  expect(await nextPage.evaluate(() => caches.keys())).toContain(siblingCache);

  await context.setOffline(true);
  await nextPage.reload();
  expect(
    await nextPage
      .locator('meta[name="fixture-release"]')
      .getAttribute("content"),
  ).toBe("2");
});

test("returns explicit failures for missing controlled resources", async ({
  context,
  page,
}) => {
  await resetFixture(page);
  await page.goto("./");
  await waitForShell(page);
  await ensureControlled(page);
  const { cacheName, assetPath } = await shellCacheAndAsset(page);

  await page.evaluate(
    async ({ name, path }) => (await caches.open(name)).delete(path),
    { name: cacheName, path: assetPath },
  );
  const online = await page.evaluate(async (path) => {
    const response = await fetch(path);
    return {
      status: response.status,
      shellError: response.headers.get("X-Audio-PWA-Shell-Error"),
    };
  }, assetPath);
  expect(online).toEqual({ status: 200, shellError: null });

  await context.setOffline(true);
  const offline = await page.evaluate(async (path) => {
    const response = await fetch(path);
    return {
      status: response.status,
      shellError: response.headers.get("X-Audio-PWA-Shell-Error"),
    };
  }, assetPath);
  expect(offline).toEqual({ status: 503, shellError: "offline-asset-missing" });
});

test("does not fetch newer HTML when controller-version HTML is missing", async ({
  page,
}) => {
  await resetFixture(page);
  await page.goto("./");
  await waitForShell(page);
  await ensureControlled(page);
  const cacheName = await page.evaluate(async () =>
    (await caches.keys()).find((name) =>
      name.startsWith("cinematic-audio-shell-"),
    )!,
  );
  await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (new URL(request.url).pathname.endsWith("/index.html"))
        await cache.delete(request);
    }
  }, cacheName);
  await page.request.post(`${fixtureOrigin}/__release?value=2`);

  const response = await page.goto("./");
  expect(response?.status()).toBe(503);
  expect(response?.headers()["x-audio-pwa-shell-error"]).toBe(
    "controller-document-missing",
  );
});

test("network status updates preserve focus and invalid input recovers", async ({
  page,
}) => {
  await resetFixture(page);
  await page.goto("./");
  await waitForShell(page);
  const picker = page.locator("#media-file");
  await picker.focus();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(picker).toBeFocused();
  await picker.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not audio"),
  });
  await expect(page.locator("#selection-status")).toHaveText(
    "Unsupported media source: notes.txt. Use WAV, MP3, M4A, AAC, FLAC, or MP4.",
  );
  await picker.setInputFiles({
    name: "interview.wav",
    mimeType: "audio/wav",
    buffer: validTinyWav(),
  });
  await expect(page.locator("#project-phase")).toHaveText("source selected");
});
