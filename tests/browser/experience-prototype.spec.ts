import { expect, test, type Page } from "@playwright/test";

const fixtureOrigin = `http://127.0.0.1:${Number(process.env.PWA_TEST_PORT ?? 4173)}`;

async function resetFixture(page: Page): Promise<void> {
  await page.request.post(`${fixtureOrigin}/__reset`);
}

async function loadWorkbench(page: Page, query = ""): Promise<void> {
  await resetFixture(page);
  const suffix = query.startsWith("?") ? query.slice(1) : query;
  await page.goto(`./?fixture=1${suffix ? `&${suffix}` : ""}`);
}

async function selectDemoFile(page: Page): Promise<void> {
  await page.locator("#media-file").setInputFiles({
    name: "interview.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("ftypavc1"),
  });
  await expect(page.locator("#project-phase")).toHaveText("source selected");
  await expect(page.locator("#selection-status")).toContainText(
    "Synthetic fixture loaded",
  );
}

async function selectAudioFixture(page: Page): Promise<void> {
  await page.locator("#media-file").setInputFiles({
    name: "voice.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFFfixture"),
  });
  await expect(page.locator("#project-phase")).toHaveText("source selected");
}

async function openAdvancedControls(page: Page): Promise<void> {
  if (!(await page.locator("#advanced-controls").getAttribute("open"))) {
    await page.locator("#advanced-controls summary").click();
  }
}

async function openExportDetails(page: Page): Promise<void> {
  if (!(await page.locator("#export-details").getAttribute("open"))) {
    await page.locator("#export-details summary").click();
  }
}

test("keeps fixture disclosure visible in demo mode", async ({ page }) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);

  const disclosure = page.locator("#fixture-disclosure");
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(page.locator("#fixture-summary")).toContainText(
    "Synthetic fixture loaded. This demo only changes UI planning state and does not process real audio.",
  );
  await expect(page.locator("#simulated-planning")).toHaveAttribute("open", "");
  await expect(page.locator("#enhance-progress")).toHaveAttribute(
    "aria-label",
    "Simulated enhancement plan progress",
  );
});

test("supports keyboard-first preview/undo and status updates", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);

  await page.locator("#compare-preview").focus();
  await expect(page.locator("#compare-preview")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#experience-status")).toContainText(
    "Preview display is showing the planned configuration snapshot.",
  );

  await page.locator("#undo-preview").focus();
  await expect(page.locator("#undo-preview")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#experience-status")).toContainText(
    "Source metadata loaded for planning; processing simulation is active.",
  );

  await page.locator("#run-enhance").focus();
  await expect(page.locator("#run-enhance")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#enhance-progress-text")).toContainText("Enhance");

  await page.locator("#cancel-enhance").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#project-phase")).not.toHaveText("enhancing");
});

test("preserves controls through narrow viewport and reduced-motion preference", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadWorkbench(page);
  await selectDemoFile(page);

  const columns = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector(".workspace") as Element)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
  );
  expect(columns).toBe(1);
  const reduceMatch = await page.evaluate(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  expect(reduceMatch).toBe(true);

  const hasReducedMotionRule = await page.evaluate(() => {
    const style = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules || []);
        } catch {
          return [];
        }
      })
      .flat();
    return style.some(
      (rule) =>
        rule instanceof CSSMediaRule &&
        /prefers-reduced-motion: reduce/.test(rule.conditionText),
    );
  });
  expect(hasReducedMotionRule).toBe(true);
});

test("restarts enhancement after cancellation on a new synchronized generation", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("processing");
  await page.locator("#cancel-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("source ready");
  await expect(page.locator("#run-enhance")).toBeEnabled();
  await page.locator("#run-enhance").click();
  await expect(page.locator("#enhance-progress-text")).toContainText("Enhance");
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5000,
  });
});

test("shows exact fixture resource values with separate storage accounting", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  const high = page.locator('[data-profile-id="xp-high-fidelity"]');
  await expect(page.locator("#source-metadata")).toContainText("54.6 MB");
  await expect(high).toContainText("910 MB");
  await expect(high).toContainText("Persistent storage:");
  await expect(high).toContainText("Peak temporary storage:");
});

test("completes the fixture edit, preview, output selection, and export journey honestly", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#control-dialogue").fill("72");
  await page.locator("#run-enhance").click();
  await expect(page.locator("#cancel-enhance")).toBeEnabled();
  await expect(page.locator("#project-status")).toContainText(
    "no audio is being processed",
    { timeout: 2_000 },
  );
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await expect(page.locator("#assembled-preview")).toContainText(
    "Assembled preview:",
  );
  await openExportDetails(page);
  await page.locator('[data-bus="music"][data-action="export"]').uncheck();
  await page.locator("#finished-mix-export").check();
  await expect(page.locator("#run-export")).toBeEnabled();
  await page.locator("#run-export").click();
  await expect(page.locator("#project-status")).toContainText(
    "Fixture export simulation complete; no file was rendered or saved.",
    { timeout: 2_000 },
  );
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 3_000,
  });
  await expect(page.locator("#experience-status")).toContainText(
    "no file was rendered",
  );
});

test("disables reducer-rejected mutation controls while enhancing and exporting", async ({
  page,
}) => {
  await loadWorkbench(page, "?fixtureExportDelayMs=1000");
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  for (const selector of [
    "#control-dialogue",
    "#control-dereverb",
    "#control-music",
    "#control-width",
    "#control-ducking",
    "#control-loudness",
    "#compare-source",
    "#compare-preview",
    "#undo-preview",
    "#reset-controls",
    "#region-start",
    "#region-end",
    "#scene-region",
    "#finished-mix-export",
  ]) {
    await expect(page.locator(selector)).toBeDisabled();
  }
  await expect(page.locator("#cancel-enhance")).toBeEnabled();
  for (const radio of await page.locator('input[name="profile"]').all())
    await expect(radio).toBeDisabled();
  for (const control of await page.locator(".stem-card input").all())
    await expect(control).toBeDisabled();
  await page.locator("#cancel-enhance").click();
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await openExportDetails(page);
  await page.locator("#run-export").click();
  await expect(page.locator("#project-phase")).toHaveText("exporting");
  await expect(page.locator("#run-export")).toBeDisabled();
  await expect(page.locator("#control-dialogue")).toBeDisabled();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 2_000,
  });
});

test("preserves focused keyed profile and stem controls across status updates", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  const profile = page.locator(
    '[data-profile-id="xp-high-fidelity"] input[name="profile"]',
  );
  await profile.focus();
  await expect(profile).toBeFocused();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect(profile).toBeFocused();
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await openExportDetails(page);
  await page.locator('[data-bus="dialogue"][data-action="export"]').focus();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect(
    page.locator('[data-bus="dialogue"][data-action="export"]'),
  ).toBeFocused();
});

test("presents audio metadata without video fields and video metadata with them", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectAudioFixture(page);
  await openAdvancedControls(page);
  await expect(page.locator("#source-metadata")).toContainText("Audio:");
  await expect(page.locator("#source-metadata")).not.toContainText("Video:");
  await page.locator("#media-file").setInputFiles({
    name: "scene.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("ftyp"),
  });
  await expect(page.locator("#source-metadata")).toContainText("Video:");
});

test("empty export manifest disables export and gives actionable guidance", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await openExportDetails(page);
  await page.locator("#finished-mix-export").check();
  await page.locator("#finished-mix-export").uncheck();
  for (const checkbox of await page.locator('[data-action="export"]').all())
    await checkbox.uncheck();
  await expect(page.locator("#run-export")).toBeDisabled();
  await expect(page.locator("#export-summary")).toContainText(
    "Select at least one stem",
  );
});

test("fixture failure retries once and reset returns to source-ready", async ({
  page,
}) => {
  await resetFixture(page);
  await page.goto("./?fixture=1&fixtureFailureChunk=1");
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("recoverable error", {
    timeout: 3_000,
  });
  await page.locator("#retry-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await page.locator("#reset-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("source ready");
});

test("responsive cards retain usable layout under reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadWorkbench(page);
  await selectDemoFile(page);
  const journeyColumns = await page
    .locator(".journey-grid")
    .evaluate(
      (node) =>
        getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean)
          .length,
    );
  expect(journeyColumns).toBe(1);
  await expect(page.locator("#run-enhance")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    elements: Array.from(
      document.querySelectorAll<HTMLElement>("body *:not(.sr-only)"),
    )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: element.className,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
      .slice(0, 20),
  }));
  expect(overflow, JSON.stringify(overflow, null, 2)).toEqual({
    viewportWidth: 360,
    documentWidth: 360,
    bodyWidth: 360,
    elements: [],
  });
});

test("undo after a completed mix restores committed controls and keeps export available", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await page.locator("#control-dialogue").fill("13");
  await expect(page.locator("#project-phase")).toHaveText("preview ready");
  await page.locator("#undo-preview").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready");
  await expect(page.locator("#control-dialogue")).toHaveValue("45");
  await openExportDetails(page);
  await expect(page.locator("#run-export")).toBeEnabled();
});

test("export failure exposes export retry and preserves the output snapshot", async ({
  page,
}) => {
  await resetFixture(page);
  await page.goto(
    "./?fixture=1&fixtureExportFailure=true&fixtureExportDelayMs=300",
  );
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await openExportDetails(page);
  await page.locator("#run-export").click();
  await expect(page.locator("#project-phase")).toHaveText("recoverable error", {
    timeout: 2_000,
  });
  await expect(page.locator("#retry-enhance")).toHaveText("Retry export");
  await expect(page.locator("#export-summary")).toContainText("Last export:");
  await page.locator("#retry-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("exporting");
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 2_000,
  });
});

test("region edits enter preview-ready and Undo restores the committed region", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await openExportDetails(page);
  const originalStart = await page.locator("#region-start").inputValue();
  const originalEnd = await page.locator("#region-end").inputValue();
  await page.locator("#region-start").fill("65");
  await page.locator("#region-start").press("Tab");
  await expect(page.locator("#project-phase")).toHaveText("preview ready");
  await expect(page.locator("#run-export")).toBeDisabled();
  await page.locator("#undo-preview").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready");
  await expect(page.locator("#region-start")).toHaveValue(originalStart);
  await expect(page.locator("#region-end")).toHaveValue(originalEnd);
  await expect(page.locator("#run-export")).toBeEnabled();
});

test("post-mix profile changes return to preview-ready and require rerun", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await expect(page.locator("#run-enhance")).toBeDisabled();
  const alternateProfile = page
    .locator('#resource-profiles input[name="profile"]')
    .nth(1);
  await alternateProfile.click();
  await expect(page.locator("#project-phase")).toHaveText("preview ready");
  await expect(page.locator("#run-export")).toBeDisabled();
  await expect(page.locator("#run-enhance")).toBeEnabled();
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("processing");
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
});

test("profile then scene post-mix edits return to committed mix after undo", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });

  const committedProfile = await page
    .locator('#resource-profiles input[name="profile"]:checked')
    .getAttribute("value");
  await expect(committedProfile).not.toBeNull();

  const alternateProfile = page
    .locator('#resource-profiles input[name="profile"]')
    .nth(1);
  await alternateProfile.click();
  await expect(page.locator("#project-phase")).toHaveText("preview ready");
  await expect(page.locator("#run-export")).toBeDisabled();

  await page.locator("#scene-region").check();
  await expect(page.locator("#project-phase")).toHaveText("preview ready");
  await expect(page.locator("#run-enhance")).toBeEnabled();

  await page.locator("#undo-preview").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready");
  await expect(page.locator("#scene-region")).not.toBeChecked();
  await expect(
    page.locator('#resource-profiles input[name="profile"]:checked'),
  ).toHaveValue(committedProfile!);
  await expect(page.locator("#run-export")).toBeEnabled();
});

test("acoustic-scene toggles from mix-ready invalidate export state", async ({
  page,
}) => {
  await loadWorkbench(page);
  await selectDemoFile(page);
  await openAdvancedControls(page);
  await page.locator("#run-enhance").click();
  await expect(page.locator("#project-phase")).toHaveText("mix ready", {
    timeout: 5_000,
  });
  await page.locator("#scene-region").check();
  await expect(page.locator("#project-phase")).toHaveText("preview ready");
  await expect(page.locator("#run-export")).toBeDisabled();
});
