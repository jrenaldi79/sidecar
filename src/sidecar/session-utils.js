/**
 * Sidecar Session Utilities - Shared functionality for session management
 * Consolidates duplicated code from start.js, resume.js, continue.js
 */

const fs = require('fs');
const path = require('path');

const { detectConflicts, formatConflictWarning } = require('../conflict');
const { logger } = require('../utils/logger');

/** Standard heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL = 5000;

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
  fs.writeFileSync(SessionPaths.contextFile(sessionDir), content);
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
  fs.writeFileSync(SessionPaths.summaryFile(sessionDir), summary);

  // Update metadata to complete
  metadata.status = 'complete';
  metadata.completedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  logger.info('Session complete', { taskId: metadata.taskId });
}

/** Output summary to stdout with standard formatting */
function outputSummary(summary) {
  process.stdout.write('\n\n');
  console.log(summary);
}

/** Create a heartbeat that writes dots to stdout periodically */
function createHeartbeat(interval = HEARTBEAT_INTERVAL) {
  const intervalId = setInterval(() => process.stdout.write('.'), interval);

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

module.exports = {
  HEARTBEAT_INTERVAL,
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  executeMode
};
