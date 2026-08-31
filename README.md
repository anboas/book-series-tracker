# Book Series Tracker

Dark, responsive reading tracker for series ownership coverage, platform source, and unread/missing gaps.

The app fetches public data from:

`https://raw.githubusercontent.com/anboas/reading-list-data/main/books.json`

If that fetch fails, it shows an empty bundled fallback rather than stale seed data.

## Deploys

- Cloudflare Pages: `https://book-series-tracker.pages.dev/`
- GitHub Pages draft: `https://anboas.github.io/book-series-tracker/`
- GitLab Pages target: `https://anboas.gitlab.io/book-series-tracker/`

GitLab is ready through `.gitlab-ci.yml`, but this shell does not currently have a noninteractive GitLab credential. Once authenticated, run:

```bash
git push gitlab-pages main
```
