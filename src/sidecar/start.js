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
  startOpenCodeServer,
  HEARTBEAT_INTERVAL
} = require('./session-utils');
const { buildPrompts } = require('../prompt-builder');
const { runHeadless } = require('../headless');
const { logger } = require('../utils/logger');
const { loadMcpConfig, parseMcpSpec } = require('../opencode-client');
const { mapAgentToOpenCode } = require('../utils/agent-mapping');
const { checkConfigChanged } = require('../utils/config');

/** Generate a unique 8-character hex task ID */
function generateTaskId() {
  return crypto.randomBytes(4).toString('hex');
}

/** Create session directory and save metadata */
function createSessionMetadata(taskId, project, options) {
  const { model, prompt, briefing, noUi, headless, agent, thinking } = options;

  const sessionDir = SessionPaths.sessionDir(project, taskId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const effectiveBriefing = prompt || briefing;
  const isHeadless = noUi !== undefined ? noUi : headless;

  const metadata = {
    taskId,
    model,
    project,
    briefing: effectiveBriefing,
    mode: isHeadless ? 'headless' : 'interactive',
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
  const { agent, isResume, conversation, mcp, reasoning } = options;
  const { createSession, sendPromptAsync } = require('../opencode-client');

  // Start OpenCode server (shared with headless mode)
  let client, server;
  try {
    const result = await startOpenCodeServer(mcp);
    client = result.client;
    server = result.server;
  } catch (error) {
    logger.error('Failed to start OpenCode server', { error: error.message });
    return {
      summary: '', completed: false, timedOut: false, taskId,
      error: `Failed to start server: ${error.message}`
    };
  }

  // Create session and send initial prompt
  let sessionId;
  try {
    sessionId = await createSession(client);

    const promptOptions = {
      model, system: systemPrompt,
      parts: [{ type: 'text', text: userMessage }]
    };

    if (agent) {
      const agentConfig = mapAgentToOpenCode(agent);
      promptOptions.agent = agentConfig.agent;
      if (agentConfig.permissions) { promptOptions.permissions = agentConfig.permissions; }
    }
    if (reasoning) { promptOptions.reasoning = reasoning; }

    await sendPromptAsync(client, sessionId, promptOptions);
    logger.debug('Interactive session ready', { sessionId });
  } catch (error) {
    server.close();
    return {
      summary: '', completed: false, timedOut: false, taskId,
      error: `Session setup failed: ${error.message}`
    };
  }

  const serverPort = new URL(server.url).port;

  return new Promise((resolve, _reject) => {
    const electronPath = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron');
    const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');

    const nodeModulesBin = path.join(__dirname, '..', '..', 'node_modules', '.bin');
    const existingPath = process.env.PATH || '';
    const env = buildElectronEnv(
      taskId, model, project, nodeModulesBin, existingPath,
      { agent, isResume, conversation, mcp }
    );

    // Pass OpenCode server info to Electron
    env.SIDECAR_OPENCODE_PORT = serverPort;
    env.SIDECAR_SESSION_ID = sessionId;

    const debugPort = process.env.SIDECAR_DEBUG_PORT || '9222';
    logger.debug('Launching Electron', { taskId, model, debugPort, serverPort, sessionId });

    const electronProcess = spawn(electronPath, [
      `--remote-debugging-port=${debugPort}`,
      mainPath
    ], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });

    // Clean up server when Electron exits
    const originalResolve = resolve;
    handleElectronProcess(electronProcess, taskId, (result) => {
      server.close();
      logger.debug('OpenCode server closed after Electron exit');
      originalResolve(result);
    });
  });
}

/** Build environment variables for Electron process */
function buildElectronEnv(taskId, model, project, nodeModulesBin, existingPath, options = {}) {
  const { agent, isResume, conversation, mcp } = options;
  const env = {
    ...process.env,
    PATH: `${nodeModulesBin}:${existingPath}`,
    SIDECAR_TASK_ID: taskId,
    SIDECAR_MODEL: model,
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
    model, prompt, briefing, sessionId, session = 'current',
    cwd, project = process.cwd(), contextTurns = 50, contextSince,
    contextMaxTokens = 80000, noUi, headless = false, timeout = 15,
    agent, mcp, mcpConfig, summaryLength = 'normal', thinking,
    client, sessionDir
  } = options;

  const effectivePrompt = prompt || briefing;
  const effectiveSession = sessionId || session;
  const effectiveProject = cwd || project;
  const effectiveHeadless = noUi !== undefined ? noUi : headless;
  const mcpServers = buildMcpConfig({ mcp, mcpConfig });
  const taskId = generateTaskId();
  const reasoning = thinking ? { effort: thinking } : undefined;

  logger.info('Starting task', { taskId, model, mode: effectiveHeadless ? 'headless' : 'interactive' });

  // Check for config changes and emit update data to stderr
  const claudeMdPath = path.join(effectiveProject, 'CLAUDE.md');
  let currentHash = null;
  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    const match = content.match(/<!-- sidecar-config-hash: ([0-9a-f]+) -->/);
    if (match) { currentHash = match[1]; }
  }
  const configCheck = checkConfigChanged(currentHash);
  if (configCheck.changed) {
    process.stderr.write(`\n[SIDECAR_CONFIG_UPDATE] Model configuration has changed.\nUpdate your project doc file with:\n\n${configCheck.updateData}\n\n`);
  }

  const context = buildContext(effectiveProject, effectiveSession, { contextTurns, contextSince, contextMaxTokens, sessionDir, client });
  const { system: systemPrompt, userMessage } = buildPrompts(
    effectivePrompt, context, effectiveProject, effectiveHeadless, agent, summaryLength
  );

  const sessDir = createSessionMetadata(taskId, effectiveProject, {
    model, prompt: effectivePrompt, noUi: effectiveHeadless, agent, thinking
  });
  saveInitialContext(sessDir, systemPrompt, userMessage);

  const heartbeat = createHeartbeat();
  let summary;

  try {
    if (effectiveHeadless) {
      const result = await runHeadless(
        model, systemPrompt, userMessage, taskId, effectiveProject,
        timeout * 60 * 1000, agent, { mcp: mcpServers, summaryLength, reasoning }
      );
      summary = result.summary || '## Sidecar Results: No Output\n\nHeadless mode completed without summary.';
      if (result.timedOut) { logger.warn('Task timed out', { taskId }); }
      if (result.error) { logger.error('Task error', { taskId, error: result.error }); }
    } else {
      logger.info('Launching interactive sidecar', { taskId, model, agent: agent || 'code' });
      const result = await runInteractive(
        model, systemPrompt, userMessage, taskId, effectiveProject,
        { agent, mcp: mcpServers, reasoning }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive task error', { taskId, error: result.error }); }
    }
  } finally {
    heartbeat.stop();
  }

  outputSummary(summary);
  const metaPath = SessionPaths.metadataFile(sessDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  finalizeSession(sessDir, summary, effectiveProject, meta);
}

module.exports = {
  generateTaskId,
  createSessionMetadata,
  buildMcpConfig,
  runInteractive,
  startSidecar,
  HEARTBEAT_INTERVAL
};
