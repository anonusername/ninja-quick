# Changelog

## 1.0.6 — 2026-07-04

- Fix CI deprecation warnings: `actions/checkout@v4` and `actions/setup-node@v4` both declared the
  now-deprecated `node20` Actions runtime, logging a warning on every job. Bumped to
  `actions/checkout@v7` and `actions/setup-node@v6` (both `node24`), clearing it.
- Bump `electron-builder` from `^25.1.8` to `^26.15.3`, which drops several stale transitive
  dependencies that were logging `npm warn deprecated` during `npm ci` (`npmlog`, `gauge`,
  `are-we-there-yet`, `@npmcli/move-file`, and multiple duplicate `glob`/`tar` versions). A few
  remain (`glob`/`inflight` via `@electron/asar`, `rimraf` via the Windows Squirrel installer,
  `boolean` via Electron's own `@electron/get`) — these are transitive deps of the latest stable
  releases of tools we already use, with no newer non-alpha version available; left as-is rather
  than forcing risky `npm overrides`.

## 1.0.5 — 2026-07-04

- Fix `v1.0.4`: `"draft": false` isn't a valid `build.publish` key in electron-builder's schema
  (caught locally via `build-windows-release.ps1`, before it could fail in CI). The correct option
  is `releaseType`, which accepts `"draft" | "prerelease" | "release"` (default `"draft"`) — set to
  `"release"` so `--publish always` actually publishes instead of failing config validation.

## 1.0.4 — 2026-07-04

- Fix releases publishing as unpublished drafts: electron-builder's GitHub publish target defaults
  `draft: true` (v1.0.2 and v1.0.3 both landed as drafts needing a manual "Publish" click). Attempted
  fix used the wrong key (`draft`); see 1.0.5 for the correction. Intent: complete the "no manual
  steps after `git tag`" goal.

## 1.0.3 — 2026-07-04

- Fix the Linux `.deb` build: electron-builder requires `author.email` in `package.json` for the
  package maintainer field, which the bare-string `author` didn't provide. Added a GitHub noreply
  address so no real personal email is exposed in the public repo.

## 1.0.2 — 2026-07-03

- Fix CI test job: a fresh checkout's `chrome-sandbox` binary isn't root-owned/4755, which made
  Electron abort rather than run unsandboxed. Set `ELECTRON_DISABLE_SANDBOX=1` for the test step
  (safe — `test-integration.js` never opens a `BrowserWindow`, so there's no untrusted content the
  sandbox would be protecting).

## 1.0.1 — 2026-07-03

- Fix the release workflow: grant the build job `contents: write` so `electron-builder --publish
  always` can actually create the GitHub Release (the repo's default Actions token permission is
  read-only). Also install `xvfb` explicitly before the headless test run and cache npm deps.

## 1.0.0 — 2026-07-03

First cross-platform release (Windows, macOS, Linux).

- Add electron-builder packaging (NSIS + portable on Windows, dmg + zip on macOS, AppImage + deb on Linux).
- Add auto-update via electron-updater, publishing to GitHub Releases (Windows/Linux; macOS auto-update requires signing, see README).
- Add GitHub Actions release workflow — tagging `vX.Y.Z` builds and publishes all three platforms.
- Categories now ship from a committed, curated per-game map instead of relying solely on the live scrape succeeding on first launch; the live scrape still refines/overrides it in the background.
- Add "active game+leagues" setting — background refresh only updates the game+league combos the user marks active. Defaults to POE2 · Runes of Aldur (SC).
- Harden the packaged app: DevTools gated on `!app.isPackaged`, Windows AppUserModelId set, single-instance lock added.

## Release process

1. Bump `version` in `package.json`.
2. Update this file.
3. Commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. GitHub Actions builds all three OSes and publishes the release automatically.
