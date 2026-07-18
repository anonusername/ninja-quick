The 4 subagent definitions that used to live here (api-drift-checker, ninja-data, ninja-ui,
ninja-verify) have moved to the private `Internal_Agent_Instructions` repo:

`https://github.com/anonusername/Internal_Agent_Instructions/tree/the_path/ninja-quick/agents`

Claude Code only registers subagents from a consumer repo's own `.claude/agents/*.md` — this note
is a breadcrumb for a human (or a bootstrap agent), not a live pointer. If you want one of these
working here again, copy the real file back into this folder. See the `agent-repo-sync` skill for
the full sync workflow.
