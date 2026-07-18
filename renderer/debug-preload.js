// Preload for the web-request debug window (renderer/debug.html). Same security posture as the
// main window — contextIsolation on, no Node in the page — so the debug renderer talks to the
// main process only through this narrow bridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('debugBridge', {
  // Fired once on load with every event captured before the page was ready (chronological).
  onSeed: (callback) => {
    const handler = (_event, events) => callback(events);
    ipcRenderer.on('debug-seed', handler);
    return () => ipcRenderer.removeListener('debug-seed', handler);
  },
  // Fired for each live event afterward: { phase: 'start' | 'end', id, ... }.
  onRequest: (callback) => {
    const handler = (_event, evt) => callback(evt);
    ipcRenderer.on('debug-request', handler);
    return () => ipcRenderer.removeListener('debug-request', handler);
  },
  // "Clear" also empties the main-process buffer so it isn't replayed on the next seed.
  clear: () => ipcRenderer.send('debug-clear'),
});
