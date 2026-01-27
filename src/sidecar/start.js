/**
 * Sidecar Start Operations - Handles starting new sidecar sessions
 * Spec Reference: §4.1, §9
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { buildContext } = require('./context-builder');
const {
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  HEARTBEAT_INTERVAL
} = require('./session-utils');
const { buildPrompts } = require('../prompt-builder');
const { runHeadless } = require('../headless');
const { logger } = require('../utils/logger');
const { loadMcpConfig, parseMcpSpec } = require('../opencode-client');
const { mapAgentToOpenCode } = require('../utils/agent-mapping');

/** Generate a unique 8-character hex task ID */
function generateTaskId() {
  return crypto.randomBytes(4).toString('hex');
}

/** Create session directory and save metadata */
function createSessionMetadata(taskId, project, options) {
  const { model, briefing, headless, agent, thinking } = options;

  const sessionDir = SessionPaths.sessionDir(project, taskId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const metadata = {
    taskId,
    model,
    project,
    briefing,
    mode: headless ? 'headless' : 'interactive',
    agent: agent || 'code',
    thinking: thinking || 'medium',
    status: 'running',
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(SessionPaths.metadataFile(sessionDir), JSON.stringify(metadata, null, 2));

  return sessionDir;
}

/** Build MCP configuration from options */
function buildMcpConfig(options) {
  const { mcp, mcpConfig } = options;
  let mcpServers = null;

  const fileConfig = loadMcpConfig(mcpConfig);
  if (fileConfig) {
    mcpServers = { ...fileConfig };
    logger.debug('Loaded MCP config from file', { serverCount: Object.keys(mcpServers).length });
  }

  if (mcp) {
    const parsed = parseMcpSpec(mcp);
    if (parsed) {
      mcpServers = mcpServers || {};
      mcpServers[parsed.name] = parsed.config;
      logger.debug('Added CLI MCP server', { name: parsed.name });
    } else {
      logger.warn('Invalid MCP server spec', { mcp });
    }
  }

  return mcpServers;
}

/** Run sidecar in interactive mode (Electron GUI) */
async function runInteractive(model, systemPrompt, userMessage, taskId, project, options = {}) {
  const { agent, isResume, conversation, mcp } = options;

  return new Promise((resolve, _reject) => {
    const electronPath = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron');
    const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');

    const nodeModulesBin = path.join(__dirname, '..', '..', 'node_modules', '.bin');
    const existingPath = process.env.PATH || '';
    const env = buildElectronEnv(
      taskId, model, systemPrompt, userMessage, project,
      nodeModulesBin, existingPath, agent, isResume, conversation, mcp
    );

    const debugPort = process.env.SIDECAR_DEBUG_PORT || '9222';
    logger.debug('Launching Electron', { taskId, model, debugPort });

    const electronProcess = spawn(electronPath, [
      `--remote-debugging-port=${debugPort}`,
      mainPath
    ], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });

    handleElectronProcess(electronProcess, taskId, resolve);
  });
}

/** Build environment variables for Electron process */
function buildElectronEnv(taskId, model, systemPrompt, userMessage, project,
                          nodeModulesBin, existingPath, agent, isResume, conversation, mcp) {
  const env = {
    ...process.env,
    PATH: `${nodeModulesBin}:${existingPath}`,
    SIDECAR_TASK_ID: taskId,
    SIDECAR_MODEL: model,
    SIDECAR_SYSTEM_PROMPT: systemPrompt,
    SIDECAR_USER_MESSAGE: userMessage,
    SIDECAR_PROJECT: project
  };

  if (agent) {
    const agentConfig = mapAgentToOpenCode(agent);
    env.SIDECAR_AGENT = agentConfig.agent;
    if (agentConfig.permissions) { env.SIDECAR_PERMISSIONS = agentConfig.permissions; }
  }

  if (isResume) {
    env.SIDECAR_RESUME = 'true';
    if (conversation) { env.SIDECAR_CONVERSATION = conversation; }
  }

  if (mcp) { env.SIDECAR_MCP_CONFIG = JSON.stringify(mcp); }

  return env;
}

/** Handle Electron process stdout/stderr and exit */
function handleElectronProcess(electronProcess, taskId, resolve) {
  let stdout = '';

  electronProcess.stdout.on('data', (data) => { stdout += data.toString(); });

  electronProcess.stderr.on('data', (data) => {
    data.toString().trim().split('\n').filter(l => l.trim())
      .forEach(line => logger.debug('Electron', { output: line.trim() }));
  });

  electronProcess.on('error', (error) => {
    logger.error('Electron process error', { error: error.message });
    resolve({
      summary: '', completed: false, timedOut: false, taskId,
      error: `Failed to start Electron: ${error.message}`
    });
  });

  electronProcess.on('close', (code) => {
    logger.debug('Electron closed', { code, stdoutLength: stdout.length });
    resolve({
      summary: stdout.trim() || 'Session ended without summary.',
      completed: code === 0, timedOut: false, taskId, exitCode: code
    });
  });
}

/** Start a new sidecar session - Spec Reference: §4.1, §9 */
async function startSidecar(options) {
  const {
    model, briefing, session = 'current', project = process.cwd(),
    contextTurns = 50, contextSince, contextMaxTokens = 80000,
    headless = false, timeout = 15, agent, mcp, mcpConfig,
    summaryLength = 'normal', thinking
  } = options;

  const mcpServers = buildMcpConfig({ mcp, mcpConfig });
  const taskId = generateTaskId();
  logger.info('Starting task', { taskId, model, mode: headless ? 'headless' : 'interactive' });

  // Build context and prompts
  const context = buildContext(project, session, { contextTurns, contextSince, contextMaxTokens });
  const { system: systemPrompt, userMessage } = buildPrompts(
    briefing, context, project, headless, agent, summaryLength
  );

  // Create session
  const sessionDir = createSessionMetadata(taskId, project, { model, briefing, headless, agent, thinking });
  saveInitialContext(sessionDir, systemPrompt, userMessage);

  // Start heartbeat
  const heartbeat = createHeartbeat();

  let summary;
  const reasoning = thinking ? { effort: thinking } : undefined;

  try {
    if (headless) {
      const result = await runHeadless(
        model, systemPrompt, userMessage, taskId, project,
        timeout * 60 * 1000, agent,
        { mcp: mcpServers, summaryLength, reasoning }
      );
      summary = result.summary || '## Sidecar Results: No Output\n\nHeadless mode completed without summary.';

      if (result.timedOut) { logger.warn('Task timed out', { taskId }); }
      if (result.error) { logger.error('Task error', { taskId, error: result.error }); }
    } else {
      logger.info('Launching interactive sidecar', { taskId, model, agent: agent || 'code' });
      const result = await runInteractive(
        model, systemPrompt, userMessage, taskId, project,
        { agent, mcp: mcpServers, reasoning }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive task error', { taskId, error: result.error }); }
    }
  } finally {
    heartbeat.stop();
  }

  // Output summary
  outputSummary(summary);

  // Finalize session - load metadata for finalization
  const metaPath = SessionPaths.metadataFile(sessionDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  finalizeSession(sessionDir, summary, project, meta);
}

module.exports = {
  generateTaskId,
  createSessionMetadata,
  buildMcpConfig,
  runInteractive,
  startSidecar,
  HEARTBEAT_INTERVAL
};
