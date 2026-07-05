# ninja-quick — AI Agent Instructions

## Project Overview

Cross-platform (Windows/macOS/Linux, via `electron-builder`) desktop client that wraps
[poe.ninja](https://poe.ninja/) functionality with:

1. **POE 1 / POE 2 game switcher** — toggle between Path of Exile 1 and Path of Exile 2 contexts (mirrors the tab UI on poe.ninja, where URLs switch between `/poe1/...` and `/poe2/...`). **POE 2 is the priority/default game.**
2. **Unified search field** — single text input that searches across all categories on the site (items, currency, builds, atlas nodes, etc.)

## Key Design Decisions & Conventions

### Game Switching Pattern

The poe.ninja site uses URL-based game context:
- POE 1 URLs: `https://poe.ninja/poe1/...`
- POE 2 URLs: `https://poe.ninja/poe2/...`

The switcher toggles the base path segment (`poe1` ↔ `poe2`). All search queries and navigation should respect the active game context. Several visual themes are available (Settings → Theme) — see the `THEMES` array in `renderer/renderer.js` and the matching `:root[data-theme="..."]` blocks in `renderer/styles.css` for the current list; **Ledger** (gold/ember/steel/violet, drawn from PoE's own material world) is the default. Each theme still distinguishes POE 1/POE 2 with its own accent color, read live from CSS custom properties (`--accent`, set per game in `applyThemeColors`), not hardcoded in JS.

### Search Behavior

- Single text field triggers searches across **all categories** simultaneously
- Results grouped by category with clear section headers
- Active game context filters results to the selected POE version only
- A permanent left sidebar (mirroring poe.ninja's own economy-page nav) lists every category;
  clicking one immediately shows its full item list (auto-fetching first if needed) and stays
  "sticky" until a different category is clicked or the game switches — clicking the same
  (already-active) category again exits back to the overview
- Any category with no data yet (never fetched, or fetched but genuinely empty) shows an inline
  refresh icon (⟳) directly on its sidebar row (`renderCategorySidebar` in `renderer.js`), so users
  can force a refresh without first navigating into that category — backed by the same
  `fetch-category` IPC / `refreshCategoryNow` used by the per-category refresh button in the
  results view

### Super categories + "Search All"

`SUPER_CATEGORIES` (renderer.js) is a registry of `{ key, label, games?, match(slug) }` entries that
merge several sidebar categories into one clickable, flattened, sorted view (e.g. "All Uniques",
"All Augments", "All Gems" — separate POE1/POE2 entries since the two games group differently).
`"search-all"` is a special catch-all entry (`match: () => true`) that is **excluded** from the
normal per-category matching scan in `renderCategorySidebar` (a catch-all placed in that scan would
swallow every other super category before its own `match()` ever ran) and instead rendered as its
own standalone header, unconditionally first. The sidebar renders **super categories first, then
ungrouped categories** below them.

`categoryScope` is never `null` — deselecting a category/super-category, or switching games, falls
back to `SEARCH_ALL_SCOPE` rather than a bare "nothing selected" state, which is what makes the
search-bar placeholder always lead with the current category/super-category name. With an *empty*
query, Search All still shows the Favorites/Recent-Searches overview (`showOverview()`) rather than
dumping every item — the full merged list only appears once you actually search, or explicitly
click the Search All header (which always re-renders its list, unlike every other super category's
click-to-toggle behavior, since there's nothing to "toggle off" to).

### Item-description tooltips + base type

Hovering an item's **name** (not the rest of the row) shows a PoE-style tooltip — base type, level
requirement, mods, flavor text — matching how poe.ninja itself presents item info. The base type is
also always shown on a second line under the name (not just on hover), so same-named variants (two
"Temporalis" rows with different underlying base types, for example) are distinguishable in the
list itself.

Two very different data sources feed this, handled in `lib/ninja-api.js`'s `extractDescription`:
- **Uniques/gems** (`stash`-family categories): the price API already returns `flavourText`,
  `baseType`, `levelRequired`, `implicitModifiers`/`explicitModifiers` per row — this data was
  simply being discarded before; no scraping needed.
- **Currency-type items** (`exchange`-family categories: Currency, Fragments, Essences, Runes,
  Omens, etc.): the price API has **none** of this data, ever — poe.ninja's own site bakes it into
  a build-time JS bundle instead, not any endpoint. `scripts/discover-currency-descriptions.js`
  scrapes this once (drives a hidden `BrowserWindow` to each category's item-detail page, reads back
  whichever `.mjs` chunk the page loaded, and parses the embedded description objects — two
  different literal formats were found in the wild, a fully-quoted JSON-style object and an
  unquoted-key/backtick-string JS-object-literal style, handled by one segment-based parser robust
  to both) into a **committed** `data/item-descriptions.json`, keyed by game → category → item id.
  `lib/ninja-api.js` reads this file at require-time; there's no runtime dependency on poe.ninja's
  page/bundle structure, only re-running the script (after a GGG patch adds new currency-type
  items) does. Missing game/category/id in that file just means no tooltip for that item — a
  graceful, expected gap (confirmed against poe.ninja's own site: some categories, like Djinn Coins
  or Skill Gems, genuinely show no description there either).

### Category Data: committed baseline + live discovery layered on top

`lib/categories.js` ships a **committed, curated category map per game** — the source of truth on
a fresh install, so the app always has the correct current category list without depending on a
runtime scrape succeeding first. `lib/category-discovery.js` scrapes poe.ninja's own live
economy-page nav (via a hidden `BrowserWindow`, cached per game+league with a 24h TTL — `main.js`'s
`getLiveCategories`) as the **freshness layer on top**, overriding the committed map when poe.ninja
adds/removes a category (PoE leagues do this every few months — confirmed directly: the live POE1
list had **40 categories** vs. the committed baseline's smaller starting set). poe.ninja has no
JSON endpoint for "what categories exist" (only economy *data* for a slug you already know), so
this scrape is the one place the app still does DOM scraping — deliberately narrow in scope.

To regenerate the committed baseline (e.g. at the start of a new PoE league), unset
`ELECTRON_RUN_AS_NODE` and run `npm run generate-categories`, then commit the updated
`lib/categories.js`.

**Gotcha found building this:** the bare league URL (`/{game}/economy/{league}`) 404s outright
("That page did not exist") — the category nav only renders once you're already on a real
category page. `discoverCategories` bootstraps by navigating to `.../​{league}/currency`
specifically, since that category is confirmed present for every league in both games.
Also: poe.ninja's current display **labels** can differ from what a slug-derived name would show
(e.g. the URL slug `breach-catalyst` is now labeled "Catalysts" on the live site) — the scrape
captures the live label, not just the slug.

### Data Source: poe.ninja's JSON API (not DOM scraping)

**poe.ninja has a real JSON API** — it's just undocumented, and its legacy public endpoints
(`/api/data/*`, referenced in every older writeup about poe.ninja) now 404. The current API was
found empirically with `scripts/discover-api.js` (drives a hidden `BrowserWindow` + Chrome DevTools
Protocol to watch real network traffic) and by direct `curl` probing once the base paths were known.

**Read [docs/api-endpoints.md](docs/api-endpoints.md) before touching `lib/ninja-api.js`.** It documents
every quirk hit while building the client — most importantly:
- Two endpoint families (`.../economy/stash/current/item/overview` vs `.../economy/exchange/current/overview`)
  and which one serves a given category is **not predictable from the category name** — both families
  answer an unknown `type` with HTTP 200 and empty `lines`, not a 404.
- The `type` query value's casing/pluralization differs **between the two games for the same category**
  (POE2 plural `UniqueWeapons`, POE1 singular `UniqueWeapon`).
- `league` must be the league's **display name** ("Runes of Aldur"), not its URL slug
  ("runesofaldur") — passing the slug silently returns 200 with empty data.
- The per-row value schema differs by game *and* endpoint family (unified `primaryValue`+`core.primary`
  vs. POE1's legacy `chaosValue`/`exaltedValue`/`divineValue`).

Because of this, `lib/ninja-api.js` resolves endpoint family + type-name variant **adaptively at
runtime** (tries candidates, caches whichever one returns non-empty data per game+category) instead of
hardcoding a fixed map. **Do not "simplify" this into a static lookup table** — the two games have
already been observed to disagree with each other on the same category.

If poe.ninja changes shape again and categories start coming back empty, re-run:
```powershell
$env:ELECTRON_RUN_AS_NODE=""; npx electron scripts/discover-api.js
```
and diff the regenerated `docs/api-endpoints.md`.

### Environment gotcha: `ELECTRON_RUN_AS_NODE`

If this env var is set to `1`, Electron runs as plain Node and `require('electron')` returns a
path string instead of the Electron API — `app`/`net`/`BrowserWindow` will all be `undefined`.
Unset it before any `npx electron ...` invocation.

## Tech Stack

### Platform: Windows/macOS/Linux Desktop — Electron v33.0.0

- Single visible `BrowserWindow` (720px wide, to fit the category sidebar) — data comes from HTTP
  requests via Electron's `net` module; a short-lived hidden `BrowserWindow` is used only for live
  category discovery (see above), not for economy data.
- Packaged and released via `electron-builder` (currently v26) — see "Releasing" below.
- `contextIsolation: true`, `nodeIntegration: false` — secure preload bridge pattern via IPC

### Releasing

`CHANGELOG.md`-driven versioning: bump `version` in `package.json`, add a `CHANGELOG.md` entry,
commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`. That tag push triggers
`.github/workflows/release.yml`, which runs the integration test suite then builds all three OSes
via `electron-builder --publish always` and publishes a GitHub Release with installers +
`latest*.yml` auto-update manifests. `electron-builder`'s GitHub publish target defaults to
`releaseType: "draft"` — this repo sets `releaseType: "release"` in `package.json`'s
`build.publish` config so tags publish with no manual step. CI pins `actions/checkout`/
`actions/setup-node` to majors that declare the `node24` Actions runtime, and uses
`node-version: 22` (current LTS) because `electron-builder@26`'s `@electron/rebuild`/`node-abi`
dependencies require Node `>=22.12.0`.

`build-windows-release.ps1` (repo root) builds a local Windows installer + portable exe without
publishing — useful for a quick smoke-test build; pass `-SkipInstall` to build against whatever's
already in `node_modules` instead of running `npm ci` first.

### Architecture

| File | Purpose |
|------|---------|
| `main.js` | Main process — creates the window, IPC handlers for data fetching & caching, live category discovery caching/TTL, `open-external` (opens poe.ninja links in the system browser) |
| `lib/ninja-api.js` | poe.ninja JSON API client — league detection, adaptive endpoint/type resolution, normalized item shape |
| `lib/category-discovery.js` | Live category-list scraper — hidden `BrowserWindow`, extracts category slugs+labels from the real economy-page nav; the freshness layer on top of `lib/categories.js` |
| `lib/categories.js` | Committed, curated category map per game — the source of truth on a fresh install; regenerate via `npm run generate-categories` |
| `preload.js` | Secure IPC bridge — exposes `ninjaApi.getCachedData()`, `getLiveCategories()`, `getLeagues()`, `startFetch()`, `fetchCategory()`, `openExternal()`, `setZoomFactor()`, `clearCache()`, `setHotkeyEnabled()`, `onFetchProgress()`, `onUpdateDownloaded()`, `restartToUpdate()` to renderer |
| `renderer/index.html` | Game switcher (2 tabs, POE 2 active by default), active label, search input + refresh/settings buttons, category sidebar + results area side by side |
| `renderer/renderer.js` | Pure browser-side logic — game switching, category sidebar (incl. per-row force-refresh icon for unpopulated categories), 300ms debounced search, favorites, price alerts, settings panel, fuzzy search fallback, keyboard navigation |
| `renderer/styles.css` | Ledger theme (default, PoE-material palette) plus several other selectable themes, colors only; active tab gets glow effect; focused rows get accent outline |
| `data/item-descriptions.json` | Committed static item-description data for currency-type categories (see "Item-description tooltips" above) — regenerate with `scripts/discover-currency-descriptions.js` |
| `CHANGELOG.md` | Version history; updated alongside every `package.json` version bump, before tagging |
| `.github/workflows/release.yml` | Tag-triggered CI: runs tests, then builds/publishes Windows/macOS/Linux via `electron-builder` |
| `build-windows-release.ps1` | Local-only Windows build helper (see "Releasing" above) |
| `scripts/discover-api.js` | Re-discovers poe.ninja's live economy-data API and regenerates `docs/api-endpoints.md` — run this if data goes empty |
| `scripts/discover-currency-descriptions.js` | Re-scrapes currency-type item descriptions into `data/item-descriptions.json` — run after a GGG patch adds new currency-type items, or if a category is missing tooltip text that poe.ninja's own site does show |
| `test-integration.js` | Integration tests against the live API — league detection, category fetch, cache round-trip, search simulation |

### App icon & system tray

`assets/ninja-quick-icon.png` (1024×1024, transparent background) is the single master icon —
`build/icon.png` is a copy of it, and `package.json`'s `win`/`mac`/`linux` build config all point
straight at that one PNG; `electron-builder` auto-converts it to `.ico`/`.icns` per-platform at
build time (no `.ico`/`.icns` binaries are committed). `assets/tray-icon.png` (32×32) is a resized
derivative of the same master. `main.js`'s `BrowserWindow` sets `icon:` explicitly so dev mode
(`npx electron . --dev`) shows the real icon too, not Electron's default.

**`scripts/generate-tray-icon.js` is obsolete** — it hand-builds a plain amber placeholder square
and would silently overwrite the real tray icon if run. Don't run it; regenerate icons only by
reprocessing `assets/ninja-quick-icon.png` (flood-fill transparency from the corners + resize, see
the git history around the icon-replacement commit for the exact script) and re-deriving
`build/icon.png`/`assets/tray-icon.png` from the result.

### Auto-update

`electron-updater` (main.js `initAutoUpdater`) checks GitHub Releases once at startup and then
every 4 hours (`UPDATE_CHECK_INTERVAL_MS`) for as long as the app stays open, stopping the repeat
checks once an update has actually been downloaded (the user already has a restart prompt at that
point). Gated by `app.isPackaged`, so `npx electron . --dev` never hits the network for this. Works
out of the box on Windows/Linux; macOS auto-update is inert until the app is code-signed and
notarized (see README's "Signing & macOS auto-update" section) — that's a documented limitation,
not a bug.

### UI Design Facts

- Game switcher: prominent top-bar tabs (POE 1 / POE 2), each game's accent color read live from
  the active theme's CSS custom properties, "Current: POE X" label below
- Category sidebar: permanent left column, super categories (incl. "Search All") first, then
  ungrouped categories, live-scraped labels, unloaded/empty categories shown greyed out with an
  inline force-refresh icon instead of an item count
- Search field: central, always accessible, 300ms debounce, case-insensitive match across all
  categories; placeholder always leads with the current category/super-category name
  (`categoryScope` is never null — see "Super categories" above)
- Results: grouped by collapsible category sections, item rows show name + base type (second line,
  when available) + sparkline + value + change %; hovering the name (not the rest of the row) shows
  the full item-description tooltip; click a row to open it on poe.ninja in the system browser
- Alert bell: outline icon by default, fills solid once a price alert is actually set on that item
  (a real SVG shape difference, not just a color change, matching the ★/☆ favorite-star pattern)
- Keyboard navigation: ArrowUp/Down moves focus through results (skips rows inside a collapsed section), Enter opens selected item

## Build & Run Commands

```powershell
# Install dependencies (one-time)
npm install

# Start dev server with DevTools open
npx electron . --dev

# Run integration tests (validates the API-client data pipeline)
npm test
```

## Autonomous Development Workflow

### Self-Verification Loop

**Every ~20 minutes of work, check `#codebase` to verify everything implemented so far is correct before continuing with the next plan item.** This means:

1. Read current state of key files (main.js, lib/ninja-api.js, renderer.js, test-integration.js, etc.)
2. Run integration tests (`npm test`) and confirm they pass
3. Compare actual implementation against the plan — are features complete? Any regressions?
4. Fix any issues found before moving to the next task

**Do NOT stop after verification — immediately continue implementing the next item in the plan.** The check is a checkpoint, not a pause point.

### Testing Policy

- **You do all testing yourself.** Never ask the user to run tests or verify results.
- Integration tests should be structural (row counts, uniqueness, value coverage) — never assume specific item names, leagues, or endpoint shapes will always be the same; poe.ninja's API is undocumented and can change.
- If a test fails, diagnose and fix before proceeding. If the failure looks like poe.ninja changed its API shape, re-run `scripts/discover-api.js` first.

## Potential Pitfalls

- poe.ninja may rate-limit or block automated requests; background refreshes are deliberately spread over roughly an hour (POE2's categories first) even though individual requests are fast — don't remove that pacing.
- POE 2 content structure differs from POE 1 — some categories exist only in one game, and the same category can live behind a different endpoint family/type-name convention per game; handle missing sections gracefully (return `[]`, don't throw).
- Game context and league state must persist across sessions so the user doesn't need to re-select on every launch.
- poe.ninja's API is a live third-party surface with no published spec — treat everything in `docs/api-endpoints.md` as a snapshot, not a guarantee.
- Live category discovery is capped at once per 24h per game+league (`CATEGORY_DISCOVERY_TTL_MS` in `main.js`) — don't lower this without a reason; it's the same politeness principle as the ~1h background-refresh spread, just on a slower cadence since categories change far less often than prices.
