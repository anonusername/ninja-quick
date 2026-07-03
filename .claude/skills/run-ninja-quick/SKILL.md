---
name: run-ninja-quick
description: Build, run, and drive the ninja-quick Electron desktop app for verification. Use when asked to start the app, take a screenshot of it, check its cache, or confirm a UI change actually renders (not just passes tests).
---

ninja-quick is a Windows Electron desktop app (not headless Linux — no xvfb needed). For
agent/automated use, drive it via the Playwright REPL at `.claude/skills/run-ninja-quick/driver.mjs`.

All paths are relative to the repo root (`c:/Users/lucan/Code/ninja-quick`).

## Prerequisites

```bash
npm install               # installs electron
npm install --save-dev playwright-core   # one-time, if not already present
```

## Run (agent path)

```bash
unset ELECTRON_RUN_AS_NODE   # see Gotchas — critical, silently breaks everything otherwise
node .claude/skills/run-ninja-quick/driver.mjs
```

Then feed it commands via stdin, one per line:

```
launch
ss overview
click #search-input
type orb
wait .item-row
ss search-results
eval document.querySelectorAll('.item-row').length
cache poe2
quit
```

Screenshots land in `C:/tmp/shots/` (override: `SCREENSHOT_DIR`). **Actually open and look at
the screenshot** — a passing `eval` check on the DOM is not the same as confirming the layout
renders correctly; a real layout regression (see Gotchas) was caught only by looking at the PNG.

### Commands

| command | what it does |
|---|---|
| `launch [dev]` | launch the app; pass `dev` to also open DevTools (see Gotcha below first) |
| `ss [name]` | screenshot -> `C:/tmp/shots/<name>.png` |
| `click <css-sel>` | click element via DOM `.click()`, not coordinates |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait for element, 10s timeout |
| `eval <js>` | evaluate in the page, print JSON |
| `text [css-sel]` | print innerText |
| `errors` | print any console.error/pageerror seen since launch |
| `cache <game> [league]` | read the app's own cache file directly (`%APPDATA%/ninja-quick/.cache/<game>_<league>_economy.json`), summarized — faster than clicking through the UI. Omit league to list available leagues for that game |
| `quit` | close app, exit |

## Run (human path)

```bash
unset ELECTRON_RUN_AS_NODE
npx electron . --dev   # opens a real window with DevTools; Ctrl-C to quit
```

## Gotchas

- **Electron's renderer does NOT support `window.prompt()`** — calling it throws
  `"prompt() is not supported."` (confirmed directly via `page.evaluate`). Any feature needing a
  quick text-input dialog needs a custom in-page modal instead (see `showPromptModal()` in
  `renderer/renderer.js`) — don't reach for `window.prompt()` in this app, it will silently break
  whatever calls it. `window.alert()`/`confirm()` have the same kind of embedder-dependent support
  in Electron and should be similarly distrusted without testing first.

- **`ELECTRON_RUN_AS_NODE=1` may be set in this shell.** If it is, Electron runs as plain Node
  and `require('electron')` (and Playwright's `executablePath` launch) misbehaves —
  `app`/`net`/`BrowserWindow` come back `undefined` or the process never becomes a real GUI
  process. Always `unset ELECTRON_RUN_AS_NODE` before `launch`.

- **`--dev` docks DevTools inside the same window and shrinks the real content viewport.**
  The app's window is only 480px wide (`main.js`'s `BrowserWindow({width: 480, ...})`). Opening
  DevTools with `webContents.openDevTools()` (what `--dev` does) docks it inside that same
  480px-wide `BrowserWindow`, squeezing the actual renderer content down to as little as ~150px
  (`window.innerWidth`). This looks exactly like a real CSS overflow bug — it isn't. Drive the
  app with plain `launch` (no `dev` arg) for any layout/screenshot verification; only use
  `launch dev` when you specifically need the DevTools console.

- **`app.firstWindow()` is unreliable once DevTools is open** — with `dev`, the app has two
  top-level pages (`devtools://...` and the real `file://.../index.html`), and `firstWindow()`
  isn't guaranteed to be the app one. The driver's plain `launch` avoids this entirely by not
  opening DevTools; if you do pass `dev`, filter `app.windows()` for the non-`devtools://` URL.

- **Piped input (a script feeding commands, not a human typing) can race or truncate.**
  `readline`'s `'line'` event doesn't wait for an async listener before firing the next one, and
  `'close'` fires the instant stdin hits EOF — both regardless of whether a command like
  `launch` has actually finished. The driver serializes commands through a promise queue and
  waits for that queue to drain on close; if you modify the driver, preserve both of those or
  piped multi-command scripts will silently skip most of their output.

- **The cache file lives under `%APPDATA%/ninja-quick/.cache/`**, one JSON file per game+**league**
  (`poe2_runesofaldur_economy.json`, `poe2_standard_economy.json`, etc — leagues are economically
  independent and are never mixed into the same file). Categories are stored as
  `{ items, fetchedAt }`, plus a reserved `__meta.rates` key (currency conversion table) — skip
  `__meta` when iterating categories. The `cache` command already does this summarization for you
  (`cache poe2 runesofaldur`; run `cache poe2` with no league to list what's available).

## Troubleshooting

- **Launch timeout (30s):** confirm `node_modules/electron/dist/electron.exe` exists
  (`npm install` first). Confirm `ELECTRON_RUN_AS_NODE` is unset.
- **`Cannot find package 'playwright-core'`:** the driver/any inspection script must live
  inside the repo (or be run with cwd there) so Node resolves `node_modules` — a script in
  `/tmp` won't find it.
- **Values/rows look truncated in a screenshot:** check whether you launched with `dev` — see
  the DevTools-docking gotcha above before assuming it's a real bug.
