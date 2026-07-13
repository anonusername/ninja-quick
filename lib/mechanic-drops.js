/**
 * Mechanic-drops map loader (main-process only, no DOM).
 *
 * Reads the committed, hand-verified data/mechanic-drops.json at require-time and hands it to the
 * renderer (via main.js's `get-mechanic-map` IPC) for the Mechanic Rewards view. There is NO runtime
 * dependency on poe.ninja or the wiki here — this is a static shipped dataset, exactly like
 * data/item-descriptions.json (see lib/ninja-api.js). Re-seed it with scripts/discover-mechanic-drops.js
 * at each new POE2 league; a missing/absent file is a graceful "no mechanics" (empty map), not an error.
 *
 * Shape (per game): { [mechanicKey]: { label, consumables: [{category, ids?}], sources: [{name, kind, uniques[]}] } }
 * - `kind` ∈ 'pinnacle-boss' | 'mechanic-boss' | 'encounter'
 * - `consumables[].category` is a poe.ninja category slug (see lib/categories.js). No `ids` => the whole
 *   category belongs to the mechanic; `ids` restricts to specific rows and is only valid for
 *   exchange-family categories (stable slug ids) — never unique-* (unstable numeric ids).
 */

const path = require('path');

let mechanicDrops = {};
try {
  mechanicDrops = require(path.join(__dirname, '..', 'data', 'mechanic-drops.json'));
} catch {
  // absent in a checkout before the first seed — treated as "no mechanics" everywhere below
}

/** The mechanic map for one game ({} if none). Strips the leading `_note` documentation key. */
function getMechanicMap(game) {
  const forGame = mechanicDrops[game];
  if (!forGame || typeof forGame !== 'object') return {};
  return forGame;
}

module.exports = { getMechanicMap };
