# Changelog

## 1.1.6 — 2026-07-19

- **Accessibility, search shortcuts, and error banner** — loading states are announced via
  `aria-busy`, `Ctrl+K`/`/` focuses search (skipped while a modal has focus), and a dismissable error
  banner distinguishes "no data yet" from "failed to load" from "showing cached data." Search also
  gets a history dropdown (prefix-filtered) and a clear (×) button, sidebar category rows are fully
  keyboard-reachable, and a saved league that's since been retired now falls back gracefully.
- **Manage Alerts view** — a dedicated view listing every price alert across both games, with
  per-alert arm/disarm, remove, and bulk enable/disable.
- **Fixed item-click links** — clicking an item now actually filters to it on poe.ninja's economy
  page (was using the wrong query parameter, so it landed on the right category but wasn't scrolled
  to or filtered down to the specific item).

## 1.1.5 — 2026-07-17

- **Item names never truncate** — the item list's name column now sizes to the longest name in the
  list and the list scrolls horizontally when it doesn't fit, so no item name is ever cut off,
  regardless of window size (the left/right column toggle still applies).
- **Web request debug window** — a new Settings toggle opens a separate window that live-lists every
  HTTP request the app makes (method, status, resource type, duration, size, host, URL), with a
  filter and terminal-style tail-follow autoscroll (scroll up to pause, return to the bottom to
  resume).
- **Vaal Temple added to Mechanic Rewards (POE2)** — the Vaal Temple (Atziri, the Red Queen) is now
  ranked alongside the other POE2 mechanics, bringing POE2 to 10 endgame mechanics.
- **Tablet detection (POE2)** — the Mechanic Rewards view reads the live Precursor Tablets on the
  market to badge which map mechanics are in the game this league ("🪧 in maps"), and flags any tablet
  type that has no matching mechanic in the data.
- **Reseed tooling** — `scripts/discover-mechanic-drops.js` now passes both wikis' Cloudflare
  challenge via a hidden browser window and logs every request it makes (developer maintenance).

## 1.1.4 — 2026-07-14

- **Aligned item columns** — the item list now lays out as a real grid: each column (name, trend,
  price, change, actions) lines up vertically across rows and autofits to content, instead of each row
  positioning independently. The name column autofits to the longest name (truncating), and the action
  buttons sit in an aligned column on the right. The left/right column toggle still applies.

## 1.1.3 — 2026-07-14

- **Mechanic Rewards now covers POE1** (~21 mechanics vs POE2's ~9) — Atziri, Shaper & Elder, Sirus,
  Exarch & Eater, Maven, Delve, Incursion, Sanctum, Abyss, Blight, Delirium, Ultimatum, Ritual, Heist,
  Expedition, Legion, Labyrinth, Synthesis, Essence, Bestiary, Breach — with the same ranking, grouping,
  sort, and consumables filter as POE2.
- **Exchange-rate ticker** — a persistent header strip showing Divine⇄base (POE2 Divine⇄Exalted, POE1
  Divine⇄Chaos) with its trend.
- **Movers & Shakers** — the home overview lists the biggest 7-day gainers/losers across the league.
- **Per-row extras** — a liquidity dot (relative volume/listings), a ▲/▼ gain-loss since you favorited
  an item, and an **open-on-trade (⇄)** button that opens pathofexile.com/trade pre-filtered.
- **Layout & visual** — item rows are **left-aligned by default** with a Settings toggle to push the
  data columns right; a **compact-density** toggle; **skeleton loaders** while data loads; and a new
  **"Mirror of Kalandra"** theme.
- **New "Consumables" super category** grouping the crafting/mechanic consumables per game (absorbs the
  old POE1 "Crafting Currency" group).

## 1.1.2 — 2026-07-13

- **Sidebar polish**: the "⚔ Mechanic Rewards" entry now renders as an inset, rounded box the same
  width and style as the other sidebar entries (Search All, All Gems, …), instead of a full-bleed
  edge-to-edge bar. It remains the topmost entry.

## 1.1.1 — 2026-07-13

- **Mechanic Rewards — group/merge toggle**: a new "Merge into one list" toggle collapses every
  checked mechanic's drops into one long, value-sorted list, with each row tagged by its mechanic so
  you can still tell where a drop comes from. Off keeps the per-mechanic ranked sections.
- **Mechanic Rewards — value sort**: a "Value ▼/▲" control that sorts the item rows the same way
  across every mechanic (and the merged list); the mechanic sections themselves stay ordered by
  top-drop value.
- The old "Mechanic Consumables" toggle is now a cleaner **"Consumables only"** content filter that
  composes with both of the above. All three view preferences persist across sessions.

## 1.1.0 — 2026-07-13

- **Mechanic Rewards (POE2)**: a new "⚔ Mechanic Rewards" view at the top of the POE2 sidebar. Pick
  any set of endgame mechanics (checkbox per mechanic, plus Select all / Select none) and see, for
  each, its tradeable consumable drops and its mechanic-boss / pinnacle-boss / encounter-**locked**
  uniques — tagged with the source NPC/encounter. Mechanics are ranked by **top single-drop value**
  (the most expensive locked drop, normalized to the league's primary currency). World drops (e.g.
  Mageblood) are intentionally excluded.
- **"Mechanic Consumables" filter**: one flattened, price-sorted list of every checked mechanic's
  consumable drops (omens, catalysts, distilled emotions, etc.) at once.
- The ranking is an explicit **market-price** heuristic, not a drop-rate estimate (poe.ninja
  publishes no drop rates) — the view labels it as such. Ranking joins a committed, hand-verified
  mechanic→drops map against already-cached economy data, so it makes **no extra poe.ninja requests**.

## 1.0.15 — 2026-07-05

- **"Search All" super category**: a new entry at the very top of the sidebar merges every item
  across every category into one searchable view.
- **Sidebar reordered**: super categories (All Uniques, All Gems, Search All, etc.) now render
  above individual categories, the reverse of the previous order.
- **Search bar always shows what you're viewing**: the placeholder now leads with the current
  category or super-category name in every state, including after deselecting or switching games
  (previously fell back to a bare "Search POE 2 items..." message with no category shown).
- **Periodic auto-update check**: the app now re-checks GitHub Releases every 4 hours while open,
  not just once at startup, so a long-running instance still notices a new release.
- **New app icon**: replaced with an updated star-only design (transparent background, cropped and
  centered).

## 1.0.14 — 2026-07-05

- **New app/tray icon**: replaced the placeholder icon with the new badge design, with a
  transparent background (no more white square around it) and a properly sized master image
  instead of an oversized 2048x2048 file.

## 1.0.13 — 2026-07-05

- **Item-description tooltip now only triggers on the item name** — hovering the sparkline,
  value, change%, or the favorite/alert/copy buttons no longer pops it.
- **New POE2 super category "All Gems"** (Uncut Gems + Lineage Support Gems), matching the
  grouping POE1 already had for its own gem categories.
- **Sidebar now shows every individual category before the grouped ones** (All Uniques, All
  Gems, etc.), instead of interleaving them in whatever order poe.ninja's own nav happened to
  list them.
- Fixed several categories (Omens, Catalysts, Abyssal Bones, Liquid Emotions) missing item
  descriptions entirely — the scraper didn't know about a few categories' historical
  league-mechanic API codenames, so it reported "no data" even though poe.ninja has it.
- Fixed literal `\n` text showing up in a few descriptions (e.g. Hinekora's Lock) instead of an
  actual line break.
- Essence-type mod text ("Sceptre: ...", "Body Armour: ...") now colors the gear-type prefix
  distinctly from the effect text.
- Alert bell is now a real outline/filled icon — previously it was always the same filled glyph
  with only a color change, so an inactive alert could look active at a glance.

## 1.0.12 — 2026-07-05

- **Base type always shown**: uniques/gems that share a display name (e.g. two "Temporalis" rows
  in POE2 Unique Armours) now show their base type on a muted line below the name in every list,
  not just in the hover tooltip — duplicates are distinguishable at a glance instead of requiring
  a hover. Currency-type rows are unaffected.

## 1.0.11 — 2026-07-05

- **Item-description tooltip**: hovering any item row now shows its PoE-style description (base
  type, level requirement, mods, flavor text) — for uniques, gems, and currency-type items alike,
  matching how poe.ninja itself presents item info. Currency-type items (orbs, fragments,
  essences, runes, omens, etc.) have no description data in poe.ninja's price API at all; that
  text is scraped once from poe.ninja's own site into a committed data file the app ships with, so
  showing it doesn't depend on any extra network call at runtime.
- **POE1 super categories**: the "All Uniques"/"All Augments"-style grouped sidebar entries
  (introduced for POE2 in 1.0.10) now also cover POE1 — All Uniques, All Maps, All Gems, Crafting
  Currency, and All Atlas.
- Recalibrated UI scale so the "100%" zoom option matches the old "125%" — the default view is
  larger without changing any of the other zoom presets' relative spacing.
- Fixed the "Auto" currency-display option showing unreadable tiny fractions (e.g. "0.00095
  Divine") for cheap items in expensive categories — it now falls back through Divine → Exalted →
  Chaos and picks the first one that displays as at least 1.0.

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
