import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const configuredExecutable = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const systemChromium = "/usr/bin/chromium";
const testPort = Number(process.env.PWA_TEST_PORT ?? 4173);
const testBaseUrl = `http://127.0.0.1:${testPort}/audio-pwa/`;
const executablePath =
  configuredExecutable ??
  (existsSync(systemChromium) ? systemChromium : undefined);

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: testBaseUrl,
    browserName: "chromium",
    headless: true,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "node scripts/pwa-fixture-server.mjs",
    url: testBaseUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
