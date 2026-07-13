/**
 * Mechanic-drops seed scrape (one-off / per-league maintenance).
 *
 * The Mechanic Rewards view (renderer) needs to know, per POE2 endgame mechanic, which UNIQUE items
 * are *locked* to that mechanic's bosses/encounters (as opposed to world drops like Mageblood, which
 * are intentionally excluded). poe.ninja's price API carries no drop-source metadata at all, and
 * poedb.tw has no JSON API (its /api path 404s). The one structured source is poe2wiki.net's
 * MediaWiki Cargo API (`/w/api.php?action=cargoquery`), whose `items` table exposes a `drop_text`
 * field — e.g. "Drops from [[Xesht, We That Are One]]", "Drops in the [[Simulacrum]]" — that is
 * null for world drops. It's reachable with a browser User-Agent (WebFetch/plain fetch get
 * Cloudflare-403'd; Electron's `net`, on Chromium's stack, is not).
 *
 * `drop_text` coverage is incomplete and the raw field frequently contains HTML hoverbox markup and
 * area-only sources (Simulacrum is an encounter, not an NPC), so this script only *seeds* a
 * candidate file (data/mechanic-drops.candidate.json). The committed data/mechanic-drops.json is the
 * HAND-VERIFIED result: the consumable→category mapping and the pinnacle/mechanic-boss/encounter
 * classification are curated by a human against this candidate — the raw scrape is never shipped
 * as-is. GGG adds mechanics/uniques every league, so re-run this and re-verify at each new POE2
 * league (same maintenance cadence as lib/categories.js).
 *
 * Run: npx electron scripts/discover-mechanic-drops.js   (unset ELECTRON_RUN_AS_NODE first)
 */

const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'mechanic-drops.candidate.json');
const LOG_FILE = path.join(OUT_DIR, '.discover-mechanic-drops.log');

const API = 'https://www.poe2wiki.net/w/api.php';
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

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    request.setHeader('User-Agent', UA);
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms: ${url}`));
    }, REQUEST_TIMEOUT_MS);
    request.on('response', (response) => {
      let raw = '';
      response.on('data', (chunk) => (raw += chunk));
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`invalid JSON from ${url}: ${e.message}`));
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

/** Cargo query for one page of Unique items that carry drop_text. */
async function fetchUniquesPage(offset) {
  const params = new URLSearchParams({
    action: 'cargoquery',
    tables: 'items',
    fields: 'items._pageName=name,items.drop_text=dropText,items.tags=tags',
    where: 'items.rarity="Unique" AND items.drop_text IS NOT NULL AND items.drop_text!=""',
    limit: String(PAGE_SIZE),
    offset: String(offset),
    format: 'json',
  });
  const json = await httpGetJson(`${API}?${params.toString()}`);
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
const AREA_HINTS = /\bSimulacrum|Sanctum|Trial of\b|Expedition|Delirium|Breachstone|Domain\b/i;
const PINNACLE_HINTS = /Xesht|King in the Mists|Arbiter of Ash|Zarokh|Olroth|Trialmaster/i;
function guessKind(text, sources) {
  const joined = `${text} ${sources.join(' ')}`;
  if (PINNACLE_HINTS.test(joined)) return 'pinnacle-boss';
  if (AREA_HINTS.test(joined)) return 'encounter';
  return 'mechanic-boss';
}

async function main() {
  log(`Querying ${API} for Unique items with drop_text…`);
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchUniquesPage(offset);
    log(`  offset ${offset}: ${page.length} rows`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  log(`Total uniques with drop_text: ${rows.length}`);

  // Group by cleaned source name so a human sees "these uniques all drop from Xesht" at a glance.
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

  const candidate = {
    _generated: new Date().toISOString(),
    _note:
      'CANDIDATE ONLY — hand-verify into data/mechanic-drops.json. `kind` is a heuristic guess; ' +
      'group these sources under the right mechanic key and add the consumable→category mapping ' +
      'by hand. World-drop uniques never appear here (they have no drop_text on the wiki).',
    sources: [...bySource.values()].sort((a, b) => b.uniques.length - a.uniques.length),
    unmappedDropText: unmapped,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(candidate, null, 2));
  log(`Wrote ${OUT_FILE}: ${candidate.sources.length} sources, ${unmapped.length} unmapped.`);
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
