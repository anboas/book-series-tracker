import assert from "node:assert/strict";

const GITHUB_API_DATA_URL = "https://api.github.com/repos/anboas/reading-list-data/contents/books.json?ref=main";
const VALID_STATUSES = new Set(["owned", "read", "reading", "queued", "unowned"]);

async function fetchGithubData() {
  const response = await fetch(GITHUB_API_DATA_URL, {
    headers: {
      accept: "application/vnd.github.raw+json",
      "user-agent": "book-series-tracker-validate/1.0",
    },
  });
  assert.equal(response.status, 200, `GitHub data should return 200, got ${response.status}`);
  const text = await response.text();
  const parsed = JSON.parse(text);
  if (parsed?.content) {
    return JSON.parse(Buffer.from(parsed.content.replace(/\s/g, ""), "base64").toString("utf8"));
  }
  return parsed;
}

function fail(errors, message) {
  errors.push(message);
}

function requireString(errors, value, label) {
  if (typeof value !== "string" || !value.trim()) fail(errors, `${label} must be a non-empty string`);
}

function optionalString(errors, value, label) {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    fail(errors, `${label} must be a non-empty string when present`);
  }
}

function optionalYear(errors, value, label) {
  if (value === undefined) return;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return;
  if (typeof value === "string" && value.trim()) return;
  fail(errors, `${label} must be a positive integer or non-empty string when present`);
}

function validateLibrary(library) {
  const errors = [];
  requireString(errors, library.updatedAt, "library.updatedAt");
  if (!Array.isArray(library.platforms)) fail(errors, "library.platforms must be an array");
  if (!Array.isArray(library.series)) fail(errors, "library.series must be an array");

  const platformIds = new Set();
  for (const [index, platform] of (library.platforms || []).entries()) {
    const label = `platforms[${index}]`;
    requireString(errors, platform.id, `${label}.id`);
    requireString(errors, platform.label, `${label}.label`);
    requireString(errors, platform.color, `${label}.color`);
    if (platform.id && platformIds.has(platform.id)) fail(errors, `${label}.id duplicates platform ${platform.id}`);
    if (platform.id) platformIds.add(platform.id);
  }

  const seriesIds = new Set();
  for (const [seriesIndex, series] of (library.series || []).entries()) {
    const label = `series[${seriesIndex}] ${series.title || series.id || ""}`.trim();
    requireString(errors, series.id, `${label}.id`);
    requireString(errors, series.title, `${label}.title`);
    requireString(errors, series.author, `${label}.author`);
    optionalString(errors, series.note, `${label}.note`);
    optionalString(errors, series.priority, `${label}.priority`);
    if (!Array.isArray(series.books)) fail(errors, `${label}.books must be an array`);
    if (series.id && seriesIds.has(series.id)) fail(errors, `${label}.id duplicates series ${series.id}`);
    if (series.id) seriesIds.add(series.id);

    const orders = new Set();
    const integerOrders = new Set();
    const titles = new Set();
    for (const [bookIndex, book] of (series.books || []).entries()) {
      const bookLabel = `${label}.books[${bookIndex}] ${book.title || ""}`.trim();
      const orderKey = String(book.order ?? "").trim();
      if (!orderKey) fail(errors, `${bookLabel}.order must be a non-empty number or label`);
      if (typeof book.order === "number" && book.order <= 0) fail(errors, `${bookLabel}.order must be positive`);
      requireString(errors, book.title, `${bookLabel}.title`);
      requireString(errors, book.author, `${bookLabel}.author`);
      requireString(errors, book.source, `${bookLabel}.source`);
      optionalString(errors, book.note, `${bookLabel}.note`);
      optionalString(errors, book.priority, `${bookLabel}.priority`);
      optionalYear(errors, book.year, `${bookLabel}.year`);
      optionalYear(errors, book.publicationYear, `${bookLabel}.publicationYear`);
      optionalString(errors, book.releaseDate, `${bookLabel}.releaseDate`);
      optionalString(errors, book.publicationDate, `${bookLabel}.publicationDate`);
      if (!VALID_STATUSES.has(book.status)) fail(errors, `${bookLabel}.status must be one of ${[...VALID_STATUSES].join(", ")}`);
      if (!Array.isArray(book.platforms)) fail(errors, `${bookLabel}.platforms must be an array`);
      for (const platformId of book.platforms || []) {
        if (!platformIds.has(platformId)) fail(errors, `${bookLabel}.platforms references unknown platform ${platformId}`);
      }
      if (orderKey && orders.has(orderKey)) fail(errors, `${bookLabel}.order duplicates #${book.order}`);
      if (orderKey) orders.add(orderKey);
      if (Number.isInteger(book.order)) integerOrders.add(book.order);
      const titleKey = String(book.title || "").trim().toLowerCase();
      if (titleKey && titles.has(titleKey)) fail(errors, `${bookLabel}.title duplicates ${book.title}`);
      if (titleKey) titles.add(titleKey);
    }

    if (integerOrders.size === orders.size) {
      const sortedOrders = [...integerOrders].sort((a, b) => a - b);
      for (let index = 1; index < sortedOrders.length; index += 1) {
        const previous = sortedOrders[index - 1];
        const current = sortedOrders[index];
        if (current !== previous + 1) {
          fail(errors, `${label}.books has an order gap between #${previous} and #${current}`);
        }
      }
    }
  }

  return errors;
}

const library = await fetchGithubData();
const errors = validateLibrary(library);
if (errors.length) {
  console.error(`Library validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const bookCount = (library.series || []).flatMap((series) => series.books || []).length;
console.log(`Validated library data: series=${library.series.length} books=${bookCount} platforms=${library.platforms.length}`);
