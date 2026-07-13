---
name: release
description: Cut a ninja-quick release — bump version, update CHANGELOG, commit, tag, push, and watch the GitHub Actions Release build to completion. Use when the user says "cut a release", "build a release", "ship it", or gives a version to release.
disable-model-invocation: true
---

# release

Automates ninja-quick's tag-push release flow (see README.md "Releasing"). A pushed `vX.Y.Z` tag
triggers `.github/workflows/release.yml`, which runs the integration tests then builds + publishes
Windows/macOS/Linux installers and the `latest*.yml` auto-update manifests via `electron-builder`.

## Versioning convention

This project stays on the **1.1.x line** — increment the patch by default (1.1.1 → 1.1.2 → …) unless
the user explicitly asks for a minor/major bump. Confirm the target version with the user if unsure.
Never reuse an existing tag: check `git tag -l "vX.Y.Z"` first (v1.0.17 and others already exist from
earlier history).

## Steps

1. **Preconditions**
   - `git status --short` — confirm only intended files are dirty; nothing unrelated staged.
   - `node -e "console.log(require('./package.json').version)"` — current version.
   - `git tag -l "vX.Y.Z"` — confirm the target tag is free.
2. **Bump** `version` in `package.json` to the target.
3. **CHANGELOG.md** — prepend a new `## X.Y.Z — YYYY-MM-DD` section (today's date) summarizing the
   user-facing changes since the last release. Keep the existing entries untouched (historical record).
4. **Commit** everything:
   ```
   git add -A
   git commit -m "<type>: <summary> (vX.Y.Z)

   <body>

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   ```
   (`feat:` for features, `fix:` for fixes, `chore:` for renumbers/tooling.)
5. **Push branch**: `git push origin the_path` (the default/working branch).
6. **Tag + push** — this is what triggers CI:
   ```
   git tag -a vX.Y.Z -m "vX.Y.Z — <short description>"
   git push origin vX.Y.Z
   ```
7. **Watch the build**: find the run id (`gh run list --limit 1`) and
   `gh run watch <id> --exit-status`. It takes ~7-8 min (tests + 3-OS build).
8. **Verify the release published correctly**:
   - `gh run view <id> --json status,conclusion` → `completed / success`.
   - `gh api repos/anonusername/ninja-quick/releases/latest -q '.tag_name'` → `vX.Y.Z`, `draft=false`.
   - `gh release download vX.Y.Z -p latest.yml -O - | head -1` → `version: X.Y.Z` (the Windows
     auto-update manifest).
9. **Report** to the user: run result, that the release is marked Latest with all installers, and that
   their running client picks up the update on its next check (restart it — fully quit from the tray —
   to trigger immediately; auto-update never downgrades, and macOS stays manual until signed).

## Deleting / renumbering a release

If asked to delete a release and renumber (as happened going v1.2.0 → v1.1.1):
`gh release delete vX.Y.Z --yes --cleanup-tag` (removes release + remote tag), `git tag -d vX.Y.Z`
(local), then re-run this flow with the corrected version. Note: auto-update never downgrades, so a
client already on the deleted version won't step back.
