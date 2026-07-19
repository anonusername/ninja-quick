#!/usr/bin/env node
/**
 * SessionStart hook — fetches this repo's session instructions from the private
 * Internal_Agent_Instructions repo (ninja-quick/instructions.md there) and injects them as context,
 * the same practical effect Claude Code's native CLAUDE.md auto-injection has.
 *
 * Not committed here (see .gitignore) — same permission-gated treatment as
 * sync-private-agents.js, for the same reason: keeping this content out of ninja-quick's own public
 * git history entirely, not just out of a file literally named CLAUDE.md. A local copy is cached at
 * .claude/instructions.md as a best-effort fallback for a session with no `gh` access but a prior
 * successful sync; with neither, this fails open silently.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'anonusername/Internal_Agent_Instructions';
const SRC_PATH = 'ninja-quick/instructions.md';
const CACHE_PATH = path.join(__dirname, '..', 'instructions.md');

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let content = null;

  try {
    const b64 = execFileSync(
      'gh',
      ['api', `repos/${REPO}/contents/${SRC_PATH}`, '--jq', '.content'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    content = Buffer.from(b64, 'base64').toString('utf8');
    fs.writeFileSync(CACHE_PATH, content);
  } catch {
    // No `gh` / not authenticated / no access this session — fall back to a stale local cache
    // from a prior successful sync, if one exists.
    try {
      content = fs.readFileSync(CACHE_PATH, 'utf8');
    } catch {
      // No cache either — nothing to inject this session.
    }
  }

  if (content) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: content,
        },
      })
    );
  }
  process.exit(0);
});
