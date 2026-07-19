The 4 subagent definitions for this repo (api-drift-checker, ninja-data, ninja-ui, ninja-verify) are
**not** committed here — their canonical source is the private `Internal_Agent_Instructions` repo:

`https://github.com/anonusername/Internal_Agent_Instructions/tree/the_path/ninja-quick/agents`

A `SessionStart` hook (`.claude/hooks/sync-private-agents.js`) fetches them into this directory as
plain `.md` files at the start of every Claude Code session, **if** the current machine has `gh`
access to that private repo — Claude Code only registers subagents from a repo's own
`.claude/agents/*.md`, and there's no way to make that discovery dynamic, so this is the closest
equivalent to a live pointer that actually works. On a machine without access, this directory just
stays empty and those 4 subagent types aren't available — silently, not an error.

The synced `.md` files are gitignored (see `.gitignore`) — this directory intentionally never holds
real subagent content in ninja-quick's own git history. To edit a subagent's definition, edit the
locally-synced file (it's a normal file once synced) and push the change upstream — see the
`agent-repo-sync` skill for the full workflow.
