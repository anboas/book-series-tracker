import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { fallbackLibrary } from "./fallbackLibrary.js";
import "./styles.css";

const DATA_URL = "https://raw.githubusercontent.com/anboas/reading-list-data/main/books.json";
const DATA_WEB_URL = "https://github.com/anboas/reading-list-data/blob/main/books.json";
const GITHUB_API_DATA_URL = "https://api.github.com/repos/anboas/reading-list-data/contents/books.json?ref=main";
const GITHUB_API_COMMIT_URL = "https://api.github.com/repos/anboas/reading-list-data/commits/main";
const APP_VERSION = "0.1.0";
const CONTROL_STORAGE_KEY = "book-series-tracker:controls";
const LIBRARY_CACHE_KEY = "book-series-tracker:library";
const coverResolutionCache = new Map();
const AUDIO_PLATFORM_IDS = new Set(["audible", "audiobookshelf"]);
const STATUS = {
  all: { label: "All", tone: "neutral" },
  owned: { label: "Owned", tone: "blue" },
  read: { label: "Read", tone: "green" },
  reading: { label: "Reading", tone: "blue" },
  queued: { label: "Queued", tone: "amber" },
  unowned: { label: "Missing", tone: "red" },
};
const SERIES_SORT = {
  attention: {
    label: "Needs attention",
    compare: (a, b) => (
      b.sortStats.unowned - a.sortStats.unowned ||
      a.sortStats.progress - b.sortStats.progress ||
      a.sortIndex - b.sortIndex
    ),
  },
  library: {
    label: "Library order",
    compare: (a, b) => a.sortIndex - b.sortIndex,
  },
  coverage: {
    label: "Least covered",
    compare: (a, b) => (
      a.sortStats.progress - b.sortStats.progress ||
      b.sortStats.unowned - a.sortStats.unowned ||
      a.sortIndex - b.sortIndex
    ),
  },
  missing: {
    label: "Most missing",
    compare: (a, b) => (
      b.sortStats.unowned - a.sortStats.unowned ||
      a.sortStats.progress - b.sortStats.progress ||
      a.sortIndex - b.sortIndex
    ),
  },
  size: {
    label: "Largest series",
    compare: (a, b) => (
      b.sortStats.books - a.sortStats.books ||
      b.sortStats.unowned - a.sortStats.unowned ||
      a.sortIndex - b.sortIndex
    ),
  },
  owned: {
    label: "Most owned",
    compare: (a, b) => (
      b.sortStats.tracked - a.sortStats.tracked ||
      b.sortStats.books - a.sortStats.books ||
      a.sortIndex - b.sortIndex
    ),
  },
  title: {
    label: "Series A-Z",
    compare: (a, b) => a.title.localeCompare(b.title) || a.sortIndex - b.sortIndex,
  },
};
const CONTROL_DEFAULTS = {
  statusFilter: "all",
  platformFilter: "all",
  platformFocus: "all",
  seriesSort: "library",
  searchQuery: "",
  seriesView: "all",
  hideCompletedSeries: false,
  density: "cover",
};
const DENSITY_ORDER = ["cover", "compact", "list"];

function readStoredControls() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTROL_STORAGE_KEY) || "{}");
    const params = new URLSearchParams(window.location.search);
    const hasStoredSort = SERIES_SORT[parsed.seriesSort];
    const mobileDefaultSort = window.matchMedia?.("(max-width: 640px)")?.matches ? "attention" : CONTROL_DEFAULTS.seriesSort;
    const controls = {
      statusFilter: STATUS[parsed.statusFilter] ? parsed.statusFilter : CONTROL_DEFAULTS.statusFilter,
      platformFilter: typeof parsed.platformFilter === "string" ? parsed.platformFilter : CONTROL_DEFAULTS.platformFilter,
      platformFocus: typeof parsed.platformFocus === "string" ? parsed.platformFocus : CONTROL_DEFAULTS.platformFocus,
      seriesSort: hasStoredSort ? parsed.seriesSort : mobileDefaultSort,
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : CONTROL_DEFAULTS.searchQuery,
      seriesView: ["missing", "queue", "authors", "next"].includes(parsed.seriesView) ? parsed.seriesView : CONTROL_DEFAULTS.seriesView,
      hideCompletedSeries: typeof parsed.hideCompletedSeries === "boolean" ? parsed.hideCompletedSeries : CONTROL_DEFAULTS.hideCompletedSeries,
      density: DENSITY_ORDER.includes(parsed.density) ? parsed.density : CONTROL_DEFAULTS.density,
    };
    const status = params.get("status");
    const sort = params.get("sort");
    const view = params.get("view");
    if (STATUS[status]) controls.statusFilter = status;
    if (SERIES_SORT[sort]) controls.seriesSort = sort;
    if (params.has("platform")) controls.platformFilter = params.get("platform") || "all";
    if (params.has("focus")) controls.platformFocus = params.get("focus") || "all";
    if (params.has("q")) controls.searchQuery = params.get("q") || "";
    if (["all", "missing", "queue", "authors", "next"].includes(view)) controls.seriesView = view;
    if (params.has("hideComplete")) controls.hideCompletedSeries = params.get("hideComplete") === "1";
    if (DENSITY_ORDER.includes(params.get("density"))) controls.density = params.get("density");
    return controls;
  } catch {
    return CONTROL_DEFAULTS;
  }
}

function writeStoredControls(controls) {
  try {
    localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(controls));
  } catch {
    // Storage can be unavailable in private contexts; controls still work for the session.
  }
}

function writeUrlControls(controls) {
  const defaults = CONTROL_DEFAULTS;
  const params = new URLSearchParams();
  if (controls.statusFilter !== defaults.statusFilter) params.set("status", controls.statusFilter);
  if (controls.platformFilter !== defaults.platformFilter) params.set("platform", controls.platformFilter);
  if (controls.platformFocus !== defaults.platformFocus) params.set("focus", controls.platformFocus);
  if (controls.seriesSort !== defaults.seriesSort) params.set("sort", controls.seriesSort);
  if (controls.searchQuery.trim()) params.set("q", controls.searchQuery.trim());
  if (controls.seriesView !== defaults.seriesView) params.set("view", controls.seriesView);
  if (controls.hideCompletedSeries) params.set("hideComplete", "1");
  if (controls.density !== defaults.density) params.set("density", controls.density);
  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

function readCachedLibrary() {
  try {
    const cached = JSON.parse(localStorage.getItem(LIBRARY_CACHE_KEY) || "{}");
    if (!cached?.library?.series?.length) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedLibrary(library) {
  try {
    localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify({
      cachedAt: new Date().toISOString(),
      library,
    }));
  } catch {
    // Cache is opportunistic; live data remains the source of truth.
  }
}

function useLibrary() {
  const [library, setLibrary] = useState(fallbackLibrary);
  const [source, setSource] = useState("Bundled draft");
  const [sourceMeta, setSourceMeta] = useState({ cachedAt: "", sha: "", url: DATA_WEB_URL });

  useEffect(() => {
    let cancelled = false;
    fetchGithubData()
      .then(({ library: data, sha, url }) => {
        if (!cancelled) {
          setLibrary(data);
          setSource("GitHub");
          setSourceMeta({ cachedAt: "", sha, url: url || DATA_WEB_URL });
          writeCachedLibrary(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const cached = readCachedLibrary();
          if (cached) {
            setLibrary(cached.library);
            setSource(`Cached GitHub${cached.cachedAt ? ` ${cached.cachedAt.slice(0, 10)}` : ""}`);
            setSourceMeta({ cachedAt: cached.cachedAt || "", sha: "", url: DATA_WEB_URL });
          } else {
            setSource("Bundled draft");
            setSourceMeta({ cachedAt: "", sha: "", url: DATA_WEB_URL });
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { library, source, sourceMeta };
}

async function fetchGithubData() {
  try {
    const response = await fetch(`${GITHUB_API_DATA_URL}&cache=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "application/vnd.github.raw+json" },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (parsed?.content) {
      const compact = parsed.content.replace(/\s/g, "");
      const binary = atob(compact);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      let commitSha = "";
      try {
        const commitResponse = await fetch(`${GITHUB_API_COMMIT_URL}?cache=${Date.now()}`, {
          cache: "no-store",
          headers: { accept: "application/vnd.github+json" },
        });
        if (commitResponse.ok) {
          commitSha = (await commitResponse.json()).sha || "";
        }
      } catch {
        commitSha = "";
      }
      return {
        library: JSON.parse(new TextDecoder().decode(bytes)),
        sha: commitSha || parsed.sha || "",
        url: parsed.html_url || DATA_WEB_URL,
      };
    }
    return { library: parsed, sha: "", url: DATA_WEB_URL };
  } catch {
    const response = await fetch(`${DATA_URL}?cache=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`GitHub Raw returned ${response.status}`);
    return { library: await response.json(), sha: "", url: DATA_WEB_URL };
  }
}

function platformMap(platforms = []) {
  return Object.fromEntries(platforms.map((platform) => [platform.id, platform]));
}

function coverUrlFromId(coverId) {
  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`;
}

async function resolveCoverUrl(book) {
  const key = `${book.title}::${book.author || ""}`;
  if (coverResolutionCache.has(key)) return coverResolutionCache.get(key);

  const promise = fetch(`https://openlibrary.org/search.json?${new URLSearchParams({
    title: book.title,
    author: book.author || "",
    limit: "5",
    fields: "title,author_name,cover_i",
  })}`, {
    cache: "force-cache",
    headers: { accept: "application/json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Open Library returned ${response.status}`);
      return response.json();
    })
    .then((data) => {
      const match = (data.docs || []).find((item) => item.cover_i);
      return match?.cover_i ? coverUrlFromId(match.cover_i) : null;
    })
    .catch(() => null);

  coverResolutionCache.set(key, promise);
  return promise;
}

function statsFor(series = []) {
  const books = series.flatMap((item) => item.books || []);
  const read = books.filter((book) => book.status === "read").length;
  const owned = books.filter((book) => book.status === "owned").length;
  const reading = books.filter((book) => book.status === "reading").length;
  const queued = books.filter((book) => book.status === "queued").length;
  const unowned = books.filter((book) => book.status === "unowned").length;
  const tracked = books.length - unowned;
  return {
    books: books.length,
    owned,
    read,
    reading,
    queued,
    unowned,
    tracked,
    progress: books.length ? Math.round((tracked / books.length) * 100) : 0,
  };
}

function seriesStateFor(stats) {
  if (!stats.books) return { tone: "empty", label: "No books", detail: "No visible titles" };
  if (stats.unowned > 0) {
    return {
      tone: stats.progress >= 75 ? "gap" : "missing",
      label: `Missing ${stats.unowned}`,
      detail: `${stats.read}/${stats.books} read`,
    };
  }
  if (stats.read === stats.books) {
    return { tone: "read", label: "Read all", detail: "Collected and read" };
  }
  if (stats.tracked === stats.books) {
    return { tone: "collected", label: "Collected", detail: `${stats.read}/${stats.books} read` };
  }
  return { tone: "partial", label: "In progress", detail: `${stats.read}/${stats.books} read` };
}

function seriesStateCountsFor(series = []) {
  return series.reduce((counts, item) => {
    const state = seriesStateFor(statsFor([item])).tone;
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});
}

function platformStatsFor(series = [], platforms = []) {
  const counts = Object.fromEntries(platforms.map((platform) => [platform.id, 0]));
  let missing = 0;
  let audio = 0;
  for (const book of series.flatMap((item) => item.books || [])) {
    if (!(book.platforms || []).length) missing += 1;
    if ((book.platforms || []).some((platformId) => AUDIO_PLATFORM_IDS.has(platformId))) audio += 1;
    for (const platformId of book.platforms || []) {
      counts[platformId] = (counts[platformId] || 0) + 1;
    }
  }
  return {
    platforms: platforms.map((platform) => ({
      ...platform,
      count: counts[platform.id] || 0,
    })),
    audio,
    missing,
  };
}

function nextMissingBookFor(series) {
  return nextMissingBooksFor(series, 1)[0] || null;
}

function orderSortValue(order) {
  const value = Number.parseFloat(String(order).replace(/[^0-9.].*$/, ""));
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function nextMissingBooksFor(series, limit = 3) {
  return [...(series.allBooks || series.books || [])]
    .filter((book) => book.status === "unowned")
    .sort((a, b) => orderSortValue(a.order) - orderSortValue(b.order))
    .slice(0, limit);
}

function visibleBooksFor(series = []) {
  return series.flatMap((item) => (
    (item.books || []).map((book) => ({
      ...book,
      seriesTitle: item.title,
      seriesAuthor: item.author,
    }))
  ));
}

function authorGroupsFor(series = []) {
  const groups = new Map();
  for (const item of series) {
    const key = item.author || "Unknown author";
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.entries()]
    .map(([author, items]) => ({ author, series: items }))
    .sort((a, b) => a.author.localeCompare(b.author));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function exportVisibleBooks(series) {
  const rows = visibleBooksFor(series);
  const headers = ["series", "order", "title", "author", "status", "platforms", "source"];
  const csv = [
    headers.join(","),
    ...rows.map((book) => headers.map((header) => csvEscape(
      header === "series"
        ? book.seriesTitle
        : header === "platforms"
          ? (book.platforms || []).join("|")
          : book[header] || "",
    )).join(",")),
  ].join("\n");
  downloadText("book-series-current-view.csv", csv, "text/csv;charset=utf-8");
}

function exportVisibleBooksJson(series) {
  downloadText(
    "book-series-current-view.json",
    `${JSON.stringify({ exportedAt: new Date().toISOString(), series }, null, 2)}\n`,
    "application/json;charset=utf-8",
  );
}

function missingBooksBySeries(series = []) {
  return series.map((item) => ({
    series: item,
    books: (item.books || []).filter((book) => book.status === "unowned"),
  })).filter((item) => item.books.length);
}

function missingListText(series = []) {
  const groups = missingBooksBySeries(series);
  if (!groups.length) return "No missing books.";
  return groups.map(({ series: item, books }) => [
    item.title,
    ...books.map((book) => `- #${book.order} ${book.title}${book.author ? ` by ${book.author}` : ""}`),
  ].join("\n")).join("\n\n");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function jumpToSeries(seriesId) {
  if (!seriesId) return;
  document.querySelector(`[data-series-id="${CSS.escape(seriesId)}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function platformLabelsFor(book, platforms) {
  const labels = (book.platforms || []).map((platformId) => platforms[platformId]?.label || platformId);
  return labels.length ? labels : ["Not owned"];
}

function platformFocusLabel(platformFocus, platforms) {
  if (platformFocus === "all") return "All platforms";
  if (platformFocus === "audio") return "Owned audio";
  if (platformFocus === "missing") return "Missing";
  return platforms[platformFocus]?.label || platformFocus;
}

function platformFocusMatches(book, platformFocus) {
  if (platformFocus === "all") return true;
  if (platformFocus === "audio") return (book.platforms || []).some((platformId) => AUDIO_PLATFORM_IDS.has(platformId));
  if (platformFocus === "missing") return !(book.platforms || []).length;
  return (book.platforms || []).includes(platformFocus);
}

function platformFocusCountFor(series, platformFocus) {
  return (series.allBooks || series.books || []).filter((book) => platformFocusMatches(book, platformFocus)).length;
}

function seriesHasPlatform(series, platformId) {
  if (platformId === "audio") {
    return (series.books || []).some((book) => (book.platforms || []).some((id) => AUDIO_PLATFORM_IDS.has(id)));
  }
  return (series.books || []).some((book) => (book.platforms || []).includes(platformId));
}

function platformFilterMatches(book, series, platformId) {
  if (platformId === "all") return true;
  if (platformFocusMatches(book, platformId)) return true;
  return book.status === "unowned" && seriesHasPlatform(series, platformId);
}

function platformFocusOptions(platforms = []) {
  return [
    { id: "all", label: "All platforms", color: "#64748b" },
    { id: "audio", label: "Owned audio", color: "#14b8a6" },
    ...platforms,
    { id: "missing", label: "Missing", color: "#fb7185" },
  ];
}

function priorityMissingBooksFor(series = [], limit = 5) {
  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  return series
    .map((item, index) => {
      const next = nextMissingBookFor({ ...item, allBooks: item.books || [] });
      if (!next) return null;
      return {
        ...next,
        seriesId: item.id,
        seriesTitle: item.title,
        seriesAuthor: item.author,
        seriesPriority: item.priority || "",
        sortRank: priorityRank[item.priority] ?? 3,
        sortIndex: index,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortRank - b.sortRank || a.sortIndex - b.sortIndex)
    .slice(0, limit);
}

function bookMetadataFor(book) {
  return book.releaseDate || book.publicationDate || book.year || book.publicationYear || "";
}

function openLibrarySearchUrl(book) {
  return `https://openlibrary.org/search?${new URLSearchParams({
    title: book.title || "",
    author: book.author || "",
  })}`;
}

function missingTitleSearchUrl(book) {
  return `https://www.google.com/search?${new URLSearchParams({
    q: `${book.title || ""} ${book.author || ""} audiobook`,
  })}`;
}

function bookHashFor(book) {
  return book?.seriesId ? `#book=${encodeURIComponent(book.seriesId)}:${encodeURIComponent(String(book.order))}` : "";
}

function statusClassFor(statusId) {
  return STATUS[statusId]?.tone || "neutral";
}

function findBookFromHash(library, hash) {
  const match = /^#book=([^:]+):(.+)$/.exec(hash || "");
  if (!match) return null;
  const seriesId = decodeURIComponent(match[1]);
  const order = decodeURIComponent(match[2]);
  const series = (library.series || []).find((item) => item.id === seriesId);
  const book = (series?.books || []).find((item) => String(item.order) === order);
  return book ? { ...book, seriesId: series.id, seriesTitle: series.title, seriesAccent: series.accent, seriesNote: series.note, seriesPriority: series.priority } : null;
}

function diagnosticsFor(library) {
  const series = library.series || [];
  const books = series.flatMap((item) => item.books || []);
  const coverIdCount = books.filter((book) => /\/b\/id\//.test(book.coverUrl || "")).length;
  const titleCoverCount = books.filter((book) => /\/b\/title\//.test(book.coverUrl || "")).length;
  const metadataCount = books.filter((book) => bookMetadataFor(book)).length;
  const priorities = series.filter((item) => item.priority || item.note).length;
  return { series: series.length, books: books.length, coverIdCount, titleCoverCount, metadataCount, priorities };
}

function App() {
  const { library, source, sourceMeta } = useLibrary();
  const platforms = useMemo(() => platformMap(library.platforms), [library.platforms]);
  const initialControls = useMemo(() => readStoredControls(), []);
  const [statusFilter, setStatusFilter] = useState(initialControls.statusFilter);
  const [platformFilter, setPlatformFilter] = useState(initialControls.platformFilter);
  const [platformFocus, setPlatformFocus] = useState(initialControls.platformFocus);
  const [seriesSort, setSeriesSort] = useState(initialControls.seriesSort);
  const [searchQuery, setSearchQuery] = useState(initialControls.searchQuery);
  const [seriesView, setSeriesView] = useState(initialControls.seriesView);
  const [hideCompletedSeries, setHideCompletedSeries] = useState(initialControls.hideCompletedSeries);
  const [density, setDensity] = useState(initialControls.density);
  const [selectedBook, setSelectedBook] = useState(null);
  const [collapsedSeries, setCollapsedSeries] = useState(() => new Set());
  const [actionMessage, setActionMessage] = useState("");
  const restoredHash = useRef(false);
  const initializedMobileCollapse = useRef(false);

  useEffect(() => {
    if ((library.platforms || []).length && !["all", "audio"].includes(platformFilter) && !platforms[platformFilter]) {
      setPlatformFilter("all");
    }
    if ((library.platforms || []).length && !["all", "audio", "missing"].includes(platformFocus) && !platforms[platformFocus]) {
      setPlatformFocus("all");
    }
  }, [library.platforms, platformFilter, platformFocus, platforms]);

  useEffect(() => {
    const controls = { statusFilter, platformFilter, platformFocus, seriesSort, searchQuery, seriesView, hideCompletedSeries, density };
    writeStoredControls(controls);
    writeUrlControls(controls);
  }, [density, hideCompletedSeries, platformFilter, platformFocus, searchQuery, seriesSort, seriesView, statusFilter]);

  const filteredSeries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const mappedSeries = (library.series || []).map((series, index) => ({
      series,
      index,
      baseBooks: (series.books || []).filter((book) => {
        if (statusFilter !== "all" && book.status !== statusFilter) return false;
        if (seriesView === "queue" && !["queued", "reading"].includes(book.status)) return false;
        if (!platformFilterMatches(book, series, platformFilter)) return false;
        return true;
      }),
    })).map(({ series, index, baseBooks }) => {
      const seriesMatches = normalizedQuery && [series.title, series.author, series.summary].some((value) => (
        (value || "").toLowerCase().includes(normalizedQuery)
      ));
      const books = normalizedQuery && !seriesMatches
        ? baseBooks.filter((book) => (
          [book.title, book.author].some((value) => (value || "").toLowerCase().includes(normalizedQuery))
        ))
        : baseBooks;
      const nextUpBook = seriesView === "next" ? nextMissingBookFor({ ...series, allBooks: books }) : null;

      return {
        ...series,
        allBooks: series.books || [],
        sortIndex: index,
        sortStats: statsFor([series]),
        books: seriesView === "next" ? (nextUpBook ? [nextUpBook] : []) : books,
      };
    });

    return mappedSeries
      .filter((series) => {
        const fullState = seriesStateFor(series.sortStats).tone;
        if (seriesView === "missing" && series.sortStats.unowned === 0) return false;
        if (seriesView === "queue" && series.books.length === 0) return false;
        if (seriesView === "next" && series.books.length === 0) return false;
        if (hideCompletedSeries && fullState === "read") return false;
        if (normalizedQuery && series.books.length === 0) return false;
        return true;
      })
      .sort(SERIES_SORT[seriesSort]?.compare || SERIES_SORT.library.compare);
  }, [hideCompletedSeries, library.series, platformFilter, searchQuery, seriesSort, seriesView, statusFilter]);

  const visibleStats = statsFor(filteredSeries);
  const totalStats = statsFor(library.series || []);
  const stateCounts = seriesStateCountsFor(library.series || []);
  const platformStats = platformStatsFor(library.series || [], library.platforms || []);
  const platformOptions = platformFocusOptions(library.platforms || []);
  const activePlatformLabel = platformFocusLabel(platformFocus, platforms);
  const nextUnreadBooks = priorityMissingBooksFor(library.series || []);
  const authorGroups = authorGroupsFor(filteredSeries);
  const diagnostics = diagnosticsFor(library);
  const selected = selectedBook;
  const cacheAgeMs = sourceMeta.cachedAt ? Date.now() - new Date(sourceMeta.cachedAt).getTime() : 0;
  const staleCachedData = sourceMeta.cachedAt && cacheAgeMs > 1000 * 60 * 60 * 24;
  const resetControls = () => {
    setStatusFilter(CONTROL_DEFAULTS.statusFilter);
    setPlatformFilter(CONTROL_DEFAULTS.platformFilter);
    setPlatformFocus(CONTROL_DEFAULTS.platformFocus);
    setSeriesSort(CONTROL_DEFAULTS.seriesSort);
    setSearchQuery(CONTROL_DEFAULTS.searchQuery);
    setSeriesView(CONTROL_DEFAULTS.seriesView);
    setHideCompletedSeries(CONTROL_DEFAULTS.hideCompletedSeries);
    setDensity(CONTROL_DEFAULTS.density);
    setActionMessage("Controls reset");
  };
  const toggleCollapsedSeries = (seriesId) => {
    setCollapsedSeries((current) => {
      const next = new Set(current);
      if (next.has(seriesId)) next.delete(seriesId);
      else next.add(seriesId);
      return next;
    });
  };
  const selectBook = (book) => {
    setSelectedBook(book);
    const hash = bookHashFor(book);
    if (hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  };
  const copyShareLink = () => {
    writeUrlControls({ statusFilter, platformFilter, platformFocus, seriesSort, searchQuery, seriesView, hideCompletedSeries, density });
    copyText(window.location.href).then(() => setActionMessage("Share link copied")).catch(() => setActionMessage("Copy failed"));
  };
  const copyMissingList = () => {
    copyText(missingListText(library.series || [])).then(() => setActionMessage("Missing list copied")).catch(() => setActionMessage("Copy failed"));
  };
  const clearSelectedBook = () => {
    setSelectedBook(null);
    if (window.location.hash.startsWith("#book=")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    if (document.activeElement?.closest?.("[data-book-card]")) {
      document.activeElement.blur();
    }
  };
  const setPrimaryLens = (lens) => {
    setSearchQuery("");
    setHideCompletedSeries(false);
    if (lens === "all") {
      setStatusFilter("all");
      setPlatformFilter("all");
      setPlatformFocus("all");
      setSeriesView("all");
    }
    if (lens === "audio") {
      setStatusFilter("all");
      setPlatformFilter("audio");
      setPlatformFocus("audio");
      setSeriesView("all");
    }
    if (lens === "unread") {
      setStatusFilter("unowned");
      setPlatformFilter("all");
      setPlatformFocus("missing");
      setSeriesView("missing");
    }
    if (lens === "next") {
      setStatusFilter("all");
      setPlatformFilter("audio");
      setPlatformFocus("missing");
      setSeriesView("next");
    }
  };
  const activeLens = (() => {
    if (seriesView === "next") return "next";
    if (statusFilter === "unowned" && seriesView === "missing") return "unread";
    if (platformFilter === "audio" && platformFocus === "audio") return "audio";
    if (statusFilter === "all" && platformFilter === "all" && platformFocus === "all" && seriesView === "all") return "all";
    return "";
  })();

  useEffect(() => {
    if (restoredHash.current || !(library.series || []).length) return;
    const book = findBookFromHash(library, window.location.hash);
    if (!book) return;
    restoredHash.current = true;
    setSelectedBook(book);
    requestAnimationFrame(() => jumpToSeries(book.seriesId));
  }, [library]);

  useEffect(() => {
    if (initializedMobileCollapse.current || !(library.series || []).length) return;
    if (!window.matchMedia?.("(max-width: 640px)")?.matches) return;
    initializedMobileCollapse.current = true;
    setCollapsedSeries(new Set(
      (library.series || [])
        .filter((series) => seriesStateFor(statsFor([series])).tone === "read")
        .map((series) => series.id),
    ));
  }, [library]);

  return (
    <main className="library-app" data-density={density} onClick={clearSelectedBook} data-book-series-app>
      <header className="app-header">
        <div className="brand-block">
          <span className="eyebrow">Reading control surface</span>
          <h1>Book Series Tracker</h1>
          <p>Series-first reading map with cover art, ownership platform, read state, and obvious unread gaps.</p>
        </div>
        <div className="summary-strip" aria-label="Library summary">
          <Stat label="Books" value={totalStats.books} />
          <Stat label="Read" value={totalStats.read} />
          <Stat label="Queued" value={totalStats.queued + totalStats.reading} />
          <Stat label="Missing" value={totalStats.unowned} />
          <Stat label="Coverage" value={`${totalStats.progress}%`} />
        </div>
      </header>

      <section className="series-state-strip" aria-label="Series state summary" data-series-state-summary>
        <StateStat label="Read all" value={stateCounts.read || 0} tone="read" />
        <StateStat label="Gap" value={stateCounts.gap || 0} tone="gap" />
        <StateStat label="Missing" value={stateCounts.missing || 0} tone="missing" />
        <StateStat label="Partial" value={stateCounts.partial || 0} tone="partial" />
        <StateStat label="Collected" value={stateCounts.collected || 0} tone="collected" />
      </section>

      <section className="platform-strip" aria-label="Platform summary" data-platform-summary>
        <button
          type="button"
          className={platformFocus === "audio" ? "active" : ""}
          style={{ "--platform-color": "#14b8a6" }}
          onClick={() => setPlatformFocus(platformFocus === "audio" ? "all" : "audio")}
          aria-pressed={platformFocus === "audio"}
          data-platform-focus="audio"
        >
          <span aria-hidden="true" />
          <strong>Owned audio</strong>
          <em>{platformStats.audio}</em>
        </button>
        {platformStats.platforms.map((platform) => (
          <button
            key={platform.id}
            type="button"
            className={platformFocus === platform.id ? "active" : ""}
            style={{ "--platform-color": platform.color || "#64748b" }}
            onClick={() => setPlatformFocus(platformFocus === platform.id ? "all" : platform.id)}
            aria-pressed={platformFocus === platform.id}
            data-platform-focus={platform.id}
          >
            <span aria-hidden="true" />
            <strong>{platform.label}</strong>
            <em>{platform.count}</em>
          </button>
        ))}
        <button
          type="button"
          className={platformFocus === "missing" ? "active" : ""}
          style={{ "--platform-color": "var(--red)" }}
          onClick={() => setPlatformFocus(platformFocus === "missing" ? "all" : "missing")}
          aria-pressed={platformFocus === "missing"}
          data-platform-focus="missing"
        >
          <span aria-hidden="true" />
          <strong>Missing</strong>
          <em>{platformStats.missing}</em>
        </button>
      </section>

      <section className="next-unread-strip" aria-label="Next unread books" data-next-unread-strip>
        <div>
          <span className="eyebrow">Next unread</span>
          <strong>{totalStats.unowned} missing titles</strong>
        </div>
        {nextUnreadBooks.map((book) => (
          <button
            key={`${book.seriesId}-${book.order}`}
            type="button"
            onClick={() => jumpToSeries(book.seriesId)}
            data-next-unread
          >
            <b>{book.seriesTitle}</b>
            <span>#{book.order} {book.title}</span>
          </button>
        ))}
      </section>

      <section className="primary-lens-bar" aria-label="Primary reading lenses" data-primary-lens-bar>
        <button type="button" className={activeLens === "all" ? "active" : ""} onClick={() => setPrimaryLens("all")} data-primary-lens="all">
          <b>All</b>
          <span>{totalStats.books}</span>
        </button>
        <button type="button" className={activeLens === "audio" ? "active" : ""} onClick={() => setPrimaryLens("audio")} data-primary-lens="audio">
          <b>Owned audio</b>
          <span>{platformStats.audio}</span>
        </button>
        <button type="button" className={activeLens === "unread" ? "active" : ""} onClick={() => setPrimaryLens("unread")} data-primary-lens="unread">
          <b>Unread</b>
          <span>{totalStats.unowned}</span>
        </button>
        <button type="button" className={activeLens === "next" ? "active" : ""} onClick={() => setPrimaryLens("next")} data-primary-lens="next">
          <b>Next up</b>
          <span>{nextUnreadBooks.length}</span>
        </button>
      </section>

      <section className="control-bar" aria-label="Library controls">
        <label className="search-control">
          <span>Search library</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Series, book, or author"
            aria-label="Search series, books, and authors"
            data-library-search
          />
        </label>
        <div className="segmented-control" data-status-filter>
          {Object.entries(STATUS).map(([id, status]) => (
            <button
              key={id}
              type="button"
              className={statusFilter === id ? "active" : ""}
              onClick={() => setStatusFilter(id)}
            >
              {status.label}
            </button>
          ))}
        </div>
        <div className="series-tools" aria-label="Series view controls">
          <button
            type="button"
            className={seriesView === "missing" ? "active" : ""}
            onClick={() => setSeriesView(seriesView === "missing" ? "all" : "missing")}
            data-missing-series-toggle
          >
            Gaps only
          </button>
          <button
            type="button"
            className={seriesView === "queue" ? "active" : ""}
            onClick={() => setSeriesView(seriesView === "queue" ? "all" : "queue")}
            data-queue-view-toggle
          >
            Queue
          </button>
          <button
            type="button"
            className={seriesView === "next" ? "active" : ""}
            onClick={() => {
              setStatusFilter("all");
              setSeriesView(seriesView === "next" ? "all" : "next");
            }}
            data-next-up-view-toggle
          >
            Next up
          </button>
          <button
            type="button"
            className={seriesView === "authors" ? "active" : ""}
            onClick={() => setSeriesView(seriesView === "authors" ? "all" : "authors")}
            data-author-view-toggle
          >
            Authors
          </button>
          <label className="check-control">
            <input
              type="checkbox"
              checked={hideCompletedSeries}
              onChange={(event) => setHideCompletedSeries(event.target.checked)}
              data-hide-completed-toggle
            />
            <span>Hide complete</span>
          </label>
          <button
            type="button"
            className={density === "compact" ? "active" : ""}
            onClick={() => setDensity(density === "compact" ? "cover" : "compact")}
            data-density-toggle
          >
            Compact
          </button>
          <button
            type="button"
            className={density === "list" ? "active" : ""}
            onClick={() => setDensity(density === "list" ? "cover" : "list")}
            data-list-density-toggle
          >
            Titles
          </button>
        </div>
        <select
          value={platformFocus}
          onChange={(event) => setPlatformFocus(event.target.value)}
          aria-label="Highlight platform"
          data-platform-focus-select
        >
          {platformOptions.map((platform) => (
            <option key={platform.id} value={platform.id}>Highlight {platform.label}</option>
          ))}
        </select>
        <select
          value={platformFilter}
          onChange={(event) => setPlatformFilter(event.target.value)}
          aria-label="Filter by platform"
          data-platform-filter
        >
          <option value="all">All platforms</option>
          <option value="audio">Owned audio + gaps</option>
          {(library.platforms || []).map((platform) => (
            <option key={platform.id} value={platform.id}>{platform.label}</option>
          ))}
        </select>
        <select value={seriesSort} onChange={(event) => setSeriesSort(event.target.value)} aria-label="Sort series" data-series-sort>
          {Object.entries(SERIES_SORT).map(([id, sort]) => (
            <option key={id} value={id}>{sort.label}</option>
          ))}
        </select>
        <select value="" onChange={(event) => jumpToSeries(event.target.value)} aria-label="Jump to series" data-series-jump>
          <option value="">Jump to series</option>
          {filteredSeries.map((series) => (
            <option key={series.id} value={series.id}>{series.title}</option>
          ))}
        </select>
        <div className="action-buttons" aria-label="View actions">
          <button type="button" onClick={copyShareLink} data-copy-share-link>Share</button>
          <button type="button" onClick={resetControls} data-reset-controls>Reset</button>
          <button type="button" onClick={() => exportVisibleBooks(filteredSeries)} data-export-view>CSV</button>
          <button type="button" onClick={() => exportVisibleBooksJson(filteredSeries)} data-export-json>JSON</button>
          <button type="button" onClick={copyMissingList} data-copy-missing-list>Missing</button>
          <button type="button" onClick={() => window.print()} data-print-missing-list>Print</button>
        </div>
      </section>

      <section className="source-row" aria-label="Data source">
        <span>Source: {source}</span>
        <span>{library.updatedAt ? `Updated ${library.updatedAt}` : "Draft data"}</span>
        <span>{visibleStats.books} visible</span>
        <span data-platform-focus-label>Focus: {activePlatformLabel}</span>
        <a href={sourceMeta.url || DATA_WEB_URL} target="_blank" rel="noreferrer" data-source-sha>
          Data {sourceMeta.sha ? sourceMeta.sha.slice(0, 7) : "source"}
        </a>
        <span data-app-version>App {APP_VERSION}</span>
        {staleCachedData ? <strong data-stale-cache-warning>Cached data may be stale</strong> : null}
        {actionMessage ? <em data-action-message>{actionMessage}</em> : null}
      </section>

      <section className="status-distribution" aria-label="Status distribution" data-status-distribution>
        <span style={{ "--segment-color": "var(--green)", "--segment-size": `${totalStats.read || 0}` }}>Read {totalStats.read} titles</span>
        <span style={{ "--segment-color": "var(--blue)", "--segment-size": `${totalStats.owned + totalStats.reading || 0}` }}>Owned {totalStats.owned + totalStats.reading} titles</span>
        <span style={{ "--segment-color": "var(--amber)", "--segment-size": `${totalStats.queued || 0}` }}>Queued {totalStats.queued} titles</span>
        <span style={{ "--segment-color": "var(--red)", "--segment-size": `${totalStats.unowned || 0}` }}>Missing {totalStats.unowned} titles</span>
      </section>

      <section className="diagnostics-row" aria-label="Import diagnostics" data-import-diagnostics>
        <span>{diagnostics.series} series</span>
        <span>{diagnostics.books} books</span>
        <span>{diagnostics.coverIdCount} cover IDs</span>
        <span>{diagnostics.titleCoverCount} title covers</span>
        <span>{diagnostics.metadataCount} release metadata</span>
        <span>{diagnostics.priorities} priorities</span>
      </section>

      <div className="workspace">
        {selected ? (
          <aside className="detail-panel" onClick={(event) => event.stopPropagation()} data-book-detail>
            <BookDetail book={selected} platforms={platforms} />
          </aside>
        ) : null}

        <section className="series-stack" data-series-stack>
          {filteredSeries.length && seriesView === "authors" ? authorGroups.map((group) => (
            <section className="author-group" key={group.author} data-author-group>
              <h2>{group.author}</h2>
              {group.series.map((series) => (
                <SeriesRow
                  key={series.id}
                  series={series}
                  platforms={platforms}
                  selected={selected}
                  collapsed={collapsedSeries.has(series.id)}
                  platformFocus={platformFocus}
                  onToggleCollapsed={toggleCollapsedSeries}
                  onSelect={selectBook}
                />
              ))}
            </section>
          )) : filteredSeries.length ? filteredSeries.map((series) => (
            <SeriesRow
              key={series.id}
              series={series}
              platforms={platforms}
              selected={selected}
              collapsed={collapsedSeries.has(series.id)}
              platformFocus={platformFocus}
              onToggleCollapsed={toggleCollapsedSeries}
              onSelect={selectBook}
            />
          )) : (
            <div className="empty-row" data-empty-view>
              <span>
                {seriesView === "queue"
                  ? "No queued or currently reading books in this view."
                  : seriesView === "next"
                    ? "No next unread books match this view."
                    : "No visible series match this view."}
              </span>
              <button type="button" onClick={resetControls} data-empty-reset>Reset filters</button>
            </div>
          )}
        </section>
      </div>
      <section className="print-missing-list" aria-label="Printable missing books">
        <h2>Missing Books</h2>
        {missingBooksBySeries(library.series || []).map(({ series, books }) => (
          <article key={series.id}>
            <h3>{series.title}</h3>
            <ul>
              {books.map((book) => (
                <li key={`${series.id}-${book.order}`}>#{book.order} {book.title}{book.author ? ` by ${book.author}` : ""}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <article>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function StateStat({ label, value, tone }) {
  return (
    <article className={`state-stat state-stat--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function SeriesRow({ series, platforms, selected, collapsed, platformFocus, onToggleCollapsed, onSelect }) {
  const stats = statsFor([series]);
  const state = seriesStateFor(stats);
  const nextMissing = nextMissingBooksFor(series);
  const focusCount = platformFocusCountFor(series, platformFocus);
  const focusLabel = platformFocusLabel(platformFocus, platforms);
  const progressStyle = { width: `${stats.progress}%` };
  const timelineBooks = series.allBooks || series.books || [];

  return (
    <article
      className={`series-row series-row--${state.tone}`}
      style={{ "--series-accent": series.accent || "#38bdf8" }}
      data-series-id={series.id}
      data-series-state={state.tone}
      data-platform-focus-count={focusCount}
    >
      <header>
        <div>
          <span>{series.author}</span>
          <h2>{series.title}</h2>
          <div className="series-badges" aria-label={`${series.title} reading summary`} data-series-badges>
            <b className="series-badge series-badge--green">{stats.read} read</b>
            {stats.unowned ? <b className="series-badge series-badge--red">{stats.unowned} missing</b> : <b className="series-badge series-badge--green">Read all</b>}
            {stats.books ? <b className="series-badge">{stats.books} total</b> : null}
          </div>
          <p>{series.summary}</p>
          {series.priority || series.note ? (
            <p className="series-note" data-series-note>
              {[series.priority, series.note].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {nextMissing.length ? (
            <p className="next-missing" data-next-missing>
              <b>Next missing</b>
              <span>{nextMissing.map((book) => `#${book.order} ${book.title}`).join(" · ")}</span>
            </p>
          ) : null}
        </div>
        <div
          className="series-meter"
          aria-label={`${series.title}: ${stats.read} read, ${stats.tracked} tracked, ${stats.unowned} missing, ${stats.progress}% coverage`}
          data-series-meter
        >
          <b>{state.label}</b>
          <em>{state.detail}</em>
          <strong>{stats.read}/{stats.books}</strong>
          {platformFocus !== "all" ? <em data-platform-focus-row>{focusCount} {focusLabel}</em> : null}
          <span><i style={progressStyle} /></span>
          <button
            type="button"
            className="collapse-button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapsed(series.id);
            }}
            aria-expanded={!collapsed}
            data-collapse-series
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </header>
      {timelineBooks.length ? (
        <div className="series-timeline" aria-label={`${series.title} read and missing timeline`} data-series-timeline>
          {timelineBooks.map((book) => {
            const status = STATUS[book.status] || STATUS.unowned;
            return (
              <button
                key={`${series.id}-timeline-${book.order}`}
                type="button"
                className={`timeline-chip timeline-chip--${statusClassFor(book.status)}`}
                title={`#${book.order} ${book.title}: ${status.label}`}
                aria-label={`Book ${book.order}, ${book.title}, ${status.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect({
                    ...book,
                    seriesId: series.id,
                    seriesTitle: series.title,
                    seriesAccent: series.accent,
                    seriesNote: series.note,
                    seriesPriority: series.priority,
                  });
                }}
              >
                {book.order}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="book-rail" data-book-rail hidden={collapsed}>
        {series.books.length ? series.books.map((book) => (
          <BookCard
            key={`${series.id}-${book.order}`}
            book={{
              ...book,
              seriesId: series.id,
              seriesTitle: series.title,
              seriesAccent: series.accent,
              seriesNote: series.note,
              seriesPriority: series.priority,
            }}
            platforms={platforms}
            platformFocus={platformFocus}
            active={selected?.title === book.title && selected?.order === book.order}
            onSelect={onSelect}
          />
        )) : (
          <div className="empty-row">No visible books in this series.</div>
        )}
      </div>
    </article>
  );
}

function BookCard({ book, platforms, platformFocus, active, onSelect }) {
  const firstPlatform = platforms[(book.platforms || [])[0]];
  const focusMatch = platformFocusMatches(book, platformFocus);
  const focusPlatform = platformFocus === "missing" ? null : platforms[platformFocus];
  const borderColor = focusMatch && focusPlatform ? focusPlatform.color : firstPlatform?.color || "#475569";
  const status = STATUS[book.status] || STATUS.unowned;
  const platformLabels = platformLabelsFor(book, platforms);
  const metadata = bookMetadataFor(book);
  const accessibleLabel = `${book.title}, ${book.seriesTitle} book ${book.order}, ${status.label}, ${platformLabels.join(", ")}`;

  return (
    <button
      type="button"
      className={`book-card book-card--${book.status}${active ? " active" : ""}${platformFocus !== "all" && focusMatch ? " platform-focused" : ""}${platformFocus !== "all" && !focusMatch ? " platform-muted" : ""}`}
      style={{ "--platform-color": borderColor }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(book);
      }}
      data-book-card
      data-platform-match={focusMatch ? "true" : "false"}
      aria-label={accessibleLabel}
      onKeyDown={(event) => {
        if (!["ArrowRight", "ArrowLeft"].includes(event.key)) return;
        event.preventDefault();
        const cards = [...event.currentTarget.closest("[data-book-rail]").querySelectorAll("[data-book-card]")];
        const currentIndex = cards.indexOf(event.currentTarget);
        const nextIndex = event.key === "ArrowRight"
          ? Math.min(cards.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
        cards[nextIndex]?.focus();
      }}
    >
      <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span>
      <span className="book-order">#{book.order}</span>
      <CoverFrame book={book} />
      <span className="book-title">{book.title}</span>
      {metadata ? <span className="book-meta">{metadata}</span> : null}
    </button>
  );
}

function CoverFrame({ book, className = "", imageClassName = "" }) {
  const [state, setState] = useState(book.coverUrl ? "loading" : "missing");

  useEffect(() => {
    setState(book.coverUrl ? "loading" : "missing");
  }, [book.coverUrl]);

  return (
    <span className={`${className || "cover-frame"} cover-frame--${state}`} aria-hidden="true" data-cover-state={state}>
      <span className="cover-title">{book.title}</span>
      <BookCoverImage book={book} className={imageClassName} onStateChange={setState} />
      {state === "missing" ? <span className="cover-diagnostic">No cover</span> : null}
    </span>
  );
}

function BookCoverImage({ book, className = "", onStateChange = () => {} }) {
  const [src, setSrc] = useState(book.coverUrl || "");
  const [hidden, setHidden] = useState(!book.coverUrl);

  useEffect(() => {
    setSrc(book.coverUrl || "");
    setHidden(!book.coverUrl);
    onStateChange(book.coverUrl ? "loading" : "missing");
  }, [book.coverUrl]);

  if (!src || hidden) return null;

  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      onLoad={() => onStateChange("loaded")}
      onError={() => {
        resolveCoverUrl(book).then((nextSrc) => {
          if (nextSrc && nextSrc !== src) {
            setSrc(nextSrc);
            onStateChange("loading");
          } else {
            setHidden(true);
            onStateChange("missing");
          }
        });
      }}
    />
  );
}

function BookDetail({ book, platforms }) {
  const ownedPlatforms = (book.platforms || []).map((platformId) => platforms[platformId]).filter(Boolean);
  const status = STATUS[book.status] || STATUS.unowned;
  const metadata = bookMetadataFor(book);

  return (
    <>
      <CoverFrame book={book} className="detail-cover-frame" imageClassName="detail-cover" />
      <div className="detail-copy">
        <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span>
        <h2>{book.title}</h2>
        <p>{book.seriesTitle} book {book.order}{book.author ? ` by ${book.author}` : ""}</p>
        {metadata ? <p className="detail-meta">Published {metadata}</p> : null}
        {book.seriesPriority || book.seriesNote || book.priority || book.note ? (
          <p className="detail-note" data-series-note>
            {[book.seriesPriority, book.seriesNote, book.priority, book.note].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <a className="source-link" href={DATA_WEB_URL} target="_blank" rel="noreferrer" data-source-link>
          Source data
        </a>
        <div className="detail-links">
          <a href={openLibrarySearchUrl(book)} target="_blank" rel="noreferrer" data-open-library-link>
            Open Library
          </a>
          {book.status === "unowned" ? (
            <a href={missingTitleSearchUrl(book)} target="_blank" rel="noreferrer" data-missing-search-link>
              Find missing title
            </a>
          ) : null}
        </div>
      </div>
      <div className="detail-platforms">
        <span>Platforms</span>
        {ownedPlatforms.length ? ownedPlatforms.map((platform) => (
          <b key={platform.id} style={{ borderColor: platform.color }}>{platform.label}</b>
        )) : <b>Not tracked as owned</b>}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
