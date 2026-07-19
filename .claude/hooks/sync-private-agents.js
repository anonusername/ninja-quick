#!/usr/bin/env node
/**
 * SessionStart hook — permission-gated subagent sync.
 *
 * Claude Code discovers subagent types by scanning .claude/agents/*.md at session start; there is no
 * way to register one dynamically. So the 4 real subagent files (ninja-data, ninja-ui, ninja-verify,
 * api-drift-checker) live only in the private Internal_Agent_Instructions repo and get fetched into
 * .claude/agents/ here fresh every session — those local copies are gitignored, never committed, so
 * ninja-quick's public tree never contains them. A machine without `gh` access to that private repo
 * gets nothing: this fails open and silent, same as this repo's other hooks.
 *
 * See the agent-repo-sync skill for the full mechanism and how to push local edits back upstream.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'anonusername/Internal_Agent_Instructions';
const SRC_PREFIX = 'ninja-quick/agents';
const DEST_DIR = path.join(__dirname, '..', 'agents');

function ghJson(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const names = ghJson(['api', `repos/${REPO}/contents/${SRC_PREFIX}`, '--jq', '.[].name'])
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.endsWith('.md'));

    if (names.length > 0) {
      fs.mkdirSync(DEST_DIR, { recursive: true });
      for (const name of names) {
        try {
          const b64 = ghJson(['api', `repos/${REPO}/contents/${SRC_PREFIX}/${name}`, '--jq', '.content']);
          fs.writeFileSync(path.join(DEST_DIR, name), Buffer.from(b64, 'base64').toString('utf8'));
        } catch {
          // One file failing shouldn't block the rest.
        }
      }
    }
  } catch {
    // No `gh`, not authenticated, or no access to the private repo — stay silent, no subagents
    // materialize this session. Never surface this as an error; it's an expected state for anyone
    // other than the repo owner.
  }
  process.exit(0);
});
