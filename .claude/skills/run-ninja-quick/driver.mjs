// REPL driver for ninja-quick (Electron desktop app). Launches the real app via Playwright's
// _electron support and exposes commands over stdin so an agent can drive the UI without
// relaunching the app on every interaction.
//
// Run: node .claude/skills/run-ninja-quick/driver.mjs
// (unset ELECTRON_RUN_AS_NODE first — see Gotchas in SKILL.md)
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || 'C:/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron.exe');

let app = null;
let page = null;
let consoleErrors = [];

const COMMANDS = {
  // Deliberately does NOT pass --dev by default: DevTools docks inside the same (fairly
  // narrow, 480px-wide) window and squeezes the real content viewport down to ~150px, which
  // silently breaks layout checks that have nothing to do with the app itself. Pass "dev" as
  // an arg only when you specifically need DevTools open.
  async launch(arg) {
    if (app) return console.log('already launched');
    const args = arg === 'dev' ? [APP_DIR, '--dev'] : [APP_DIR];
    app = await electron.launch({ executablePath: electronBin, args, timeout: 30_000 });
    page = await app.firstWindow();
    consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    await new Promise((r) => setTimeout(r, 2000));
    console.log('launched.', page.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '->', r);
  },

  async type(text) { if (page) await page.keyboard.type(text, { delay: 30 }); },
  async press(key) { if (page) await page.keyboard.press(key); },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null));
  },

  async errors() {
    console.log(consoleErrors.length ? JSON.stringify(consoleErrors, null, 2) : 'none');
  },

  async cache(args) {
    // Reads the app's own cache file directly — quicker than clicking through the UI to
    // confirm a fetch landed. Cache is scoped per game+league: usage "cache poe2 standard"
    // (game defaults to 'poe2'; league is required — list dirents if you don't know it).
    const [game, league] = (args || 'poe2').split(/\s+/);
    const g = game || 'poe2';
    const cacheDir = path.join(process.env.APPDATA, 'ninja-quick', '.cache');
    if (!league) {
      const files = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.startsWith(`${g}_`)) : [];
      return console.log(files.length ? `no league given — available: ${files.join(', ')}` : `no cache files for ${g} yet`);
    }
    const file = path.join(cacheDir, `${g}_${league}_economy.json`);
    if (!fs.existsSync(file)) return console.log('no cache file yet:', file);
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    console.log(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, k === '__meta' ? v : { itemCount: v.items?.length, fetchedAt: v.fetchedAt }])
        ),
        null,
        2
      )
    );
  },

  async quit() {
    if (app) await app.close().catch(() => {});
    app = null;
    page = null;
  },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

// Unlike a driver that IS the Electron process, this script stays a plain Node process and
// launches Electron as a child via Playwright — there's no stdin-stealing to work around here,
// so process.stdin (not the /dev/stdin trick some POSIX examples use) is what actually works
// on Windows.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' });

// readline's 'line' event fires for every buffered line as soon as it's available — it does NOT
// wait for an async listener to finish before emitting the next one. Piping several commands at
// once (a script feeding this driver, not a human typing) would otherwise run them concurrently
// — e.g. `ss` starting before `launch` has actually set `page`. Chain them through one promise
// so each command only starts once the previous one has fully finished.
let queue = Promise.resolve();

rl.on('line', (line) => {
  queue = queue.then(async () => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    if (!cmd) return rl.prompt();
    const fn = COMMANDS[cmd];
    if (!fn) {
      console.log('unknown:', cmd, '- try: help');
      return rl.prompt();
    }
    try {
      await fn(rest.join(' '));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
    if (cmd === 'quit') {
      rl.close();
      process.exit(0);
    }
    rl.prompt();
  });
});
rl.on('close', async () => {
  // When input is piped (a script, not an interactive human), 'close' fires the instant stdin
  // hits EOF — i.e. right after every line has been *read*, regardless of whether the queued
  // async commands they triggered have actually *finished* running. Wait for the queue to drain
  // before tearing down, or a piped script's later commands (screenshot, eval, quit) silently
  // never execute.
  await queue.catch(() => {});
  await COMMANDS.quit();
  process.exit(0);
});

console.log('ninja-quick driver - "help" for commands, "launch" to start');
rl.prompt();
