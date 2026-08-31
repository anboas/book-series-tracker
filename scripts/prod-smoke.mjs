import assert from "node:assert/strict";

const DEFAULT_PROD_URL = "https://book-series-tracker.pages.dev/";
const GITHUB_API_DATA_URL = "https://api.github.com/repos/anboas/reading-list-data/contents/books.json?ref=main";
const EXPECTED_DATA = {
  updatedAt: "2026-08-31",
  books: 192,
  read: 169,
  missing: 23,
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function normalizeBaseUrl(value) {
  const raw = value || DEFAULT_PROD_URL;
  const url = new URL(raw);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function expectedValue(name, fallback) {
  const value = argValue(name);
  return value ? Number(value) : fallback;
}

function statusText(response) {
  return `${response.status} ${response.statusText}`.trim();
}

async function fetchGithubData() {
  const response = await fetchWithCheck(GITHUB_API_DATA_URL, {
    headers: { accept: "application/vnd.github.raw+json" },
  });
  assert.equal(response.status, 200, `GitHub data should return 200, got ${statusText(response)}`);
  const text = await response.text();
  const parsed = JSON.parse(text);
  if (parsed?.content) {
    const compact = parsed.content.replace(/\s/g, "");
    return JSON.parse(Buffer.from(compact, "base64").toString("utf8"));
  }
  return parsed;
}

function statsFor(library) {
  const books = (library.series || []).flatMap((series) => series.books || []);
  return {
    books: books.length,
    read: books.filter((book) => book.status === "read").length,
    missing: books.filter((book) => book.status === "unowned").length,
  };
}

async function fetchWithCheck(url, options = {}) {
  return fetch(url, {
    redirect: "follow",
    ...options,
    headers: {
      "user-agent": "book-series-tracker-prod-smoke/1.0",
      ...(options.headers || {}),
    },
  });
}

function extractAssets(html, baseUrl) {
  const scripts = new Set();
  const stylesheets = new Set();
  const tagPattern = /<(script|link)\b[^>]*>/gi;
  const attrPattern = /\s([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

  for (const tagMatch of html.matchAll(tagPattern)) {
    const tagName = tagMatch[1].toLowerCase();
    const attrs = {};
    for (const attrMatch of tagMatch[0].matchAll(attrPattern)) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2] || attrMatch[3] || attrMatch[4] || "";
    }
    if (tagName === "script" && attrs.src) {
      scripts.add(new URL(attrs.src, baseUrl).href);
    }
    if (tagName === "link" && attrs.rel?.toLowerCase().split(/\s+/).includes("stylesheet") && attrs.href) {
      stylesheets.add(new URL(attrs.href, baseUrl).href);
    }
  }

  return {
    scripts: [...scripts],
    stylesheets: [...stylesheets],
  };
}

const baseUrl = normalizeBaseUrl(argValue("--url"));
const homeResponse = await fetchWithCheck(baseUrl);
assert.equal(homeResponse.status, 200, `Homepage should return 200, got ${statusText(homeResponse)}`);

const html = await homeResponse.text();
assert.match(html, /Book Series Tracker/, "Homepage should identify the app");

const assets = extractAssets(html, homeResponse.url || baseUrl);
assert.ok(assets.scripts.length > 0, "Homepage should reference at least one JavaScript asset");

for (const assetUrl of [...assets.scripts, ...assets.stylesheets]) {
  const assetResponse = await fetchWithCheck(assetUrl, { method: "HEAD" });
  assert.equal(assetResponse.status, 200, `Asset should return 200: ${assetUrl} got ${statusText(assetResponse)}`);
}

const data = await fetchGithubData();
const stats = statsFor(data);
assert.equal(data.updatedAt, argValue("--expect-updated-at") || EXPECTED_DATA.updatedAt, "Data updatedAt should match the expected snapshot");
assert.equal(stats.books, expectedValue("--expect-books", EXPECTED_DATA.books), "Data book count should match the expected snapshot");
assert.equal(stats.read, expectedValue("--expect-read", EXPECTED_DATA.read), "Data read count should match the expected snapshot");
assert.equal(stats.missing, expectedValue("--expect-missing", EXPECTED_DATA.missing), "Data missing count should match the expected snapshot");

console.log(
  [
    `Verified production smoke for ${baseUrl.href}`,
    "homepage=200",
    `js_assets=${assets.scripts.length}`,
    `css_assets=${assets.stylesheets.length}`,
    `updated_at=${data.updatedAt}`,
    `books=${stats.books}`,
    `read=${stats.read}`,
    `missing=${stats.missing}`,
  ].join(" "),
);
