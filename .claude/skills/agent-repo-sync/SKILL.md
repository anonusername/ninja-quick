---
name: agent-repo-sync
description: Sync ninja-quick's agent instructions with the private Internal_Agent_Instructions repo, and pull a moved subagent file back into .claude/agents/ if you need it live again. Use after editing CLAUDE.md/AGENTS.md, or when a ninja-data/ninja-ui/ninja-verify/api-drift-checker subagent needs to be restored locally.
disable-model-invocation: true
---

# agent-repo-sync

`github.com/anonusername/Internal_Agent_Instructions` (private) centralizes AI-agent instructions
across several of the user's projects, one folder each. ninja-quick's folder is
`ninja-quick/` there: `AGENTS.md` (guard-stub + the real AGENTS.md content), `CLAUDE.md` (a copy),
and `agents/*.md` (the 4 subagent definitions that used to live in this repo's own
`.claude/agents/`).

## Why the split

- `.claude/agents/*.md` (the 4 subagents) — **moved**, not mirrored. `.claude/agents/README.md`
  here is a breadcrumb, not a functional pointer: Claude Code only registers subagents by parsing
  `.claude/agents/*.md` in a repo's own tree, so it will never dereference the note to load
  `ninja-data`/`ninja-ui`/`ninja-verify`/`api-drift-checker` from the private repo automatically.
- `CLAUDE.md`/`AGENTS.md` — **mirrored**, not moved. Both are auto-injected into every Claude Code
  session directly from this repo's root; a copy that only exists in Internal_Agent_Instructions
  would not be auto-loaded, so the real files stay here and get pushed as copies, not replaced.

Mechanism is `git subtree split` (matching `Internal_Agent_Instructions/README.md`'s "How It Works" —
the doc other project folders there actually use, e.g. `suwayomi-server-export`), not the
`git submodule` + `.github/copilot-instructions.md` flow in `REFERENCE-BOOTSTRAP-AGENT.md` — that
one is for onboarding a consumer repo with no existing agent setup, which doesn't describe
ninja-quick.

## Precondition

`gh auth status` must show the `repo` scope against the `anonusername` account (private-repo push
access). If it doesn't, stop and ask the user rather than trying to work around it.

## Re-sync CLAUDE.md/AGENTS.md after a local edit

Run from the repo root, in the scratchpad dir (never inside ninja-quick's own working tree):

```powershell
$SCRATCH = "<scratchpad dir>\Internal_Agent_Instructions"
gh repo clone anonusername/Internal_Agent_Instructions $SCRATCH
Copy-Item CLAUDE.md "$SCRATCH\ninja-quick\CLAUDE.md" -Force
# AGENTS.md: keep the guard-stub header (Consumer Repository + Scope Guard) intact, only replace
# the "## Instructions" body with this repo's real AGENTS.md content — don't overwrite the header.
git -C $SCRATCH add ninja-quick
git -C $SCRATCH commit -m "Sync ninja-quick CLAUDE.md/AGENTS.md"
git -C $SCRATCH push origin the_path
git -C $SCRATCH subtree split --prefix=ninja-quick -b ninja-quick-export
git -C $SCRATCH push -u origin ninja-quick-export --force
Remove-Item -Recurse -Force $SCRATCH
```

## Pull a subagent back into `.claude/agents/`

If you need `ninja-data`/`ninja-ui`/`ninja-verify`/`api-drift-checker` live again as an Agent-tool
subagent in ninja-quick:

```powershell
gh api repos/anonusername/Internal_Agent_Instructions/contents/ninja-quick/agents/<name>.md `
  --jq '.content' | # base64-decode and write to .claude/agents/<name>.md
```

Commit the restored file. It'll show up as an available subagent type on the next session (Claude
Code discovers `.claude/agents/*.md` at session start, not live mid-session).

## Adding a new subagent

Create it in `.claude/agents/` here as normal, then follow "Re-sync" above but also copy the new
file into `Internal_Agent_Instructions/ninja-quick/agents/` before committing there — keep both
sides in sync manually; there's no automated two-way sync.
