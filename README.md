# Book Series Tracker

Dark, responsive reading tracker for series progress, ownership platform, and unread gaps.

The app fetches public data from:

`https://raw.githubusercontent.com/anboas/reading-list-data/main/books.json`

If that fetch fails, it falls back to the bundled draft data in `src/fallbackLibrary.js`.

## Deploys

- Cloudflare Pages: `https://book-series-tracker.pages.dev/`
- GitHub Pages draft: `https://anboas.github.io/book-series-tracker/`
- GitLab Pages target: `https://anboas.gitlab.io/book-series-tracker/`

GitLab is ready through `.gitlab-ci.yml`, but this shell does not currently have a noninteractive GitLab credential. Once authenticated, run:

```bash
git push gitlab-pages main
```
