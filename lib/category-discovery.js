/**
 * Live category discovery — poe.ninja has no JSON endpoint listing "what categories exist" (the
 * JSON API only serves economy *data* for a category slug you already know). PoE leagues add and
 * remove economy categories every few months, so the only reliable source for the current set is
 * the live page's own navigation. This scrapes it with a hidden BrowserWindow, the same technique
 * `main.js` used for league discovery before the API migration (see docs/api-endpoints.md and
 * scripts/discover-api.js for the sibling techniques this mirrors).
 *
 * Verified against the live site while building this: the bare league URL
 * (`/{game}/economy/{league}`) 404s outright ("That page did not exist"), and the category nav
 * only renders once you're already on a real category page — so 'currency' is used to bootstrap
 * discovery (it's the one category confirmed present for every league in both games).
 */
const { BrowserWindow } = require('electron');

const NAV_TIMEOUT_MS = 15_000;
const HYDRATE_WAIT_MS = 4_000;

function navigateAndWait(win, url) {
  const done = new Promise((resolve) => {
    win.webContents.once('did-finish-load', resolve);
    setTimeout(resolve, NAV_TIMEOUT_MS);
  });
  return win.loadURL(url, { timeout: NAV_TIMEOUT_MS + 5_000 })
    .catch(() => {})
    .then(() => done)
    .then(() => new Promise((r) => setTimeout(r, HYDRATE_WAIT_MS)));
}

/**
 * Discover the live category list for a game+league. Returns [{ slug, label }] using poe.ninja's
 * own current display label (which can differ from what a slug-derived name would show — e.g. the
 * site now shows "Catalysts" for what its URL still calls `breach-catalyst`), or null if the
 * scrape fails for any reason. Never throws — callers must fall back to the static list on null.
 */
async function discoverCategories(game, leagueSlug) {
  let win;
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await navigateAndWait(win, `https://poe.ninja/${game}/economy/${leagueSlug}/currency`);

    const result = await win.webContents.executeJavaScript(`
      (() => {
        const prefix = '/' + '${game}' + '/economy/' + '${leagueSlug}' + '/';
        const links = Array.from(document.querySelectorAll('a'));
        const seen = new Map(); // slug -> label, dedup by slug
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          if (!href.startsWith(prefix)) continue;
          const rest = href.slice(prefix.length);
          // Category links are exactly one segment past the league; item-detail links
          // (".../currency/mirror-of-kalandra") have an extra segment — exclude those.
          if (!rest || rest.includes('/')) continue;
          const label = a.textContent.trim();
          if (label) seen.set(rest, label);
        }
        return Array.from(seen, ([slug, label]) => ({ slug, label }));
      })()
    `);

    return Array.isArray(result) && result.length > 0 ? result : null;
  } catch (e) {
    console.error(`discoverCategories(${game}/${leagueSlug}) failed:`, e.message);
    return null;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

module.exports = { discoverCategories };
