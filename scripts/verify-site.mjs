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
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-book-series-app]");
    const text = await page.locator("[data-book-series-app]").innerText();
    assert.match(text, /Book Series Tracker/);
    assert.match(text, /SOURCE: GITHUB/);
    assert.match(text, /He Who Fights with Monsters/);
    assert.match(text, /Dungeon Crawler Carl/);
    assert.match(text, /Defiance of the Fall/);
    assert.match(text, /The Wheel of Time/);
    assert.match(text, /Arcane Ascension/);
    assert.doesNotMatch(text, /The Land/);
    assert.ok(await page.locator("[data-series-stack] > article").count() >= 40, "should render the Audible series library");
    assert.ok(await page.locator("[data-book-card]").count() >= 180, "should render the Audible title cards and derived gaps");
    assert.equal(await page.locator("[data-book-detail]").count(), 1, "should render selected book detail");
    const scrollableRails = await page.locator("[data-book-rail]").evaluateAll((rails) => (
      rails.filter((rail) => rail.scrollWidth > rail.clientWidth + 4).length
    ));
    assert.ok(scrollableRails >= 1, "at least one series row should scroll horizontally inside the row");
    await page.locator("[data-book-rail]").first().evaluate((rail) => {
      rail.scrollLeft = rail.scrollWidth;
    });
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
