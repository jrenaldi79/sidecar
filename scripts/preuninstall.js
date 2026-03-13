#!/usr/bin/env node

/**
 * Pre-uninstall script for claude-sidecar
 *
 * Removes activity monitoring hooks from ~/.claude/settings.json
 * that were registered by postinstall.js. Leaves other user hooks intact.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Hook script basenames registered by postinstall — used to identify sidecar hooks during removal.
const SIDECAR_HOOK_SCRIPTS = ['pre-bash.sh', 'post-tool-use.sh', 'post-failure.sh'];

function isSidecarHookCommand(command) {
  if (!command || typeof command !== 'string') { return false; }
  // Require both matching basename AND a sidecar-related path to avoid removing user hooks
  const basename = path.basename(command);
  return SIDECAR_HOOK_SCRIPTS.includes(basename) && command.includes('claude-sidecar');
}

function removeHooks() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return; // No settings file — nothing to clean up
  }

  if (!settings.hooks) { return; }

  let removed = 0;
  for (const [event, matchers] of Object.entries(settings.hooks)) {
    if (!Array.isArray(matchers)) { continue; }
    const filtered = matchers.filter((matcher) => {
      const hooks = matcher.hooks || [];
      const isSidecar = hooks.some((h) => isSidecarHookCommand(h.command));
      if (isSidecar) { removed++; }
      return !isSidecar;
    });
    if (filtered.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = filtered;
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (removed > 0) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
    console.log(`[claude-sidecar] Removed ${removed} hook(s) from ~/.claude/settings.json`);
  }
}

if (require.main === module) {
  removeHooks();
}

module.exports = { removeHooks };
