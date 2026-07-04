# Changelog

## 1.0.10 — 2026-07-04

- **Global sort sync**: sorting one category by price now sorts every category the same way
  immediately, instead of each category remembering its own independent sort order.
- **"All Uniques" super category**: every `unique-*` category is now grouped in the sidebar under
  one gold-bordered box with an "All Uniques" header. Clicking it shows one merged, sorted list of
  every unique item across all of them; its refresh icon updates every member category in one
  batched pass instead of one at a time.
- Fix 8 issues from code review: the alert bell now reflects a disabled alert (not just its
  presence); the confirm-modal's keydown listener no longer leaks on non-Escape dismissal;
  clearing the cache handles errors and no longer races an in-flight background fetch; theme
  validation no longer trusts spoofable object-prototype truthiness; price alerts get their own
  color instead of colliding with currency-gold under the Classic theme; theme colors are now read
  live from CSS instead of duplicated in a JS table that could drift out of sync; a new
  `RESETTABLE_SETTINGS` registry makes it harder to forget wiring a future setting into "Reset
  other settings"; removed an unused CSS variable.

## 1.0.9 — 2026-07-04

- **Visual redesign**: replace the arbitrary emerald/amber theme with a palette grounded in Path
  of Exile's own material world — gold/ember/steel/violet semantic colors (currency-gold, POE1
  oxblood, POE2 cold steel, favorites-only violet), Fraunces/IBM Plex Sans/IBM Plex Mono (bundled
  locally, offline-first), tooltip-card item rows, and a rune-slot search bar.
- **Theme switching**: two themes (Ledger = the redesign above, Classic = the original
  pre-redesign emerald/amber look, colors only) via a Settings dropdown, structured so more themes
  can be added later without restructuring.
- **Per-category price sort**: a 3-state toggle button (unsorted / highest-first / lowest-first)
  per category header in the results view.
- **UI scale setting**: a Settings dropdown (80%–150%) using `webFrame.setZoomFactor` for true page
  zoom, paired with a window-resize IPC so the scale change actually fits everything instead of
  clipping.
- **Settings reset system**: individual resets for price alerts (disables without discarding
  configured thresholds), cache, and other settings (refresh interval, active leagues, hotkey,
  notifications, UI scale, display unit, favorites, recent searches) — plus a "reset all". Destructive
  resets confirm first via a new in-app confirm modal (Electron's renderer has no native
  `window.confirm()`).
- Fix `lodash.isequal` deprecation warning: `electron-updater` depends on it directly; its only
  usage (comparing update-manifest objects) is safely replaced by `node:util.isDeepStrictEqual` via
  a local shim package + `package.json` `overrides`. (`inflight`, the other deprecated transitive
  dependency, is left as-is — forcing a newer `glob` would break `electron-builder`'s asar
  packaging, confirmed via source inspection.)

## 1.0.8 — 2026-07-04

- Add a force-refresh icon directly on unloaded/empty category rows in the sidebar (not just the
  results-view refresh button), reusing the existing `fetch-category` IPC / `refreshCategoryNow`
  plumbing — no new IPC surface needed.
- Fix 5 POE2 categories that were permanently stuck at 0 items no matter how many times they were
  refreshed: `abyssal-bones`, `omens`, `liquid-emotions`, `breach-catalyst`, `unique-relics`.
  Confirmed via live network capture that poe.ninja's real `type` for each is a historical
  league-mechanic codename unrelated to the current slug/label (`Abyss`, `Ritual`, `Delirium`,
  `Breach`, `UniqueSanctumRelics` respectively) — no PascalCase transform of the slug could ever
  guess these, so `lib/ninja-api.js` now seeds them directly instead of relying on the adaptive
  guesser. POE1's `omens`/`unique-relics` were checked too and already resolve correctly as-is.
- Correct a `docs/api-endpoints.md` quirk: only the `exchange` endpoint family returns
  200-with-empty for an unrecognized `type`; the `stash`/item family genuinely 404s.

## 1.0.7 — 2026-07-04

- Fix `EBADENGINE` warnings from `npm ci` in CI: bumping `electron-builder` to 26 in v1.0.6 pulled
  in `@electron/rebuild@4.1.0` and `node-abi@4.33.0`, both requiring Node `>=22.12.0`, but the
  workflow's `node-version` was still `20`. Bumped to `22` (current active LTS) in both jobs. This
  was a warning, not a build failure (v1.0.6's CI run succeeded regardless), but it's now resolved
  cleanly rather than left as noise.

## 1.0.6 — 2026-07-04

- Fix CI deprecation warnings: `actions/checkout@v4` and `actions/setup-node@v4` both declared the
  now-deprecated `node20` Actions runtime, logging a warning on every job. Bumped to
  `actions/checkout@v7` and `actions/setup-node@v6` (both `node24`), clearing it.
- Bump `electron-builder` from `^25.1.8` to `^26.15.3`, which drops several stale transitive
  dependencies that were logging `npm warn deprecated` during `npm ci` (`npmlog`, `gauge`,
  `are-we-there-yet`, `@npmcli/move-file`, and multiple duplicate `glob`/`tar` versions). A few
  remain (`glob`/`inflight` via `@electron/asar`, `rimraf` via the Windows Squirrel installer,
  `boolean` via Electron's own `@electron/get`) — these are transitive deps of the latest stable
  releases of tools we already use, with no newer non-alpha version available; left as-is rather
  than forcing risky `npm overrides`.

## 1.0.5 — 2026-07-04

- Fix `v1.0.4`: `"draft": false` isn't a valid `build.publish` key in electron-builder's schema
  (caught locally via `build-windows-release.ps1`, before it could fail in CI). The correct option
  is `releaseType`, which accepts `"draft" | "prerelease" | "release"` (default `"draft"`) — set to
  `"release"` so `--publish always` actually publishes instead of failing config validation.

## 1.0.4 — 2026-07-04

- Fix releases publishing as unpublished drafts: electron-builder's GitHub publish target defaults
  `draft: true` (v1.0.2 and v1.0.3 both landed as drafts needing a manual "Publish" click). Attempted
  fix used the wrong key (`draft`); see 1.0.5 for the correction. Intent: complete the "no manual
  steps after `git tag`" goal.

## 1.0.3 — 2026-07-04

- Fix the Linux `.deb` build: electron-builder requires `author.email` in `package.json` for the
  package maintainer field, which the bare-string `author` didn't provide. Added a GitHub noreply
  address so no real personal email is exposed in the public repo.

## 1.0.2 — 2026-07-03

- Fix CI test job: a fresh checkout's `chrome-sandbox` binary isn't root-owned/4755, which made
  Electron abort rather than run unsandboxed. Set `ELECTRON_DISABLE_SANDBOX=1` for the test step
  (safe — `test-integration.js` never opens a `BrowserWindow`, so there's no untrusted content the
  sandbox would be protecting).

## 1.0.1 — 2026-07-03

- Fix the release workflow: grant the build job `contents: write` so `electron-builder --publish
  always` can actually create the GitHub Release (the repo's default Actions token permission is
  read-only). Also install `xvfb` explicitly before the headless test run and cache npm deps.

## 1.0.0 — 2026-07-03

First cross-platform release (Windows, macOS, Linux).

- Add electron-builder packaging (NSIS + portable on Windows, dmg + zip on macOS, AppImage + deb on Linux).
- Add auto-update via electron-updater, publishing to GitHub Releases (Windows/Linux; macOS auto-update requires signing, see README).
- Add GitHub Actions release workflow — tagging `vX.Y.Z` builds and publishes all three platforms.
- Categories now ship from a committed, curated per-game map instead of relying solely on the live scrape succeeding on first launch; the live scrape still refines/overrides it in the background.
- Add "active game+leagues" setting — background refresh only updates the game+league combos the user marks active. Defaults to POE2 · Runes of Aldur (SC).
- Harden the packaged app: DevTools gated on `!app.isPackaged`, Windows AppUserModelId set, single-instance lock added.

## Release process

1. Bump `version` in `package.json`.
2. Update this file.
3. Commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. GitHub Actions builds all three OSes and publishes the release automatically.
