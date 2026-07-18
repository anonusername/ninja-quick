/**
 * Mechanic-drops seed scrape (one-off / per-league maintenance).
 *
 * The Mechanic Rewards view (renderer) needs to know, per game + endgame mechanic, which UNIQUE items
 * are *locked* to that mechanic's bosses/encounters (as opposed to world drops like Mageblood, which
 * are intentionally excluded). poe.ninja's price API carries no drop-source metadata at all, and
 * poedb.tw has no JSON API (its /api path 404s). The one structured source is each game's wiki
 * MediaWiki Cargo API (POE1 → poewiki.net, POE2 → poe2wiki.net; `/w/api.php?action=cargoquery`), whose
 * `items` table exposes a `drop_text` field — e.g. "Drops from [[Xesht, We That Are One]]", "Drops in
 * the [[Simulacrum]]" — that is null for world drops.
 *
 * Both wikis now sit behind a Cloudflare JS challenge that returns HTTP 200 with a "Making sure
 * you're not a bot!" HTML interstitial to plain requests — WebFetch, and (as of this writing)
 * Electron's `net` too, despite an earlier note here to the contrary. So the fetch drives a hidden
 * `BrowserWindow` (real Chromium, which auto-solves the challenge and sets the `cf_clearance`
 * cookie), loads each Cargo API URL, and reads the JSON straight out of `document.body.innerText`.
 * One window is reused per run, so only the first request pays the ~1–5s challenge cost.
 *
 * `drop_text` coverage is incomplete and the raw field frequently contains HTML hoverbox markup and
 * area-only sources (Simulacrum is an encounter, not an NPC), so this script only *seeds* a
 * candidate file (data/mechanic-drops.candidate.json). The committed data/mechanic-drops.json is the
 * HAND-VERIFIED result: the consumable→category mapping and the pinnacle/mechanic-boss/encounter
 * classification are curated by a human against this candidate — the raw scrape is never shipped
 * as-is (POE1 also needs `(variant)`-suffix stripping + de-dup + `ids` subsets for shared exchange
 * categories; see AGENTS.md "POE1 specifics"). GGG adds mechanics/uniques every league, so re-run this
 * and re-verify at each new league (same maintenance cadence as lib/categories.js).
 *
 * Run: npx electron scripts/discover-mechanic-drops.js   (unset ELECTRON_RUN_AS_NODE first)
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'mechanic-drops.candidate.json');
const LOG_FILE = path.join(OUT_DIR, '.discover-mechanic-drops.log');

// One wiki per game — both are MediaWiki + Cargo, same `items` table shape. POE1's poewiki.net is
// far richer (hundreds of uniques carry drop_text vs ~100 on poe2wiki.net).
const WIKIS = {
  poe1: 'https://www.poewiki.net/w/api.php',
  poe2: 'https://www.poe2wiki.net/w/api.php',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 20_000;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(LOG_FILE, `discover-mechanic-drops started ${new Date().toISOString()}\n`);

function log(line) {
  const msg = typeof line === 'string' ? line : JSON.stringify(line);
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + '\n');
}

const POLL_INTERVAL_MS = 1000;

let scrapeWin = null;
function getScrapeWindow() {
  if (scrapeWin && !scrapeWin.isDestroyed()) return scrapeWin;
  scrapeWin = new BrowserWindow({ show: false, width: 1024, height: 768 });
  scrapeWin.webContents.setUserAgent(UA);
  return scrapeWin;
}

/**
 * GET a Cargo API URL through a hidden BrowserWindow so Cloudflare's JS challenge is auto-solved,
 * then parse the JSON out of the rendered body. Every request is logged (URL out, then size/timing
 * back) so a reseed run leaves an auditable trail of exactly what it hit — the offline-maintenance
 * counterpart to the in-app web-request debug window (console + data/.discover-mechanic-drops.log).
 */
async function fetchJson(url) {
  const win = getScrapeWindow();
  const startedAt = Date.now();
  log(`  → GET ${url}`);
  // The challenge often interrupts the initial navigation with its own reload, which rejects
  // loadURL (ERR_ABORTED) — that's expected; the poll below waits for the real JSON to land.
  await win.loadURL(url).catch(() => {});
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let lastPreview = '';
  while (Date.now() < deadline) {
    const body = await win.webContents
      .executeJavaScript('document.body ? document.body.innerText : ""', true)
      .catch(() => '');
    const text = (body || '').trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      log(`  ← 200 GET ${url} (${text.length} bytes, ${Date.now() - startedAt}ms)`);
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`invalid JSON from ${url}: ${e.message}`);
      }
    }
    lastPreview = text.slice(0, 60).replace(/\s+/g, ' ');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  log(`  ✗ GET ${url} — no JSON after ${REQUEST_TIMEOUT_MS}ms (Cloudflare unsolved? last: "${lastPreview}")`);
  throw new Error(`timed out waiting for JSON (Cloudflare?) from ${url}`);
}

/** Cargo query for one page of Unique items that carry drop_text, from a given wiki API. */
async function fetchUniquesPage(api, offset) {
  const params = new URLSearchParams({
    action: 'cargoquery',
    tables: 'items',
    fields: 'items._pageName=name,items.drop_text=dropText,items.tags=tags',
    where: 'items.rarity="Unique" AND items.drop_text IS NOT NULL AND items.drop_text!=""',
    limit: String(PAGE_SIZE),
    offset: String(offset),
    format: 'json',
  });
  const json = await fetchJson(`${api}?${params.toString()}`);
  if (json.error) throw new Error(`Cargo API error: ${json.error.info || JSON.stringify(json.error)}`);
  return Array.isArray(json.cargoquery) ? json.cargoquery.map((r) => r.title) : [];
}

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Turn a raw wiki drop_text into { text, sources[] }.
 * - decodes entities, strips any HTML (hoverbox markup), collapses whitespace
 * - pulls [[Target|Display]] / [[Target]] wikilinks as the candidate source names (display form),
 *   ignoring File:/Image: links */
function cleanDropText(raw) {
  const decoded = decodeEntities(String(raw));
  const sources = [];
  const linkRe = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = linkRe.exec(decoded)) !== null) {
    const target = m[1];
    if (/^(File|Image|Media):/i.test(target)) continue;
    const display = target.includes('|') ? target.split('|').pop() : target;
    const name = display.trim();
    if (name && !sources.includes(name)) sources.push(name);
  }
  const text = decoded
    .replace(/<[^>]*>/g, ' ') // strip HTML tags
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2') // wikilinks -> display text
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, sources };
}

// Heuristic first-guess kind for the CANDIDATE only — a human re-buckets in the committed file.
// "encounter" = area/instance-locked (no single NPC); pinnacle bosses are the endgame invitation
// fights; everything else with a named source is a plain mechanic-boss guess.
const AREA_HINTS = /\bSimulacrum|Sanctum|Trial of\b|Expedition|Delirium|Breachstone|Domain|Laboratory|Temple of Atzoatl|Alluring Abyss|Forbidden|Cortex\b/i;
const PINNACLE_HINTS =
  /Xesht|King in the Mists|Arbiter of Ash|Zarokh|Olroth|Trialmaster|Sirus|Maven|Searing Exarch|Eater of Worlds|Uber Elder|Shaper|Elder\b|Atziri|Catarina|Venarius|Cortex|Chayula|Uul-Netol|Vaal Omnitect/i;
function guessKind(text, sources) {
  const joined = `${text} ${sources.join(' ')}`;
  if (PINNACLE_HINTS.test(joined)) return 'pinnacle-boss';
  if (AREA_HINTS.test(joined)) return 'encounter';
  return 'mechanic-boss';
}

/** Scrape one game's wiki and group its drop_text-carrying uniques by cleaned source name. */
async function scrapeGame(game) {
  const api = WIKIS[game];
  log(`[${game}] querying ${api} for Unique items with drop_text…`);
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchUniquesPage(api, offset);
    log(`  [${game}] offset ${offset}: ${page.length} rows`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  log(`[${game}] total uniques with drop_text: ${rows.length}`);

  const bySource = new Map();
  const unmapped = []; // drop_text present but no wikilink source resolved — needs manual look
  for (const row of rows) {
    const { text, sources } = cleanDropText(row.dropText || '');
    const entry = { name: row.name, tags: row.tags || '', dropText: text, kind: guessKind(text, sources) };
    if (sources.length === 0) {
      unmapped.push(entry);
      continue;
    }
    for (const src of sources) {
      if (!bySource.has(src)) bySource.set(src, { source: src, kind: entry.kind, uniques: [] });
      bySource.get(src).uniques.push(row.name);
    }
  }
  return {
    total: rows.length,
    sources: [...bySource.values()].sort((a, b) => b.uniques.length - a.uniques.length),
    unmappedDropText: unmapped,
  };
}

async function main() {
  const candidate = {
    _generated: new Date().toISOString(),
    _note:
      'CANDIDATE ONLY — hand-verify into data/mechanic-drops.json (keyed by game). `kind` is a ' +
      'heuristic guess; group these sources under the right mechanic key and add the ' +
      'consumable→category mapping by hand. World-drop uniques never appear here (no drop_text).',
  };
  // POE1 first is fine here (this is offline maintenance, not the app's paced fetch); do both games.
  for (const game of ['poe1', 'poe2']) {
    candidate[game] = await scrapeGame(game);
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(candidate, null, 2));
  log(
    `Wrote ${OUT_FILE}: ` +
      ['poe1', 'poe2'].map((g) => `${g}=${candidate[g].sources.length} sources`).join(', ')
  );
}

app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (e) {
    log(`FATAL: ${e.stack || e.message}`);
    app.exit(1);
  }
});
