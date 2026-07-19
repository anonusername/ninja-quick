---
name: agent-repo-sync
description: How ninja-quick's session instructions and subagent files sync with the private Internal_Agent_Instructions repo, and how to push a local edit (of .claude/instructions.md, AGENTS.md, or a subagent file) back upstream. Use after editing any of those, or when a sync-related hook needs debugging.
disable-model-invocation: true
---

# agent-repo-sync

`github.com/anonusername/Internal_Agent_Instructions` (private) centralizes AI-agent instructions
across several of the user's projects, one folder each. ninja-quick's folder is `ninja-quick/` there:
`AGENTS.md` (guard-stub + the real AGENTS.md content), `instructions.md` (mirrors
`.claude/instructions.md`'s content — renamed from `CLAUDE.md` for consistency with the consumer
side), and `agents/*.md` (the 4 subagent definitions).

## Why this isn't a plain file mirror

Claude Code requires two things to be physically present at exact local paths, with no redirect or
dynamic-registration mechanism: a file literally named `CLAUDE.md` for session auto-injection (this
repo deliberately doesn't have one — see below), and real `.claude/agents/*.md` files for subagent
discovery (a pure filesystem scan at session start). A breadcrumb file or a copy living only in the
private repo can't satisfy either. Beyond that, **neither is committed to ninja-quick's own history at
all** — not just avoiding the filename `CLAUDE.md`, but keeping this content out of the public repo's
git history entirely (it re-entered once already, under `.claude/instructions.md`, until that got
caught and un-committed). So instead of a static local mirror, two `SessionStart` hooks fetch the real
content from the private repo fresh, every session, and write it to gitignored local paths:

- **`.claude/hooks/load-instructions.js`** fetches `Internal_Agent_Instructions/ninja-quick/instructions.md`
  via `gh api`, caches it at `.claude/instructions.md` (**gitignored**, not committed), and injects it
  as context via `hookSpecificOutput.additionalContext`. No access this session → falls back to
  whatever's cached from a prior successful sync, if any; no cache either → silently injects nothing.
- **`.claude/hooks/sync-private-agents.js`** fetches the 4 subagent `.md` files from
  `Internal_Agent_Instructions/ninja-quick/agents/` via `gh api` and writes them into
  `.claude/agents/`. Those written files are **gitignored** too — permission-gated by whether the
  current machine's `gh` auth can read the private repo, so ninja-quick's own git history never holds
  them. No access → the hook fails open, silently; those 4 subagent types just aren't available that
  session.

## Precondition

`gh auth status` must show the `repo` scope against the `anonusername` account (private-repo read
access for both hooks to work at runtime; write access for the push steps below). If a machine
doesn't have this, both hooks still fail open safely — sessions just won't have the session-instructions
context or the 4 subagents (unless a stale local `.claude/instructions.md` cache from a prior session
covers the gap for instructions).

## Push a local edit upstream

Edited the local `.claude/instructions.md` cache, `AGENTS.md`, or a synced file in `.claude/agents/`?
Push the change to the private repo so other machines' hooks pick it up next session — and so your own
next `load-instructions.js`/`sync-private-agents.js` run doesn't just overwrite your edit with the old
upstream content. Run from the repo root, in the scratchpad dir (never inside ninja-quick's own
working tree):

```powershell
$SCRATCH = "<scratchpad dir>\Internal_Agent_Instructions"
gh repo clone anonusername/Internal_Agent_Instructions $SCRATCH
Copy-Item .claude\instructions.md "$SCRATCH\ninja-quick\instructions.md" -Force
Copy-Item .claude\agents\*.md "$SCRATCH\ninja-quick\agents\" -Force
# AGENTS.md: keep the guard-stub header (Consumer Repository + Scope Guard) intact, only replace
# the "## Instructions" body with this repo's real AGENTS.md content — don't overwrite the header.
git -C $SCRATCH add ninja-quick
git -C $SCRATCH commit -m "Sync ninja-quick instructions/agents"
git -C $SCRATCH push origin the_path
git -C $SCRATCH subtree split --prefix=ninja-quick -b ninja-quick-export
git -C $SCRATCH push -u origin ninja-quick-export --force
Remove-Item -Recurse -Force $SCRATCH
```

The `ninja-quick-export` branch rebuild matches this hub repo's own documented convention (every
project folder gets one) even though nothing currently `git subtree pull`s from it — ninja-quick
consumes via the hooks above instead, since that's the only path that lands files at the exact
locations Claude Code needs.

## Adding a new subagent

Add the file to `.claude/agents/` locally as normal (it'll work immediately, same session), then also
copy it into `Internal_Agent_Instructions/ninja-quick/agents/` and follow "Push a local edit upstream"
above — keep both sides in sync manually; there's no automated two-way sync. Until it's pushed, the
new subagent only exists on this machine and won't survive `sync-private-agents.js` overwriting
`.claude/agents/` on another machine (or this one, after a `git clean`).

## Debugging

- Subagent not showing up as an Agent-tool type: check `.claude/agents/<name>.md` actually exists
  locally first (`ls .claude/agents`) — if it's missing, `sync-private-agents.js` either didn't run,
  failed silently (check `gh auth status`), or hasn't landed yet this session (Claude Code's
  subagent-directory scan vs. `SessionStart` hook execution order isn't documented as guaranteed; a
  file that lands mid-session may only take effect starting the *next* session).
- Session instructions missing: check `.claude/instructions.md` exists and `node
  .claude/hooks/load-instructions.js < /dev/null` (or `echo {} |` on Windows) prints valid JSON with a
  non-empty `additionalContext`.
