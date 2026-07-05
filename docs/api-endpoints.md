# poe.ninja live API endpoints (auto-discovered)

Generated 2026-07-03T01:38:21.110Z by `scripts/discover-api.js`.

This is a **live, undocumented, third-party API** — nothing below is a published spec, it was reverse
engineered by watching real network traffic (`scripts/discover-api.js`) and by direct `curl` probing once
the base paths were known. poe.ninja can change any of this without notice. If category data silently
starts coming back empty, re-run `scripts/discover-api.js` and diff this file before assuming the app broke.

> **Note:** none of the endpoints below ever return item *description* text (flavor text, mods) for
> currency-type categories — that's a separate data source entirely (poe.ninja's own client bundle,
> not this API), scraped by `scripts/discover-currency-descriptions.js` into a committed
> `data/item-descriptions.json`. Don't go looking for a description field in these responses; it
> genuinely isn't there.

## Quirks discovered (read before touching `lib/ninja-api.js`)

These are not guesses — each was hit as a real bug while building the client and confirmed by direct
`curl` testing. `lib/ninja-api.js` is written to survive #2–#5 adaptively (it probes and caches per
game+category rather than hardcoding one shape); if you change that file, preserve that behavior.

1. **The legacy API is gone.** `poe.ninja/api/data/*` (the endpoints the old scraping-era code and every
   public poe.ninja API writeup you'll find online reference) now 404s. The real base paths are
   `poe.ninja/{game}/api/data/index-state` and `poe.ninja/{game}/api/economy/...`, where `{game}` is
   `poe1` or `poe2`. curl gets a static SPA shell for the HTML pages but the JSON API paths above respond
   directly — no browser required for the API itself, only for *discovering* it the first time.

2. **Two endpoint families exist, and which one serves a given category is not predictable from the
   category name.** `.../api/economy/stash/current/item/overview?league=X&type=Y` serves full item data
   (uniques, etc. — name/icon embedded per row). `.../api/economy/exchange/current/overview?league=X&type=Y`
   serves currency-like tradeables (row has only an `id`; name/icon come from a separate top-level `items[]`
   array joined by `id`). Example: POE2 `unique-weapons` → only `stash` has data; POE2 `currency` → only
   `exchange` has data. **The `exchange` family answers unknown `type` values with HTTP 200 and an empty
   `lines` array — not a 404 — so a 200 status alone does not confirm you picked the right family.** (The
   `stash`/item family genuinely 404s for an unrecognized `type` — confirmed directly against a
   deliberately bogus value — so this 200-but-empty trap is `exchange`-specific, not universal.) You must
   check whether `lines` is actually non-empty before treating a combo as resolved.
   
   **The `type` value itself can also be an arbitrary historical codename, not derivable from the slug
   at all** — e.g. POE2's `omens` category (a display label) is actually served by `type=Ritual`, not
   any PascalCase form of "omens"; `liquid-emotions` → `Delirium`, `breach-catalyst` → `Breach`,
   `abyssal-bones` → `Abyss`, `unique-relics` → `UniqueSanctumRelics`. These are old league-mechanic
   names poe.ninja never renamed internally even though the category's slug/label moved on. `lib/ninja-api.js`
   seeds `resolvedCombo` with these known cases directly rather than relying on the guesser, which can
   never produce them.

3. **The `type` query value's casing/pluralization is inconsistent between the two POE games for the
   *same* category**, on the same endpoint family. Example (stash/item family): POE2 uses the plural
   `UniqueWeapons`, `UniqueArmours`, `UniqueFlasks`, …; POE1 uses the **singular** `UniqueWeapon`,
   `UniqueArmour`, `UniqueFlask`, … for the exact same category slugs. There is no single PascalCase rule
   that works for both games — `lib/ninja-api.js` tries both the plural and last-word-singularized form
   of every category slug.

4. **`league` must be the league's display name, not its URL slug — and this fails silently.**
   `?league=runesofaldur` (the slug you'd get from a page URL like `/poe2/economy/runesofaldur/currency`)
   returns **HTTP 200 with an empty `lines` array**, which looks exactly like "this category has no data
   right now." The correct value is the display name from `index-state`'s `economyLeagues[].displayName`,
   e.g. `?league=Runes+of+Aldur`. This combines with quirk #2's "200-but-empty is not an error" trap to be
   an easy silent-failure mode — always sanity-check against a category you know has data (e.g. `currency`)
   when debugging "no results."

5. **The per-row value schema differs between endpoint families *and* between games, on top of #2–#4.**
   - POE2 (both `stash` and `exchange` families) and POE1's `exchange` family use a unified schema: each
     row has a numeric `primaryValue`, and the response has a top-level `core.primary` string naming the
     currency that value is expressed in (observed: `"divine"` for POE2, `"chaos"` for POE1 — this is
     itself league/game-dependent, don't hardcode "Divine").
   - POE1's `stash/item` family predates that unification: there is **no top-level `core` object at all**,
     and each row instead has explicit `chaosValue` / `exaltedValue` / `divineValue` numeric fields directly.
   - `lib/ninja-api.js`'s `extractValue()` tries `primaryValue`+`core.primary` first, then falls back to
     `divineValue` → `exaltedValue` → `chaosValue` in that order.

6. **Change-percent field name also varies by casing:** POE2 rows use `sparkline.totalChange` (lowercase
   `l`); POE1 `stash` rows use `sparkLine.totalChange` (capital `L`). Check both.

## Raw discovery output

Distinct JSON endpoints observed by the automated probe: **12**

## `https://config.playwire.com/audience_segments/config.json`

- Example: `https://config.playwire.com/audience_segments/config.json`
- Status: 200 · rows: 304
- Top-level keys: `[array len=304]`
- Row keys: `["id","name","definition"]`
- First row sample:

```json
{
  "id": 3,
  "name": "Playwire Audiences | Custom | Interest | Video Gaming | Console Games | Playstation",
  "definition": [
    {
      "group": "meta_keywords",
      "values": [
        "~ps4~",
        "~playstation~",
        "~ps5~",
        "~ps2~",
        "~ps3~",
        "~ps vita~",
        "~psp~"
      ]
    },
    {
      "group": "page_domains",
      "values": [
        "~playstation~",
        "~ps4~",
        "~ps5~",
        "~ps3~",
        "~ps2~"
      ],
      "operator": "OR"
    },
    {
      "group": "url_paths",
      "values": [
        "~ps4~",
        "~playstation~",
        "~ps5~",
        "~ps3~",
        "~ps2~"
      ],
      "operator": "OR"
    },
    {
      "group": "referrer_domains",
      "values": [
        "~ps2~",
        "~ps3~",
        "~ps4~",
        "~ps5~",
        "~playstation~"
      ],
      "operator": "OR"
    }
  ]
}
```

## `https://id.hadron.ad.gt/v1/hadron.json ? _it,domain,partner_id,sync,url,v`

- Example: `https://id.hadron.ad.gt/v1/hadron.json?_it=amazon&partner_id=403&sync=0&domain=poe.ninja&url=https://poe.ninja/poe2/economy&v=06`
- Status: 200 · rows: 0
- Top-level keys: `base_id, guid, addr, domain, debug_info, hadron_id`

## `https://lb.eu-1-id5-sync.com/lb/v1`

- Example: `https://lb.eu-1-id5-sync.com/lb/v1`
- Status: 200 · rows: 0
- Top-level keys: `lb, ttl`

## `https://lbs.eu-1-id5-sync.com/lbs/v1`

- Example: `https://lbs.eu-1-id5-sync.com/lbs/v1`
- Status: 200 · rows: 0
- Top-level keys: `lbs`

## `https://poe.ninja/poe2/api/data/index-state`

- Example: `https://poe.ninja/poe2/api/data/index-state`
- Status: 200 · rows: 0
- Top-level keys: `economyLeagues, oldEconomyLeagues, snapshotVersions, buildLeagues, oldBuildLeagues`

## `https://poe.ninja/poe2/api/economy/exchange/current/overview ? league,type`

- Example: `https://poe.ninja/poe2/api/economy/exchange/current/overview?league=Runes+of+Aldur&type=Currency`
- Status: 200 · rows: 52
- Top-level keys: `core, lines, items`
- Row keys: `["id","primaryValue","volumePrimaryValue","maxVolumeCurrency","maxVolumeRate","sparkline"]`
- First row sample:

```json
{
  "id": "chaos",
  "primaryValue": 0.1244,
  "volumePrimaryValue": 185739,
  "maxVolumeCurrency": "divine",
  "maxVolumeRate": 8.04,
  "sparkline": {
    "totalChange": 19.78,
    "data": [
      -2.69,
      -3.77,
      -1.1,
      4.22,
      9.04,
      16.7,
      19.78
    ]
  }
}
```

## `https://pogo.ccgateway.net/v1/p/5bb3e20859/classification ? url`

- Example: `https://pogo.ccgateway.net/v1/p/5bb3e20859/classification?url=https%3A%2F%2Fpoe.ninja%2Fpoe2%2Feconomy%2Frunesofaldur%2Fcurrency`
- Status: 200 · rows: 0
- Top-level keys: `brand_safety_checked, contextualclassifications`

## `https://gum.criteo.com/sid/json ? bundle,cw,domain,lsw,origin,topUrl`

- Example: `https://gum.criteo.com/sid/json?origin=prebid&topUrl=https%3A%2F%2Fpoe.ninja%2F&domain=poe.ninja&bundle=-T-Kj19DMU5sTzFXWmdJanNGNWZZOEpaS210JTJGZjJwclJmTVltZVFTclNKWFM0NEQlMkJGaklDeVlZc0J4WWVNZDl1M2RHV0ZpalBrWk5RRlB3Wk9rZExPV29MOGtHWVhSOE9Zb01nVE94U2QycXJTb3VRdXVrM2FVbUNQaTFPZTdDaWQ4TXBXYiUyQjRXR0tkJTJCcmxYeWszOWRDMmJ3USUzRCUzRA&cw=1&lsw=1`
- Status: 200 · rows: 0
- Top-level keys: `bundle, bidId, pixels`

## `https://rp.liadm.com/j ? cd,did,dtstmp,duid,pu,se,tv,wpn`

- Example: `https://rp.liadm.com/j?dtstmp=1783042681299&did=did-0046&se=e30&duid=f5d4f94406dd--01kwhxq2k0avyw1xqx9hm7xwyd&tv=10.29.1&pu=https%3A%2F%2Fpoe.ninja%2Fpoe2%2Feconomy%2Frunesofaldur%2Fcurrency&wpn=prebid&cd=.poe.ninja`
- Status: 200 · rows: 0
- Top-level keys: `bakers`

## `https://poe.ninja/poe2/api/economy/stash/current/item/overview ? league,type`

- Example: `https://poe.ninja/poe2/api/economy/stash/current/item/overview?league=Runes+of+Aldur&type=UniqueWeapons`
- Status: 200 · rows: 148
- Top-level keys: `core, lines`
- Row keys: `["id","itemId","detailsId","name","baseType","icon","flavourText","levelRequired","category","primaryValue","listingCount","corrupted","sparkLine","implicitModifiers","explicitModifiers","requirementModifiers","grantedSkillModifiers"]`
- First row sample:

```json
{
  "id": 729,
  "itemId": "Runeseeker's Call Runemastered Runic Fork",
  "detailsId": "runeseekers-call-runemastered-runic-fork",
  "name": "Runeseeker's Call",
  "baseType": "Runemastered Runic Fork",
  "icon": "https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvV2VhcG9ucy9PbmVIYW5kV2VhcG9ucy9XYW5kcy9VbmlxdWVzL1J1bmljRGl2aW5lciIsInciOjIsImgiOjMsInNjYWxlIjoxLCJyZWFsbSI6InBvZTIifV0/df89e6455f/RunicDiviner.png",
  "flavourText": "Smithed from ancient metal \r\nwrought from the very stars.\r\nIt is a means to call upon them, \r\nfor one capable of wielding it.",
  "levelRequired": 84,
  "category": "Ezomyte [Wand]",
  "primaryValue": 950,
  "listingCount": 67,
  "corrupted": false,
  "sparkLine": {
    "totalChange": 11.9,
    "data": [
      0,
      -15.67,
      -14.91,
      -0.47,
      1.71,
      3.06,
      11.9
    ]
  },
  "implicitModifiers": [
    {
      "text": "+300 to maximum [Ward|Runic Ward]",
      "optional": true
    },
    {
      "text": "(30-50)% increased Mana Regeneration Rate",
      "optional": true
    },
    {
      "text": "(30-50)% chance for [Spell] Skills to fire 2 additional [Projectile|Projectiles]",
      "optional": true
    }
  ],
  "explicitModifiers": [
    {
      "text": "Only [Rune|Runes] can be Socketed in this item",
      "optional": false
    },
    {
      "text": "200% increased effect of Socketed [Rune|Runes]",
      "optional": false
    }
  ],
  "requirementModifiers": [
    {
      "text": "Level: (65-90)",
      "optional": false
    },
    {
      "text": "[Intelligence|Int]: 114",
      "optional": false
    }
```

## `https://poe.ninja/poe1/api/data/index-state`

- Example: `https://poe.ninja/poe1/api/data/index-state`
- Status: 200 · rows: 0
- Top-level keys: `economyLeagues, oldEconomyLeagues, snapshotVersions, buildLeagues, oldBuildLeagues`

## `https://poe.ninja/poe1/api/economy/exchange/current/overview ? league,type`

- Example: `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=Ancestors&type=Currency`
- Status: 200 · rows: 101
- Top-level keys: `core, lines, items`
- Row keys: `["id","primaryValue","volumePrimaryValue","maxVolumeCurrency","maxVolumeRate","sparkline"]`
- First row sample:

```json
{
  "id": "accelerating-catalyst",
  "primaryValue": 1.01,
  "volumePrimaryValue": 51.17,
  "maxVolumeCurrency": "chaos",
  "maxVolumeRate": 0.9902,
  "sparkline": {
    "totalChange": -3.35,
    "data": [
      0,
      0.52,
      -2.39,
      36.42,
      15.92,
      45.78,
      -3.35
    ]
  }
}
```

