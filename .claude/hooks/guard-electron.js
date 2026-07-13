#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard — the ELECTRON_RUN_AS_NODE trap.
 *
 * If ELECTRON_RUN_AS_NODE=1 is set in the shell (it often is here), Electron runs as plain Node:
 * `require('electron')` returns a path string and `app`/`net`/`BrowserWindow` are undefined, so any
 * command that launches the app/scripts/tests silently misbehaves (see CLAUDE.md / AGENTS.md).
 * This blocks such a command unless it clears the var, so it gets corrected before wasting a run.
 *
 * Blocks via a PreToolUse "deny" decision (Claude sees the reason and re-issues with the fix).
 * Fails open (exit 0) on any parse error — a hook must never wedge the tool pipeline.
 */
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = (JSON.parse(raw).tool_input || {}).command || '';
  } catch {
    process.exit(0);
  }

  // Match `electron` only as an INVOKED COMMAND — a preceding command boundary (start, space, ; & | or
  // `(`) — so a substring inside a path/flag like ".claude/hooks/guard-electron.js" or the node tool
  // `electron-builder`/`electron-updater` does NOT trip it. (?!-) also excludes the -builder/-updater case.
  const launchesElectron =
    /(^|[\s;&|(])npx\s+electron\b(?!-)/.test(cmd) || // `npx electron .` / `npx electron scripts/...`
    /(^|[\s;&|(])electron\s+[^-\s]/.test(cmd) || // bare `electron .`
    /\bnpm\s+(test|start)\b/.test(cmd) || // npm test/start spawn Electron under the hood
    /\bnpm\s+run\s+(dev|generate-categories)\b/.test(cmd);
  // `unset ELECTRON_RUN_AS_NODE` OR an inline `ELECTRON_RUN_AS_NODE=...` prefix both satisfy the guard.
  const clearsVar = /ELECTRON_RUN_AS_NODE/.test(cmd);

  if (launchesElectron && !clearsVar) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'This launches Electron but does not clear ELECTRON_RUN_AS_NODE. If that var is 1, ' +
            'Electron runs as plain Node (app/net/BrowserWindow undefined). Re-run with ' +
            '`unset ELECTRON_RUN_AS_NODE && <command>` prepended (see CLAUDE.md).',
        },
      })
    );
  }
  process.exit(0);
});
