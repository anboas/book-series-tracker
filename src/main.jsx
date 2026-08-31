import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { fallbackLibrary } from "./fallbackLibrary.js";
import "./styles.css";

const DATA_URL = "https://raw.githubusercontent.com/anboas/reading-list-data/main/books.json";
const STATUS = {
  all: { label: "All", tone: "neutral" },
  owned: { label: "Owned", tone: "blue" },
  read: { label: "Read", tone: "green" },
  reading: { label: "Reading", tone: "blue" },
  queued: { label: "Queued", tone: "amber" },
  unowned: { label: "Missing", tone: "red" },
};

function useLibrary() {
  const [library, setLibrary] = useState(fallbackLibrary);
  const [source, setSource] = useState("Bundled draft");

  useEffect(() => {
    let cancelled = false;
    fetch(`${DATA_URL}?cache=${Date.now()}`, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        return response.json();
      })
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

function platformMap(platforms = []) {
  return Object.fromEntries(platforms.map((platform) => [platform.id, platform]));
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

function App() {
  const { library, source } = useLibrary();
  const platforms = useMemo(() => platformMap(library.platforms), [library.platforms]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [selectedBook, setSelectedBook] = useState(null);

  const filteredSeries = useMemo(() => {
    return (library.series || []).map((series) => ({
      ...series,
      books: (series.books || []).filter((book) => {
        if (statusFilter !== "all" && book.status !== statusFilter) return false;
        if (platformFilter !== "all" && !(book.platforms || []).includes(platformFilter)) return false;
        return true;
      }),
    }));
  }, [library.series, platformFilter, statusFilter]);

  const visibleStats = statsFor(filteredSeries);
  const totalStats = statsFor(library.series || []);
  const selected = selectedBook || filteredSeries.find((series) => series.books.length)?.books[0];

  return (
    <main className="library-app" data-book-series-app>
      <header className="app-header">
        <div className="brand-block">
          <span className="eyebrow">Reading control surface</span>
          <h1>Book Series Tracker</h1>
          <p>Series-first reading map with cover art, ownership platform, read state, and obvious unread gaps.</p>
        </div>
        <div className="summary-strip" aria-label="Library summary">
          <Stat label="Books" value={totalStats.books} />
          <Stat label="Owned" value={totalStats.owned + totalStats.read} />
          <Stat label="Queued" value={totalStats.queued + totalStats.reading} />
          <Stat label="Missing" value={totalStats.unowned} />
          <Stat label="Coverage" value={`${totalStats.progress}%`} />
        </div>
      </header>

      <section className="control-bar" aria-label="Library controls">
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
        <a href={DATA_URL} target="_blank" rel="noreferrer">GitHub data</a>
      </section>

      <section className="source-row" aria-label="Data source">
        <span>Source: {source}</span>
        <span>{library.updatedAt ? `Updated ${library.updatedAt}` : "Draft data"}</span>
        <span>{visibleStats.books} visible</span>
      </section>

      <div className="workspace">
        <aside className="detail-panel" data-book-detail>
          {selected ? (
            <BookDetail book={selected} platforms={platforms} />
          ) : (
            <div className="empty-detail">No books match the current filter.</div>
          )}
        </aside>

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
  const progressStyle = { width: `${stats.progress}%`, backgroundColor: series.accent || "#38bdf8" };

  return (
    <article className="series-row" style={{ "--series-accent": series.accent || "#38bdf8" }} data-series-id={series.id}>
      <header>
        <div>
          <span>{series.author}</span>
          <h2>{series.title}</h2>
          <p>{series.summary}</p>
        </div>
        <div className="series-meter" aria-label={`${series.title} progress`}>
          <strong>{stats.tracked}/{stats.books}</strong>
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
      onClick={() => onSelect(book)}
      data-book-card
    >
      <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span>
      <span className="book-order">#{book.order}</span>
      <span className="cover-frame" aria-hidden="true">
        <span className="cover-title">{book.title}</span>
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt=""
            loading="lazy"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        ) : null}
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

function BookDetail({ book, platforms }) {
  const ownedPlatforms = (book.platforms || []).map((platformId) => platforms[platformId]).filter(Boolean);
  const status = STATUS[book.status] || STATUS.unowned;

  return (
    <>
      <span className="detail-cover-frame" aria-hidden="true">
        <span className="cover-title">{book.title}</span>
        {book.coverUrl ? (
          <img
            className="detail-cover"
            src={book.coverUrl}
            alt=""
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        ) : null}
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
