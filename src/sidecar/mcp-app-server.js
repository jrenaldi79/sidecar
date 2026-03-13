/**
 * MCP App Server Mode
 *
 * Starts an OpenCode server for MCP App inline UI. Unlike headless mode,
 * this does NOT poll for autonomous completion. The server stays alive
 * until the session is folded or aborted externally (via MCP tools).
 *
 * Flow: start server -> create session -> send initial prompt -> keep alive
 * The MCP App iframe handles interactive chat via sidecar_app_send/messages/fold.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { ensureNodeModulesBinInPath } = require('../utils/path-setup');
const { mapAgentToOpenCode } = require('../utils/agent-mapping');
const { writeProgress } = require('./progress');
const { writeSessionInfo } = require('./session-utils');

/** Poll interval for checking if session was folded/aborted (ms) */
const KEEPALIVE_POLL_MS = 5000;

/**
 * Run an MCP App server session.
 * Starts OpenCode, creates a session, sends the initial prompt,
 * then keeps the server alive until folded or aborted.
 *
 * @param {string} model - Model identifier
 * @param {string} systemPrompt - System prompt (instructions)
 * @param {string} userMessage - Initial user message (briefing)
 * @param {string} taskId - Unique task identifier
 * @param {string} project - Project directory path
 * @param {object} [options] - Additional options
 * @param {object} [options.mcp] - MCP server configurations
 * @param {object} [options.reasoning] - Reasoning configuration
 * @param {string} [options.agent] - Agent mode (default: 'chat')
 * @param {string} [options.client] - Client type
 * @returns {Promise<object>} Result with opencodeSessionId
 */
async function runMcpAppServer(model, systemPrompt, userMessage, taskId, project, options = {}) {
  const {
    createSession,
    sendPromptAsync,
    checkHealth,
    startServer
  } = require('../opencode-client');

  const { reasoning, agent } = options;
  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }

  writeProgress(sessionDir, 'initializing');
  ensureNodeModulesBinInPath();

  // Start OpenCode server (port 0 = OS auto-assign)
  logger.debug('Starting OpenCode server for MCP App', { model, taskId });
  let client, server;

  try {
    const serverOptions = { port: 0, client: options.client };
    if (options.mcp) { serverOptions.mcp = options.mcp; }
    const result = await startServer(serverOptions);
    client = result.client;
    server = result.server;
    logger.debug('MCP App server started', { url: server.url });
  } catch (error) {
    logger.error('Failed to start OpenCode server for MCP App', { error: error.message });
    return { summary: '', completed: false, taskId, error: `Failed to start server: ${error.message}` };
  }

  let sessionId;

  try {
    // Wait for server health
    const { waitForServer } = require('../headless');
    const serverReady = await waitForServer(client, checkHealth);
    writeProgress(sessionDir, 'server_ready');

    if (!serverReady) {
      server.close();
      return { summary: '', completed: false, taskId, error: 'OpenCode server failed to start' };
    }

    // Create session
    sessionId = await createSession(client);
    writeProgress(sessionDir, 'session_created');

    // Write port + session ID to metadata for MCP App tools
    const serverPort = new URL(server.url).port;
    writeSessionInfo(sessionDir, serverPort, sessionId);
    logger.info('MCP App session ready', { taskId, sessionId, port: serverPort });

    // Send initial prompt
    const agentConfig = mapAgentToOpenCode(agent || 'chat');
    const promptOptions = {
      model,
      system: systemPrompt,
      parts: [{ type: 'text', text: userMessage }],
      agent: agentConfig.agent
    };
    if (reasoning) { promptOptions.reasoning = reasoning; }

    await sendPromptAsync(client, sessionId, promptOptions);
    writeProgress(sessionDir, 'prompt_sent');
    logger.info('Initial prompt sent, entering keep-alive', { taskId });

    // Keep-alive: wait until session is folded, aborted, or errored
    await keepAlive(sessionDir, taskId);

    server.close();
    return { summary: '', completed: true, taskId, opencodeSessionId: sessionId };

  } catch (error) {
    logger.error('MCP App server error', { taskId, error: error.message });
    if (sessionId) {
      try {
        const { abortSession } = require('../opencode-client');
        await abortSession(client, sessionId);
      } catch { /* ignore */ }
    }
    server.close();
    return { summary: '', completed: false, taskId, error: error.message };
  }
}

/**
 * Keep the process alive until the session is no longer running.
 * Checks metadata.status periodically and exits when folded/aborted/errored.
 *
 * @param {string} sessionDir - Path to session directory
 * @param {string} taskId - Task identifier (for logging)
 */
async function keepAlive(sessionDir, taskId) {
  const metaPath = path.join(sessionDir, 'metadata.json');

  for (;;) {
    await new Promise(resolve => setTimeout(resolve, KEEPALIVE_POLL_MS));

    try {
      if (!fs.existsSync(metaPath)) { break; }
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta.status !== 'running') {
        logger.info('MCP App session ended', { taskId, status: meta.status });
        break;
      }
    } catch {
      // Ignore transient read errors
    }
  }
}

module.exports = { runMcpAppServer, keepAlive, KEEPALIVE_POLL_MS };
