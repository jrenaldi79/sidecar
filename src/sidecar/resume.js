/**
 * Sidecar Resume Operations - Handles resuming previous sidecar sessions
 * Spec Reference: §4.3, §8.3
 */

const fs = require('fs');
const path = require('path');

const { runInteractive, buildMcpConfig } = require('./start');
const {
  SessionPaths,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  checkSessionLiveness
} = require('./session-utils');
const { acquireLock, releaseLock } = require('../utils/session-lock');
const { runHeadless } = require('../headless');
const { logger } = require('../utils/logger');
const {
  validateSidecarSessionDir,
  validateSidecarSessionMetadata,
  readContainedSessionFile
} = require('../utils/sidecar-boundaries');

/** Load session metadata from session directory */
function loadSessionMetadata(sessionDir) {
  const metaPath = SessionPaths.metadataFile(sessionDir);
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Session metadata not found: ${metaPath}`);
  }
  return JSON.parse(readContainedSessionFile(sessionDir, 'metadata.json'));
}

/** Load initial context (system prompt) from session */
function loadInitialContext(sessionDir) {
  return readContainedSessionFile(sessionDir, 'initial_context.md', { optional: true }) || '';
}

/** Check for file drift - files that were read may have changed */
function checkFileDrift(metadata, project) {
  const filesRead = metadata.filesRead || [];
  const lastActivity = metadata.completedAt || metadata.createdAt;
  const lastActivityTime = new Date(lastActivity).getTime();
  const changedFiles = [];

  for (const file of filesRead) {
    const filePath = path.join(project, file);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > lastActivityTime) {
        changedFiles.push(file);
      }
    }
  }

  return { hasChanges: changedFiles.length > 0, changedFiles, lastActivityTime };
}

/** Build drift warning message */
function buildDriftWarning(changedFiles, lastActivityTime) {
  const timeSince = Date.now() - lastActivityTime;
  const hours = Math.floor(timeSince / 3600000);

  return `
## ⚠️ RESUME NOTICE

This session is being resumed after a pause. **The file system has changed since your last message.**

**Time since last activity:** ${hours > 0 ? hours + ' hours' : 'Less than an hour'}

**Changed files:**
${changedFiles.map(f => `- ${f}`).join('\n')}

Please verify your previous findings against the current state of these files before continuing.
`;
}

/** Build user message for headless resume, including conversation history */
function buildResumeUserMessage(briefing, conversation) {
  const parts = [];

  if (conversation) {
    parts.push('## PREVIOUS CONVERSATION\n');
    parts.push(conversation);
    parts.push('\n---\n');
    parts.push('## RESUME\n');
    parts.push('You are resuming a previous session. Continue from where you left off.');
  }

  if (briefing) {
    if (parts.length === 0) {
      parts.push(briefing);
    } else {
      parts.push(`\nOriginal task: ${briefing}`);
    }
  }

  return parts.join('\n');
}

/** Update session metadata status */
function updateSessionStatus(sessionDir, status) {
  const metaPath = SessionPaths.metadataFile(sessionDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  meta.status = status;
  if (status === 'running') {
    meta.resumedAt = new Date().toISOString();
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

/** Resume a previous sidecar session - Spec Reference: §4.3, §8.3 */
async function resumeSidecar(options) {
  const {
    taskId, project = process.cwd(), headless = false, timeout = 15,
    mcp, mcpConfig, client, noMcp, excludeMcp
  } = options;

  const sessionDir = validateSidecarSessionDir(project, taskId);

  // Load previous session data
  const metadata = validateSidecarSessionMetadata(loadSessionMetadata(sessionDir), project);
  const effectiveProject = metadata.projectDir;
  const systemPrompt = loadInitialContext(sessionDir);

  // Dead-process detection: log if the previous process is no longer alive
  const liveness = checkSessionLiveness(metadata);
  if (liveness !== 'alive') {
    logger.info('Session process is dead, restoring from disk', {
      taskId, liveness, pid: metadata.pid,
    });
  }

  // Acquire lock to prevent concurrent resume operations
  acquireLock(sessionDir, headless ? 'headless' : 'interactive');

  let heartbeat;
  try {
    const mcpServers = buildMcpConfig({ mcp, mcpConfig, clientType: client, noMcp, excludeMcp });
    logger.info('Resuming session', { taskId, model: metadata.model, briefing: metadata.briefing });

    // Check for file drift
    const drift = checkFileDrift(metadata, effectiveProject);
    let resumePrompt = systemPrompt;

    if (drift.hasChanges) {
      const driftWarning = buildDriftWarning(drift.changedFiles, drift.lastActivityTime);
      resumePrompt = systemPrompt + '\n' + driftWarning;
      logger.warn('Files changed since last activity', { taskId, changedFileCount: drift.changedFiles.length });
    }

    // Update metadata (get updated metadata with resumedAt)
    const updatedMetadata = updateSessionStatus(sessionDir, 'running');

    // Start heartbeat
    heartbeat = createHeartbeat();

    let summary;
    const effectiveAgent = metadata.agent || 'Build';

    // Load conversation for both paths (interactive already did this, headless didn't)
    const existingConversation =
      readContainedSessionFile(sessionDir, 'conversation.jsonl', { optional: true }) || '';

    if (headless) {
      const userMessage = buildResumeUserMessage(metadata.briefing || '', existingConversation);
      const result = await runHeadless(
        metadata.model, resumePrompt, userMessage,
        taskId, effectiveProject, timeout * 60 * 1000, effectiveAgent, { mcp: mcpServers }
      );
      summary = result.summary || '## Sidecar Results: No Output\n\nResumed session completed without summary.';

      if (result.timedOut) { logger.warn('Resume task timed out', { taskId }); }
      if (result.error) { logger.error('Resume task error', { taskId, error: result.error }); }
    } else {
      logger.info('Launching interactive resume', { taskId, model: metadata.model });

      const result = await runInteractive(
        metadata.model, resumePrompt, metadata.briefing || '',
        taskId, effectiveProject,
        {
          agent: effectiveAgent,
          isResume: true,
          conversation: existingConversation,
          opencodeSessionId: metadata.opencodeSessionId,
          mcp: mcpServers
        }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive resume error', { taskId, error: result.error }); }
    }

    // Output summary
    outputSummary(summary);

    // Finalize session (use updatedMetadata which has resumedAt)
    finalizeSession(sessionDir, summary, effectiveProject, updatedMetadata);
  } finally {
    if (heartbeat) { heartbeat.stop(); }
    releaseLock(sessionDir);
  }
}

module.exports = {
  loadSessionMetadata,
  loadInitialContext,
  checkFileDrift,
  buildDriftWarning,
  buildResumeUserMessage,
  updateSessionStatus,
  resumeSidecar
};
