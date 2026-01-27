/**
 * Sidecar Continue Operations - Handles continuing from previous sessions
 * Spec Reference: §4.4, §8.5
 */

const fs = require('fs');

const { generateTaskId, runInteractive } = require('./start');
const {
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat
} = require('./session-utils');
const { runHeadless } = require('../headless');
const { buildPrompts } = require('../prompt-builder');
const { logger } = require('../utils/logger');

/** Load previous session data (metadata, summary, conversation) */
function loadPreviousSession(taskId, project) {
  const sessionDir = SessionPaths.sessionDir(project, taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // Load metadata
  const metaPath = SessionPaths.metadataFile(sessionDir);
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Load summary if available
  const summaryPath = SessionPaths.summaryFile(sessionDir);
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf-8') : '';

  // Load and format conversation if available
  const convPath = SessionPaths.conversationFile(sessionDir);
  let conversation = '';

  if (fs.existsSync(convPath)) {
    const lines = fs.readFileSync(convPath, 'utf-8').split('\n').filter(Boolean);
    const messages = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    conversation = messages.map(m => {
      const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
      return `[${m.role} @ ${time}] ${m.content}`;
    }).join('\n\n');
  }

  return { metadata, summary, conversation };
}

/** Build continuation context from previous session data */
function buildContinuationContext(metadata, summary, conversation, contextMaxTokens = 80000) {
  const maxChars = contextMaxTokens * 4;

  const truncatedConversation = conversation.length > maxChars
    ? conversation.slice(-maxChars)
    : conversation;

  return `
## PREVIOUS SIDECAR SESSION

This sidecar continues from a previous session (${metadata.taskId}).

### Previous Task
${metadata.briefing || 'No briefing recorded'}

### Previous Summary
${summary || 'No summary available'}

### Previous Conversation Excerpt
${truncatedConversation || 'No conversation recorded'}

---

## NEW TASK

Build on the previous sidecar's findings. The user wants to continue or extend that work.
`;
}

/** Create session metadata for continuation */
function createContinueSessionMetadata(taskId, project, options, oldTaskId) {
  const { model, briefing, headless, agent } = options;

  const sessionDir = SessionPaths.sessionDir(project, taskId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const metadata = {
    taskId,
    model,
    project,
    briefing,
    mode: headless ? 'headless' : 'interactive',
    agent: agent || 'code',
    status: 'running',
    createdAt: new Date().toISOString(),
    continuesFrom: oldTaskId
  };

  fs.writeFileSync(SessionPaths.metadataFile(sessionDir), JSON.stringify(metadata, null, 2));

  return sessionDir;
}

/** Continue from a previous sidecar session - Spec Reference: §4.4, §8.5 */
async function continueSidecar(options) {
  const {
    taskId: oldTaskId,
    briefing,
    project = process.cwd(),
    contextMaxTokens = 80000,
    headless = false,
    timeout = 15,
    agent
  } = options;

  // Load previous session data
  const { metadata: oldMetadata, summary: previousSummary, conversation: previousConversation } =
    loadPreviousSession(oldTaskId, project);

  const model = options.model || oldMetadata.model;
  logger.info('Continuing from session', { oldTaskId, model });

  // Build continuation context
  const previousContext = buildContinuationContext(
    oldMetadata, previousSummary, previousConversation, contextMaxTokens
  );
  const fullContext = previousContext + '\n\n' + briefing;

  // Inherit agent from previous session if not specified
  const effectiveAgent = agent || oldMetadata.agent || 'Build';

  // Build system prompt and user message
  const { system: systemPrompt, userMessage } = buildPrompts(
    briefing, fullContext, project, headless, effectiveAgent
  );

  // Generate new task ID and create session
  const newTaskId = generateTaskId();
  logger.info('New continuation task', { newTaskId, oldTaskId });

  const sessionDir = createContinueSessionMetadata(newTaskId, project, {
    model, briefing, headless, agent: effectiveAgent
  }, oldTaskId);

  saveInitialContext(sessionDir, systemPrompt, userMessage);

  // Start heartbeat
  const heartbeat = createHeartbeat();

  let summary;

  try {
    if (headless) {
      const result = await runHeadless(
        model, systemPrompt, userMessage, newTaskId, project,
        timeout * 60 * 1000, effectiveAgent
      );
      summary = result.summary ||
        '## Sidecar Results: No Output\n\nContinued session completed without summary.';

      if (result.timedOut) { logger.warn('Continuation task timed out', { taskId: newTaskId }); }
      if (result.error) { logger.error('Continuation task error', { taskId: newTaskId, error: result.error }); }
    } else {
      logger.info('Launching interactive continue', { taskId: newTaskId, model });
      const result = await runInteractive(
        model, systemPrompt, userMessage, newTaskId, project,
        { agent: effectiveAgent }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive continue error', { taskId: newTaskId, error: result.error }); }
    }
  } finally {
    heartbeat.stop();
  }

  // Output summary
  outputSummary(summary);

  // Load current metadata for finalization
  const metaPath = SessionPaths.metadataFile(sessionDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Finalize session
  finalizeSession(sessionDir, summary, project, meta);
}

module.exports = {
  loadPreviousSession,
  buildContinuationContext,
  createContinueSessionMetadata,
  continueSidecar
};
