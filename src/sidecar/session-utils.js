/**
 * Sidecar Session Utilities - Shared functionality for session management
 * Consolidates duplicated code from start.js, resume.js, continue.js
 */

const fs = require('fs');
const path = require('path');

const { detectConflicts, formatConflictWarning } = require('../conflict');
const { logger } = require('../utils/logger');

/** Standard heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL = 15000;

/** Session path utilities - eliminates magic strings across modules */
const SessionPaths = {
  /** Get root sidecar sessions directory */
  rootDir(project) {
    return path.join(project, '.claude', 'sidecar_sessions');
  },

  /** Get session directory for a specific task */
  sessionDir(project, taskId) {
    return path.join(this.rootDir(project), taskId);
  },

  /** Get metadata.json path */
  metadataFile(sessionDir) {
    return path.join(sessionDir, 'metadata.json');
  },

  /** Get conversation.jsonl path */
  conversationFile(sessionDir) {
    return path.join(sessionDir, 'conversation.jsonl');
  },

  /** Get summary.md path */
  summaryFile(sessionDir) {
    return path.join(sessionDir, 'summary.md');
  },

  /** Get initial_context.md path */
  contextFile(sessionDir) {
    return path.join(sessionDir, 'initial_context.md');
  }
};

/** Save system prompt and user message to initial_context.md */
function saveInitialContext(sessionDir, systemPrompt, userMessage) {
  const content = `# System Prompt\n\n${systemPrompt}\n\n# User Message (Task)\n\n${userMessage}`;
  fs.writeFileSync(SessionPaths.contextFile(sessionDir), content, { mode: 0o600 });
}

/** Finalize session - detect conflicts, save summary, update metadata */
function finalizeSession(sessionDir, summary, project, metadata) {
  const metaPath = SessionPaths.metadataFile(sessionDir);

  // Detect file conflicts
  const conflicts = detectConflicts(
    { written: metadata.filesWritten },
    project,
    new Date(metadata.createdAt)
  );

  if (conflicts.length > 0) {
    const conflictWarning = formatConflictWarning(conflicts);
    console.log(`\n${conflictWarning}\n`);
    metadata.conflicts = conflicts;
  }

  // Save summary
  fs.writeFileSync(SessionPaths.summaryFile(sessionDir), summary, { mode: 0o600 });

  // Update metadata to complete
  metadata.status = 'complete';
  metadata.completedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });

  logger.info('Session complete', { taskId: metadata.taskId });
}

/** Output summary to stdout with standard formatting */
function outputSummary(summary) {
  console.log(summary);
}

/**
 * Create a heartbeat that writes status to stderr periodically.
 * When sessionDir is provided, includes message count and latest activity.
 *
 * @param {number} [interval=HEARTBEAT_INTERVAL] - Interval in milliseconds
 * @param {string} [sessionDir] - Session directory to read progress from
 * @returns {{ stop: () => void }}
 */
function createHeartbeat(interval = HEARTBEAT_INTERVAL, sessionDir) {
  const startTime = Date.now();
  const intervalId = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const ts = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;

    if (sessionDir) {
      const { readProgress } = require('./progress');
      const progress = readProgress(sessionDir);
      process.stderr.write(`[sidecar] ${ts} | ${progress.messages} messages | ${progress.latest}\n`);
    } else {
      process.stderr.write(`[sidecar] still running... ${ts} elapsed\n`);
    }
  }, interval);

  return {
    stop() {
      clearInterval(intervalId);
    }
  };
}

/**
 * Execute sidecar in either headless or interactive mode
 * Consolidates the if/else pattern duplicated across start, resume, continue
 */
async function executeMode(options) {
  const {
    headless,
    runHeadless,
    runInteractive,
    model,
    systemPrompt,
    userMessage,
    taskId,
    project,
    timeout,
    agent,
    extraOptions = {},
    defaultSummary = '## Sidecar Results: No Output\n\nSession completed without summary.',
    operationType = 'task'
  } = options;

  let result;

  if (headless) {
    result = await runHeadless(
      model,
      systemPrompt,
      userMessage,
      taskId,
      project,
      timeout * 60 * 1000,
      agent,
      extraOptions
    );

    result.summary = result.summary || defaultSummary;

    if (result.timedOut) {
      logger.warn(`${operationType} timed out`, { taskId });
    }
    if (result.error) {
      logger.error(`${operationType} error`, { taskId, error: result.error });
    }
  } else {
    logger.info(`Launching interactive ${operationType}`, { taskId, model, agent });

    result = await runInteractive(
      model,
      systemPrompt,
      userMessage,
      taskId,
      project,
      { agent, ...extraOptions }
    );

    result.summary = result.summary || '';

    if (result.error) {
      logger.error(`Interactive ${operationType} error`, { taskId, error: result.error });
    }
  }

  return result;
}

/**
 * Start OpenCode server, wait for health, return client+server.
 * Shared by headless and interactive modes.
 *
 * @param {object} [mcpConfig] - Optional MCP server configuration
 * @param {object} [options] - Additional server options
 * @param {string} [options.client] - Client type (e.g. 'cowork', 'code-local')
 * @param {string} [options.systemPrompt] - System prompt to set on agent config (hidden from UI)
 * @param {string} [options.agentName] - Agent to set systemPrompt on (default: 'chat')
 * @returns {Promise<{client: object, server: object}>}
 * @throws {Error} If server fails to start or health check fails
 */
async function startOpenCodeServer(mcpConfig, options = {}) {
  const { checkHealth, startServer } = require('../opencode-client');
  const { ensureNodeModulesBinInPath } = require('../utils/path-setup');
  const { ensurePortAvailable } = require('../utils/server-setup');
  const { waitForServer } = require('../headless');

  ensureNodeModulesBinInPath();

  // Use specified port, or 0 to let the OS auto-assign (enables parallel sessions)
  const port = options.port || 0;
  if (port > 0) {
    ensurePortAvailable(port);
  }

  const serverOptions = { port };
  if (mcpConfig) { serverOptions.mcp = mcpConfig; }
  if (options.client) { serverOptions.client = options.client; }
  if (options.systemPrompt) { serverOptions.systemPrompt = options.systemPrompt; }
  if (options.agentName) { serverOptions.agentName = options.agentName; }

  const { client, server } = await startServer(serverOptions);
  logger.debug('OpenCode server started', { url: server.url });

  const ready = await waitForServer(client, checkHealth);
  if (!ready) {
    server.close();
    throw new Error('OpenCode server failed to become ready');
  }

  return { client, server };
}

/**
 * Write OpenCode port and session ID to metadata.json.
 * Called early during session startup so MCP App tools can access them.
 * No-op if metadata.json doesn't exist yet.
 */
function writeSessionInfo(sessionDir, port, sessionId) {
  const metaPath = SessionPaths.metadataFile(sessionDir);
  try {
    if (!fs.existsSync(metaPath)) { return; }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.opencodePort = String(port);
    meta.opencodeSessionId = sessionId;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  } catch {
    // Non-fatal — MCP App tools will report missing port/session gracefully
  }
}

module.exports = {
  HEARTBEAT_INTERVAL,
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  executeMode,
  startOpenCodeServer,
  writeSessionInfo
};
