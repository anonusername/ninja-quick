#!/usr/bin/env node
/**
 * SessionStart hook — auto-loads `.claude/instructions.md` into context every session, the same
 * practical effect Claude Code's native CLAUDE.md auto-injection has, without a file literally named
 * CLAUDE.md (see .claude/instructions.md's own header for why, and the agent-repo-sync skill).
 *
 * Fails open (no output, exit 0) if the file is missing or unreadable — a hook must never wedge
 * session startup.
 */
const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const content = fs.readFileSync(path.join(__dirname, '..', 'instructions.md'), 'utf8');
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: content,
        },
      })
    );
  } catch {
    // Missing/unreadable — say nothing, let the session start normally.
  }
  process.exit(0);
});
