# Book Series Tracker

Dark, responsive reading tracker for series ownership coverage, platform source, and unread/missing gaps.

The app fetches public data from:

`https://raw.githubusercontent.com/anboas/reading-list-data/main/books.json`

If that fetch fails, it shows an empty bundled fallback rather than stale seed data.

## Task Board

Open improvements are tracked in GitHub Issues:

`https://github.com/anboas/book-series-tracker/issues`

The current board started from a 25-card improvement sweep covering search, filters, gap views, navigation, platform context, exports, validation, PWA polish, and documentation.

## Development

```bash
npm install
npm run verify:data
npm run verify
npm run verify:prod-smoke
npm run cover:check
```

`npm run verify:data` validates the loaded library shape, platform references, duplicate titles/orders, and internal order gaps.

`npm run verify` builds the app, validates the data, and runs Playwright desktop/mobile checks against local Vite. The local verifier mocks Open Library cover responses so third-party image delivery does not make product checks flaky.

`npm run verify:prod-smoke` checks the production homepage/assets and the expected live data snapshot:

- updatedAt: `2026-09-01`
- books: `201`
- read: `169`
- owned: `6`
- missing: `26`
- AudioBookshelf: `6`

`npm run cover:check` probes cover URLs independently and groups failures by series. It is intentionally separate from `npm run verify` because title-derived Open Library cover URLs can fail while the app still renders title plates or dynamically resolves alternatives.

## Deploys

- Cloudflare Pages: `https://book-series-tracker.pages.dev/`
- GitHub Pages draft: `https://anboas.github.io/book-series-tracker/`
- GitLab Pages target: `https://anboas.gitlab.io/book-series-tracker/`

Cloudflare deploy:

```bash
npm run pages:deploy
```

GitLab is ready through `.gitlab-ci.yml`, but this shell does not currently have a noninteractive GitLab credential. Once authenticated, run:

```bash
git push gitlab-pages main
```
