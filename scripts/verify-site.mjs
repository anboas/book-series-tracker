import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:4274/";
const MOCK_COVER_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

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
    await page.route("https://covers.openlibrary.org/**", (route) => {
      route.fulfill({ status: 200, contentType: "image/png", body: MOCK_COVER_IMAGE });
    });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("book-series-tracker:controls"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-book-series-app]");
    await page.waitForFunction(() => document.querySelector("[data-book-series-app]")?.innerText.includes("SOURCE: GITHUB"));
    const text = await page.locator("[data-book-series-app]").innerText();
    assert.match(text, /Book Series Tracker/);
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute("href"), "/manifest.webmanifest", "PWA manifest should be linked");
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
    const stateSummary = await page.locator("[data-series-state-summary]").innerText();
    assert.match(stateSummary, /40\s+Read all/i, "state summary should count fully read series");
    assert.match(stateSummary, /3\s+Gap/i, "state summary should count mostly covered gap series");
    assert.match(stateSummary, /4\s+Missing/i, "state summary should count missing-heavy series");
    assert.match(await page.locator("[data-platform-summary]").innerText(), /Audible\s+169/i, "platform summary should count Audible titles");
    await page.locator("[data-series-jump]").selectOption("dungeon-crawler-carl");
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-series-id="dungeon-crawler-carl"]').getBoundingClientRect().top) < 80);
    await page.locator("[data-queue-view-toggle]").click();
    assert.equal(await page.locator("[data-series-stack] > article").count(), 0, "queue view should hide rows when no books are queued");
    assert.match(await page.locator("[data-empty-view]").innerText(), /No queued or currently reading books/i);
    await page.locator("[data-queue-view-toggle]").click();
    await page.locator("[data-density-toggle]").click();
    assert.equal(await page.locator("[data-book-series-app]").getAttribute("data-density"), "compact", "compact density should be active");
    assert.match(page.url(), /density=compact/, "compact density should be shareable in the URL");
    await page.locator("[data-density-toggle]").click();
    const firstCard = page.locator("[data-book-card]").first();
    const secondCard = page.locator("[data-book-card]").nth(1);
    await firstCard.focus();
    await firstCard.press("ArrowRight");
    assert.equal(await secondCard.evaluate((node) => document.activeElement === node), true, "ArrowRight should move book-card focus");
    assert.match(await firstCard.getAttribute("aria-label"), /He Who Fights with Monsters.*book 1.*Read.*Audible/i, "book card accessible label should include title, order, status, and platforms");
    const download = page.waitForEvent("download");
    await page.locator("[data-export-view]").click();
    assert.equal((await download).suggestedFilename(), "book-series-current-view.csv", "export should download current view CSV");
    await page.locator("[data-missing-series-toggle]").click();
    assert.equal(await page.locator("[data-series-stack] > article").count(), 7, "missing-series view should show only series with gaps");
    assert.equal(await page.locator('[data-series-id="the-stormlight-archive"]').count(), 0, "missing-series view should hide complete series");
    assert.match(await page.locator('[data-series-id="dungeon-crawler-carl"] [data-next-missing]').innerText(), /#2 Carl's Doomsday Scenario/i);
    await page.locator("[data-missing-series-toggle]").click();
    await page.locator("[data-hide-completed-toggle]").check();
    assert.equal(await page.locator("[data-series-stack] > article").count(), 7, "hide-completed should remove fully read rows");
    assert.equal(await page.locator('[data-series-id="the-stormlight-archive"]').count(), 0, "hide-completed should hide Stormlight");
    assert.equal(await page.locator('[data-series-id="dungeon-crawler-carl"]').count(), 1, "hide-completed should retain incomplete rows");
    await page.locator("[data-hide-completed-toggle]").uncheck();
    await page.locator("[data-library-search]").fill("doomsday");
    assert.equal(await page.locator("[data-series-stack] > article").count(), 1, "search should hide non-matching series rows");
    assert.equal(await page.locator("[data-book-card]").count(), 1, "search should narrow visible books");
    assert.match(await page.locator("[data-book-series-app]").innerText(), /Carl's Doomsday Scenario/);
    await page.locator("[data-status-filter] button", { hasText: "Missing" }).click();
    await page.locator("[data-series-sort]").selectOption("coverage");
    await page.locator("[data-missing-series-toggle]").click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-book-series-app]");
    await page.waitForFunction(() => document.querySelector("[data-book-series-app]")?.innerText.includes("SOURCE: GITHUB"));
    assert.equal(await page.locator("[data-library-search]").inputValue(), "doomsday", "search should persist across reloads");
    assert.equal(await page.locator("[data-series-sort]").inputValue(), "coverage", "series sort should persist across reloads");
    assert.match(await page.locator("[data-status-filter] button.active").innerText(), /Missing/, "status filter should persist across reloads");
    assert.match(page.url(), /view=missing/, "series view should be shareable in the URL");
    assert.equal(await page.locator("[data-series-stack] > article").count(), 1, "persisted search and status should restore the filtered row");
    await page.locator("[data-library-search]").fill("");
    await page.locator("[data-status-filter] button", { hasText: "All" }).click();
    await page.locator("[data-series-sort]").selectOption("library");
    await page.locator("[data-missing-series-toggle]").click();
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
    const dccImages = page.locator('[data-series-id="dungeon-crawler-carl"] img');
    assert.equal(await dccImages.count(), 7, "Dungeon Crawler Carl should have cover images for every book");
    if (viewport.width >= 1440) {
      for (let index = 0; index < await dccImages.count(); index += 1) {
        const image = dccImages.nth(index);
        await image.scrollIntoViewIfNeeded();
        const coverState = await image.evaluate(async (image) => {
          image.loading = "eager";
          if (!image.complete) {
            await new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
              setTimeout(resolve, 10000);
            });
          }
          await image.decode?.().catch(() => undefined);
          return { hidden: image.hidden, naturalWidth: image.naturalWidth };
        });
        assert.ok(!coverState.hidden && coverState.naturalWidth > 0, `Dungeon Crawler Carl cover ${index + 1} should load`);
      }
    }
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

  const offlinePage = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await offlinePage.route("https://api.github.com/repos/anboas/reading-list-data/**", (route) => route.abort());
  await offlinePage.route("https://raw.githubusercontent.com/anboas/reading-list-data/**", (route) => route.abort());
  await offlinePage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await offlinePage.evaluate(() => {
    localStorage.setItem("book-series-tracker:library", JSON.stringify({
      cachedAt: "2026-08-31T12:00:00.000Z",
      library: {
        updatedAt: "cache-test",
        platforms: [{ id: "cache", label: "Cache", color: "#38bdf8" }],
        series: [{
          id: "cache-test-series",
          title: "Cache Test Series",
          author: "Verifier",
          accent: "#38bdf8",
          summary: "Cached fallback test.",
          priority: "Buy next",
          note: "Keep this one visible.",
          books: [{
            order: 1,
            title: "Cached Book",
            author: "Verifier",
            status: "read",
            platforms: ["cache"],
            source: "Verifier fixture",
            publicationYear: 2026,
          }],
        }],
      },
    }));
  });
  await offlinePage.reload({ waitUntil: "domcontentloaded" });
  await offlinePage.waitForFunction(() => document.querySelector("[data-book-series-app]")?.innerText.includes("CACHED GITHUB"));
  const offlineText = await offlinePage.locator("[data-book-series-app]").innerText();
  assert.match(offlineText, /Source: Cached GitHub 2026-08-31/i, "offline load should use cached GitHub data");
  assert.match(offlineText, /Cache Test Series/);
  assert.match(offlineText, /Buy next.*Keep this one visible/i, "series notes and priority should render when present");
  assert.match(offlineText, /2026/, "publication metadata should render when present");
  assert.match(offlineText, /1\s+visible/i);
  await offlinePage.locator("[data-book-card]").click();
  assert.equal(await offlinePage.locator("[data-source-link]").getAttribute("href"), "https://github.com/anboas/reading-list-data/blob/main/books.json", "book detail should link to source data");
  await offlinePage.route("https://covers.openlibrary.org/**", (route) => route.abort());
  await offlinePage.evaluate(() => {
    localStorage.setItem("book-series-tracker:library", JSON.stringify({
      cachedAt: "2026-08-31T12:00:00.000Z",
      library: {
        updatedAt: "cover-test",
        platforms: [],
        series: [{
          id: "cover-test-series",
          title: "Cover Test Series",
          author: "Verifier",
          summary: "Cover fallback test.",
          books: [{
            order: 1,
            title: "No Cover Book",
            author: "Verifier",
            status: "unowned",
            platforms: [],
            source: "Verifier fixture",
            coverUrl: "https://covers.openlibrary.org/b/id/fail-L.jpg",
          }],
        }],
      },
    }));
  });
  await offlinePage.reload({ waitUntil: "domcontentloaded" });
  await offlinePage.waitForFunction(() => document.querySelector("[data-book-series-app]")?.innerText.includes("CACHED GITHUB"));
  await offlinePage.waitForSelector('[data-cover-state="missing"]');
  assert.match(await offlinePage.locator('[data-cover-state="missing"]').first().innerText(), /No cover/i, "missing covers should show a quiet diagnostic");
  await offlinePage.close();

  console.log("Verified Book Series Tracker desktop/mobile.");
} finally {
  await browser.close();
  server.kill();
}
