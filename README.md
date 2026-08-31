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
npm run verify
npm run verify:prod-smoke
```

`npm run verify` builds the app and runs Playwright desktop/mobile checks against local Vite. The local verifier mocks Open Library cover responses so third-party image delivery does not make product checks flaky.

`npm run verify:prod-smoke` checks the production homepage/assets and the expected live data snapshot:

- updatedAt: `2026-08-31`
- books: `192`
- read: `169`
- missing: `23`

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
