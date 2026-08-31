import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE_URL = "http://127.0.0.1:4275/";
const OUT_DIR = "artifacts/screenshots";

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

mkdirSync(OUT_DIR, { recursive: true });
const server = spawn("npm", ["run", "dev", "--", "--port", "4275", "--strictPort"], { stdio: "ignore" });
await waitForServer(BASE_URL);

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  for (const [name, viewport] of Object.entries({
    desktop: { width: 1440, height: 1000 },
    mobile: { width: 390, height: 844 },
  })) {
    const page = await browser.newPage({ viewport });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-book-series-app]");
    await page.waitForFunction(() => document.querySelector("[data-book-series-app]")?.innerText.includes("SOURCE: GITHUB"));
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
    await page.close();
  }
  console.log(`Captured screenshots in ${OUT_DIR}`);
} finally {
  await browser.close();
  server.kill();
}
