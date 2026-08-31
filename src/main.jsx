import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { fallbackLibrary } from "./fallbackLibrary.js";
import "./styles.css";

const DATA_URL = "https://raw.githubusercontent.com/anboas/reading-list-data/main/books.json";
const GITHUB_API_DATA_URL = "https://api.github.com/repos/anboas/reading-list-data/contents/books.json?ref=main";
const CONTROL_STORAGE_KEY = "book-series-tracker:controls";
const coverResolutionCache = new Map();
const STATUS = {
  all: { label: "All", tone: "neutral" },
  owned: { label: "Owned", tone: "blue" },
  read: { label: "Read", tone: "green" },
  reading: { label: "Reading", tone: "blue" },
  queued: { label: "Queued", tone: "amber" },
  unowned: { label: "Missing", tone: "red" },
};
const SERIES_SORT = {
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

function readStoredControls() {
  const defaults = {
    statusFilter: "all",
    platformFilter: "all",
    seriesSort: "library",
    searchQuery: "",
  };

  try {
    const parsed = JSON.parse(localStorage.getItem(CONTROL_STORAGE_KEY) || "{}");
    return {
      statusFilter: STATUS[parsed.statusFilter] ? parsed.statusFilter : defaults.statusFilter,
      platformFilter: typeof parsed.platformFilter === "string" ? parsed.platformFilter : defaults.platformFilter,
      seriesSort: SERIES_SORT[parsed.seriesSort] ? parsed.seriesSort : defaults.seriesSort,
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : defaults.searchQuery,
    };
  } catch {
    return defaults;
  }
}

function writeStoredControls(controls) {
  try {
    localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(controls));
  } catch {
    // Storage can be unavailable in private contexts; controls still work for the session.
  }
}

function useLibrary() {
  const [library, setLibrary] = useState(fallbackLibrary);
  const [source, setSource] = useState("Bundled draft");

  useEffect(() => {
    let cancelled = false;
    fetchGithubData()
      .then((data) => {
        if (!cancelled) {
          setLibrary(data);
          setSource("GitHub");
        }
      })
      .catch(() => {
        if (!cancelled) setSource("Bundled draft");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { library, source };
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
      return JSON.parse(new TextDecoder().decode(bytes));
    }
    return parsed;
  } catch {
    const response = await fetch(`${DATA_URL}?cache=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`GitHub Raw returned ${response.status}`);
    return response.json();
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

function App() {
  const { library, source } = useLibrary();
  const platforms = useMemo(() => platformMap(library.platforms), [library.platforms]);
  const initialControls = useMemo(() => readStoredControls(), []);
  const [statusFilter, setStatusFilter] = useState(initialControls.statusFilter);
  const [platformFilter, setPlatformFilter] = useState(initialControls.platformFilter);
  const [seriesSort, setSeriesSort] = useState(initialControls.seriesSort);
  const [searchQuery, setSearchQuery] = useState(initialControls.searchQuery);
  const [selectedBook, setSelectedBook] = useState(null);

  useEffect(() => {
    if ((library.platforms || []).length && platformFilter !== "all" && !platforms[platformFilter]) {
      setPlatformFilter("all");
    }
  }, [library.platforms, platformFilter, platforms]);

  useEffect(() => {
    writeStoredControls({ statusFilter, platformFilter, seriesSort, searchQuery });
  }, [platformFilter, searchQuery, seriesSort, statusFilter]);

  const filteredSeries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const mappedSeries = (library.series || []).map((series, index) => ({
      series,
      index,
      baseBooks: (series.books || []).filter((book) => {
        if (statusFilter !== "all" && book.status !== statusFilter) return false;
        if (platformFilter !== "all" && !(book.platforms || []).includes(platformFilter)) return false;
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

      return {
        ...series,
        sortIndex: index,
        sortStats: statsFor([series]),
        books,
      };
    });

    return mappedSeries
      .filter((series) => !normalizedQuery || series.books.length > 0)
      .sort(SERIES_SORT[seriesSort]?.compare || SERIES_SORT.library.compare);
  }, [library.series, platformFilter, searchQuery, seriesSort, statusFilter]);

  const visibleStats = statsFor(filteredSeries);
  const totalStats = statsFor(library.series || []);
  const selected = selectedBook;
  const clearSelectedBook = () => {
    setSelectedBook(null);
    if (document.activeElement?.closest?.("[data-book-card]")) {
      document.activeElement.blur();
    }
  };

  return (
    <main className="library-app" onClick={clearSelectedBook} data-book-series-app>
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
        <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)} aria-label="Filter by platform">
          <option value="all">All platforms</option>
          {(library.platforms || []).map((platform) => (
            <option key={platform.id} value={platform.id}>{platform.label}</option>
          ))}
        </select>
        <select value={seriesSort} onChange={(event) => setSeriesSort(event.target.value)} aria-label="Sort series" data-series-sort>
          {Object.entries(SERIES_SORT).map(([id, sort]) => (
            <option key={id} value={id}>{sort.label}</option>
          ))}
        </select>
        <a href={DATA_URL} target="_blank" rel="noreferrer">GitHub data</a>
      </section>

      <section className="source-row" aria-label="Data source">
        <span>Source: {source}</span>
        <span>{library.updatedAt ? `Updated ${library.updatedAt}` : "Draft data"}</span>
        <span>{visibleStats.books} visible</span>
      </section>

      <div className="workspace">
        {selected ? (
          <aside className="detail-panel" onClick={(event) => event.stopPropagation()} data-book-detail>
            <BookDetail book={selected} platforms={platforms} />
          </aside>
        ) : null}

        <section className="series-stack" data-series-stack>
          {filteredSeries.map((series) => (
            <SeriesRow
              key={series.id}
              series={series}
              platforms={platforms}
              selected={selected}
              onSelect={setSelectedBook}
            />
          ))}
        </section>
      </div>
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

function SeriesRow({ series, platforms, selected, onSelect }) {
  const stats = statsFor([series]);
  const state = seriesStateFor(stats);
  const progressStyle = { width: `${stats.progress}%` };

  return (
    <article
      className={`series-row series-row--${state.tone}`}
      style={{ "--series-accent": series.accent || "#38bdf8" }}
      data-series-id={series.id}
      data-series-state={state.tone}
    >
      <header>
        <div>
          <span>{series.author}</span>
          <h2>{series.title}</h2>
          <p>{series.summary}</p>
        </div>
        <div className="series-meter" aria-label={`${series.title} progress`} data-series-meter>
          <b>{state.label}</b>
          <em>{state.detail}</em>
          <strong>{stats.read}/{stats.books}</strong>
          <span><i style={progressStyle} /></span>
        </div>
      </header>
      <div className="book-rail" data-book-rail>
        {series.books.length ? series.books.map((book) => (
          <BookCard
            key={`${series.id}-${book.order}`}
            book={{ ...book, seriesTitle: series.title, seriesAccent: series.accent }}
            platforms={platforms}
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

function BookCard({ book, platforms, active, onSelect }) {
  const firstPlatform = platforms[(book.platforms || [])[0]];
  const borderColor = firstPlatform?.color || "#475569";
  const status = STATUS[book.status] || STATUS.unowned;

  return (
    <button
      type="button"
      className={`book-card book-card--${book.status}${active ? " active" : ""}`}
      style={{ "--platform-color": borderColor }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(book);
      }}
      data-book-card
    >
      <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span>
      <span className="book-order">#{book.order}</span>
      <span className="cover-frame" aria-hidden="true">
        <span className="cover-title">{book.title}</span>
        <BookCoverImage book={book} />
      </span>
      <span className="book-title">{book.title}</span>
      <span className="platform-dots" aria-label="Platforms">
        {(book.platforms || []).length ? book.platforms.map((platformId) => (
          <i key={platformId} style={{ backgroundColor: platforms[platformId]?.color || "#64748b" }} title={platforms[platformId]?.label || platformId} />
        )) : <i className="empty" title="Not owned" />}
      </span>
    </button>
  );
}

function BookCoverImage({ book, className = "" }) {
  const [src, setSrc] = useState(book.coverUrl || "");
  const [hidden, setHidden] = useState(!book.coverUrl);

  useEffect(() => {
    setSrc(book.coverUrl || "");
    setHidden(!book.coverUrl);
  }, [book.coverUrl]);

  if (!src || hidden) return null;

  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        resolveCoverUrl(book).then((nextSrc) => {
          if (nextSrc && nextSrc !== src) {
            setSrc(nextSrc);
          } else {
            setHidden(true);
          }
        });
      }}
    />
  );
}

function BookDetail({ book, platforms }) {
  const ownedPlatforms = (book.platforms || []).map((platformId) => platforms[platformId]).filter(Boolean);
  const status = STATUS[book.status] || STATUS.unowned;

  return (
    <>
      <span className="detail-cover-frame" aria-hidden="true">
        <span className="cover-title">{book.title}</span>
        <BookCoverImage book={book} className="detail-cover" />
      </span>
      <div className="detail-copy">
        <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span>
        <h2>{book.title}</h2>
        <p>{book.seriesTitle} book {book.order}{book.author ? ` by ${book.author}` : ""}</p>
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
