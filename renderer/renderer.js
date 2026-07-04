// ════════════════════════════════════════════
// ninja-quick — Renderer Process
// Pure browser APIs + IPC via window.ninjaApi
// ════════════════════════════════════════════

// ── State ───────────────────────────────────

let currentGame = 'poe2';       // 'poe1' | 'poe2' — POE2 is the default/priority game
let detectedLeagues = { poe1: [], poe2: [] };   // [{ slug, displayName, hardcore, indexed }]
let currentLeague = { poe1: '', poe2: '' };     // stores the league SLUG
// { categorySlug: { items: [{name,value,changePercent,icon,amount,unit,trend}], fetchedAt },
//   __meta: { rates: {primary, rates}, updatedAt } } — scoped to whichever league is
// currentLeague[game] at the time it was loaded; always reload after switching leagues.
let cachedData = {};
let fetching = { poe1: false, poe2: false };    // track in-progress fetches
let categoryRefreshing = {};     // categorySlug -> true while a per-category refresh is in flight
let refreshIntervalMs = 12 * 60 * 60 * 1000;    // default 12 hours (user-configurable)
let zoomFactor = 1;              // UI scale (Settings) — see applyZoomFactor
let currentTheme = 'ledger';     // 'ledger' | 'classic' — see setTheme
let categoryScope = null;        // a real category slug, a super-category scope ('__super:<key>'), or null
let displayUnit = 'Auto';        // 'Auto' | 'Chaos' | 'Divine' | 'Exalted' — manual currency override

// favorites[game]: Set of "category::name" keys. alerts[game]: [{category,name,threshold,direction,unit,armed}].
let favorites = { poe1: new Set(), poe2: new Set() };
let alerts = { poe1: [], poe2: [] };
let notificationsEnabled = true;
let settingsOpen = false;
let liveCategories = { poe1: [], poe2: [] }; // [{ slug, label }] — live-scraped, see loadLiveCategories

// activeLeagues: [{ game, leagueSlug }] — which game+league combos the background refresh timer
// (startRefreshTimer) actually touches. Separate from currentLeague/currentGame (what's on
// screen): viewing a league is always on-demand regardless of whether it's active. Defaults to
// POE2 · Runes of Aldur (SC) the first time detectLeagues() resolves POE2's league list, unless
// the user has already saved an explicit setting (see applyDefaultActiveLeagues).
let activeLeagues = [];
let activeLeaguesInitialized = false; // true once loaded from storage OR a default has been applied

// Page-zoom presets (see preload.js's setZoomFactor / webFrame.setZoomFactor) — scales text,
// layout, and icons together as one true zoom, so the UI "fits" at every level rather than
// just growing text past its containers.
const ZOOM_OPTIONS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

function applyZoomFactor(factor) {
  zoomFactor = factor;
  window.ninjaApi.setZoomFactor(factor);
}

// Themes — each entry here + a matching :root[data-theme="..."] block in styles.css is all a new
// theme needs. Colors themselves are never duplicated into JS (see applyThemeColors below) — the
// CSS blocks are the only source of truth, read via getComputedStyle at the moment they're needed.
const THEMES = [
  { key: 'ledger', label: 'Ledger (default)' },
  { key: 'classic', label: 'Classic' },
];
const THEME_KEYS = new Set(THEMES.map((t) => t.key));

function setTheme(theme) {
  // Object.hasOwn-equivalent check via a real Set, not a plain-object truthiness lookup — the
  // latter is spoofable by inherited Object.prototype keys like "constructor"/"toString".
  currentTheme = THEME_KEYS.has(theme) ? theme : 'ledger';
  document.documentElement.dataset.theme = currentTheme;
  localStorage.setItem('ninja_theme', currentTheme);
  applyThemeColors(currentGame); // re-applies accent/glow/divider for the new theme's colors
}

const REFRESH_INTERVAL_OPTIONS = [
  { label: '15 minutes', ms: 15 * 60 * 1000 },
  { label: '30 minutes', ms: 30 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '3 hours', ms: 3 * 60 * 60 * 1000 },
  { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { label: '12 hours', ms: 12 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
];

/** Category entries in cachedData, skipping reserved keys. */
function categoryEntries(gameData) {
  return Object.entries(gameData).filter(([key]) => key !== '__meta' && key !== '__categories');
}

/** Reload cachedData[game] for whichever league is currently selected for that game. Cache is
 * scoped per game+league on disk, so this must be re-called any time the selected league changes
 * (or when a background fetch event might have updated the currently-viewed league's data).
 * Also refreshes the sidebar's item counts if `game` is the one currently on screen — centralizing
 * that here means every cache-reload site (fetch progress, manual refresh, background timer, a
 * single category refresh) keeps the sidebar accurate without each needing its own call. */
async function reloadCache(game) {
  cachedData[game] = await window.ninjaApi.getCachedData(game, currentLeague[game]);
  if (currentGame === game) renderCategorySidebar();
  return cachedData[game];
}

function favoriteKey(category, name) {
  return `${category}::${name}`;
}

function loadFavorites(game) {
  try {
    const raw = JSON.parse(localStorage.getItem(`ninja_favorites_${game}`) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(game) {
  localStorage.setItem(`ninja_favorites_${game}`, JSON.stringify([...favorites[game]]));
}

function toggleFavorite(game, category, name) {
  const key = favoriteKey(category, name);
  if (favorites[game].has(key)) favorites[game].delete(key);
  else favorites[game].add(key);
  saveFavorites(game);
}

/** Resolve the current game's favorited keys into live item data, skipping any favorite whose
 * category/name no longer exists in the cache (e.g. after an upstream category rename) rather
 * than showing it as broken. */
function getFavoriteItems(game) {
  const gameData = cachedData[game] || {};
  const result = [];
  for (const key of favorites[game]) {
    const sep = key.indexOf('::');
    const category = key.slice(0, sep);
    const name = key.slice(sep + 2);
    const entry = gameData[category];
    const item = entry && Array.isArray(entry.items) && entry.items.find((i) => i.name === name);
    if (item) result.push({ item, category });
  }
  return result;
}

// ── Super categories ────────────────────────
//
// A super category groups several real categories under one sidebar box + one merged results
// view. Adding another one later is just another entry here — `match` decides which live
// category slugs belong to it; nothing else needs to change. "All Uniques" groups every category
// whose slug is prefixed `unique-` (the reliable signal — live-scraped *labels* can drift from
// their slug, e.g. poe.ninja relabeling `breach-catalyst` as "Catalysts", so slug-prefix matching
// is what's robust here, not label text).
const SUPER_CATEGORIES = [
  { key: 'all-uniques', label: 'All Uniques', match: (slug) => slug.startsWith('unique-') },
];

const SUPER_SCOPE_PREFIX = '__super:';

function superCategoryForScope(scope) {
  if (typeof scope !== 'string' || !scope.startsWith(SUPER_SCOPE_PREFIX)) return null;
  const key = scope.slice(SUPER_SCOPE_PREFIX.length);
  return SUPER_CATEGORIES.find((sc) => sc.key === key) || null;
}

/** Flattens every item across every live category matching a super category's `match()` into
 * one [{item, category}] list, filtered by the same substring query renderResults already uses —
 * modeled directly on getFavoriteItems above, which does the same cross-category flattening. */
function getSuperCategoryItems(superCat, query) {
  const gameData = cachedData[currentGame] || {};
  const result = [];
  for (const [category, entry] of categoryEntries(gameData)) {
    if (!superCat.match(category) || !entry || !Array.isArray(entry.items)) continue;
    for (const item of entry.items) {
      if (!query || item.name.toLowerCase().includes(query)) result.push({ item, category });
    }
  }
  return result;
}

// ── Active Game+Leagues ─────────────────────
//
// Distinct from favorites/alerts (which are per-game, not per-league) — a game+league combo is
// the unit background refresh operates on, so it's stored as a flat list of { game, leagueSlug }.

/** Returns null (not []) when nothing has ever been saved, so callers can tell "user explicitly
 * deactivated everything" apart from "never configured — apply the default". */
function loadActiveLeaguesRaw() {
  try {
    const raw = localStorage.getItem('ninja_active_leagues');
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a) => a && a.game && a.leagueSlug) : null;
  } catch {
    return null;
  }
}

function saveActiveLeagues() {
  localStorage.setItem('ninja_active_leagues', JSON.stringify(activeLeagues));
}

function isLeagueActive(game, leagueSlug) {
  return activeLeagues.some((a) => a.game === game && a.leagueSlug === leagueSlug);
}

function setLeagueActive(game, leagueSlug, active) {
  if (active) {
    if (!isLeagueActive(game, leagueSlug)) activeLeagues.push({ game, leagueSlug });
  } else {
    activeLeagues = activeLeagues.filter((a) => !(a.game === game && a.leagueSlug === leagueSlug));
  }
  saveActiveLeagues();
}

/** Called once, right after detectLeagues() resolves POE2's league list, if the user has never
 * saved an explicit active-leagues setting. Picks the softcore temp league (not Standard/HC) —
 * poe.ninja's economyLeagues list puts the current temp league first, which is "Runes of Aldur"
 * as of this writing, but resolving by the `hardcore` flag rather than hardcoding a slug means
 * this survives poe.ninja renaming/rotating leagues (see docs/api-endpoints.md). */
function applyDefaultActiveLeagues(poe2Leagues) {
  if (activeLeaguesInitialized || poe2Leagues.length === 0) return;
  const defaultLeague = poe2Leagues.find((l) => !l.hardcore) || poe2Leagues[0];
  activeLeagues = [{ game: 'poe2', leagueSlug: defaultLeague.slug }];
  activeLeaguesInitialized = true;
  saveActiveLeagues();
}

/** Fetch any active game+league that has no cached data yet — the background timer only fires on
 * its interval, so a first launch needs its own priming pass. Uses getCachedData directly (not
 * cachedData[game], which only reflects whichever league is currently on screen) since an active
 * league and the viewed league are independent. */
async function primeActiveLeagues() {
  for (const { game, leagueSlug } of activeLeagues) {
    try {
      const existing = await window.ninjaApi.getCachedData(game, leagueSlug);
      if (categoryEntries(existing).length > 0) continue;
      await window.ninjaApi.startFetch(game, leagueSlug);
    } catch (err) {
      console.error(`primeActiveLeagues(${game}/${leagueSlug}) failed:`, err);
    }
    if (currentGame === game && currentLeague[game] === leagueSlug) {
      await reloadCache(game);
      renderForQuery(searchInput.value.trim().toLowerCase());
    }
  }
}

function loadAlerts(game) {
  try {
    const raw = JSON.parse(localStorage.getItem(`ninja_alerts_${game}`) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveAlerts(game) {
  localStorage.setItem(`ninja_alerts_${game}`, JSON.stringify(alerts[game]));
}

function findAlert(game, category, name) {
  return alerts[game].find((a) => a.category === category && a.name === name);
}

/**
 * A minimal custom prompt modal. Electron's renderer does NOT support the native
 * `window.prompt()` (it throws "prompt() is not supported.") — this is a small in-page
 * replacement with the same call shape (returns the entered string, or null if cancelled),
 * so the rest of the app can use it exactly like a native prompt would have worked.
 */
function showPromptModal(message, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <p class="modal-message"></p>
        <input type="text" class="modal-input" />
        <div class="modal-actions">
          <button class="modal-cancel">Cancel</button>
          <button class="modal-ok">OK</button>
        </div>
      </div>
    `;
    overlay.querySelector('.modal-message').textContent = message;
    const input = overlay.querySelector('.modal-input');
    input.value = defaultValue || '';

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('.modal-ok').addEventListener('click', () => finish(input.value));
    overlay.querySelector('.modal-cancel').addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null); // click outside the box cancels
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value);
      if (e.key === 'Escape') finish(null);
    });

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

/** A minimal custom confirm modal — sibling to showPromptModal above, for the same reason
 * (Electron's renderer has no native window.confirm() either). Resolves true/false. */
function showConfirmModal(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <p class="modal-message"></p>
        <div class="modal-actions">
          <button class="modal-cancel">Cancel</button>
          <button class="modal-ok">Yes</button>
        </div>
      </div>
    `;
    overlay.querySelector('.modal-message').textContent = message;

    // Escape has to bind on `document` (there's no input field to scope it to like
    // showPromptModal does) — finish() itself always detaches it, on every dismissal path, not
    // just Escape, so it can never outlive this modal.
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
    };
    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('.modal-ok').addEventListener('click', () => finish(true));
    overlay.querySelector('.modal-cancel').addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
  });
}

/** Bell-icon click handler: prompts for a threshold, infers direction from the current value,
 * blank input removes the alert. A single minimal-UI interaction rather than a dedicated
 * alerts panel (see showPromptModal — Electron has no native window.prompt()). */
async function promptAlert(game, category, item) {
  const existing = findAlert(game, category, item.name);
  const label = existing
    ? `Update or remove the alert for ${item.name} (currently ${item.value}). Enter a new threshold in ${item.unit}, or leave blank to remove:`
    : `Set an alert for ${item.name} (currently ${item.value}). Enter a threshold value in ${item.unit}:`;
  const input = await showPromptModal(label, existing ? String(existing.threshold) : '');
  if (input === null) return; // cancelled

  const trimmed = input.trim();
  if (trimmed === '') {
    if (existing) {
      alerts[game] = alerts[game].filter((a) => a !== existing);
      saveAlerts(game);
      renderForQuery(searchInput.value.trim().toLowerCase());
    }
    return;
  }

  const threshold = parseFloat(trimmed);
  if (Number.isNaN(threshold)) return;
  const direction = item.amount !== null && threshold < item.amount ? 'below' : 'above';

  if (existing) {
    // Re-editing an alert via the bell icon is an explicit re-affirmation of interest in it, so
    // also re-enable it if a prior "Reset price alerts" had turned it off.
    Object.assign(existing, { threshold, direction, unit: item.unit, armed: true, enabled: true });
  } else {
    alerts[game].push({ category, name: item.name, threshold, direction, unit: item.unit, armed: true, enabled: true });
  }
  saveAlerts(game);
  renderForQuery(searchInput.value.trim().toLowerCase());
}

/**
 * Check every active alert for a game against freshly loaded cache data and fire a native OS
 * notification on a crossing. `armed` prevents renotifying every refresh cycle once already past
 * the threshold; it re-arms once the value moves back to the other side (no hysteresis band —
 * an acceptable simplification, a value oscillating right at the threshold could renotify often).
 */
function checkAlerts(game, gameData) {
  if (!notificationsEnabled || alerts[game].length === 0) return;
  let changed = false;

  for (const alert of alerts[game]) {
    if (alert.enabled === false) continue; // disabled via "Reset price alerts"
    const entry = gameData[alert.category];
    const item = entry && Array.isArray(entry.items) && entry.items.find((i) => i.name === alert.name);
    if (!item || item.amount === null || item.unit !== alert.unit) continue;

    const crossed = alert.direction === 'below' ? item.amount <= alert.threshold : item.amount >= alert.threshold;
    if (crossed && alert.armed) {
      new Notification(`ninja-quick — ${alert.name}`, {
        body: `Now ${item.value} (alert: ${alert.direction} ${alert.threshold} ${alert.unit})`,
      });
      alert.armed = false;
      changed = true;
    } else if (!crossed && !alert.armed) {
      alert.armed = true;
      changed = true;
    }
  }

  if (changed) saveAlerts(game);
}

/**
 * Fuzzy fallback for when the exact substring search finds nothing — typo tolerance, not a
 * search rewrite. Builds a fresh Fuse index over the currently-visible categories on demand
 * (only runs on the zero-results path, so the cost of rebuilding each time is negligible).
 */
function fuzzySearchAcrossCategories(categories, query) {
  if (!window.Fuse) return [];
  const flat = [];
  for (const [category, entry] of categories) {
    const items = entry && Array.isArray(entry.items) ? entry.items : [];
    for (const item of items) flat.push({ item, category });
  }
  if (flat.length === 0) return [];

  const fuse = new window.Fuse(flat, { keys: ['item.name'], threshold: 0.35, minMatchCharLength: 2 });
  return fuse.search(query, { limit: 20 }).map((r) => r.item);
}

function getRecentSearches() {
  try {
    const raw = JSON.parse(localStorage.getItem('ninja_recent_searches') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function pushRecentSearch(query) {
  const recent = getRecentSearches().filter((q) => q !== query);
  recent.unshift(query);
  localStorage.setItem('ninja_recent_searches', JSON.stringify(recent.slice(0, 8)));
}

/** Builds one item row — shared by search results and the favorites section so the two can't
 * drift apart. `query` is optional; when empty, the name is shown plain (no highlight). */
function buildItemRow(item, category, query, rates) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.itemName = item.name;
  row.dataset.category = category;

  const displayName = query ? highlightText(item.name, query) : escapeHtml(item.name);
  const displayValue = formatDisplayValue(item, rates);
  const changeClass = item.changePercent && (item.changePercent.startsWith('+') ? 'positive' : item.changePercent.startsWith('-') ? 'negative' : '');
  const sparkline = renderSparkline(item.trend);
  const isFavorite = favorites[currentGame].has(favoriteKey(category, item.name));
  const existingAlert = findAlert(currentGame, category, item.name);
  const hasAlert = !!existingAlert && existingAlert.enabled !== false;

  row.innerHTML = `
    <span class="item-name">${displayName}</span>
    ${sparkline}
    ${displayValue ? `<span class="item-value">${escapeHtml(displayValue)}</span>` : ''}
    ${item.changePercent ? `<span class="item-change ${changeClass}">${escapeHtml(item.changePercent)}</span>` : ''}
    <button class="item-favorite ${isFavorite ? 'active' : ''}" title="Pin to favorites">${isFavorite ? '★' : '☆'}</button>
    <button class="item-alert ${hasAlert ? 'active' : ''}" title="Set a price alert">🔔</button>
    <button class="item-copy" title="Copy item name">⧉</button>
  `;

  row.addEventListener('click', () => openInPoeNinjaCategory(category, item.name));

  row.querySelector('.item-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    copyItemName(item.name, e.currentTarget);
  });

  row.querySelector('.item-favorite').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(currentGame, category, item.name);
    renderForQuery(searchInput.value.trim().toLowerCase());
  });

  row.querySelector('.item-alert').addEventListener('click', (e) => {
    e.stopPropagation();
    promptAlert(currentGame, category, item);
  });

  return row;
}

// Collapse state persists across re-renders (query changes, show-more clicks, favorite toggles)
// instead of living in a closure that resets to `false` every time — otherwise collapsing one
// category and then interacting with a *different* one (e.g. clicking its "show more") silently
// re-expanded everything, since every render rebuilt every header with a fresh `collapsed = false`.
let categoryCollapsed = {};

// Global price-sort state, shared by every category — sorting "Omens" descending immediately
// shows every other category (e.g. "Soul Cores") as descending too, rather than each category
// remembering its own independent sort mode. In-memory only, not persisted (matches
// categoryCollapsed's lifetime above).
let globalSortMode = 'none'; // 'none' | 'desc' | 'asc'
const SORT_CYCLE = ['none', 'desc', 'asc'];

function nextSortMode(mode) {
  return SORT_CYCLE[(SORT_CYCLE.indexOf(mode || 'none') + 1) % SORT_CYCLE.length];
}

/** Sorts by numeric amount per the global sort mode. `getAmount` defaults to reading `.amount`
 * directly (plain items) but accepts an accessor so the same function also sorts the merged
 * {item, category} pairs a super category's flat list uses (see getSuperCategoryItems). Items
 * with no numeric value always sort last regardless of direction. Returns a new array — never
 * mutates the source. */
function sortByAmount(items, mode, getAmount = (x) => x.amount) {
  if (mode !== 'desc' && mode !== 'asc') return items;
  return [...items].sort((a, b) => {
    const av = getAmount(a);
    const bv = getAmount(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return mode === 'desc' ? bv - av : av - bv;
  });
}

/** Builds a collapsible category-header + items wrapper, shared by all three list surfaces
 * (search results, the fuzzy "Similar matches" fallback, and the favorites section) so their
 * collapse/refresh behavior can't drift apart between call sites. `collapseKey` is the
 * categoryCollapsed lookup key (real category slug, or a pseudo-key like "__favorites"/"__fuzzy"
 * for sections that aren't a real category). `extraHeaderHtml` is inserted between the name and
 * the count (used for the per-category refresh button + "updated X ago" label). */
function buildCollapsibleSection(collapseKey, title, count, extraHeaderHtml, populate) {
  const section = document.createElement('div');
  section.className = 'category-section';

  const header = document.createElement('div');
  header.className = 'category-header';
  header.innerHTML = `
    <span class="category-chevron">▼</span>
    <span class="category-name">${title}</span>
    ${extraHeaderHtml || ''}
    <span class="category-count">${count}</span>
  `;

  const itemsDiv = document.createElement('div');
  itemsDiv.className = 'category-items';

  if (categoryCollapsed[collapseKey]) {
    itemsDiv.classList.add('collapsed');
    header.querySelector('.category-chevron').classList.add('collapsed');
  }
  header.addEventListener('click', () => {
    categoryCollapsed[collapseKey] = !categoryCollapsed[collapseKey];
    itemsDiv.classList.toggle('collapsed', categoryCollapsed[collapseKey]);
    header.querySelector('.category-chevron').classList.toggle('collapsed', categoryCollapsed[collapseKey]);
  });

  populate(itemsDiv, header);

  section.appendChild(header);
  section.appendChild(itemsDiv);
  return section;
}

function refreshButtonHtml(category, labelOverride) {
  const label = labelOverride || formatCategoryName(category);
  return `<button class="category-refresh" title="Refresh ${escapeHtml(label)} now">⟳</button>`;
}

/** Sibling to wireRefreshButton for a super category's group refresh — refreshes every member
 * slug in one batched pass (refreshCategoriesNow) instead of one category. */
function wireGroupRefreshButton(header, slugs) {
  const btn = header.querySelector('.category-refresh');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    refreshCategoriesNow(slugs, btn);
  });
}

function sortButtonHtml() {
  const icon = globalSortMode === 'desc' ? '▼' : globalSortMode === 'asc' ? '▲' : '⇅';
  const label = globalSortMode === 'desc' ? 'Sorted highest first' : globalSortMode === 'asc' ? 'Sorted lowest first' : 'Sort by price';
  return `<button class="category-sort" title="${escapeHtml(label)} (applies to every category) — click to change">${icon}</button>`;
}

/** `onToggle` re-renders whatever's showing (e.g. renderResults(query)) after the sort mode
 * changes — the button itself only owns the state cycle, not the redraw. Sort mode is global, so
 * this affects every category's display, not just the one the click came from. */
function wireSortButton(header, onToggle) {
  const btn = header.querySelector('.category-sort');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    globalSortMode = nextSortMode(globalSortMode);
    onToggle();
  });
}

function wireRefreshButton(header, category) {
  const btn = header.querySelector('.category-refresh');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    refreshCategoryNow(category, btn);
  });
}

// ── DOM refs ────────────────────────────────

const btnPoe1        = document.getElementById('btn-poe1');
const btnPoe2        = document.getElementById('btn-poe2');
const activeText     = document.getElementById('active-game-text');
const leagueSelect   = document.getElementById('league-select');
const unitSelect     = document.getElementById('unit-select');
const searchInput    = document.getElementById('search-input');
const resultsContainer = document.getElementById('results-container');
const dataStatus     = document.getElementById('data-status');
const nextRefreshEl  = document.getElementById('next-refresh');
const btnRefresh     = document.getElementById('btn-refresh');
const btnSettings    = document.getElementById('btn-settings');
const categorySidebar = document.getElementById('category-sidebar');

// ── Category Sidebar ────────────────────────
// Mirrors poe.ninja's own economy-page nav. Live-scraped (see lib/category-discovery.js via the
// get-live-categories IPC) rather than a hardcoded list — PoE leagues add/remove categories every
// few months. main.js handles caching/freshness (24h TTL) and falls back to a static list if
// poe.ninja is unreachable, so this call is cheap on every repeat after the first per league.

async function loadLiveCategories(game) {
  const league = currentLeague[game];
  if (!league) return;
  if (currentGame === game) categorySidebar.innerHTML = `<div class="sidebar-loading">Loading categories…</div>`;
  try {
    const result = await window.ninjaApi.getLiveCategories(game, league);
    liveCategories[game] = Array.isArray(result.categories) ? result.categories : [];
  } catch (err) {
    console.error(`loadLiveCategories(${game}) failed:`, err);
    liveCategories[game] = [];
  }
  if (currentGame === game) renderCategorySidebar();
}

function buildSidebarItemRow(cat, gameData) {
  const entry = gameData[cat.slug];
  const count = entry && Array.isArray(entry.items) ? entry.items.length : null;
  const label = cat.label || formatCategoryName(cat.slug);
  const needsRefresh = count === null || count === 0;

  const row = document.createElement('div');
  row.className = `sidebar-item ${categoryScope === cat.slug ? 'active' : ''} ${count === null ? 'unloaded' : ''}`;
  row.innerHTML = `
    <span class="sidebar-item-label">${escapeHtml(label)}</span>
    <span class="sidebar-item-count">${count === null ? '' : count}</span>
    ${needsRefresh ? refreshButtonHtml(cat.slug) : ''}
  `;
  row.addEventListener('click', () => selectSidebarCategory(cat.slug));
  if (needsRefresh) wireRefreshButton(row, cat.slug);
  return row;
}

function buildSuperCategoryGroup(superCat, memberCats, gameData) {
  const scope = SUPER_SCOPE_PREFIX + superCat.key;
  const group = document.createElement('div');
  group.className = 'sidebar-supercategory-group';

  const header = document.createElement('div');
  header.className = `sidebar-supercategory-header ${categoryScope === scope ? 'active' : ''}`;
  header.innerHTML = `
    <span class="sidebar-item-label">${escapeHtml(superCat.label)}</span>
    ${refreshButtonHtml(superCat.key, superCat.label)}
  `;
  header.addEventListener('click', () => selectSuperCategory(superCat.key));
  wireGroupRefreshButton(header, memberCats.map((c) => c.slug));
  group.appendChild(header);

  for (const cat of memberCats) group.appendChild(buildSidebarItemRow(cat, gameData));
  return group;
}

function renderCategorySidebar() {
  const gameData = cachedData[currentGame] || {};
  const cats = liveCategories[currentGame] || [];
  categorySidebar.innerHTML = '';

  if (cats.length === 0) {
    categorySidebar.innerHTML = `<div class="sidebar-loading">Loading categories…</div>`;
    return;
  }

  const renderedSuperKeys = new Set();

  for (const cat of cats) {
    const superCat = SUPER_CATEGORIES.find((sc) => sc.match(cat.slug));
    if (superCat) {
      if (renderedSuperKeys.has(superCat.key)) continue; // already rendered with the group below
      renderedSuperKeys.add(superCat.key);
      const memberCats = cats.filter((c) => superCat.match(c.slug));
      categorySidebar.appendChild(buildSuperCategoryGroup(superCat, memberCats, gameData));
      continue;
    }
    categorySidebar.appendChild(buildSidebarItemRow(cat, gameData));
  }
}

/** Clicking the "All Uniques"-style group header selects the merged super-category view
 * (renderResults handles the '__super:' scope specially). Deliberately does NOT auto-fetch
 * uncached member categories the way selectSidebarCategory does for a single category — that's
 * what the group's own refresh icon is for; a plain click shouldn't surprise-trigger fetching
 * every member category at once. */
function selectSuperCategory(key) {
  const scope = SUPER_SCOPE_PREFIX + key;
  categoryScope = categoryScope === scope ? null : scope;
  searchInput.value = '';
  const superCat = SUPER_CATEGORIES.find((sc) => sc.key === key);
  searchInput.placeholder = categoryScope
    ? `${superCat.label} — showing all items…`
    : `Search ${currentGame === 'poe1' ? 'POE 1' : 'POE 2'} items, currency, uniques…`;
  renderCategorySidebar();
  renderResults('');
}

/** Clicking a sidebar category immediately shows its full item list (like poe.ninja's own nav),
 * fetching it first if it hasn't been loaded yet. Clicking the already-active category again
 * exits category scope back to the overview. */
async function selectSidebarCategory(slug) {
  if (categoryScope === slug) {
    categoryScope = null;
    searchInput.value = '';
    searchInput.placeholder = `Search ${currentGame === 'poe1' ? 'POE 1' : 'POE 2'} items, currency, uniques…`;
    renderCategorySidebar();
    renderForQuery('');
    return;
  }

  categoryScope = slug;
  searchInput.value = '';
  const label = (liveCategories[currentGame].find((c) => c.slug === slug) || {}).label || formatCategoryName(slug);
  searchInput.placeholder = `${label} — showing all items…`;
  renderCategorySidebar();

  const game = currentGame;
  const gameData = cachedData[game] || {};
  const entry = gameData[slug];
  if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) {
    const league = currentLeague[game];
    if (league) {
      dataStatus.textContent = `Fetching ${label}…`;
      try {
        await window.ninjaApi.fetchCategory(game, league, slug);
        await reloadCache(game); // refreshes the sidebar's item count internally when game is on screen
      } catch (err) {
        console.error(`selectSidebarCategory fetch ${slug} failed:`, err);
      }
    }
  }

  if (currentGame === game) renderResults('');
}

// ── Init ────────────────────────────────────

(async () => {
  // Restore last game from localStorage
  const savedGame = localStorage.getItem('ninja_game');
  if (savedGame) currentGame = savedGame;

  const savedInterval = parseInt(localStorage.getItem('ninja_refresh_ms'), 10);
  if (!isNaN(savedInterval) && savedInterval > 0) refreshIntervalMs = savedInterval;

  const savedZoom = parseFloat(localStorage.getItem('ninja_zoom_factor'));
  if (!isNaN(savedZoom) && ZOOM_OPTIONS.includes(savedZoom)) applyZoomFactor(savedZoom);

  // setTheme() also calls applyThemeColors(currentGame) here (currentGame is already resolved
  // above) — redundant with the full applyGameSwitch() call later in this init, but cheap and
  // keeps this one validation rule (THEME_KEYS.has(...)) in one place instead of duplicated.
  setTheme(localStorage.getItem('ninja_theme'));

  const savedUnit = localStorage.getItem('ninja_display_unit');
  if (savedUnit && ['Auto', 'Chaos', 'Divine', 'Exalted'].includes(savedUnit)) displayUnit = savedUnit;
  if (unitSelect) unitSelect.value = displayUnit;

  favorites.poe1 = loadFavorites('poe1');
  favorites.poe2 = loadFavorites('poe2');
  alerts.poe1 = loadAlerts('poe1');
  alerts.poe2 = loadAlerts('poe2');
  notificationsEnabled = localStorage.getItem('ninja_notifications_enabled') !== 'false';

  const savedActiveLeagues = loadActiveLeaguesRaw();
  if (savedActiveLeagues !== null) {
    activeLeagues = savedActiveLeagues;
    activeLeaguesInitialized = true;
  }
  // else: left uninitialized — applyDefaultActiveLeagues() sets it once detectLeagues() below
  // resolves POE2's league list (defaults to POE2 · Runes of Aldur SC).

  // Hotkey defaults OFF — auto-enabling a global shortcut without the user opting in could
  // silently steal a keybind another app already uses. Await + reconcile: registration can fail
  // (another app already holds it), and localStorage must reflect what actually happened, not
  // just what was requested — otherwise Settings can show "enabled" for a hotkey that isn't.
  const hotkeyEnabled = localStorage.getItem('ninja_hotkey_enabled') === 'true';
  if (hotkeyEnabled) {
    const actuallyEnabled = await window.ninjaApi.setHotkeyEnabled(true);
    if (!actuallyEnabled) localStorage.setItem('ninja_hotkey_enabled', 'false');
  }

  applyGameSwitch(currentGame);
  updateWindowTitle();

  // Best-effort initial league guess from localStorage — cache is scoped per game+league, so we
  // need a league to load before any network call. detectLeagues() below validates/corrects this
  // against the live league list and reloads cachedData again if it turns out to be stale.
  currentLeague.poe1 = localStorage.getItem('ninja_league_poe1') || '';
  currentLeague.poe2 = localStorage.getItem('ninja_league_poe2') || '';
  await reloadCache('poe1');
  await reloadCache('poe2');

  renderForQuery(searchInput.value.trim().toLowerCase());
  renderCategorySidebar();

  // Load the category sidebar for both games (best-effort against the guessed league; corrected
  // below if detectLeagues resolves a different one) and detect leagues / start background
  // fetches. None of this blocks the initial paint above.
  loadLiveCategories('poe1').catch((err) => console.error('loadLiveCategories(poe1) error:', err));
  loadLiveCategories('poe2').catch((err) => console.error('loadLiveCategories(poe2) error:', err));
  detectLeagues()
    .then(() => primeActiveLeagues())
    .catch(err => console.error('detectLeagues error:', err));

  window.ninjaApi.onFetchProgress(async (data) => {
    try {
      dataStatus.textContent = `${data.gameKey}: ${formatCategoryName(data.category)} (${data.current}/${data.total}) — ${data.status}`;

      // Reload cache for whichever league is CURRENTLY selected — a background fetch event may
      // be for a league the user has since switched away from (it writes to its own league-scoped
      // file and doesn't affect what should be displayed now).
      const freshCache = await reloadCache(data.gameKey);
      checkAlerts(data.gameKey, freshCache);

      // Re-render if currently viewing this game
      if (currentGame === data.gameKey) {
        renderForQuery(searchInput.value.trim().toLowerCase());
      }
    } catch (err) {
      console.error('Fetch progress handler error:', err);
    }
  });

  updateStatus();
  startRefreshTimer();
  searchInput.focus();

  if (window.ninjaApi.onUpdateDownloaded) {
    window.ninjaApi.onUpdateDownloaded(showUpdateToast);
  }
})();

/** A packaged build's autoUpdater downloads silently in the background; this is the only UI
 * surface telling the user an update is ready — without it, "restart to apply" would never happen
 * until the next natural app relaunch. */
function showUpdateToast() {
  if (document.querySelector('.update-toast')) return;
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.innerHTML = `<span>Update downloaded — restart to apply</span><button>Restart</button>`;
  toast.querySelector('button').addEventListener('click', () => window.ninjaApi.restartToUpdate());
  document.body.appendChild(toast);
}

/** Route to the right view for the current query — the single source of truth for what
 * "empty" (overview, or the active sidebar category's full list), "too short to search" and
 * "search" mean, used from every entry point. */
function renderForQuery(q) {
  if (q.length === 0) {
    if (categoryScope) renderResults('');
    else showOverview();
  } else if (q.length < 2) {
    clearResults();
  } else {
    renderResults(q);
  }
}

// ── Game Switcher ───────────────────────────

btnPoe1.addEventListener('click', () => switchGame('poe1'));
btnPoe2.addEventListener('click', () => switchGame('poe2'));

function switchGame(game) {
  currentGame = game;
  categoryScope = null;
  settingsOpen = false;
  localStorage.setItem('ninja_game', game);
  applyGameSwitch(game);
  updateWindowTitle();
  updateStatus();
  renderForQuery(searchInput.value.trim().toLowerCase());
  if (liveCategories[game].length === 0) loadLiveCategories(game).catch((err) => console.error('loadLiveCategories error:', err));
  else renderCategorySidebar();
}

/** Sets --accent/--glow and the tab-divider's colors for the given game, reading them straight
 * off the active theme's CSS custom properties (styles.css's :root[data-theme="..."] blocks) —
 * the only place these colors are defined. Split out from applyGameSwitch so a pure theme change
 * (setTheme) doesn't also pay for rebuilding the league dropdown/tabs/placeholder below. */
function applyThemeColors(game) {
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue(game === 'poe1' ? '--poe1-accent' : '--poe2-accent').trim();
  const glow = style.getPropertyValue(game === 'poe1' ? '--poe1-glow' : '--poe2-glow').trim();
  const dividerGlow = style.getPropertyValue(game === 'poe1' ? '--poe1-divider-glow' : '--poe2-divider-glow').trim();

  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--glow', glow);

  const divider = document.querySelector('.tab-divider');
  if (divider) {
    divider.style.background = accent;
    divider.style.boxShadow = `0 0 6px ${dividerGlow}`;
  }
}

function applyGameSwitch(game) {
  // Tabs
  btnPoe1.classList.toggle('active', game === 'poe1');
  btnPoe2.classList.toggle('active', game === 'poe2');

  // Active label — always visible, zero ambiguity
  const label = game === 'poe1' ? 'POE 1' : 'POE 2';
  activeText.textContent = `Current: ${label}`;

  applyThemeColors(game);

  // League selector dropdown
  updateLeagueSelector(game);

  // Update placeholder
  searchInput.placeholder = `Search ${label} items, currency, uniques…`;
}

function updateWindowTitle() {
  const label = currentGame === 'poe1' ? 'POE 1' : 'POE 2';
  const league = detectedLeagues[currentGame].find((l) => l.slug === currentLeague[currentGame]);
  document.title = `ninja-quick — ${label}${league ? ' · ' + league.displayName : ''}`;
}

// ── League Selector ───────────────────────

function updateLeagueSelector(game) {
  const leagues = detectedLeagues[game];
  const current = currentLeague[game] || (leagues.length > 0 ? leagues[0].slug : '');

  leagueSelect.innerHTML = '';
  if (leagues.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'Detecting…';
    leagueSelect.appendChild(opt);
    return;
  }

  const matchExists = leagues.some((l) => l.slug === current);
  for (const league of leagues) {
    const opt = document.createElement('option');
    opt.value = league.slug;
    opt.textContent = league.displayName;
    if (league.slug === current) opt.selected = true;
    leagueSelect.appendChild(opt);
  }

  // No option actually matched `current` (e.g. a stale/rotated-out league slug) — correct both
  // the dropdown and currentLeague to the first available league. Checking leagueSelect.value
  // here would NOT work: an unselected <select> defaults its own .value to the first option
  // regardless, so that check is always truthy even when nothing really matched.
  if (!matchExists) {
    currentLeague[game] = leagues[0].slug;
    leagueSelect.value = leagues[0].slug;
  }
}

if (unitSelect) {
  unitSelect.addEventListener('change', () => {
    displayUnit = unitSelect.value;
    localStorage.setItem('ninja_display_unit', displayUnit);
    renderForQuery(searchInput.value.trim().toLowerCase());
  });
}

leagueSelect.addEventListener('change', async () => {
  const selected = leagueSelect.value;
  if (selected === 'Detecting…') return;

  currentLeague[currentGame] = selected;
  localStorage.setItem(`ninja_league_${currentGame}`, selected);
  updateWindowTitle();

  const game = currentGame;

  // Load whatever's already cached for the newly selected league right away (may be empty, may
  // already hold data from a previous session) instead of continuing to show the old league's
  // data while the new league's fetch is in flight.
  await reloadCache(game);
  if (currentGame === game) renderForQuery(searchInput.value.trim().toLowerCase());
  loadLiveCategories(game).catch((err) => console.error('loadLiveCategories error:', err));

  fetching[game] = true;
  dataStatus.textContent = `Fetching ${game.toUpperCase()} (${selected})…`;
  try {
    await window.ninjaApi.startFetch(game, selected);
  } finally {
    fetching[game] = false;
    if (currentGame === game) updateStatus();
  }
});

// ── Search ──────────────────────────────────

let searchDebounceTimer;

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  settingsOpen = false; // typing implies the user wants to search, not configure
  const q = searchInput.value.trim().toLowerCase();

  if (q.length === 0) {
    if (categoryScope) renderResults('');
    else showOverview();
    return;
  }

  if (q.length < 2) {
    clearResults();
    return;
  }

  searchDebounceTimer = setTimeout(() => {
    renderResults(q);
  }, 300);
});

// Keyboard navigation in results
searchInput.addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;

  // Exclude rows inside a collapsed category — they're display:none, so focusing/opening one
  // would select something the user can't see. Rows with no `.category-items` ancestor at all
  // (the plain category-summary rows in the overview) are unaffected by collapse and stay included.
  const rows = Array.from(resultsContainer.querySelectorAll('.item-row')).filter((r) => {
    const wrapper = r.closest('.category-items');
    return !wrapper || !wrapper.classList.contains('collapsed');
  });
  if (!rows.length) return;

  e.preventDefault();

  // Find currently focused row
  const focused = document.querySelector('.item-row.focused');
  let idx = rows.indexOf(focused);

  if (e.key === 'ArrowDown') {
    idx = Math.min(idx + 1, rows.length - 1);
  } else if (e.key === 'ArrowUp') {
    idx = Math.max(idx - 1, 0);
  } else if (e.key === 'Enter' && focused) {
    const itemName = focused.dataset.itemName;
    const category = focused.dataset.category || 'currency';
    openInPoeNinjaCategory(category, itemName);
    return;
  }

  // Apply focus class
  rows.forEach((r) => r.classList.remove('focused'));
  if (idx >= 0 && idx < rows.length) {
    rows[idx].classList.add('focused');
    rows[idx].scrollIntoView({ block: 'nearest' });
  }
});

function openInPoeNinjaCategory(category, itemName) {
  // League detection may not have completed yet — building the URL with an empty league
  // segment produces a broken `…/economy//currency` link, so bail out instead.
  const league = currentLeague[currentGame];
  if (!league) return;

  const encoded = encodeURIComponent(itemName);
  const url = `https://poe.ninja/${currentGame}/economy/${league}/${category}?search=${encoded}`;
  window.ninjaApi.openExternal(url);
}

// ── Render Results ──────────────────────────

// Large categories (unique armours can be 800+ rows) are capped to keep the DOM light; a
// "show N more" row raises the limit for just that category. Reset whenever the query changes so
// a fresh search doesn't inherit a previous search's expanded limits. Keyboard Up/Down navigation
// needs no changes for this — it already just operates over whatever `.item-row`s exist in the DOM.
const RENDER_CAP = 150;
let categoryRenderLimit = {};
let lastRenderedQuery = null;

/** Appends a "Show N more…" row to itemsDiv if `total` exceeds `limit`, re-rendering via
 * `onExpand` when clicked. Shared by every capped list (search-result categories, favorites). */
function appendShowMoreIfNeeded(itemsDiv, limitKey, total, limit, onExpand) {
  if (total <= limit) return;
  const remaining = total - limit;
  const showMoreRow = document.createElement('button');
  showMoreRow.className = 'show-more-row';
  showMoreRow.textContent = `Show ${Math.min(remaining, RENDER_CAP)} more…`;
  showMoreRow.addEventListener('click', () => {
    categoryRenderLimit[limitKey] = limit + RENDER_CAP;
    onExpand();
  });
  itemsDiv.appendChild(showMoreRow);
}

function renderResults(query) {
  resultsContainer.innerHTML = '';
  // renderResults('') is also (ab)used to show a sidebar category's full listing (empty query
  // trivially matches every item) — that's not a "search" a user typed, so don't pollute recent
  // search history with a blank entry.
  if (query) pushRecentSearch(query);

  if (query !== lastRenderedQuery) {
    categoryRenderLimit = {};
    lastRenderedQuery = query;
  }

  const gameData = cachedData[currentGame] || {};
  const rates = gameData.__meta && gameData.__meta.rates;
  const allCategories = categoryEntries(gameData);
  const superCat = superCategoryForScope(categoryScope);
  const categories = superCat
    ? allCategories.filter(([cat]) => superCat.match(cat))
    : categoryScope
      ? allCategories.filter(([cat]) => cat === categoryScope)
      : allCategories;
  let totalMatches = 0;

  if (superCat) {
    // One merged, flat list across every member category (per your choice) — same
    // cross-category-flattening pattern getFavoriteItems/'__favorites' already uses, just sourced
    // from getSuperCategoryItems instead of the favorites set.
    const merged = sortByAmount(getSuperCategoryItems(superCat, query), globalSortMode, (pair) => pair.item.amount);
    totalMatches = merged.length;
    const limitKey = SUPER_SCOPE_PREFIX + superCat.key;
    const limit = categoryRenderLimit[limitKey] || RENDER_CAP;
    const memberSlugs = categories.map(([cat]) => cat);

    const section = buildCollapsibleSection(
      limitKey,
      superCat.label,
      merged.length,
      `${refreshButtonHtml(superCat.key, superCat.label)}${sortButtonHtml()}`,
      (itemsDiv, header) => {
        wireGroupRefreshButton(header, memberSlugs);
        wireSortButton(header, () => renderResults(query));
        merged.slice(0, limit).forEach(({ item, category }) => {
          itemsDiv.appendChild(buildItemRow(item, category, query, rates));
        });
        appendShowMoreIfNeeded(itemsDiv, limitKey, merged.length, limit, () => renderResults(query));
      }
    );
    resultsContainer.appendChild(section);
  } else {
    for (const [category, entry] of categories) {
      const items = entry && Array.isArray(entry.items) ? entry.items : [];
      if (items.length === 0) continue;

      let matches = items.filter((item) => item.name.toLowerCase().includes(query));
      if (matches.length === 0) continue;

      matches = sortByAmount(matches, globalSortMode);
      totalMatches += matches.length;

      const limit = categoryRenderLimit[category] || RENDER_CAP;
      const section = buildCollapsibleSection(
        category,
        formatCategoryName(category),
        matches.length,
        `<span class="category-updated">${escapeHtml(formatAgo(entry.fetchedAt))}</span>${refreshButtonHtml(category)}${sortButtonHtml()}`,
        (itemsDiv, header) => {
          wireRefreshButton(header, category);
          wireSortButton(header, () => renderResults(query));
          matches.slice(0, limit).forEach((item) => {
            itemsDiv.appendChild(buildItemRow(item, category, query, rates));
          });
          appendShowMoreIfNeeded(itemsDiv, category, matches.length, limit, () => renderResults(query));
        }
      );
      resultsContainer.appendChild(section);
    }
  }

  if (totalMatches === 0) {
    // Exact substring search found nothing — fall back to fuzzy matching (typo tolerance) rather
    // than immediately declaring "no results". Deliberately narrow: this is the ONLY place Fuse
    // is used, so the fast exact-match path above (and its highlighting) is untouched.
    const fuzzyMatches = fuzzySearchAcrossCategories(categories, query);
    if (fuzzyMatches.length > 0) {
      const section = buildCollapsibleSection('__fuzzy', 'Similar matches', fuzzyMatches.length, '', (itemsDiv) => {
        fuzzyMatches.forEach(({ item, category }) => {
          itemsDiv.appendChild(buildItemRow(item, category, '', rates));
        });
      });
      resultsContainer.appendChild(section);
      dataStatus.textContent = `No exact match for "${query}" — showing ${fuzzyMatches.length} similar results`;
      return;
    }
    resultsContainer.innerHTML = `<div class="no-results">No results for "${escapeHtml(query)}" in ${currentGame.toUpperCase()}</div>`;
  }

  dataStatus.textContent = superCat
    ? `${totalMatches} matches in ${superCat.label}`
    : categoryScope
      ? `${totalMatches} matches in ${formatCategoryName(categoryScope)}`
      : `${totalMatches} matches across ${allCategories.length} categories`;
}

btnSettings.addEventListener('click', () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen) renderSettings();
  else renderForQuery(searchInput.value.trim().toLowerCase());
});

// ── Settings reset actions ──────────────────
// Each disables (not deletes, for alerts) or restores-to-default one area; resetAll runs all of
// them plus the two things none of the individual actions own (theme, last-viewed game/league).

function resetPriceAlerts() {
  for (const game of ['poe1', 'poe2']) {
    for (const alert of alerts[game]) alert.enabled = false;
    saveAlerts(game);
  }
}

async function clearCacheAction() {
  await window.ninjaApi.clearCache(); // throws if the delete failed — let the caller surface it
  cachedData = { poe1: {}, poe2: {} };
  await reloadCache(currentGame);
  // Deliberately not awaited — refilling every active league's every category over the network
  // can take a long time (same background-fetch pacing the rest of the app uses); block only on
  // the fast local clear+reload above so the reset UI itself doesn't hang waiting on it.
  primeActiveLeagues().catch((err) => console.error('primeActiveLeagues after clearCache failed:', err));
}

// Central registry for "Reset other settings" — add a new persisted setting's reset-to-default
// logic here so it can't be forgotten later; resetOtherSettings just iterates this list instead
// of hand-listing every setting inline (which is exactly how the zoom-factor row nearly slipped
// through when it was added).
const RESETTABLE_SETTINGS = [
  () => {
    refreshIntervalMs = 12 * 60 * 60 * 1000;
    localStorage.removeItem('ninja_refresh_ms');
    startRefreshTimer();
  },
  () => {
    applyZoomFactor(1);
    localStorage.removeItem('ninja_zoom_factor');
  },
  () => {
    displayUnit = 'Auto';
    localStorage.removeItem('ninja_display_unit');
    if (unitSelect) unitSelect.value = displayUnit;
  },
  () => {
    activeLeagues = [];
    activeLeaguesInitialized = false;
    localStorage.removeItem('ninja_active_leagues');
    applyDefaultActiveLeagues(detectedLeagues.poe2);
  },
  () => {
    window.ninjaApi.setHotkeyEnabled(false);
    localStorage.removeItem('ninja_hotkey_enabled');
  },
  () => {
    notificationsEnabled = true;
    localStorage.removeItem('ninja_notifications_enabled');
  },
  () => {
    favorites.poe1 = new Set();
    favorites.poe2 = new Set();
    localStorage.removeItem('ninja_favorites_poe1');
    localStorage.removeItem('ninja_favorites_poe2');
  },
  () => localStorage.removeItem('ninja_recent_searches'),
];

/** `prime: false` skips the post-reset active-league refetch — used by resetAllSettings, which
 * runs clearCacheAction right after this and does its own single prime pass once the cache is
 * actually empty. Priming here too would race an in-flight fetch's cache write against that
 * delete (confirmed via code review: this exact sequence was the trigger). */
function resetOtherSettings({ prime = true } = {}) {
  for (const apply of RESETTABLE_SETTINGS) apply();
  if (prime) primeActiveLeagues().catch((err) => console.error('primeActiveLeagues failed:', err));
}

async function resetAllSettings() {
  resetPriceAlerts();
  resetOtherSettings({ prime: false });
  await clearCacheAction();
  setTheme('ledger');
  localStorage.removeItem('ninja_game');
  localStorage.removeItem('ninja_league_poe1');
  localStorage.removeItem('ninja_league_poe2');
}

function renderSettings() {
  resultsContainer.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'settings-panel';

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.innerHTML = `<span>Settings</span><button class="settings-close" title="Close">✕</button>`;
  title.querySelector('.settings-close').addEventListener('click', () => {
    settingsOpen = false;
    renderForQuery(searchInput.value.trim().toLowerCase());
  });
  box.appendChild(title);

  // Refresh interval
  const intervalRow = document.createElement('label');
  intervalRow.className = 'settings-row';
  const intervalSelect = document.createElement('select');
  intervalSelect.className = 'league-select';
  for (const opt of REFRESH_INTERVAL_OPTIONS) {
    const el = document.createElement('option');
    el.value = opt.ms;
    el.textContent = opt.label;
    if (opt.ms === refreshIntervalMs) el.selected = true;
    intervalSelect.appendChild(el);
  }
  intervalSelect.addEventListener('change', () => {
    refreshIntervalMs = parseInt(intervalSelect.value, 10);
    localStorage.setItem('ninja_refresh_ms', String(refreshIntervalMs));
    startRefreshTimer();
  });
  intervalRow.innerHTML = `<span>Background refresh interval</span>`;
  intervalRow.appendChild(intervalSelect);
  box.appendChild(intervalRow);

  // UI scale — true page zoom (text + layout + icons together), not just a font-size bump
  const zoomRow = document.createElement('label');
  zoomRow.className = 'settings-row';
  const zoomSelect = document.createElement('select');
  zoomSelect.className = 'league-select';
  for (const factor of ZOOM_OPTIONS) {
    const el = document.createElement('option');
    el.value = factor;
    el.textContent = `${Math.round(factor * 100)}%`;
    if (factor === zoomFactor) el.selected = true;
    zoomSelect.appendChild(el);
  }
  zoomSelect.addEventListener('change', () => {
    const factor = parseFloat(zoomSelect.value);
    applyZoomFactor(factor);
    localStorage.setItem('ninja_zoom_factor', String(factor));
  });
  zoomRow.innerHTML = `<span>UI scale</span>`;
  zoomRow.appendChild(zoomSelect);
  box.appendChild(zoomRow);

  // Theme — see THEMES and styles.css's :root[data-theme="..."] blocks
  const themeRow = document.createElement('label');
  themeRow.className = 'settings-row';
  const themeSelect = document.createElement('select');
  themeSelect.className = 'league-select';
  for (const theme of THEMES) {
    const el = document.createElement('option');
    el.value = theme.key;
    el.textContent = theme.label;
    if (theme.key === currentTheme) el.selected = true;
    themeSelect.appendChild(el);
  }
  themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
  themeRow.innerHTML = `<span>Theme</span>`;
  themeRow.appendChild(themeSelect);
  box.appendChild(themeRow);

  // Active leagues — which game+league combos the interval above actually refreshes. Listed for
  // both games regardless of currentGame, since "active" is independent of what's on screen.
  const activeLeaguesSection = document.createElement('div');
  activeLeaguesSection.className = 'settings-row settings-row-column';
  activeLeaguesSection.innerHTML = `<span>Active leagues (kept updated in the background)</span>`;
  for (const game of ['poe2', 'poe1']) {
    for (const league of detectedLeagues[game]) {
      const row = document.createElement('label');
      row.className = 'settings-subrow';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isLeagueActive(game, league.slug);
      checkbox.addEventListener('change', () => {
        setLeagueActive(game, league.slug, checkbox.checked);
        if (checkbox.checked) primeActiveLeagues().catch((err) => console.error('primeActiveLeagues failed:', err));
      });
      row.appendChild(checkbox);
      row.append(` ${game.toUpperCase()} · ${league.displayName}`);
      activeLeaguesSection.appendChild(row);
    }
  }
  box.appendChild(activeLeaguesSection);

  // Global hotkey toggle
  const hotkeyRow = document.createElement('label');
  hotkeyRow.className = 'settings-row';
  const hotkeyCheckbox = document.createElement('input');
  hotkeyCheckbox.type = 'checkbox';
  hotkeyCheckbox.checked = localStorage.getItem('ninja_hotkey_enabled') === 'true';
  hotkeyCheckbox.addEventListener('change', async () => {
    const enabled = await window.ninjaApi.setHotkeyEnabled(hotkeyCheckbox.checked);
    hotkeyCheckbox.checked = enabled; // reflect actual state — registration can fail (conflict)
    localStorage.setItem('ninja_hotkey_enabled', String(enabled));
  });
  hotkeyRow.innerHTML = `<span>Global show/hide hotkey (Ctrl/Cmd+Shift+Space)</span>`;
  hotkeyRow.appendChild(hotkeyCheckbox);
  box.appendChild(hotkeyRow);

  // Notifications master toggle
  const notifRow = document.createElement('label');
  notifRow.className = 'settings-row';
  const notifCheckbox = document.createElement('input');
  notifCheckbox.type = 'checkbox';
  notifCheckbox.checked = notificationsEnabled;
  notifCheckbox.addEventListener('change', () => {
    notificationsEnabled = notifCheckbox.checked;
    localStorage.setItem('ninja_notifications_enabled', String(notificationsEnabled));
  });
  notifRow.innerHTML = `<span>Price alert notifications</span>`;
  notifRow.appendChild(notifCheckbox);
  box.appendChild(notifRow);

  // Reset actions
  const resetHeading = document.createElement('div');
  resetHeading.className = 'settings-reset-heading';
  resetHeading.textContent = 'Reset';
  box.appendChild(resetHeading);

  const addResetRow = (label, handler, { confirmMessage, danger } = {}) => {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const btn = document.createElement('button');
    btn.className = danger ? 'settings-reset-btn danger' : 'settings-reset-btn';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      if (confirmMessage && !(await showConfirmModal(confirmMessage))) return;
      try {
        await handler();
      } catch (err) {
        console.error(`${label} failed:`, err);
        dataStatus.textContent = `${label} failed: ${err.message}`;
      }
      renderSettings();
    });
    row.appendChild(btn);
    box.appendChild(row);
  };

  addResetRow('Reset price alerts', resetPriceAlerts, {
    confirmMessage: 'Disable every price alert for both games? Their thresholds are kept, just turned off.',
  });
  addResetRow('Clear cache', clearCacheAction);
  addResetRow('Reset other settings', resetOtherSettings, {
    confirmMessage: 'Reset background refresh, active leagues, hotkey, notifications, UI scale, and currency unit to their defaults — and clear favorites and recent searches?',
  });
  addResetRow('Reset all', resetAllSettings, {
    confirmMessage: 'Reset everything — price alerts, cache, all other settings, favorites, recent searches, and theme?',
    danger: true,
  });

  resultsContainer.appendChild(box);
}

// The category-by-category browsing list this used to render is now the permanent left sidebar
// (see renderCategorySidebar) — the overview keeps only Favorites + Recent searches.
function showOverview() {
  categoryScope = null;
  renderCategorySidebar();
  const gameData = cachedData[currentGame] || {};
  const hasAnyData = categoryEntries(gameData).some(([, entry]) => entry && Array.isArray(entry.items) && entry.items.length > 0);

  if (!hasAnyData) {
    resultsContainer.innerHTML = `<div class="empty-state"><p>No data loaded yet — fetching in background…</p></div>`;
    return;
  }

  resultsContainer.innerHTML = '';

  const favoriteItems = getFavoriteItems(currentGame);
  if (favoriteItems.length > 0) {
    const rates = gameData.__meta && gameData.__meta.rates;
    const limit = categoryRenderLimit['__favorites'] || RENDER_CAP;
    const section = buildCollapsibleSection('__favorites', '★ Favorites', favoriteItems.length, '', (itemsDiv) => {
      favoriteItems.slice(0, limit).forEach(({ item, category }) => {
        itemsDiv.appendChild(buildItemRow(item, category, '', rates));
      });
      appendShowMoreIfNeeded(itemsDiv, '__favorites', favoriteItems.length, limit, () => showOverview());
    });
    resultsContainer.appendChild(section);
  }

  const recentSearches = getRecentSearches();
  if (recentSearches.length > 0) {
    const recentDiv = document.createElement('div');
    recentDiv.className = 'recent-searches';
    recentDiv.innerHTML = `<span class="recent-searches-label">Recent:</span>`;
    recentSearches.forEach((q) => {
      const chip = document.createElement('button');
      chip.className = 'recent-chip';
      chip.textContent = q;
      chip.addEventListener('click', () => {
        searchInput.value = q;
        renderResults(q);
      });
      recentDiv.appendChild(chip);
    });
    resultsContainer.appendChild(recentDiv);
  }

  if (favoriteItems.length === 0 && recentSearches.length === 0) {
    resultsContainer.innerHTML = `<div class="empty-state"><p>Pin a favorite or search to see it here — browse categories on the left.</p></div>`;
  }

  updateStatus(); // clears any stale status text left over from a previous search (e.g. "no exact match…")
}

/** Refresh a single category on demand (backed by the existing fetch-category IPC, previously unused by the UI). */
async function refreshCategoryNow(category, buttonEl) {
  if (categoryRefreshing[category]) return;
  const game = currentGame;
  const league = currentLeague[game];
  if (!league) return;

  categoryRefreshing[category] = true;
  buttonEl.classList.add('spinning');
  buttonEl.disabled = true;
  try {
    await window.ninjaApi.fetchCategory(game, league, category);
    const freshCache = await reloadCache(game);
    checkAlerts(game, freshCache);
    if (currentGame === game) renderForQuery(searchInput.value.trim().toLowerCase());
  } catch (err) {
    console.error(`refreshCategoryNow(${category}) failed:`, err);
  } finally {
    categoryRefreshing[category] = false;
  }
}

/** Batched version of refreshCategoryNow for a super category's group refresh — fetches every
 * member slug in parallel, then does ONE reloadCache/checkAlerts/renderForQuery pass afterward
 * instead of one per slug (looping refreshCategoryNow N times would work but redundantly reload
 * the whole cache and re-render N times over). Slugs already mid-refresh (e.g. a per-category
 * refresh in flight) are skipped rather than double-fetched. */
async function refreshCategoriesNow(slugs, buttonEl) {
  const toFetch = slugs.filter((slug) => !categoryRefreshing[slug]);
  if (toFetch.length === 0) return;
  const game = currentGame;
  const league = currentLeague[game];
  if (!league) return;

  for (const slug of toFetch) categoryRefreshing[slug] = true;
  buttonEl.classList.add('spinning');
  buttonEl.disabled = true;
  try {
    await Promise.all(toFetch.map((slug) => window.ninjaApi.fetchCategory(game, league, slug)));
    const freshCache = await reloadCache(game);
    checkAlerts(game, freshCache);
    if (currentGame === game) renderForQuery(searchInput.value.trim().toLowerCase());
  } catch (err) {
    console.error(`refreshCategoriesNow(${toFetch.join(',')}) failed:`, err);
  } finally {
    for (const slug of toFetch) categoryRefreshing[slug] = false;
  }
}

/** Copy an item's name to the clipboard (for pasting into trade chat), with brief visual feedback. */
async function copyItemName(name, buttonEl) {
  try {
    await navigator.clipboard.writeText(name);
    const original = buttonEl.textContent;
    buttonEl.textContent = '✓';
    buttonEl.classList.add('copied');
    setTimeout(() => {
      buttonEl.textContent = original;
      buttonEl.classList.remove('copied');
    }, 1000);
  } catch (err) {
    console.error('copyItemName failed:', err);
  }
}

/** Render an item's value in the user's chosen display currency ("Auto" = item's own native unit). */
function formatDisplayValue(item, rates) {
  if (displayUnit === 'Auto' || item.amount === null || !rates) return item.value;
  const converted = convertAmount(item.amount, item.unit, displayUnit, rates);
  if (converted === null) return item.value; // no conversion rate available — fall back to native unit
  return `${trimNumber(converted)} ${displayUnit}`;
}

/**
 * Convert a value from one currency unit to another using a league's exchange-rate table
 * ({ primary, rates }), where rates[unit] = "how many `unit` equal 1 primary". Returns null if
 * either unit has no known rate (caller should fall back to displaying the original value).
 */
function convertAmount(amount, fromUnit, toUnit, { primary, rates }) {
  if (fromUnit.toLowerCase() === toUnit.toLowerCase()) return amount;

  let primaryAmount;
  if (fromUnit.toLowerCase() === primary.toLowerCase()) {
    primaryAmount = amount;
  } else {
    const fromKey = Object.keys(rates).find((k) => k.toLowerCase() === fromUnit.toLowerCase());
    if (!fromKey || !rates[fromKey]) return null;
    primaryAmount = amount / rates[fromKey];
  }

  if (toUnit.toLowerCase() === primary.toLowerCase()) return primaryAmount;
  const toKey = Object.keys(rates).find((k) => k.toLowerCase() === toUnit.toLowerCase());
  if (!toKey || !rates[toKey]) return null;
  return primaryAmount * rates[toKey];
}

function trimNumber(n) {
  return parseFloat(n.toPrecision(4)).toString();
}

/** A tiny inline SVG sparkline from a 7-point trend array (may contain null gaps). Empty string if
 * there aren't at least 2 usable points — not worth rendering a flat/meaningless line. */
function renderSparkline(trend) {
  if (!Array.isArray(trend)) return '';
  const points = trend.map((v, i) => (typeof v === 'number' ? { x: i, y: v } : null)).filter(Boolean);
  if (points.length < 2) return '';

  const width = 40;
  const height = 14;
  const xs = trend.length - 1;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;

  const coords = points
    .map((p) => `${(p.x / xs) * width},${height - ((p.y - min) / range) * height}`)
    .join(' ');
  const trendClass = points[points.length - 1].y >= points[0].y ? 'positive' : 'negative';

  return `<svg class="sparkline ${trendClass}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="1.5" />
  </svg>`;
}

function clearResults() {
  resultsContainer.innerHTML = `<div class="empty-state"><p>Type something to search</p></div>`;
}

// ── Data Fetching ───────────────────────────

async function detectLeagues() {
  // POE2 is detected and fetched first — it's the priority game, and the old POE1-first
  // ordering meant POE2 data could take up to an hour longer than necessary to appear.
  try {
    const poe2Leagues = await window.ninjaApi.getLeagues('poe2');
    detectedLeagues.poe2 = poe2Leagues;
    applyDefaultActiveLeagues(poe2Leagues);
    if (poe2Leagues.length > 0) {
      const saved = localStorage.getItem('ninja_league_poe2');
      const resolved = poe2Leagues.some((l) => l.slug === saved) ? saved : poe2Leagues[0].slug;
      if (resolved !== currentLeague.poe2) {
        // The league we guessed at init (or had none) wasn't valid — reload cache for the
        // now-resolved league before startFetchIfEmpty checks it below.
        currentLeague.poe2 = resolved;
        await reloadCache('poe2');
        if (currentGame === 'poe2') renderForQuery(searchInput.value.trim().toLowerCase());
        loadLiveCategories('poe2').catch((err) => console.error('loadLiveCategories error:', err));
      }
    }
  } catch (err) {
    console.error('Failed to detect POE2 leagues:', err);
  }
  updateLeagueSelector(currentGame);
  if (currentGame === 'poe2') updateWindowTitle();
  await startFetchIfEmpty('poe2', currentLeague.poe2);

  try {
    const poe1Leagues = await window.ninjaApi.getLeagues('poe1');
    detectedLeagues.poe1 = poe1Leagues;
    if (poe1Leagues.length > 0) {
      const saved = localStorage.getItem('ninja_league_poe1');
      const resolved = poe1Leagues.some((l) => l.slug === saved) ? saved : poe1Leagues[0].slug;
      if (resolved !== currentLeague.poe1) {
        currentLeague.poe1 = resolved;
        await reloadCache('poe1');
        if (currentGame === 'poe1') renderForQuery(searchInput.value.trim().toLowerCase());
        loadLiveCategories('poe1').catch((err) => console.error('loadLiveCategories error:', err));
      }
    }
  } catch (err) {
    console.error('Failed to detect POE1 leagues:', err);
  }
  updateLeagueSelector(currentGame);
  if (currentGame === 'poe1') updateWindowTitle();
  await startFetchIfEmpty('poe1', currentLeague.poe1);
}

/**
 * Only starts a fetch if we have no cached data yet (for the currently selected league).
 */
async function startFetchIfEmpty(game, league) {
  if (!league) return;

  const gameData = cachedData[game] || {};
  const catCount = categoryEntries(gameData).length;
  if (catCount > 0) {
    console.log(`Already have ${catCount} categories for ${game}/${league}, skipping initial fetch`);
    return;
  }

  fetching[game] = true;
  if (currentGame === game) dataStatus.textContent = `Fetching ${game.toUpperCase()}…`;
  try {
    await window.ninjaApi.startFetch(game, league);
  } finally {
    fetching[game] = false;
    if (currentGame === game) updateStatus();
  }
}

// ── Manual Refresh Button ───────────────────
// Fire-and-forget: startFetch runs in background (~60 min), onFetchProgress updates data progressively
btnRefresh.addEventListener('click', () => {
  btnRefresh.style.color = 'var(--accent)';
  btnRefresh.disabled = true;

  const game = currentGame;
  const league = currentLeague[game];
  if (league) {
    fetching[game] = true;
    dataStatus.textContent = `Refreshing ${game.toUpperCase()}…`;
    // Fire in background — onFetchProgress will reload cache as categories complete
    window.ninjaApi.startFetch(game, league).finally(() => {
      fetching[game] = false;
      if (currentGame === game) updateStatus();
    });
  }

  // Re-enable button immediately — fetch runs in background
  setTimeout(() => {
    btnRefresh.style.color = '';
    btnRefresh.disabled = false;
  }, 500);
});

// ── Background Refresh Timer ────────────────

let refreshTimer = null;

function startRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);

  const intervalDisplay = formatDuration(refreshIntervalMs);
  nextRefreshEl.textContent = `Next full refresh in ${intervalDisplay}`;

  refreshTimer = setInterval(async () => {
    console.log('Background refresh triggered');
    // Only the game+leagues the user has marked active — a POE2-only player should never trigger
    // a POE1 fetch. POE2-first ordering preserved by sorting, matching the app-wide priority.
    const targets = [...activeLeagues].sort((a, b) => (a.game === 'poe2' ? 0 : 1) - (b.game === 'poe2' ? 0 : 1));
    const games = [...new Set(targets.map((t) => t.game))];

    for (const game of games) fetching[game] = true;
    try {
      for (const { game, leagueSlug } of targets) {
        await window.ninjaApi.startFetch(game, leagueSlug);
      }
    } catch (err) {
      // Don't let a rejected startFetch (e.g. a main-process error) skip the cache reload below —
      // whatever categories DID complete before the failure should still show up.
      console.error('Background refresh failed:', err);
    } finally {
      for (const game of games) fetching[game] = false;
    }

    try {
      for (const game of games) await reloadCache(game);
      updateStatus();
    } catch (err) {
      console.error('Background refresh cache reload failed:', err);
    }
  }, refreshIntervalMs);
}

function updateStatus() {
  const gameData = cachedData[currentGame] || {};
  const entries = categoryEntries(gameData);
  const catCount = entries.length;
  const itemCount = entries.reduce((sum, [, entry]) => sum + (entry && Array.isArray(entry.items) ? entry.items.length : 0), 0);

  // Don't overwrite in-progress fetch messages — only update when not fetching
  if (!fetching[currentGame]) {
    if (catCount === 0) {
      dataStatus.textContent = `Fetching ${currentGame.toUpperCase()}…`;
      resultsContainer.innerHTML = `<div class="loading-overlay"><div class="spinner"></div>Loading data from poe.ninja…</div>`;
    } else {
      dataStatus.textContent = `${catCount} categories · ${itemCount} items cached`;
    }
  }
}

// ── Utilities ───────────────────────────────

function formatCategoryName(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function highlightText(text, query) {
  // Escape name and query the same way before matching, so the regex operates on already-escaped
  // text consistently — matching a raw query against escaped HTML can miss matches (query has `&`)
  // or splice <mark> in the middle of an entity (query has `<`/`>`).
  const escapedName = escapeHtml(text);
  const escapedQuery = escapeHtml(query);
  const regex = new RegExp(`(${escapeRegex(escapedQuery)})`, 'gi');
  return escapedName.replace(regex, '<mark>$1</mark>');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDuration(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(ms / (1000 * 60));
  return `${mins}m`;
}

/** "updated Xm ago" / "updated just now" label for a category's fetchedAt timestamp. */
function formatAgo(fetchedAt) {
  if (!fetchedAt) return '';
  const elapsed = Date.now() - fetchedAt;
  if (elapsed < 60_000) return 'updated just now';
  const mins = Math.floor(elapsed / 60_000);
  if (mins < 60) return `updated ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `updated ${hours}h ago`;
}
