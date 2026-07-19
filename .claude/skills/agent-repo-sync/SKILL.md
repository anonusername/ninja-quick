---
name: agent-repo-sync
description: How ninja-quick's session instructions and subagent files sync with the private Internal_Agent_Instructions repo, and how to push a local edit (of .claude/instructions.md, AGENTS.md, or a subagent file) back upstream. Use after editing any of those, or when a sync-related hook needs debugging.
disable-model-invocation: true
---

# agent-repo-sync

`github.com/anonusername/Internal_Agent_Instructions` (private) centralizes AI-agent instructions
across several of the user's projects, one folder each. ninja-quick's folder is `ninja-quick/` there:
`AGENTS.md` (guard-stub + the real AGENTS.md content), `CLAUDE.md` (historical name — actually
mirrors `.claude/instructions.md`'s content), and `agents/*.md` (the 4 subagent definitions).

## Why this isn't a plain file mirror

Claude Code requires two things to be physically present at exact local paths, with no redirect or
dynamic-registration mechanism: a file literally named `CLAUDE.md` for session auto-injection (this
repo deliberately doesn't have one — see below), and real `.claude/agents/*.md` files for subagent
discovery (a pure filesystem scan at session start). A breadcrumb file or a copy living only in the
private repo can't satisfy either. So instead of a static local mirror, two `SessionStart` hooks
materialize the real content locally, fresh, every session:

- **`.claude/hooks/load-instructions.js`** reads `.claude/instructions.md` (this repo's session
  instructions — same content/role CLAUDE.md used to have, deliberately renamed so as not to recreate
  a file literally named CLAUDE.md) and injects it as context via
  `hookSpecificOutput.additionalContext`. This file **is** committed here (nothing sensitive in it).
- **`.claude/hooks/sync-private-agents.js`** fetches the 4 subagent `.md` files from
  `Internal_Agent_Instructions/ninja-quick/agents/` via `gh api` and writes them into
  `.claude/agents/`. Those written files are **gitignored** — permission-gated by whether the current
  machine's `gh` auth can read the private repo, so ninja-quick's own git history never holds them.
  No access → the hook fails open, silently; those 4 subagent types just aren't available that
  session.

## Precondition

`gh auth status` must show the `repo` scope against the `anonusername` account (private-repo read
access for `sync-private-agents.js` to work at runtime; write access for the push steps below). If a
machine doesn't have this, the two hooks above still fail open safely — sessions just won't have the
session-instructions context or the 4 subagents.

## Push a local edit upstream

Edited `.claude/instructions.md`, `AGENTS.md`, or a synced file in `.claude/agents/`? Push the change
to the private repo so other machines' `sync-private-agents.js` picks it up next session. Run from the
repo root, in the scratchpad dir (never inside ninja-quick's own working tree):

```powershell
$SCRATCH = "<scratchpad dir>\Internal_Agent_Instructions"
gh repo clone anonusername/Internal_Agent_Instructions $SCRATCH
Copy-Item .claude\instructions.md "$SCRATCH\ninja-quick\CLAUDE.md" -Force
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
