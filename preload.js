const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ninjaApi', {
  // Data access — cache is scoped per game+league, so getCachedData needs both.
  getCachedData: (gameKey, leagueSlug) =>
    ipcRenderer.invoke('get-cached-data', gameKey, leagueSlug),
  getLeagues: (gameKey) =>
    ipcRenderer.invoke('get-leagues', gameKey),
  // Live-scraped category list for the sidebar (falls back to a static list main-process side if
  // poe.ninja is unreachable or the scrape fails) — NOT the removed get-categories IPC, this one
  // actually reflects what's currently on the site rather than a hardcoded array.
  getLiveCategories: (gameKey, leagueSlug) =>
    ipcRenderer.invoke('get-live-categories', gameKey, leagueSlug),

  // Fetching
  startFetch: (gameKey, league) =>
    ipcRenderer.invoke('start-fetch', gameKey, league),
  fetchCategory: (gameKey, league, cat) =>
    ipcRenderer.invoke('fetch-category', gameKey, league, cat),

  // Open a poe.ninja URL in the system's default browser (never inside the app)
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Register/unregister the global show/hide hotkey — the renderer decides based on its own
  // localStorage-persisted preference; main.js holds no independent settings store.
  setHotkeyEnabled: (enabled) => ipcRenderer.invoke('set-hotkey-enabled', enabled),

  // Events from main process
  onFetchProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('fetch-progress', handler);
    return () => ipcRenderer.removeListener('fetch-progress', handler);
  },
});
