# ninja-quick

Cross-platform (Windows, macOS, Linux) desktop client for [poe.ninja](https://poe.ninja/) — POE 1 / POE 2 game switcher with unified search across all economy categories.

## Features

- **Game Switcher** — toggle between POE 1 and POE 2 contexts; persists across sessions. POE 2 is the default/priority game. Several themes available (Settings → Theme), Ledger by default.
- **Live Category Sidebar** — a permanent left-hand nav (mirroring poe.ninja's own economy-page sidebar), sourced from a committed per-game category list and refined by a live scrape in the background — PoE leagues add/remove economy categories every few months. Super categories (All Uniques, All Gems, etc., plus a "Search All" that merges everything) sit on top, individual categories below. Click a category to see its full item list immediately, auto-fetching it first if needed.
- **Item-Description Tooltips** — hover an item's name to see its PoE-style description (base type, level requirement, mods, flavor text), for uniques, gems, and currency-type items alike. Base type is also always shown under the name, so same-named variants are distinguishable at a glance.
- **Active Game+Leagues** — pick which game+league combos stay updated in the background (Settings → Active leagues), so the app doesn't spend bandwidth refreshing leagues you don't play. Defaults to POE2 · Runes of Aldur (SC).
- **Unified Search** — single text input searches across currency, uniques, fragments, essences, etc.; 300ms debounce; the search bar always shows which category/super-category you're currently in
- **Keyboard Navigation** — ArrowUp/Down to move through results, Enter opens the item on poe.ninja in your system browser
- **Background Data Fetching** — poe.ninja's own JSON API, cached locally; auto-refreshes every 12 hours for active leagues
- **Favorites, Price Alerts, Fuzzy Search** — pin items, get a native OS notification when a price crosses a threshold, and typo-tolerant search fallback
- **Auto-update** — packaged builds check GitHub Releases for updates at startup and every 4 hours after (Windows/Linux; see [Signing](#signing--macos-auto-update) for macOS)

## Download

Grab the latest release for your OS from the [GitHub Releases page](../../releases).

| OS | File | Notes |
|----|------|-------|
| Windows | `ninja-quick-Setup-x.y.z.exe` | Installer. A portable `.exe` is also published if you'd rather not install. |
| macOS | `ninja-quick-x.y.z.dmg` | Universal (Intel + Apple Silicon). |
| Linux | `ninja-quick-x.y.z.AppImage` or `.deb` | AppImage needs `chmod +x` before running. |

### Builds are currently unsigned

These builds aren't code-signed yet, so each OS will warn before the first run. This is expected —
verify you downloaded from this repo's Releases page, then proceed:

- **Windows (SmartScreen):** click "More info" → "Run anyway".
- **macOS (Gatekeeper):** right-click the app → "Open" → confirm in the dialog (a plain double-click
  will refuse to launch an unsigned app the first time). If macOS still blocks it, run
  `xattr -dr com.apple.quarantine /Applications/ninja-quick.app` in Terminal.
- **Linux:** `chmod +x ninja-quick-*.AppImage` then run it directly, or `sudo dpkg -i ninja-quick-*.deb`.

## Quick Start (from source)

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
- **Category Data** — `lib/categories.js` ships a committed, curated category map per game so a
  fresh install always has the correct current list without depending on a runtime scrape
  succeeding. `lib/category-discovery.js` still scrapes the live page's own nav with a hidden
  `BrowserWindow` in the background (cached per game+league, 24h TTL) and overrides the committed
  list if poe.ninja adds/removes a category — the committed map is the reliable baseline, the
  scrape is the freshness layer on top.
- **Local Cache** — JSON files in `{userData}/.cache/{game}_{league}_economy.json`, one per game+league (leagues are economically independent and are never mixed into the same file).
- **IPC Bridge** — secure preload pattern (`contextIsolation: true`, `nodeIntegration: false`).

## Data Source Notes

- poe.ninja's public API is not documented anywhere; `lib/ninja-api.js` resolves the right endpoint
  and `type` naming adaptively per game+category rather than hardcoding a fixed map, because the two
  POE games are inconsistent with each other on this API (see docs/api-endpoints.md).
- Background refreshes are deliberately spread over roughly an hour (POE2's categories first, then
  POE1's) as a courtesy to poe.ninja's servers, even though each individual request is fast. Only
  the game+leagues marked **active** in Settings are included in this background loop.
- If `scripts/discover-api.js` needs to be re-run (poe.ninja changed something), unset
  `ELECTRON_RUN_AS_NODE` first and run `npx electron scripts/discover-api.js`.
- To regenerate the committed category map (e.g. at the start of a new PoE league), unset
  `ELECTRON_RUN_AS_NODE` and run `npm run generate-categories`, then commit the updated
  `lib/categories.js`.
- **Item descriptions** (for the hover tooltip + base-type line) are a separate data source from
  the price API — currency-type categories have no description text in any JSON endpoint at all,
  so `data/item-descriptions.json` is scraped once from poe.ninja's own site by
  `npx electron scripts/discover-currency-descriptions.js` (unset `ELECTRON_RUN_AS_NODE` first) and
  committed. Re-run it if a category is missing tooltip text that poe.ninja's own site does show
  (e.g. after a patch adds new currency-type items).

## Releasing

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/release.yml` builds Windows/macOS/Linux and publishes a GitHub Release with
   installers + the `latest*.yml` manifests electron-updater needs.

To build locally without publishing: `npm run dist:dir` (fast, unpacked — good for smoke-testing)
or `npm run dist:win` / `dist:mac` / `dist:linux` for a real installer on the current OS.

## Signing & macOS auto-update

Releases currently ship **unsigned** (see the [Download](#download) section for the click-through
warnings this causes). Auto-update works out of the box on Windows and Linux; **macOS auto-update
is blocked by Gatekeeper until the app is signed and notarized** — until then, mac users update by
downloading the new release manually.

To add signing later:

- **Windows:** get a code-signing certificate, then set the `CSC_LINK` (path/URL to the `.pfx`) and
  `CSC_KEY_PASSWORD` secrets — electron-builder picks these up automatically.
- **macOS:** enroll in the Apple Developer Program, add a `notarize` block to the `build` config in
  `package.json`, and set the `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
  secrets. No other code changes are needed — auto-update starts working the moment the app is
  signed and notarized.
