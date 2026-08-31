import assert from "node:assert/strict";

const GITHUB_API_DATA_URL = "https://api.github.com/repos/anboas/reading-list-data/contents/books.json?ref=main";
const CONCURRENCY = 12;
const REQUEST_TIMEOUT_MS = 8000;

async function fetchGithubData() {
  const response = await fetch(GITHUB_API_DATA_URL, {
    headers: {
      accept: "application/vnd.github.raw+json",
      "user-agent": "book-series-tracker-cover-check/1.0",
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

async function checkCover(book) {
  if (!book.coverUrl) return { ok: false, status: "missing-url" };
  try {
    const response = await fetch(book.coverUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "user-agent": "book-series-tracker-cover-check/1.0" },
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: error.message };
  }
}

const library = await fetchGithubData();
const failures = new Map();
const entries = [];

for (const series of library.series || []) {
  for (const book of series.books || []) {
    entries.push({ series, book });
  }
}

let nextIndex = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, async () => {
  while (nextIndex < entries.length) {
    const entry = entries[nextIndex];
    nextIndex += 1;
    const { series, book } = entry;
    const result = await checkCover(book);
    if (!result.ok) {
      const group = failures.get(series.title) || [];
      group.push({ order: book.order, title: book.title, status: result.status, url: book.coverUrl || "" });
      failures.set(series.title, group);
    }
  }
}));

if (failures.size) {
  console.error(`Cover check found failures in ${failures.size} series:`);
  for (const [seriesTitle, books] of failures) {
    console.error(`\n${seriesTitle}`);
    for (const book of books) {
      console.error(`- #${book.order} ${book.title}: ${book.status} ${book.url}`);
    }
  }
  process.exit(1);
}

console.log(`Checked cover URLs: books=${entries.length} failures=0`);
