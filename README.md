# ninja-quick

Windows desktop client for [poe.ninja](https://poe.ninja/) — POE 1 / POE 2 game switcher with unified search across all economy categories.

## Features

- **Game Switcher** — toggle between POE 1 (emerald) and POE 2 (amber) contexts; persists across sessions. POE 2 is the default/priority game.
- **Live Category Sidebar** — a permanent left-hand nav (mirroring poe.ninja's own economy-page sidebar), scraped live from the site rather than hardcoded — PoE leagues add/remove economy categories every few months. Click a category to see its full item list immediately, auto-fetching it first if needed.
- **Unified Search** — single text input searches across currency, uniques, fragments, essences, etc.; 300ms debounce
- **Keyboard Navigation** — ArrowUp/Down to move through results, Enter opens the item on poe.ninja in your system browser
- **Background Data Fetching** — poe.ninja's own JSON API, cached locally; auto-refreshes every 12 hours
- **Favorites, Price Alerts, Fuzzy Search** — pin items, get a native OS notification when a price crosses a threshold, and typo-tolerant search fallback

## Quick Start

```powershell
# Install dependencies (one-time)
npm install

# Start dev server with DevTools
npx electron . --dev

# Run integration tests
npm test
```

> If `ELECTRON_RUN_AS_NODE=1` is set in your shell, `unset` it first — Electron then runs as
> plain Node and `require('electron')` returns a path string instead of the Electron API.

## Architecture

- **Electron v33.0.0** — a single visible `BrowserWindow` for the UI, plus a short-lived hidden
  `BrowserWindow` only for live category discovery (see below) — everything else is the JSON API.
- **poe.ninja JSON API** — `lib/ninja-api.js` talks directly to poe.ninja's (undocumented, reverse-engineered)
  API. See [docs/api-endpoints.md](docs/api-endpoints.md) for the endpoints and every quirk discovered —
  read it before touching the data layer, several behaviors there are not what you'd guess.
- **Live Category Discovery** — poe.ninja has no JSON endpoint listing "what categories exist" (only
  economy *data* for a category you already know the slug of), so `lib/category-discovery.js`
  scrapes the live page's own nav with a hidden `BrowserWindow` — the one place this app still does
  DOM scraping, deliberately scoped to just category slugs/labels. Cached per game+league with a
  24h TTL; falls back to `lib/categories.js`'s static list if poe.ninja is unreachable.
- **Local Cache** — JSON files in `{userData}/.cache/{game}_{league}_economy.json`, one per game+league (leagues are economically independent and are never mixed into the same file).
- **IPC Bridge** — secure preload pattern (`contextIsolation: true`, `nodeIntegration: false`).

## Data Source Notes

- poe.ninja's public API is not documented anywhere; `lib/ninja-api.js` resolves the right endpoint
  and `type` naming adaptively per game+category rather than hardcoding a fixed map, because the two
  POE games are inconsistent with each other on this API (see docs/api-endpoints.md).
- Background refreshes are deliberately spread over roughly an hour (POE2's categories first, then
  POE1's) as a courtesy to poe.ninja's servers, even though each individual request is fast.
- If `scripts/discover-api.js` needs to be re-run (poe.ninja changed something), unset
  `ELECTRON_RUN_AS_NODE` first and run `npx electron scripts/discover-api.js`.
