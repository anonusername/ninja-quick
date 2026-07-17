# GitHub contributor hygiene — keeping Claude off the Contributors list

This project's [attribution policy](../CLAUDE.md#commits-attribution-policy) is that **Claude/Anthropic
must never be credited as a contributor**. New commits already omit any `Co-Authored-By: Claude …`
trailer. This doc is the runbook for the *other* half: getting an already-recorded Claude co-author
back **off GitHub's repo homepage "Contributors" sidebar** after the fact — which turns out to be
non-obvious, because that sidebar is not fed by the data source you'd expect.

## Why removing it is not just "rewrite history"

There are **two different contributor surfaces** on GitHub, backed by different data:

| Surface | Backed by | Counts co-authors? |
|---|---|---|
| REST `GET /repos/OWNER/REPO/contributors` (and the number the API reports) | commit **authors** only | No |
| The repo homepage **Contributors sidebar** + the Insights → Contributors graph | a separate contributor **index** that also resolves `Co-Authored-By:` trailers (email → account) | **Yes** |

So a `Co-Authored-By: Claude <…@anthropic.com>` trailer maps to the `@claude` account and shows up in
the **sidebar** while the REST `/contributors` list stays clean. Fixing the REST list (or seeing it was
already clean) tells you nothing about the sidebar.

Two more properties of the sidebar index matter:

- **It reads commit objects in the repo's network, not just reachable refs.** Rewriting history and
  force-pushing makes the old commits *dangling*, but GitHub does **not** garbage-collect them on push —
  they persist server-side (reported as up to ~30 days). While they exist, the index can still see the
  co-author.
- **It is refreshed on structural repo events, not on every push.** A plain force-push — even with a
  `/stats/contributors` recompute, even with a bare default-branch rename — did **not** refresh it in
  practice. A **visibility toggle** (public → private → public) *did*.

## What was actually done here (2026-07, ninja-quick)

Diagnosis first, then the fix that worked:

1. **Rewrite history to remove the trailer** — `git filter-branch` (or `git-filter-repo`) to strip the
   `Co-Authored-By: Claude …` line from every commit message, then force-push. Verify locally:
   ```bash
   git log --all --format='%an <%ae>' | sort -u          # only the real owner
   git log --all --format=%B | grep -i 'co-authored'      # no trailers (doc text mentioning "Claude" is fine)
   ```
   This is **necessary but not sufficient** — the trailer must be gone, but on its own it did not
   refresh the sidebar.
2. **Confirm the REST list is clean** (it was) and **rule out CDN caching** — the still-stale sidebar
   page came back with `cache-control: max-age=0, private, must-revalidate`, `server: github.com`, and
   no `Age`/`X-Cache`/`Via` headers, i.e. it was GitHub's true origin state, not a stale cache. (Steps
   that did *not* move it: `/stats/contributors` recompute → 202→200; a bare default-branch
   rename-away-and-back.)
3. **The fix that worked — a visibility-toggle combo** (repo had 0 stars / 0 forks, so this was
   zero-cost here; weigh that first on a repo with either):
   ```bash
   gh repo edit OWNER/REPO --visibility private --accept-visibility-change-consequences
   gh api -X POST repos/OWNER/REPO/branches/DEFAULT/rename -f new_name=DEFAULT_tmp
   gh api -X POST repos/OWNER/REPO/branches/DEFAULT_tmp/rename -f new_name=DEFAULT
   gh repo edit OWNER/REPO --visibility public --accept-visibility-change-consequences
   ```
   Going public again is the structural event that forced a re-index; the sidebar dropped from
   "Contributors 2" (with `@claude`) to "Contributors 1" immediately on the next fresh page load.

Verify by loading the repo homepage with a cache-busting query param and checking there are no
`/claude` links in the Contributors section. (Leftover on-page "claude" *text* — the `.claude/` tooling
directory, `CLAUDE.md`, a commit subject like "add Claude Code automation tooling" — is expected and is
**not** attribution.)

## Durability caveat (re-verify)

The visibility toggle re-indexes against **currently visible** objects, but the old dangling commits
still exist server-side until GitHub GCs them (~30 days). In principle a future reindex before that GC
could repopulate the entry, so **re-check the sidebar** rather than treating "Contributors 1" as
permanent. Options if you want the co-author *permanently* gone rather than just currently suppressed:

- **Wait it out** — after the dangling objects age out (~30 days) the source is gone.
- **GitHub Support** — file the documented "remove cached views / references to rewritten commits" flow
  (as in *Removing sensitive data from a repository*), giving the old SHAs, and ask them to GC the
  dangling objects. Days, but it purges the source.
- **Block the account** — `gh api -X PUT user/blocks/claude` (personal) or
  `gh api -X PUT orgs/ORG/blocks/claude` (org-owned repos). Reliable and reversible, but leaves a
  standing block on the account; a heavier lever than the toggle. Not used here.

## Prevention

Keep new commits clean so this never recurs: the attribution policy in [CLAUDE.md](../CLAUDE.md#commits-attribution-policy)
and every subagent's `## Commits` section forbid the `Co-Authored-By: Claude` trailer (and any
"Generated with Claude" note) on commits and PRs.
