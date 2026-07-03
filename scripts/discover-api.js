/**
 * Phase 0 — Empirical poe.ninja API discovery.
 *
 * poe.ninja is a client-rendered SPA; its data comes from JSON XHR/fetch calls that are
 * only visible from inside a real browser. This script drives a hidden BrowserWindow,
 * attaches the Chrome DevTools Protocol (CDP) Network domain, and records every JSON
 * response the economy pages fetch — URL, query params, and a shape sample of the body.
 *
 * Run: npx electron scripts/discover-api.js   (unset ELECTRON_RUN_AS_NODE first)
 * Output: docs/api-endpoints.md, plus a live progress log at docs/.discover-progress.log
 *
 * Every network-ish await here is timeout-raced (win.loadURL() only resolves on
 * did-finish-load and can hang indefinitely on pages that never go fully idle), and a
 * hard watchdog force-exits the process no matter what state we're in.
 *
 * Re-run this whenever category data silently comes back empty — poe.ninja's API is
 * undocumented and can change shape without notice. See docs/api-endpoints.md's "Quirks"
 * section for everything already discovered (endpoint families, league-name vs slug,
 * singular/plural type casing, per-game value-field schema differences).
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'docs');
const OUT_FILE = path.join(OUT_DIR, 'api-endpoints.md');
const LOG_FILE = path.join(OUT_DIR, '.discover-progress.log');

const HARD_WATCHDOG_MS = 90_000; // absolute ceiling for the whole run
const NAV_TIMEOUT_MS = 12_000;
const HYDRATE_WAIT_MS = 4_000;
const JS_EVAL_TIMEOUT_MS = 5_000;
const BODY_FETCH_TIMEOUT_MS = 5_000;

// Pages to visit. POE2 first (per plan). League is discovered from the landing page.
const VISITS = [
  { game: 'poe2', path: '/poe2/economy' },
  { game: 'poe1', path: '/poe1/economy' },
];
const PROBE_CATEGORIES = ['currency', 'unique-weapons'];

const collected = []; // { url, status, mimeType, topKeys, rowCount, rowSample }

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(LOG_FILE, `discover-api started ${new Date().toISOString()}\n`);

function log(line) {
  const msg = typeof line === 'string' ? line : JSON.stringify(line);
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + '\n'); // synchronous so it survives a hard kill
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Race any promise against a timeout; never throws — resolves { ok, value|reason }. */
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

/** Summarize an unknown JSON body into a compact, readable shape sample. */
function summarize(body) {
  try {
    const json = JSON.parse(body);
    const topKeys = Array.isArray(json) ? `[array len=${json.length}]` : Object.keys(json).join(', ');

    const rows =
      (json && Array.isArray(json.lines) && json.lines) ||
      (json && Array.isArray(json.entries) && json.entries) ||
      (Array.isArray(json) && json) ||
      null;
    let rowSample = null;
    if (rows && rows.length) {
      const first = rows[0];
      rowSample = {
        rowKeys: typeof first === 'object' && first ? Object.keys(first) : typeof first,
        firstRow: first,
      };
    }
    return { topKeys, rowCount: rows ? rows.length : 0, rowSample };
  } catch {
    return { topKeys: '(non-JSON or parse error)', rowCount: 0, rowSample: null };
  }
}

function looksLikeData(url, mimeType) {
  if (/\.(js|css|png|jpe?g|gif|webp|svg|woff2?|ttf|eot|otf|ico|map)(\?|$)/i.test(url)) return false;
  if (/googletagmanager|google-analytics|doubleclick|gstatic|cloudflareinsights/i.test(url)) return false;
  return /json/i.test(mimeType || '');
}

async function attachNetwork(win) {
  const dbg = win.webContents.debugger;
  try {
    dbg.attach('1.3');
  } catch (e) {
    log(`debugger attach failed: ${e.message}`);
    return;
  }

  const meta = new Map(); // requestId -> { url, mimeType, status }

  dbg.on('message', (_event, method, params) => {
    if (method === 'Network.responseReceived') {
      meta.set(params.requestId, {
        url: params.response.url,
        mimeType: params.response.mimeType,
        status: params.response.status,
      });
    } else if (method === 'Network.loadingFinished') {
      const m = meta.get(params.requestId);
      if (!m || !looksLikeData(m.url, m.mimeType)) return;
      // Fire-and-forget with its own timeout — must never block the CDP event loop.
      withTimeout(
        dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId }),
        BODY_FETCH_TIMEOUT_MS,
        `getResponseBody ${m.url}`
      ).then((res) => {
        if (!res.ok) return;
        const body = res.value.base64Encoded
          ? Buffer.from(res.value.body, 'base64').toString('utf-8')
          : res.value.body;
        collected.push({ url: m.url, status: m.status, mimeType: m.mimeType, ...summarize(body) });
        log(`  [json] ${m.status} ${m.url}`);
      });
    }
  });

  await withTimeout(dbg.sendCommand('Network.enable'), JS_EVAL_TIMEOUT_MS, 'Network.enable');
}

async function navigate(win, url) {
  log(`\n=== navigate: ${url} ===`);
  const nav = withTimeout(win.loadURL(url), NAV_TIMEOUT_MS, `loadURL ${url}`);
  const result = await nav;
  if (!result.ok) log(`  ${result.reason}`);
  await sleep(HYDRATE_WAIT_MS); // let client-side hydration fire its XHRs
}

/** Pull a league slug out of the current economy landing page. */
async function detectLeague(win, game) {
  const result = await withTimeout(
    win.webContents.executeJavaScript(`
      (() => {
        const links = Array.from(document.querySelectorAll('a'));
        for (const a of links) {
          if (a.href.includes('/' + '${game}' + '/economy/')) {
            const parts = a.pathname.split('/');
            if (parts[3] && parts[3].length > 0) return parts[3];
          }
        }
        return null;
      })()
    `),
    JS_EVAL_TIMEOUT_MS,
    `detectLeague ${game}`
  );
  return result.ok ? result.value : null;
}

function writeReport() {
  const byTemplate = new Map();
  for (const c of collected) {
    let u;
    try {
      u = new URL(c.url);
    } catch {
      continue;
    }
    const params = Array.from(u.searchParams.keys()).sort().join(',');
    const template = `${u.origin}${u.pathname}${params ? ` ? ${params}` : ''}`;
    if (!byTemplate.has(template)) byTemplate.set(template, { template, example: c });
  }

  let md = `# poe.ninja live API endpoints (auto-discovered)\n\n`;
  md += `Generated ${new Date().toISOString()} by \`scripts/discover-api.js\`.\n\n`;
  md += `Distinct JSON endpoints observed: **${byTemplate.size}**\n\n`;

  if (byTemplate.size === 0) {
    md += `_No JSON endpoints captured this run — see \`.discover-progress.log\` for what happened_ ` +
      `(navigation timeouts, CDP attach failure, or poe.ninja may not expose a JSON API for these pages).\n`;
  }

  for (const { template, example } of byTemplate.values()) {
    md += `## \`${template}\`\n\n`;
    md += `- Example: \`${example.url}\`\n`;
    md += `- Status: ${example.status} · rows: ${example.rowCount}\n`;
    md += `- Top-level keys: \`${example.topKeys}\`\n`;
    if (example.rowSample) {
      md += `- Row keys: \`${JSON.stringify(example.rowSample.rowKeys)}\`\n`;
      md += `- First row sample:\n\n\`\`\`json\n${JSON.stringify(example.rowSample.firstRow, null, 2).slice(0, 1600)}\n\`\`\`\n`;
    }
    md += `\n`;
  }

  fs.writeFileSync(OUT_FILE, md);
  log(`\nWrote ${byTemplate.size} endpoint templates -> ${OUT_FILE}`);
}

let finished = false;

function finishAndExit(code) {
  if (finished) return;
  finished = true;
  try {
    writeReport();
  } catch (e) {
    log(`writeReport failed: ${e.message}`);
  }
  log(`exiting with code ${code}`);
  process.exit(code); // hard exit — guarantees no lingering process/window survives
}

async function run() {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  await attachNetwork(win);

  for (const visit of VISITS) {
    await navigate(win, 'https://poe.ninja' + visit.path);
    const league = await detectLeague(win, visit.game);
    log(`  detected ${visit.game} league: ${league}`);
    if (league) {
      for (const cat of PROBE_CATEGORIES) {
        await navigate(win, `https://poe.ninja/${visit.game}/economy/${league}/${cat}`);
      }
    }
  }

  finishAndExit(0);
}

// Absolute ceiling: whatever state we're in, write what we have and die.
setTimeout(() => {
  log(`\n!!! HARD WATCHDOG at ${HARD_WATCHDOG_MS}ms — forcing exit !!!`);
  finishAndExit(1);
}, HARD_WATCHDOG_MS);

app.whenReady().then(run).catch((err) => {
  log(`discover-api crashed: ${err.stack || err.message}`);
  finishAndExit(1);
});
