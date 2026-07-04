/**
 * Regenerates the committed category map in lib/categories.js from the live site, using the same
 * discoverCategories() scrape main.js uses at runtime (see lib/category-discovery.js). Run this
 * at the start of a new PoE league cycle so the committed list — which a packaged build relies on
 * as its immediate, always-available baseline (see main.js's getLiveCategories) — doesn't silently
 * drift from what's actually on poe.ninja.
 *
 * Run: npx electron scripts/generate-categories.js   (unset ELECTRON_RUN_AS_NODE first)
 * Then commit the regenerated lib/categories.js.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { discoverCategories } = require('../lib/category-discovery');
const ninjaApi = require('../lib/ninja-api');

const OUT_FILE = path.join(__dirname, '..', 'lib', 'categories.js');

async function currentLeagueSlug(game) {
  const leagues = await ninjaApi.getLeagues(game);
  if (leagues.length === 0) throw new Error(`No leagues returned for ${game}`);
  // First entry is poe.ninja's current/default league — same assumption main.js's league
  // detection makes, and the one every league in both games supports 'currency' on.
  return leagues[0].slug;
}

function formatList(slugs) {
  return slugs.map((s) => `    ${JSON.stringify(s)},`).join('\n');
}

app.whenReady().then(async () => {
  try {
    console.log('Discovering current league slugs...');
    const [poe1League, poe2League] = await Promise.all([
      currentLeagueSlug('poe1'),
      currentLeagueSlug('poe2'),
    ]);

    console.log(`Scraping categories: poe1/${poe1League}, poe2/${poe2League}`);
    const [poe1Result, poe2Result] = await Promise.all([
      discoverCategories('poe1', poe1League),
      discoverCategories('poe2', poe2League),
    ]);

    if (!poe1Result || !poe2Result) {
      throw new Error('discoverCategories returned null for one or both games — scrape failed, leaving lib/categories.js untouched');
    }

    const poe1Slugs = poe1Result.map((c) => c.slug);
    const poe2Slugs = poe2Result.map((c) => c.slug);

    const content = `/** Category slugs per game, as listed on poe.ninja's economy page. Shared between main.js
 * (background fetch, and the immediate baseline for a packaged build's first launch before the
 * live scrape in lib/category-discovery.js has a chance to run/override it) and
 * test-integration.js so the two never drift out of sync.
 *
 * Generated ${new Date().toISOString().slice(0, 10)} by scripts/generate-categories.js against
 * poe1/${poe1League} and poe2/${poe2League} — re-run that script at the start of a new PoE league
 * if categories start looking stale (poe.ninja adds/removes economy categories every league). */
function getCategories(gameKey) {
  if (gameKey === 'poe1') {
    return [
${formatList(poe1Slugs)}
    ];
  }
  // POE2 categories (from poe.ninja economy page)
  return [
${formatList(poe2Slugs).replace(/^    /gm, '  ')}
  ];
}

module.exports = { getCategories };
`;

    fs.writeFileSync(OUT_FILE, content);
    console.log(`Wrote ${OUT_FILE} — poe1: ${poe1Slugs.length} categories, poe2: ${poe2Slugs.length} categories`);
  } catch (err) {
    console.error('generate-categories failed:', err.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
