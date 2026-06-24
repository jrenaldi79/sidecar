/**
 * Crash Handler - Updates metadata to 'error' on uncaught exceptions
 *
 * Installed by bin/sidecar.js for MCP-spawned processes that have a --task-id.
 * When the process crashes, the handler marks the session as failed so the
 * MCP client can detect the error instead of seeing a stuck 'running' status.
 */

const fs = require('fs');
const path = require('path');
const {
  readContainedSessionFile,
  validateSidecarSessionDir,
  writeContainedSessionFile
} = require('../utils/sidecar-session-boundaries');

/**
 * Create a crash handler that updates session metadata on error.
 *
 * @param {string} taskId - The sidecar task ID
 * @param {string} project - The project root directory
 * @returns {function(Error): void} Handler function to call with the error
 */
function installCrashHandler(taskId, project) {
  return function handleCrash(err) {
    try {
      const sessionDir = validateSidecarSessionDir(project, taskId);
      const metadataText = readContainedSessionFile(sessionDir, 'metadata.json', { optional: true });

      if (metadataText === null) {
        return;
      }

      const metadata = JSON.parse(metadataText);

      if (metadata.status !== 'running') {
        return;
      }

      metadata.status = 'error';
      metadata.reason = err.message;
      metadata.errorAt = new Date().toISOString();

      writeContainedSessionFile(sessionDir, 'metadata.json', JSON.stringify(metadata, null, 2), { mode: 0o600 });

      // Delete session lock if it exists
      const lockPath = path.join(sessionDir, 'session.lock');
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Lock may not exist yet
      }
    } catch (_ignored) {
      // Crash handler must never throw - swallow all errors
    }
  };
}

module.exports = { installCrashHandler };
