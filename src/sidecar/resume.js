/**
 * Sidecar Resume Operations - Handles resuming previous sidecar sessions
 * Spec Reference: §4.3, §8.3
 */

const fs = require('fs');
const path = require('path');

const { runInteractive } = require('./start');
const {
  SessionPaths,
  finalizeSession,
  outputSummary,
  createHeartbeat
} = require('./session-utils');
const { runHeadless } = require('../headless');
const { logger } = require('../utils/logger');

/** Load session metadata from session directory */
function loadSessionMetadata(sessionDir) {
  const metaPath = SessionPaths.metadataFile(sessionDir);
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Session metadata not found: ${metaPath}`);
  }
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/** Load initial context (system prompt) from session */
function loadInitialContext(sessionDir) {
  const contextPath = SessionPaths.contextFile(sessionDir);
  if (fs.existsSync(contextPath)) {
    return fs.readFileSync(contextPath, 'utf-8');
  }
  return '';
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
  const { taskId, project = process.cwd(), headless = false, timeout = 15 } = options;

  const sessionDir = SessionPaths.sessionDir(project, taskId);
  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // Load previous session data
  const metadata = loadSessionMetadata(sessionDir);
  const systemPrompt = loadInitialContext(sessionDir);

  logger.info('Resuming session', { taskId, model: metadata.model, briefing: metadata.briefing });

  // Check for file drift
  const drift = checkFileDrift(metadata, project);
  let resumePrompt = systemPrompt;

  if (drift.hasChanges) {
    const driftWarning = buildDriftWarning(drift.changedFiles, drift.lastActivityTime);
    resumePrompt = systemPrompt + '\n' + driftWarning;
    logger.warn('Files changed since last activity', { taskId, changedFileCount: drift.changedFiles.length });
  }

  // Update metadata (get updated metadata with resumedAt)
  const updatedMetadata = updateSessionStatus(sessionDir, 'running');

  // Start heartbeat
  const heartbeat = createHeartbeat();

  let summary;
  const effectiveAgent = metadata.agent || 'Build';

  try {
    if (headless) {
      const result = await runHeadless(
        metadata.model, resumePrompt, metadata.briefing || '',
        taskId, project, timeout * 60 * 1000, effectiveAgent
      );
      summary = result.summary || '## Sidecar Results: No Output\n\nResumed session completed without summary.';

      if (result.timedOut) { logger.warn('Resume task timed out', { taskId }); }
      if (result.error) { logger.error('Resume task error', { taskId, error: result.error }); }
    } else {
      logger.info('Launching interactive resume', { taskId, model: metadata.model });

      const conversationPath = SessionPaths.conversationFile(sessionDir);
      const existingConversation = fs.existsSync(conversationPath)
        ? fs.readFileSync(conversationPath, 'utf-8')
        : '';

      const result = await runInteractive(
        metadata.model, resumePrompt, metadata.briefing || '',
        taskId, project,
        { agent: effectiveAgent, isResume: true, conversation: existingConversation }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive resume error', { taskId, error: result.error }); }
    }
  } finally {
    heartbeat.stop();
  }

  // Output summary
  outputSummary(summary);

  // Finalize session (use updatedMetadata which has resumedAt)
  finalizeSession(sessionDir, summary, project, updatedMetadata);
}

module.exports = {
  loadSessionMetadata,
  loadInitialContext,
  checkFileDrift,
  buildDriftWarning,
  updateSessionStatus,
  resumeSidecar
};
