const { app, BrowserWindow, ipcMain, shell, Tray, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const ninjaApi = require('./lib/ninja-api');
const { getCategories } = require('./lib/categories');
const { discoverCategories } = require('./lib/category-discovery');
const { autoUpdater } = require('electron-updater');

// Windows taskbar grouping/notifications need a stable AppUserModelId — without it, price-alert
// notifications can show up under a generic "Electron" identity instead of ninja-quick.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.ninjaquick.app');
}

// A background tray app launching a second instance would just fight the first one over the
// cache files and the global hotkey — focus the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// Live category list is re-scraped at most this often per game+league — categories change on a
// league-cycle timescale (new PoE leagues add/remove economy categories every few months), not
// continuously, so there's no need to hit the live site on every launch.
const CATEGORY_DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

let mainWindow;
let tray = null;
let isQuitting = false;
const HOTKEY = 'CommandOrControl+Shift+Space';
let hotkeyRegistered = false;

// Spread a full category refresh over roughly an hour so we don't hammer poe.ninja —
// the API calls themselves are fast; this pacing is deliberate politeness, not a technical need.
const FULL_REFRESH_SPREAD_MS = 60 * 60 * 1000;
const MIN_STAGGER_MS = 5_000;

// ── Cache directory ────────────────────────
//
// Cache is scoped per game+league (not just per game) — leagues are economically independent,
// and a cache keyed only by game meant switching leagues could show stale prices from whichever
// league was cached before, with nothing to tell the two apart. One file per game+league.

const CACHE_DIR = path.join(app.getPath('userData'), '.cache');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheFilePath(game, leagueSlug) {
  const safeLeague = String(leagueSlug).replace(/[^a-z0-9_-]/gi, '_');
  return path.join(CACHE_DIR, `${game}_${safeLeague}_economy.json`);
}

function readCache(game, leagueSlug) {
  const file = cacheFilePath(game, leagueSlug);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read ${game}/${leagueSlug} cache:`, err);
  }
  return {};
}

/** Read-modify-write a single category into the cache, re-reading fresh each time so a
 * concurrent writer (see fetchLocks below) can't have its update clobbered by a stale snapshot.
 * Categories are stored as { items, fetchedAt } so the UI can show "updated X ago" per section. */
function writeCategoryToCache(game, leagueSlug, category, items) {
  ensureCacheDir();
  const current = readCache(game, leagueSlug);
  current[category] = { items, fetchedAt: Date.now() };
  fs.writeFileSync(cacheFilePath(game, leagueSlug), JSON.stringify(current, null, 2));
}

/** Write the league's currency exchange-rate table under the reserved `__meta` key, so the
 * renderer can convert any item's `amount`/`unit` into the user's preferred display currency
 * without a separate IPC round trip. Renderers must skip `__meta` when iterating categories. */
function writeRatesToCache(game, leagueSlug, rates) {
  ensureCacheDir();
  const current = readCache(game, leagueSlug);
  current.__meta = { rates, updatedAt: Date.now() };
  fs.writeFileSync(cacheFilePath(game, leagueSlug), JSON.stringify(current, null, 2));
}

/** Write the live-discovered category list under the reserved `__categories` key. */
function writeCategoriesToCache(game, leagueSlug, categories) {
  ensureCacheDir();
  const current = readCache(game, leagueSlug);
  current.__categories = { categories, discoveredAt: Date.now() };
  fs.writeFileSync(cacheFilePath(game, leagueSlug), JSON.stringify(current, null, 2));
}

/**
 * The category list the sidebar shows and the background fetch iterates. lib/categories.js's
 * committed, curated-from-live map is the immediate baseline — a packaged build's first launch
 * must not block the sidebar/fetch loop on a scrape that can take ~20s and can fail — while
 * lib/category-discovery.js's live scrape runs (blocking, if a previous discovery already exists
 * and has gone stale) or in the background (fire-and-forget, on a true first launch) to override
 * it once poe.ninja is confirmed reachable. Re-scrapes at most once per CATEGORY_DISCOVERY_TTL_MS
 * per game+league. Returns { categories: [{slug, label}], discoveredAt, isFallback }.
 */
async function getLiveCategories(gameKey, leagueSlug) {
  const cached = readCache(gameKey, leagueSlug).__categories;
  const isFresh = cached && Date.now() - cached.discoveredAt < CATEGORY_DISCOVERY_TTL_MS;

  if (isFresh) return { ...cached, isFallback: false };

  if (!cached) {
    // True first launch (or the scrape has never once succeeded for this game+league) — return
    // the committed list right away instead of making the caller wait on the scrape, and let the
    // scrape run in the background to populate __categories for next time.
    discoverCategories(gameKey, leagueSlug)
      .then((discovered) => {
        if (discovered) writeCategoriesToCache(gameKey, leagueSlug, discovered);
      })
      .catch((err) => console.error(`background discoverCategories(${gameKey}/${leagueSlug}) failed:`, err.message));

    const fallback = getCategories(gameKey).map((slug) => ({ slug, label: null }));
    return { categories: fallback, discoveredAt: null, isFallback: true };
  }

  // A discovery exists but has gone stale (past the TTL) — re-scrape now; a previously-successful
  // scrape means poe.ninja is likely reachable, so blocking here is worth it for accuracy.
  const discovered = await discoverCategories(gameKey, leagueSlug);
  if (discovered) {
    writeCategoriesToCache(gameKey, leagueSlug, discovered);
    return { categories: discovered, discoveredAt: Date.now(), isFallback: false };
  }
  return { ...cached, isFallback: false };
}

// ── League cache (slug -> displayName, needed by the API but not present in poe.ninja URLs) ──

const leagueDisplayNames = { poe1: new Map(), poe2: new Map() };

async function loadLeagues(gameKey) {
  const leagues = await ninjaApi.getLeagues(gameKey);
  leagueDisplayNames[gameKey] = new Map(leagues.map((l) => [l.slug, l.displayName]));
  return leagues;
}

function resolveDisplayName(gameKey, leagueSlug) {
  return leagueDisplayNames[gameKey].get(leagueSlug) || leagueSlug;
}

// ── Main window ────────────────────────────

// Base content size at 100% UI scale — also used by the set-ui-scale IPC handler below so the
// window itself grows/shrinks with the zoom factor instead of just clipping scaled-up content.
const BASE_WINDOW_WIDTH = 720;
const BASE_WINDOW_HEIGHT = 720;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: BASE_WINDOW_WIDTH,
    height: BASE_WINDOW_HEIGHT,
    minWidth: 560,
    minHeight: 500,
    titleBarStyle: 'default',
    // The packaged app gets its taskbar/dock icon for free from the exe's embedded resource
    // (set via package.json's build.win/mac/linux.icon) — this option is what makes dev mode
    // (`npx electron . --dev`, unpackaged) show the same icon instead of Electron's default.
    icon: path.join(__dirname, 'assets/ninja-quick-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Gated on !app.isPackaged (not just the --dev flag) so a stray argv flag can't open DevTools
  // in a shipped build.
  if (!app.isPackaged && process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Minimize to tray instead of quitting — a background price-check tool is only useful if
  // closing the window doesn't kill it. Only a real quit (tray menu, before-quit) bypasses this.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Null out the reference once the window is actually gone (real quit), not just hidden — a
  // background fetch loop (runFullFetch) can still be mid-flight during shutdown, and its next
  // sendProgress() call must be able to tell the window is gone rather than call methods on a
  // destroyed BrowserWindow object (which throws "Object has been destroyed").
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/tray-icon.png'));
  tray.setToolTip('ninja-quick');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show/Hide', click: toggleWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', toggleWindow);
}

function setHotkeyEnabled(enabled) {
  if (enabled === hotkeyRegistered) return hotkeyRegistered;
  if (enabled) {
    hotkeyRegistered = globalShortcut.register(HOTKEY, toggleWindow);
    if (!hotkeyRegistered) console.error(`Failed to register global hotkey ${HOTKEY} — likely already in use by another app`);
  } else {
    globalShortcut.unregister(HOTKEY);
    hotkeyRegistered = false;
  }
  return hotkeyRegistered;
}

// A second launch attempt (user double-clicks the exe again) should just surface the existing
// window instead of starting a competing process — requestSingleInstanceLock() above already
// stopped the second process from getting this far in itself, this handles the first process's
// side of that handoff.
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// ── Auto-update ────────────────────────────
//
// Only relevant for a packaged build — a dev run has no update feed to check and isPackaged
// gating keeps `npx electron . --dev` from ever hitting the network for this. Unsigned builds:
// this works on Windows/Linux out of the box; macOS auto-update is blocked by Gatekeeper until
// the app is code-signed & notarized (see README's signing section) — checkForUpdates() there
// will just fail silently, which is fine, not a bug.
//
// Re-checking every 4 hours means a long-running instance (left open for days) still notices a
// new release without needing a restart — a one-time startup check alone can't do that. Once an
// update has actually been downloaded, the user already has a restart prompt (see the
// 'update-downloaded' toast wiring in renderer.js), so there's no reason to keep re-checking/
// re-downloading until they act on it or relaunch.
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
let updateReadyToInstall = false;

function initAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', () => {
    updateReadyToInstall = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded');
    }
  });
  autoUpdater.on('error', (err) => {
    console.error('autoUpdater error:', err.message);
  });

  const check = () => autoUpdater.checkForUpdates().catch((err) => console.error('checkForUpdates failed:', err.message));
  check();
  setInterval(() => {
    if (!updateReadyToInstall) check();
  }, UPDATE_CHECK_INTERVAL_MS);
}

ipcMain.handle('restart-to-update', () => {
  autoUpdater.quitAndInstall();
});

// ── Init ───────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();
  initAutoUpdater();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // With minimize-to-tray, this normally only fires on a real quit (mainWindow.destroy() or
  // platform-specific teardown) — window "close" no longer reaches here, it's intercepted above.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow.show();
});

// ── IPC Handlers ───────────────────────────

ipcMain.handle('get-cached-data', (_event, gameKey, leagueSlug) => {
  if (!leagueSlug) return {};
  return readCache(gameKey, leagueSlug);
});

ipcMain.handle('get-leagues', async (_event, gameKey) => {
  try {
    return await loadLeagues(gameKey);
  } catch (err) {
    console.error(`get-leagues(${gameKey}) failed:`, err.message);
    return [];
  }
});

ipcMain.handle('get-live-categories', async (_event, gameKey, leagueSlug) => {
  if (!leagueSlug) return { categories: [], discoveredAt: null, isFallback: true };
  try {
    return await getLiveCategories(gameKey, leagueSlug);
  } catch (err) {
    console.error(`get-live-categories(${gameKey}/${leagueSlug}) failed:`, err.message);
    return { categories: getCategories(gameKey).map((slug) => ({ slug, label: null })), discoveredAt: null, isFallback: true };
  }
});

// One in-flight full-refresh promise per game+league — a second start-fetch request for the
// same game+league (manual refresh, the 12h timer) joins the existing run instead of racing it.
// Keying by league (not just game) also means switching leagues starts its own independent fetch
// instead of silently reusing — and discarding — whatever the previous league's fetch was doing.
const fetchLocks = {};

ipcMain.handle('start-fetch', (_event, gameKey, leagueSlug) => {
  if (!leagueSlug) return Promise.resolve({ error: 'No league set' });
  const lockKey = `${gameKey}:${leagueSlug}`;
  if (fetchLocks[lockKey]) return fetchLocks[lockKey];

  const run = runFullFetch(gameKey, leagueSlug).finally(() => {
    fetchLocks[lockKey] = null;
  });
  fetchLocks[lockKey] = run;
  return run;
});

ipcMain.handle('fetch-category', async (_event, gameKey, leagueSlug, cat) => {
  try {
    const league = resolveDisplayName(gameKey, leagueSlug);
    const items = await ninjaApi.fetchCategory(gameKey, league, cat);
    writeCategoryToCache(gameKey, leagueSlug, cat, items);
    return { success: true, count: items.length };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https:\/\/poe\.ninja\//.test(url)) {
    shell.openExternal(url);
  }
});

// Companion to the renderer's webFrame.setZoomFactor (preload.js) — a page zoom alone scales
// content but not the window, so anything past 100% would just clip against the fixed 720x720
// frame. Resizing the window's content area by the same factor is what actually makes "change
// scale" mean "fit all" rather than "scale and clip."
ipcMain.handle('set-ui-scale', (event, factor) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || typeof factor !== 'number' || factor <= 0) return null;
  win.setContentSize(Math.round(BASE_WINDOW_WIDTH * factor), Math.round(BASE_WINDOW_HEIGHT * factor));
  return win.getContentSize();
});

// Settings → "Clear cache". Reuses CACHE_DIR/ensureCacheDir (the package.json `clean-cache` script
// duplicates this path standalone since it runs outside Electron with no `app` access — this is
// the one place the running app itself can delete its own cache).
ipcMain.handle('clear-cache', () => {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      for (const file of fs.readdirSync(CACHE_DIR)) {
        // recursive:true in case the cache layout ever grows a subdirectory — force:true alone
        // only suppresses "already gone" errors, not a real lock (e.g. AV scanning a freshly
        // written file, or a background fetch still writing to it).
        fs.rmSync(path.join(CACHE_DIR, file), { recursive: true, force: true });
      }
    }
    ensureCacheDir();
  } catch (err) {
    throw new Error(`Failed to clear cache: ${err.message}`);
  }
});

// The renderer owns all preference persistence (localStorage) — it tells main.js what to
// register on startup and whenever the user flips the setting, rather than main.js keeping its
// own separate settings store.
ipcMain.handle('set-hotkey-enabled', (_event, enabled) => {
  return setHotkeyEnabled(!!enabled);
});

// ── Data Fetching ──────────────────────────

async function runFullFetch(gameKey, leagueSlug) {
  const league = resolveDisplayName(gameKey, leagueSlug);
  // Live-discovered list (falls back to the static one) — a newly-added category should actually
  // get its data fetched, not just show up as a sidebar entry with nothing behind it.
  const { categories: liveCategories } = await getLiveCategories(gameKey, leagueSlug);
  const categories = liveCategories.map((c) => c.slug);
  const staggerMs = Math.max(MIN_STAGGER_MS, FULL_REFRESH_SPREAD_MS / categories.length);

  try {
    const rates = await ninjaApi.getExchangeRates(gameKey, league);
    writeRatesToCache(gameKey, leagueSlug, rates);
  } catch (err) {
    console.error(`getExchangeRates failed for ${gameKey}/${league}:`, err.message);
  }

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    try {
      const items = await ninjaApi.fetchCategory(gameKey, league, cat);
      writeCategoryToCache(gameKey, leagueSlug, cat, items);
      sendProgress(gameKey, leagueSlug, cat, i + 1, categories.length, `ok (${items.length} items)`);
    } catch (err) {
      console.error(`fetchCategory error ${gameKey}/${cat}:`, err.message);
      sendProgress(gameKey, leagueSlug, cat, i + 1, categories.length, err.message);
    }

    if (i < categories.length - 1) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
  }

  return { success: true, categories: categories.length };
}

// ── Event helpers ──────────────────────────

function sendProgress(gameKey, leagueSlug, category, current, total, status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('fetch-progress', { gameKey, leagueSlug, category, current, total, status });
}
