# Changelog

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
