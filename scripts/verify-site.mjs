import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:4274/";

async function waitForServer(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const server = spawn("npm", ["run", "dev", "--", "--port", "4274", "--strictPort"], { stdio: "ignore" });
await waitForServer(BASE_URL);

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-book-series-app]");
    const text = await page.locator("[data-book-series-app]").innerText();
    assert.match(text, /Book Series Tracker/);
    assert.match(text, /SOURCE: GITHUB/);
    assert.match(text, /169\s+READ/);
    assert.doesNotMatch(text, /169\s+OWNED/);
    assert.match(text, /He Who Fights with Monsters/);
    assert.match(text, /Dungeon Crawler Carl/);
    assert.match(text, /Carl's Doomsday Scenario/);
    assert.match(text, /This Inevitable Ruin/);
    assert.match(text, /Defiance of the Fall/);
    assert.match(text, /The Wheel of Time/);
    assert.match(text, /Arcane Ascension/);
    assert.doesNotMatch(text, /The Land/);
    assert.ok(await page.locator("[data-series-stack] > article").count() >= 40, "should render the Audible series library");
    assert.ok(await page.locator("[data-book-card]").count() >= 190, "should render the Audible title cards and derived gaps");
    assert.equal(await page.locator('[data-series-id="dungeon-crawler-carl"]').getAttribute("data-series-state"), "missing", "Dungeon Crawler Carl should show missing series state");
    assert.match(await page.locator('[data-series-id="dungeon-crawler-carl"] [data-series-meter]').innerText(), /MISSING 6/);
    assert.equal(await page.locator('[data-series-id="the-stormlight-archive"]').getAttribute("data-series-state"), "read", "fully tracked Audible series should show read-all state");
    assert.match(await page.locator('[data-series-id="the-stormlight-archive"] [data-series-meter]').innerText(), /READ ALL/);
    assert.equal(await page.locator('[data-series-stack] > article').first().getAttribute("data-series-id"), "he-who-fights-with-monsters", "default sort should preserve library order");
    await page.locator("[data-series-sort]").selectOption("coverage");
    assert.equal(await page.locator('[data-series-stack] > article').first().getAttribute("data-series-id"), "dungeon-crawler-carl", "least-covered sort should surface Dungeon Crawler Carl first");
    await page.locator("[data-series-sort]").selectOption("library");
    const workspaceWidth = await page.locator(".workspace").evaluate((node) => node.getBoundingClientRect().width);
    assert.ok(workspaceWidth >= viewport.width - 24, `workspace should use available width at ${viewport.width}: ${workspaceWidth}`);
    assert.equal(await page.locator('[data-series-id="dungeon-crawler-carl"] [data-book-card]').count(), 7, "Dungeon Crawler Carl should render the full seven-book main series");
    await page.locator('[data-series-id="dungeon-crawler-carl"]').scrollIntoViewIfNeeded();
    const dccCoverStates = await page.locator('[data-series-id="dungeon-crawler-carl"] img').evaluateAll(async (images) => {
      await Promise.all(images.map((image) => {
        if (image.complete) return undefined;
        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }));
      return images.map((image) => ({ hidden: image.hidden, naturalWidth: image.naturalWidth }));
    });
    assert.equal(dccCoverStates.length, 7, "Dungeon Crawler Carl should have cover images for every book");
    assert.ok(dccCoverStates.every((image) => !image.hidden && image.naturalWidth > 0), "Dungeon Crawler Carl covers should load");
    assert.equal(await page.locator("[data-book-detail]").count(), 0, "should not show book detail before a book is selected");
    const scrollableRails = await page.locator("[data-book-rail]").evaluateAll((rails) => (
      rails.filter((rail) => rail.scrollWidth > rail.clientWidth + 4).length
    ));
    assert.ok(scrollableRails >= 1, "at least one series row should scroll horizontally inside the row");
    const visibleRailScrollbars = await page.locator("[data-book-rail]").evaluateAll((rails) => (
      rails.filter((rail) => getComputedStyle(rail).scrollbarWidth !== "none").length
    ));
    assert.equal(visibleRailScrollbars, 0, "series rows should not show persistent horizontal scrollbars");
    await page.locator("[data-book-rail]").first().evaluate((rail) => {
      rail.scrollLeft = rail.scrollWidth;
    });
    await page.locator("[data-book-card]").first().click();
    assert.equal(await page.locator("[data-book-detail]").count(), 1, "selecting a book should show the focus dock");
    assert.equal(await page.locator("[data-book-card].active").count(), 1, "selecting a book should mark one active card");
    await page.locator(".app-header").click();
    assert.equal(await page.locator("[data-book-detail]").count(), 0, "clicking away should clear the focus dock");
    assert.equal(await page.locator("[data-book-card].active").count(), 0, "clicking away should clear active book focus");
    await page.locator("[data-status-filter] button", { hasText: "Missing" }).click();
    assert.ok(await page.locator("[data-book-card]").count() >= 10, "missing filter should retain derived unread gaps");
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    assert.ok(overflow <= 2, `viewport ${viewport.width} overflow ${overflow}`);
    await page.close();
  }
  console.log("Verified Book Series Tracker desktop/mobile.");
} finally {
  await browser.close();
  server.kill();
}
