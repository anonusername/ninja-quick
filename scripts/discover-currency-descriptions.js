/**
 * Phase 0.5 — currency-type item descriptions (one-off maintenance scrape).
 *
 * poe.ninja's price API (both endpoint families — see docs/api-endpoints.md) never returns
 * description/flavor-text/mod-text for currency-like categories (Currency, Fragments, Essences,
 * Runes, Omens, etc). That text isn't served by any API at all: it's baked at build time into
 * poe.ninja's own client JS bundle and only becomes reachable by rendering an item's detail page
 * (`/{game}/economy/{league}/{category}/{item-slug}`) in a real browser and reading whichever JS
 * chunk it pulls in — confirmed empirically while building the hover-tooltip feature. The chunk
 * filenames are content-hashed and reshuffle on every poe.ninja deploy, so this script finds the
 * right chunk fresh each run (by content, not by a hardcoded URL) rather than hardcoding a hash.
 *
 * One item's detail page pulls in its *whole category's* description data in one chunk (confirmed:
 * POE2's Currency category's chunk contained all 53 currency items in a single ~13KB bundle), so
 * this only needs to visit ONE item per exchange-family category, not every item.
 *
 * Categories whose price-API rows already carry `flavourText`/mods (uniques, gems — the `stash`
 * endpoint family) are skipped entirely; that data flows through lib/ninja-api.js's normalizeRow
 * directly and needs no scraping.
 *
 * Output is a committed static file (data/item-descriptions.json) that ships with the app and is
 * read at runtime with no live dependency on poe.ninja's page/bundle structure — only re-running
 * this script depends on that, and only when GGG adds new currency-type items.
 *
 * Run: npx electron scripts/discover-currency-descriptions.js   (unset ELECTRON_RUN_AS_NODE first)
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { getLeagues, typeVariants } = require('../lib/ninja-api.js');
const { discoverCategories } = require('../lib/category-discovery.js');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'item-descriptions.json');
const LOG_FILE = path.join(OUT_DIR, '.discover-descriptions.log');

const HARD_WATCHDOG_MS = 20 * 60_000; // this visits ~dozens of pages across 2 games — generous ceiling
const NAV_TIMEOUT_MS = 15_000;
const HYDRATE_WAIT_MS = 4_000;
const GAMES = ['poe2', 'poe1'];

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(LOG_FILE, `discover-currency-descriptions started ${new Date().toISOString()}\n`);

function log(line) {
  const msg = typeof line === 'string' ? line : JSON.stringify(line);
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + '\n');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: `timeout after ${ms}ms: ${label}` }), ms);
  });
  return Promise.race([
    promise.then((value) => ({ ok: true, value })).catch((reason) => ({ ok: false, reason: String(reason) })),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

/** Minimal duplicate of ninja-api.js's family-probing, just enough to tell stash vs exchange
 * apart and grab one sample item id — this script is a one-off maintenance tool, not runtime
 * code, so it intentionally doesn't import ninja-api.js's private resolution internals. */
async function probeCategory(game, leagueDisplayName, categorySlug) {
  const { net } = require('electron');
  const families = [
    (type) => `https://poe.ninja/${game}/api/economy/stash/current/item/overview?league=${encodeURIComponent(leagueDisplayName)}&type=${type}`,
    (type) => `https://poe.ninja/${game}/api/economy/exchange/current/overview?league=${encodeURIComponent(leagueDisplayName)}&type=${type}`,
  ];

  function getJson(url) {
    return new Promise((resolve) => {
      const request = net.request({ method: 'GET', url });
      request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0');
      let raw = '';
      request.on('response', (response) => {
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          if (response.statusCode !== 200) return resolve(null);
          try { resolve(JSON.parse(raw)); } catch { resolve(null); }
        });
      });
      request.on('error', () => resolve(null));
      request.end();
    });
  }

  for (let familyIdx = 0; familyIdx < families.length; familyIdx++) {
    for (const type of typeVariants(categorySlug)) {
      const json = await getJson(families[familyIdx](type));
      if (json && Array.isArray(json.lines) && json.lines.length > 0) {
        const family = familyIdx === 0 ? 'stash' : 'exchange';
        const hasFlavour = family === 'stash' && typeof json.lines[0].flavourText === 'string';
        // Every row's short internal `id` (e.g. "bauble", "chaos") differs from its actual
        // detail-page URL slug (e.g. "glassblowers-bauble", "chaos-orb") — confirmed empirically
        // for both "core" trade currencies AND ordinary rows, so this can't be derived by
        // transforming `id` itself. The top-level `items` array maps every id to its real
        // `detailsId` (the URL slug); fall back to the raw id only if that lookup is missing.
        const itemsById = new Map((Array.isArray(json.items) ? json.items : []).map((it) => [it.id, it]));
        const meta = itemsById.get(json.lines[0].id);
        const sampleId = (meta && meta.detailsId) || json.lines[0].id;
        return { family, sampleId, hasFlavour, itemCount: json.lines.length };
      }
    }
  }
  return null;
}

/** Reads the URLs of every `_astro/*.mjs` chunk the current page has actually loaded (via the
 * Resource Timing API, from inside the page itself) and fetches each directly over plain HTTP.
 *
 * This replaces an earlier CDP Network-domain capture approach (attach the debugger, watch
 * Network.loadingFinished, pull each response body) that turned out to be a genuine race, not
 * just a cold-navigation quirk: pages with a large script burst (Divination Cards fires ~70
 * `.mjs` requests within ~200ms of navigation) could lose individual getResponseBody calls under
 * that load even with retries, a same-window reload, and a longer hydrate wait — confirmed by
 * downloading the exact same chunk by hand and finding the real data untouched. Reading the
 * URLs from the already-loaded page and re-fetching them as plain GETs sidesteps the CDP event
 * pipeline (and its concurrency limits) entirely — no race left to lose. */
async function fetchLoadedChunkBodies(win) {
  const result = await withTimeout(
    win.webContents.executeJavaScript(`
      performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.endsWith('.mjs'))
    `),
    5_000,
    'collect chunk URLs'
  );
  const urls = result.ok && Array.isArray(result.value) ? result.value : [];

  const { net } = require('electron');
  function getText(url) {
    return new Promise((resolve) => {
      const request = net.request({ method: 'GET', url });
      request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0');
      let raw = '';
      request.on('response', (response) => {
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => resolve(response.statusCode === 200 ? raw : ''));
      });
      request.on('error', () => resolve(''));
      request.end();
    });
  }

  const bodies = await Promise.all(urls.map((u) => getText(u)));
  return bodies.filter((b) => b.includes('descrText') || b.includes('flavourText'));
}

/** Pull every {id,name,...} description object out of a JS chunk's source text.
 *
 * Confirmed empirically these are NOT one consistent format across categories: Currency's chunk
 * is a fully double-quoted JSON-style object literal (`{"id":"...","name":"...",...}`), while
 * Fragments' chunk uses unquoted keys and backtick template-literal strings for multi-line text
 * (`{id:"...",name:"...",flavourText:\`multi\nline\`}`) — same underlying data, different bundler
 * output for each page. Rather than one full-object regex (brittle to this variation), find each
 * item's `id`/`name` start marker (quotes around the key optional) and scan the text between one
 * marker and the next for whichever description fields are present — robust to both formats and
 * to categories that only carry a subset of fields (Currency has descrText+explicitMods, Fragments
 * has flavourText only). */
const STR = '(?:"(?:[^"\\\\]|\\\\.)*"|`(?:[^`\\\\]|\\\\.)*`)';
const ITEM_START_RE = /"?id"?\s*:\s*"([^"]+)"\s*,\s*"?name"?\s*:\s*((?:"(?:[^"\\]|\\.)*")|(?:`(?:[^`\\]|\\.)*`))/g;
const FIELD_RE = new RegExp(`"?(descrText|flavourText|explicitMods|implicitMods)"?\\s*:\\s*(${STR}|\\[(?:\\s*${STR}\\s*,?)*\\])`, 'g');

/** Un-escape a matched JSON or template-literal string literal (including surrounding quotes/backticks). */
function unquoteJsString(raw) {
  const inner = raw.slice(1, -1);
  return inner.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' }[c] || c));
}

function parseFieldValue(raw) {
  if (raw[0] === '[') {
    const items = [...raw.matchAll(new RegExp(STR, 'g'))].map((m) => unquoteJsString(m[0]));
    return items;
  }
  return unquoteJsString(raw);
}

function extractDescriptions(jsSource) {
  const found = new Map();
  const starts = [...jsSource.matchAll(ITEM_START_RE)];
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    const id = m[1];
    const name = unquoteJsString(m[2]);
    const segmentEnd = i + 1 < starts.length ? starts[i + 1].index : Math.min(jsSource.length, m.index + 4000);
    const segment = jsSource.slice(m.index + m[0].length, segmentEnd);

    let descrText = '';
    let flavourText = '';
    const mods = [];
    for (const fieldMatch of segment.matchAll(FIELD_RE)) {
      const [, key, rawValue] = fieldMatch;
      const value = parseFieldValue(rawValue);
      if (key === 'descrText') descrText = value;
      else if (key === 'flavourText') flavourText = value;
      else if (key === 'explicitMods' || key === 'implicitMods') mods.push(...value);
    }
    if (!descrText && !flavourText && mods.length === 0) continue; // not a description object, just an id/name match elsewhere
    found.set(id, { name, descrText: descrText || flavourText, mods: mods.map(stripTags) });
  }
  return found;
}

/** poe.ninja's mod text uses `[Category|DisplayText]` tags (e.g. "[ItemRarity|Rare]") — strip to
 * just the display text for plain-text rendering. */
function stripTags(text) {
  return text
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$2') // [Category|DisplayText] -> DisplayText
    .replace(/\[([^\]]+)\]/g, '$1') // [Text] -> Text
    .replace(/<[^>]*>\{([^}]*)\}/g, '$1'); // <tag>{Text} (divination-card reward/mod formatting) -> Text
}

/** Uses a brand-new, disposable BrowserWindow per category (not the shared discovery window) so
 * one category's already-loaded chunks can never shadow another's. Loads the item detail page,
 * then reads back every `.mjs` chunk the page itself ended up loading and fetches each directly
 * (see fetchLoadedChunkBodies) — no network-event capture involved, so there's nothing left to
 * race no matter how many scripts the page fires at once. */
async function scrapeCategoryDescriptions(game, leagueSlug, categorySlug, sampleId) {
  const url = `https://poe.ninja/${game}/economy/${leagueSlug}/${categorySlug}/${sampleId}`;
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  try {
    log(`  navigate: ${url}`);
    await withTimeout(win.loadURL(url), NAV_TIMEOUT_MS, url);
    await sleep(HYDRATE_WAIT_MS);

    const bodies = await fetchLoadedChunkBodies(win);
    const collected = new Map();
    for (const body of bodies) {
      for (const [id, desc] of extractDescriptions(body)) collected.set(id, desc);
    }
    return collected;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function finishAndExit(code, result) {
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
  log(`\nWrote descriptions -> ${OUT_FILE}`);
  log(`exiting with code ${code}`);
  process.exit(code);
}

async function run() {
  const result = {};

  for (const game of GAMES) {
    result[game] = {};
    const leagues = await getLeagues(game);
    const league = leagues.find((l) => l.indexed) || leagues[0];
    if (!league) {
      log(`${game}: no leagues found, skipping`);
      continue;
    }
    log(`\n=== ${game} · league ${league.displayName} (${league.slug}) ===`);

    const categories = await discoverCategories(game, league.slug);
    if (!categories) {
      log(`${game}: category discovery failed, skipping`);
      continue;
    }
    log(`${game}: ${categories.length} categories: ${categories.map((c) => c.slug).join(', ')}`);

    for (const cat of categories) {
      const probe = await probeCategory(game, league.displayName, cat.slug);
      if (!probe) {
        log(`  ${cat.slug}: no data for this league, skipping`);
        continue;
      }
      if (probe.family === 'stash' && probe.hasFlavour) {
        log(`  ${cat.slug}: stash-family with flavourText already — no scrape needed`);
        continue;
      }
      if (probe.family === 'stash') {
        log(`  ${cat.slug}: stash-family without flavourText (no description data at all) — skipping`);
        continue;
      }

      log(`  ${cat.slug}: exchange-family, ${probe.itemCount} items — scraping via sample "${probe.sampleId}"`);
      // fetchLoadedChunkBodies fetches chunks directly by URL (no network-event capture), so
      // there's no race left to retry against — one retry is just cheap insurance against an
      // ordinary transient network hiccup, not a workaround for a known flaky mechanism.
      let descriptions = new Map();
      for (let attempt = 1; attempt <= 2 && descriptions.size === 0; attempt++) {
        if (attempt > 1) log(`  ${cat.slug}: 0 so far, retrying`);
        descriptions = await scrapeCategoryDescriptions(game, league.slug, cat.slug, probe.sampleId);
      }
      log(`  ${cat.slug}: extracted ${descriptions.size} descriptions`);
      if (descriptions.size > 0) {
        result[game][cat.slug] = Object.fromEntries(descriptions);
      }
    }
  }

  finishAndExit(0, result);
}

setTimeout(() => {
  log(`\n!!! HARD WATCHDOG at ${HARD_WATCHDOG_MS}ms — forcing exit !!!`);
  finishAndExit(1, {});
}, HARD_WATCHDOG_MS);

// Each category scrape creates and destroys its own disposable window (see
// scrapeCategoryDescriptions), so there are brief gaps with zero windows open — without this,
// Electron's default window-all-closed behavior quits the whole app mid-run.
app.on('window-all-closed', () => {});

app.whenReady().then(run).catch((err) => {
  log(`discover-currency-descriptions crashed: ${err.stack || err.message}`);
  finishAndExit(1, {});
});
