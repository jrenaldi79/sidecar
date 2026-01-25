/**
 * Claude Sidecar - Main Module
 *
 * Spec Reference: §9 Implementation
 * Exports all public APIs for the sidecar CLI.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Import submodules (will be implemented by subagents)
// const { resolveSession, encodeProjectPath } = require('./session');
// const { filterContext } = require('./context');
// const { buildSystemPrompt } = require('./prompt-builder');
// const { runHeadless } = require('./headless');
// const { SessionManager } = require('./session-manager');

const HEARTBEAT_INTERVAL = 5000;

/**
 * Generate a unique task ID
 */
function generateTaskId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Start a new sidecar session
 * Spec Reference: §4.1, §9
 *
 * @param {object} options
 * @param {string} options.model - Model to use (e.g., google/gemini-2.5)
 * @param {string} options.briefing - Task description
 * @param {string} options.session - Session ID or 'current'
 * @param {string} options.project - Project directory
 * @param {number} options.contextTurns - Max conversation turns
 * @param {string} options.contextSince - Time filter (e.g., '2h')
 * @param {number} options.contextMaxTokens - Max context tokens
 * @param {boolean} options.headless - Run without GUI
 * @param {number} options.timeout - Headless timeout in minutes
 */
async function startSidecar(options) {
  const {
    model,
    briefing,
    session = 'current',
    project = process.cwd(),
    contextTurns = 50,
    contextSince,
    contextMaxTokens = 80000,
    headless = false,
    timeout = 15
  } = options;

  const taskId = generateTaskId();

  // Log to stderr (stdout is reserved for summary)
  console.error(`[Sidecar] Starting task ${taskId}`);
  console.error(`[Sidecar] Model: ${model}`);
  console.error(`[Sidecar] Mode: ${headless ? 'headless' : 'interactive'}`);

  // TODO: Build context from Claude Code session
  // const context = buildContext(project, session, { contextTurns, contextSince, contextMaxTokens });
  const context = '[Context extraction not yet implemented]';

  // TODO: Build system prompt
  // const systemPrompt = buildSystemPrompt(briefing, context, project, headless);
  const systemPrompt = `# SIDECAR SESSION

You are a sidecar agent helping with a task from Claude Code.

## TASK BRIEFING

${briefing}

## CONVERSATION CONTEXT (from Claude Code)

${context}

## ENVIRONMENT

Project: ${project}
You have full read/write access to this directory.

${headless ? `
## HEADLESS MODE INSTRUCTIONS

You are running autonomously without human interaction.

1. Execute the task completely
2. Make reasonable assumptions (document them)
3. When done, output your summary followed by [SIDECAR_COMPLETE]

Do NOT ask questions. Work independently.
` : `
## INTERACTIVE MODE

The user will work with you in a conversation.
When they click "Fold", you'll be asked to generate a summary.
Keep track of key findings as you work.
`}`;

  // Save session metadata
  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);
  fs.mkdirSync(sessionDir, { recursive: true });

  fs.writeFileSync(
    path.join(sessionDir, 'metadata.json'),
    JSON.stringify({
      taskId,
      model,
      project,
      briefing,
      mode: headless ? 'headless' : 'interactive',
      status: 'running',
      createdAt: new Date().toISOString()
    }, null, 2)
  );

  fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), systemPrompt);

  // Start heartbeat (to stdout)
  const heartbeat = setInterval(() => process.stdout.write('.'), HEARTBEAT_INTERVAL);

  let summary;

  try {
    if (headless) {
      // TODO: Implement headless runner
      // summary = await runHeadless(model, systemPrompt, taskId, project, timeout * 60 * 1000);
      console.error('[Sidecar] Headless mode not yet implemented');
      summary = '## Sidecar Results: Not Implemented\n\nHeadless mode is not yet implemented.';
    } else {
      // TODO: Implement interactive mode (Electron)
      // summary = await runInteractive(model, systemPrompt, taskId, project);
      console.error('[Sidecar] Interactive mode not yet implemented');
      summary = '## Sidecar Results: Not Implemented\n\nInteractive mode is not yet implemented.';
    }
  } finally {
    clearInterval(heartbeat);
  }

  // Output summary to stdout
  process.stdout.write('\n\n');
  console.log(summary);

  // Save summary
  fs.writeFileSync(path.join(sessionDir, 'summary.md'), summary);

  // Update metadata
  const metaPath = path.join(sessionDir, 'metadata.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  meta.status = 'complete';
  meta.completedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.error(`[Sidecar] Task ${taskId} complete`);
}

/**
 * List previous sidecar sessions
 * Spec Reference: §4.2
 */
async function listSidecars(options) {
  const { status, all, json, project = process.cwd() } = options;

  const sessionsDir = path.join(project, '.claude', 'sidecar_sessions');

  if (!fs.existsSync(sessionsDir)) {
    console.log('No sidecar sessions found.');
    return;
  }

  let sessions = fs.readdirSync(sessionsDir)
    .filter(d => {
      const metaPath = path.join(sessionsDir, d, 'metadata.json');
      return fs.existsSync(metaPath);
    })
    .map(d => {
      const meta = JSON.parse(fs.readFileSync(path.join(sessionsDir, d, 'metadata.json'), 'utf-8'));
      return { ...meta, id: d };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Filter by status if specified
  if (status && status !== 'all') {
    sessions = sessions.filter(s => s.status === status);
  }

  if (sessions.length === 0) {
    console.log('No sidecar sessions found.');
    return;
  }

  if (json) {
    console.log(JSON.stringify(sessions, null, 2));
  } else {
    console.log('ID        MODEL                  STATUS     AGE         BRIEFING');
    console.log('─'.repeat(80));
    sessions.forEach(s => {
      const age = formatAge(s.createdAt);
      const briefingShort = (s.briefing || '').slice(0, 30) + ((s.briefing?.length > 30) ? '...' : '');
      console.log(
        `${(s.id || '').padEnd(10)}${(s.model || '').padEnd(23)}${(s.status || 'unknown').padEnd(11)}${age.padEnd(12)}${briefingShort}`
      );
    });
  }
}

/**
 * Resume a previous sidecar session
 * Spec Reference: §4.3, §8.3
 */
async function resumeSidecar(options) {
  const { taskId, project = process.cwd() } = options;

  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // TODO: Implement resume with drift detection
  console.error(`[Sidecar] Resume not yet implemented for task ${taskId}`);
  console.log('Resume functionality coming soon.');
}

/**
 * Continue from a previous sidecar session
 * Spec Reference: §4.4, §8.5
 */
async function continueSidecar(options) {
  const { taskId, briefing, model, project = process.cwd() } = options;

  const oldSessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);

  if (!fs.existsSync(oldSessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // TODO: Implement continue with context from previous session
  console.error(`[Sidecar] Continue not yet implemented for task ${taskId}`);
  console.log('Continue functionality coming soon.');
}

/**
 * Read sidecar session data
 * Spec Reference: §4.5
 */
async function readSidecar(options) {
  const { taskId, summary, conversation, metadata, project = process.cwd() } = options;

  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  if (conversation) {
    const convPath = path.join(sessionDir, 'conversation.jsonl');
    if (fs.existsSync(convPath)) {
      const lines = fs.readFileSync(convPath, 'utf-8').split('\n').filter(Boolean);
      lines.forEach(line => {
        try {
          const msg = JSON.parse(line);
          const time = new Date(msg.timestamp).toLocaleTimeString();
          console.log(`[${msg.role} @ ${time}] ${msg.content}\n`);
        } catch {
          // Skip malformed lines
        }
      });
    } else {
      console.log('No conversation recorded.');
    }
  } else if (metadata) {
    const metaPath = path.join(sessionDir, 'metadata.json');
    console.log(fs.readFileSync(metaPath, 'utf-8'));
  } else {
    // Default: show summary
    const summaryPath = path.join(sessionDir, 'summary.md');
    if (fs.existsSync(summaryPath)) {
      console.log(fs.readFileSync(summaryPath, 'utf-8'));
    } else {
      console.log('No summary available (session may not have been folded).');
    }
  }
}

/**
 * Format a timestamp as relative age
 */
function formatAge(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) { return `${mins}m ago`; }
  const hours = Math.floor(mins / 60);
  if (hours < 24) { return `${hours}h ago`; }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

module.exports = {
  startSidecar,
  listSidecars,
  resumeSidecar,
  continueSidecar,
  readSidecar,
  generateTaskId
};
