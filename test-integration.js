/**
 * Integration test — validates the poe.ninja API-client data pipeline:
 * 1. League detection for both games (POE2 first, per priority)
 * 2. Category fetch returns a normalized, populated shape
 * 3. Cache read/write round-trip
 * 4. Search across categories
 * 5. Top 10 most expensive items in every single league (Standard included), both games
 *
 * poe.ninja's API is an undocumented third party surface (see docs/api-endpoints.md) — these
 * checks are deliberately structural (counts, non-emptiness, uniqueness) and never assert
 * specific item names or leagues, since both change constantly.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const api = require('./lib/ninja-api');
const { getCategories } = require('./lib/categories');

const POLITE_DELAY_MS = 300; // spread requests out a little even in tests — same server as the app
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Convert an item's (amount, unit) into the league's primary-currency-equivalent number, using
 * the exchange rate table from getExchangeRates(). `rates[unit]` means "this many `unit` equal
 * 1 primary", so amount-in-primary = amount / rates[unit] for any non-primary unit. Returns null
 * if the unit is unrecognized (no rate available) — callers should exclude those from ranking
 * rather than silently misrank them.
 */
function toPrimaryEquivalent({ amount, unit }, { primary, rates }) {
  if (unit.toLowerCase() === primary.toLowerCase()) return amount;
  const rateKey = Object.keys(rates).find((k) => k.toLowerCase() === unit.toLowerCase());
  if (!rateKey || !rates[rateKey]) return null;
  return amount / rates[rateKey];
}

/**
 * Fetch every category for a game+league, rank all items by primary-currency-equivalent value,
 * and return the top 10. Returns { rates, top10, totalItems }. `top10` is [] for leagues with no
 * economy data at all (e.g. non-indexed Standard/Hardcore leagues poe.ninja doesn't track) — that
 * is a valid, expected outcome, not a failure.
 */
async function topExpensiveItemsForLeague(game, league) {
  const rates = await api.getExchangeRates(game, league.displayName);
  await sleep(POLITE_DELAY_MS);

  const ranked = [];
  for (const cat of getCategories(game)) {
    const items = await api.fetchCategory(game, league.displayName, cat);
    for (const item of items) {
      if (item.amount === null) continue;
      const primaryEquivalent = toPrimaryEquivalent(item, rates);
      if (primaryEquivalent === null) continue;
      ranked.push({ name: item.name, category: cat, value: item.value, unit: item.unit, primaryEquivalent });
    }
    await sleep(POLITE_DELAY_MS);
  }

  ranked.sort((a, b) => b.primaryEquivalent - a.primaryEquivalent);
  return { rates, top10: ranked.slice(0, 10), totalItems: ranked.length };
}

// ── Test framework ─────────────────────────

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  }
}

// ── Test Suite ─────────────────────────────

async function runTests() {
  // ═══ Test 1: POE2 League Detection (priority game, checked first) ══════
  console.log('\n═══ Test 1: POE2 League Detection ═══');
  const poe2Leagues = await api.getLeagues('poe2');
  assert(poe2Leagues.length > 0, `POE2: leagues detected (${poe2Leagues.length})`);
  assert(
    poe2Leagues.every((l) => typeof l.slug === 'string' && l.slug.length > 0 && typeof l.displayName === 'string'),
    'POE2: every league has a non-empty slug and displayName'
  );
  console.log(`  Found ${poe2Leagues.length} POE2 leagues: ${poe2Leagues.map((l) => l.displayName).join(', ')}`);

  // ═══ Test 2: POE1 League Detection ══════
  console.log('\n═══ Test 2: POE1 League Detection ═══');
  const poe1Leagues = await api.getLeagues('poe1');
  assert(poe1Leagues.length > 0, `POE1: leagues detected (${poe1Leagues.length})`);
  console.log(`  Found ${poe1Leagues.length} POE1 leagues: ${poe1Leagues.map((l) => l.displayName).join(', ')}`);

  // ═══ Test 3: POE2 Currency Fetch ══════
  const poe2League = poe2Leagues[0].displayName;
  console.log(`\n═══ Test 3: POE2 Currency (${poe2League}) ═══`);
  const poe2Currency = await api.fetchCategory('poe2', poe2League, 'currency');
  assert(poe2Currency.length > 20, `POE2 currency: ${poe2Currency.length} items (>20)`);

  const poe2WithValues = poe2Currency.filter((i) => i.value.length > 0);
  assert(
    poe2WithValues.length > poe2Currency.length * 0.5,
    `POE2 currency: ${poe2WithValues.length}/${poe2Currency.length} items have values (>50%)`
  );

  const uniquePoe2Names = new Set(poe2Currency.map((i) => i.name.toLowerCase()));
  assert(uniquePoe2Names.size === poe2Currency.length, `POE2 currency: ${uniquePoe2Names.size} unique names out of ${poe2Currency.length}`);

  const poe2WithAmount = poe2Currency.filter((i) => typeof i.amount === 'number' && typeof i.unit === 'string' && i.unit.length > 0);
  assert(poe2WithAmount.length === poe2WithValues.length, `POE2 currency: amount/unit populated wherever value is (${poe2WithAmount.length}/${poe2WithValues.length})`);

  const poe2WithTrend = poe2Currency.filter((i) => Array.isArray(i.trend));
  assert(poe2WithTrend.length > 0, `POE2 currency: at least some rows have trend data (${poe2WithTrend.length}/${poe2Currency.length})`);

  console.log('  Sample items:');
  for (const item of poe2Currency.slice(0, 3)) {
    console.log(`    - ${item.name}: ${item.value || '(no value)'} ${item.changePercent} [amount=${item.amount} unit=${item.unit} trend=${item.trend ? item.trend.length + 'pts' : 'none'}]`);
  }

  // ═══ Test 4: POE1 Currency Fetch ══════
  const poe1League = poe1Leagues[0].displayName;
  console.log(`\n═══ Test 4: POE1 Currency (${poe1League}) ═══`);
  const poe1Currency = await api.fetchCategory('poe1', poe1League, 'currency');
  assert(poe1Currency.length > 20, `POE1 currency: ${poe1Currency.length} items (>20)`);

  const poe1WithValues = poe1Currency.filter((i) => i.value.length > 0);
  assert(
    poe1WithValues.length > poe1Currency.length * 0.5,
    `POE1 currency: ${poe1WithValues.length}/${poe1Currency.length} items have values (>50%)`
  );

  const poe1WithAmount = poe1Currency.filter((i) => typeof i.amount === 'number' && typeof i.unit === 'string' && i.unit.length > 0);
  assert(poe1WithAmount.length === poe1WithValues.length, `POE1 currency: amount/unit populated wherever value is (${poe1WithAmount.length}/${poe1WithValues.length})`);

  console.log('  Sample items:');
  for (const item of poe1Currency.slice(0, 3)) {
    console.log(`    - ${item.name}: ${item.value || '(no value)'} ${item.changePercent} [amount=${item.amount} unit=${item.unit} trend=${item.trend ? item.trend.length + 'pts' : 'none'}]`);
  }

  // ═══ Test 5: POE1 Unique Weapons (singular-type-name endpoint quirk) ══════
  console.log(`\n═══ Test 5: POE1 Unique Weapons (${poe1League}) ═══`);
  const poe1Weapons = await api.fetchCategory('poe1', poe1League, 'unique-weapons');
  assert(poe1Weapons.length > 100, `POE1 unique weapons: ${poe1Weapons.length} items (>100)`);

  const uniquePoe1WeaponNames = new Set(poe1Weapons.map((i) => i.name.toLowerCase()));
  assert(
    uniquePoe1WeaponNames.size <= poe1Weapons.length && uniquePoe1WeaponNames.size > poe1Weapons.length * 0.5,
    `POE1 weapons: ${uniquePoe1WeaponNames.size} distinct names out of ${poe1Weapons.length} rows`
  );

  const poe1WeaponsWithValues = poe1Weapons.filter((i) => i.value.length > 0);
  assert(
    poe1WeaponsWithValues.length > 0,
    `POE1 unique weapons: at least some rows have a value (${poe1WeaponsWithValues.length}/${poe1Weapons.length})`
  );

  // POE1's stash/item family uses the legacy chaosValue/exaltedValue/divineValue schema (no
  // core.primary) — confirm amount/unit still comes through via extractValue's fallback chain.
  const poe1WeaponsWithAmount = poe1Weapons.filter((i) => typeof i.amount === 'number' && typeof i.unit === 'string' && i.unit.length > 0);
  assert(
    poe1WeaponsWithAmount.length === poe1WeaponsWithValues.length,
    `POE1 unique weapons: amount/unit populated wherever value is (${poe1WeaponsWithAmount.length}/${poe1WeaponsWithValues.length})`
  );

  // ═══ Test 6: POE2 Unique Weapons (plural-type-name endpoint quirk) ══════
  console.log(`\n═══ Test 6: POE2 Unique Weapons (${poe2League}) ═══`);
  const poe2Weapons = await api.fetchCategory('poe2', poe2League, 'unique-weapons');
  assert(poe2Weapons.length > 30, `POE2 unique weapons: ${poe2Weapons.length} items (>30)`);

  // ═══ Test 7: Unknown category degrades gracefully ══════
  console.log('\n═══ Test 7: Unknown Category ═══');
  const bogus = await api.fetchCategory('poe2', poe2League, 'not-a-real-category-xyzzy');
  assert(Array.isArray(bogus) && bogus.length === 0, `Unknown category returns [] (got ${JSON.stringify(bogus)})`);

  // ═══ Test 8: Cache Read/Write Round-Trip ══════
  console.log('\n═══ Test 8: Cache Round-Trip ═══');
  const cacheDir = path.join(app.getPath('userData'), '.cache', 'test-cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const testData = { currency: poe1Currency.slice(0, 5), weapons: poe1Weapons.slice(0, 3) };
  const cacheFile = path.join(cacheDir, 'test_economy.json');
  fs.writeFileSync(cacheFile, JSON.stringify(testData, null, 2));

  const readBack = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  assert(readBack.currency.length === 5, `Cache: currency count matches (got ${readBack.currency.length})`);
  assert(readBack.weapons[0].name === poe1Weapons[0].name, 'Cache: first weapon name matches');

  fs.unlinkSync(cacheFile);
  fs.rmSync(cacheDir, { recursive: true });

  // ═══ Test 9: Search Simulation ══════
  console.log('\n═══ Test 9: Search Simulation ═══');
  const allItems = [...poe1Currency, ...poe1Weapons];

  const orbResults = allItems.filter((i) => i.name.toLowerCase().includes('orb'));
  assert(orbResults.length > 0, `Search "orb": ${orbResults.length} results (>0)`);

  const xyzzyResults = allItems.filter((i) => i.name.toLowerCase().includes('xyzzy'));
  assert(xyzzyResults.length === 0, `Search "xyzzy": ${xyzzyResults.length} results (===0)`);

  const firstItem = allItems[0];
  if (firstItem) {
    const lowerName = firstItem.name.toLowerCase();
    const matchByLowercase = allItems.filter((i) => i.name.toLowerCase() === lowerName);
    assert(matchByLowercase.length > 0, `Search is case-insensitive: found ${matchByLowercase.length} matches for "${lowerName}"`);
  }

  // ═══ Test 10: Top 10 Most Expensive Items — every league, both games (POE2 first) ══════
  // Standard/hardcore leagues are often not "indexed" by poe.ninja (no active economy tracking),
  // so an empty top10 there is a valid outcome, not a failure — only assert on leagues with data.
  for (const [game, leagues] of [
    ['poe2', poe2Leagues],
    ['poe1', poe1Leagues],
  ]) {
    for (const league of leagues) {
      console.log(`\n═══ Test 10: Top 10 Most Expensive — ${game.toUpperCase()} / ${league.displayName} ═══`);
      const { rates, top10, totalItems } = await topExpensiveItemsForLeague(game, league);

      if (totalItems === 0) {
        console.log(`  (no economy data for this league — likely not actively indexed)`);
        continue;
      }

      assert(top10.length > 0 && top10.length <= 10, `${game}/${league.displayName}: top10 has ${top10.length} entries (1-10)`);
      const sorted = top10.every((item, i) => i === 0 || item.primaryEquivalent <= top10[i - 1].primaryEquivalent);
      assert(sorted, `${game}/${league.displayName}: top10 is sorted descending by value`);
      assert(
        top10.every((item) => typeof item.name === 'string' && item.name.length > 0),
        `${game}/${league.displayName}: every top10 entry has a name`
      );

      top10.forEach((item, i) => {
        // Only show the "≈ X <primary>" conversion when it's an actual cross-currency
        // conversion — an item already priced in the league's primary unit doesn't need
        // "6895 Divine ≈ 6895.0000 Divine" repeating the same number back at itself.
        const converted =
          item.unit.toLowerCase() === rates.primary.toLowerCase()
            ? ''
            : ` ≈ ${item.primaryEquivalent.toFixed(4)} ${rates.primary}`;
        console.log(`  ${i + 1}. ${item.name} (${item.category}) — ${item.value}${converted}`);
      });
    }
  }

  // ═══ Summary ══════
  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }

  app.exit(failCount > 0 ? 1 : 0);
}

app.whenReady().then(runTests).catch((err) => {
  console.error('Test crashed:', err);
  app.exit(1);
});
