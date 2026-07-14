---
name: reseed-league
description: Refresh ninja-quick's committed data at the start of a new PoE league (or after a GGG patch) — regenerate the category baseline, re-discover the poe.ninja API map, and re-seed the currency-description and mechanic-drops datasets, then verify. Use at league start or when categories/descriptions/mechanic data look stale.
disable-model-invocation: true
---

# reseed-league

PoE leagues (and patches) add/remove economy categories, currency-type items, and endgame
mechanics/uniques every few months. Several committed datasets must be regenerated and, for the
hand-curated ones, re-verified. All of these run **Electron as a real GUI/Node-with-Electron
process**, so `ELECTRON_RUN_AS_NODE` must be unset first (the `guard-electron` hook enforces this).

## Order of operations

Run from the repo root, each with `unset ELECTRON_RUN_AS_NODE &&` prefixed:

1. **Category baseline** — `npm run generate-categories`
   Regenerates `lib/categories.js` (the committed per-game category list). Commit the diff.
2. **API endpoint map** — `npx electron scripts/discover-api.js`
   Regenerates `docs/api-endpoints.md` by watching real network traffic. Diff it; if the endpoint
   family / `type`-naming shape changed, reconcile `lib/ninja-api.js` (see its `resolvedCombo` seeds
   and the "Quirks" section of the doc). Only needed if data comes back empty, but cheap to confirm.
3. **Currency descriptions** — `npx electron scripts/discover-currency-descriptions.js`
   Re-scrapes `data/item-descriptions.json` (tooltip text for currency-type categories). Needed when
   a patch adds currency-type items missing tooltip text.
4. **Mechanic drops** — `npx electron scripts/discover-mechanic-drops.js`
   Seeds a per-game `data/mechanic-drops.candidate.json` from each game's wiki Cargo API (POE1 →
   poewiki.net, POE2 → poe2wiki.net). **Hand-verify** into the committed `data/mechanic-drops.json`
   (keyed by game): the candidate is noisy (HTML hoverbox markup, over-extracted "sources"); map each
   real boss/encounter to the right mechanic + consumable categories, classify `kind` (pinnacle-boss /
   mechanic-boss / encounter), drop world-drop/ambiguous entries, and for POE1 strip `(variant)`
   suffixes + de-dup + use `ids` subsets for shared exchange categories. See AGENTS.md "Mechanic
   Rewards" ("POE1 specifics").

## Verify

- `unset ELECTRON_RUN_AS_NODE && npm test` — the integration suite (structural checks + the offline
  Mechanic Rewards data/ranking test) must pass.
- **Mechanic-drops coverage** (offline): load `require('./lib/mechanic-drops').getMechanicMap('poe2')`
  and confirm each source's `uniques` resolve by name against a live POE2 cache file's item names — a
  name absent from one snapshot is fine ("—" in the UI), but a source where *most* names miss means
  the list needs cleaning (usually PoE1 bleed-through or a name-format mismatch).
- Optionally launch the app (see the `run-ninja-quick` skill; use a throwaway `--user-data-dir` if the
  packaged app holds the single-instance lock) and eyeball the sidebar + Mechanic Rewards view.

## Ship

Commit the regenerated files (candidate JSON is gitignored — only the verified
`data/mechanic-drops.json` is committed), then use the `release` skill to cut a patch release.
