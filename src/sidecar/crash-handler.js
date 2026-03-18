/**
 * Crash Handler - Updates metadata to 'error' on uncaught exceptions
 *
 * Installed by bin/sidecar.js for MCP-spawned processes that have a --task-id.
 * When the process crashes, the handler marks the session as failed so the
 * MCP client can detect the error instead of seeing a stuck 'running' status.
 */

const fs = require('fs');
const { SessionPaths } = require('./session-utils');

/**
 * Create a crash handler that updates session metadata on error.
 *
 * @param {string} taskId - The sidecar task ID
 * @param {string} project - The project root directory
 * @param {object} [options] - Additional options
 * @param {object} [options.vmProvider] - VM provider to shut down on crash
 * @returns {function(Error): void} Handler function to call with the error
 */
function installCrashHandler(taskId, project, options = {}) {
  const { vmProvider } = options;

  return function handleCrash(err) {
    try {
      const sessionDir = SessionPaths.sessionDir(project, taskId);
      const metaPath = SessionPaths.metadataFile(sessionDir);

      if (!fs.existsSync(metaPath)) {
        return;
      }

      const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      if (metadata.status !== 'running') {
        return;
      }

      metadata.status = 'error';
      metadata.reason = err.message;
      metadata.errorAt = new Date().toISOString();

      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
    } catch (_ignored) {
      // Crash handler must never throw - swallow all errors
    }

    // Best-effort VM shutdown on crash
    if (vmProvider) {
      try {
        vmProvider.shutdown();
      } catch (_ignored) {
        // Must never throw in crash handler
      }
    }
  };
}

module.exports = { installCrashHandler };
