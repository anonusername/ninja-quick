/** Category slugs per game, as listed on poe.ninja's economy page. Shared between main.js
 * (background fetch, and the immediate baseline for a packaged build's first launch before the
 * live scrape in lib/category-discovery.js has a chance to run/override it) and
 * test-integration.js so the two never drift out of sync.
 *
 * Generated 2026-07-24 by scripts/generate-categories.js against
 * poe1/allflame and poe2/runesofaldur — re-run that script at the start of a new PoE league
 * if categories start looking stale (poe.ninja adds/removes economy categories every league). */
function getCategories(gameKey) {
  if (gameKey === 'poe1') {
    return [
    "currency",
    "fragments",
    "wombgifts",
    "runegrafts",
    "allflame-embers",
    "tattoos",
    "omens",
    "djinn-coins",
    "ducats",
    "enshrouding-crystals",
    "divination-cards",
    "artifacts",
    "oils",
    "incubators",
    "unique-weapons",
    "unique-armours",
    "unique-accessories",
    "unique-flasks",
    "unique-jewels",
    "forbidden-jewels",
    "shrine-belts",
    "unique-tinctures",
    "unique-relics",
    "skill-gems",
    "imbued-gems",
    "cluster-jewels",
    "maps",
    "blighted-maps",
    "blight-ravaged-maps",
    "unique-maps",
    "valdo-maps",
    "delirium-orbs",
    "invitations",
    "scarabs",
    "astrolabes",
    "memories",
    "temples",
    "base-types",
    "fossils",
    "resonators",
    "beasts",
    "essences",
    "vials",
    ];
  }
  // POE2 categories (from poe.ninja economy page)
  return [
  "currency",
  "fragments",
  "abyssal-bones",
  "uncut-gems",
  "lineage-support-gems",
  "essences",
  "soul-cores",
  "idols",
  "runes",
  "omens",
  "expedition",
  "liquid-emotions",
  "breach-catalyst",
  "verisium",
  "unique-weapons",
  "unique-armours",
  "unique-accessories",
  "unique-flasks",
  "unique-charms",
  "unique-jewels",
  "unique-relics",
  "unique-tablets",
  "precursor-tablets",
  ];
}

module.exports = { getCategories };
