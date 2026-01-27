/**
 * Electron Main Process - Version 2
 *
 * Uses custom chat UI instead of hacking OpenCode's web interface.
 * Communicates with OpenCode via HTTP API.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  createSession: sdkCreateSession,
  createChildSession,
  checkHealth,
  startServer: sdkStartServer,
  sendPrompt,
  getMessages,
  getSessionStatus
} = require('../src/opencode-client');
const { validateAgentType, getAgentType, getAgentTools } = require('../src/agent-types');
const { ensurePortAvailable } = require('../src/utils/server-setup');
const { getModelForAgent, loadConfig, saveConfig } = require('../src/utils/agent-model-config');
const { ensureNodeModulesBinInPath } = require('../src/utils/path-setup');
const { logger } = require('../src/utils/logger');

// ============================================================================
// Configuration
// ============================================================================

const WINDOW_CONFIG = {
  width: 720,
  height: 850,
  minWidth: 550,
  minHeight: 600,
  frame: true,
  backgroundColor: '#262624',
  title: 'Sidecar',
  titleBarStyle: 'hiddenInset',
  trafficLightPosition: { x: 12, y: 12 }
};

const START_PORT = 4440;
const SERVER_CHECK = {
  maxRetries: 30,
  retryDelayMs: 500
};

// ============================================================================
// Environment Variables
// ============================================================================

const taskId = process.env.SIDECAR_TASK_ID || 'unknown';
const model = process.env.SIDECAR_MODEL || 'unknown';
const systemPrompt = process.env.SIDECAR_SYSTEM_PROMPT || '';
const userMessage = process.env.SIDECAR_USER_MESSAGE || '';
const project = process.env.SIDECAR_PROJECT || process.cwd();
const agent = process.env.SIDECAR_AGENT || 'code';

// Parse MCP config from environment (passed as JSON string)
let mcpConfig = null;
if (process.env.SIDECAR_MCP_CONFIG) {
  try {
    mcpConfig = JSON.parse(process.env.SIDECAR_MCP_CONFIG);
    logger.info('MCP config loaded', { serverCount: Object.keys(mcpConfig).length });
  } catch (err) {
    logger.error('Failed to parse MCP config', { error: err.message });
  }
}

// ============================================================================
// State
// ============================================================================

let mainWindow = null;
let sdkServer = null;
let sdkClient = null;
let sessionId = null;
const conversationLog = [];

// Request cancellation state
let currentAbortController = null;
let isRequestInFlight = false;

// Health check state
let lastHealthCheck = null;
// Health status is tracked but currently unused (for future health monitoring)
// eslint-disable-next-line no-unused-vars
let lastHealthStatus = false;

const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);

// ============================================================================
// Server Management
// ============================================================================

/**
 * Wait for the OpenCode server to be ready using SDK health check
 */
async function waitForServer(client, retries = SERVER_CHECK.maxRetries) {
  for (let i = 0; i < retries; i++) {
    try {
      const isHealthy = await checkHealth(client);
      if (isHealthy) {
        return true;
      }
    } catch (err) {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, SERVER_CHECK.retryDelayMs));
  }
  throw new Error('Server failed to start');
}

/**
 * Start OpenCode server using SDK (no CLI spawning)
 */
async function startOpenCodeServer() {
  logger.info('Starting OpenCode server via SDK');

  // CRITICAL: Ensure node_modules/.bin is in PATH so SDK can find 'opencode' wrapper
  // Without this, SDK's spawn('opencode', ...) fails with ENOENT
  ensureNodeModulesBinInPath();
  logger.debug('PATH configured for opencode lookup');

  // Ensure port is available (kills stale processes from previous sessions)
  if (!ensurePortAvailable(START_PORT)) {
    throw new Error(`Port ${START_PORT} is in use and could not be freed`);
  }
  logger.debug('Port available', { port: START_PORT });

  // Build server options with MCP config if available
  const serverOptions = { port: START_PORT };
  if (mcpConfig) {
    serverOptions.mcp = mcpConfig;
    logger.info('MCP servers will be loaded', { servers: Object.keys(mcpConfig) });
  }

  // Use SDK to start the server programmatically
  logger.debug('Spawning OpenCode server process');
  try {
    const result = await sdkStartServer(serverOptions);
    sdkServer = result.server;
    sdkClient = result.client;
    logger.info('Server process started', { url: sdkServer.url });
  } catch (err) {
    logger.error('Failed to start server', {
      error: err.message,
      hint: 'opencode command not found - check opencode-ai is installed'
    });
    throw err;
  }

  logger.debug('Waiting for server health check', { url: sdkServer.url });
  await waitForServer(sdkClient);
  logger.info('Server ready and accepting connections');

  return { serverUrl: sdkServer.url, client: sdkClient };
}

// ============================================================================
// Window Creation
// ============================================================================

async function createWindow() {
  // Ensure session directory exists
  fs.mkdirSync(sessionDir, { recursive: true });

  // Save initial context
  fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), systemPrompt);

  // Start OpenCode server (returns SDK client)
  const { serverUrl: apiBase, client } = await startOpenCodeServer();

  // Create a session via SDK
  try {
    logger.debug('Creating session');
    sessionId = await sdkCreateSession(client);
    logger.info('Session created', { sessionId });
  } catch (err) {
    logger.error('Failed to create session', { error: err.message });
    cleanup();
    process.exit(1);
  }

  // Create browser window
  mainWindow = new BrowserWindow({
    ...WINDOW_CONFIG,
    webPreferences: {
      preload: path.join(__dirname, 'preload-v2.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow file:// to localhost API requests (needed for OpenCode)
      webSecurity: false
    }
  });

  // Load our custom UI
  const uiPath = path.join(__dirname, 'ui', 'index.html');
  await mainWindow.loadFile(uiPath);

  // Inject configuration AFTER page loads
  // Pass system prompt and user message separately for proper OpenCode API usage
  await mainWindow.webContents.executeJavaScript(`
    window.sidecarConfig = {
      taskId: '${taskId}',
      model: '${model}',
      apiBase: '${apiBase}',
      sessionId: '${sessionId}',
      systemPrompt: ${JSON.stringify(systemPrompt)},
      userMessage: ${JSON.stringify(userMessage)},
      agent: '${agent}'
    };
    console.log('[Sidecar] Config injected:', window.sidecarConfig);
  `);

  // Re-initialize the UI with the config
  await mainWindow.webContents.executeJavaScript(`
    if (typeof init === 'function') {
      init();
    }
  `);


  // For testing, capture a screenshot if a specific env var is set
  if (process.env.SIDECAR_SCREENSHOT_PATH) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.capturePage().then(image => {
        require('fs').writeFile(process.env.SIDECAR_SCREENSHOT_PATH, image.toPNG(), (err) => {
          if (err) {
            logger.error('Failed to capture screenshot', { error: err.message });
          } else {
            logger.debug('Screenshot captured', { path: process.env.SIDECAR_SCREENSHOT_PATH });
          }

        });
      });
    });
  }

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });
}

// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle('log-message', (_event, msg) => {
  conversationLog.push(msg);

  // Write to file in real-time
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');
  fs.appendFileSync(conversationPath, JSON.stringify(msg) + '\n');
});

ipcMain.handle('fold', async () => {
  logger.info('Fold triggered');

  // Get the last assistant message as summary
  const lastAssistant = [...conversationLog].reverse().find(m => m.role === 'assistant');
  const summary = lastAssistant?.content || 'Session ended without summary.';

  // Output summary to stdout
  process.stdout.write(summary);

  // Save summary to file
  const summaryPath = path.join(sessionDir, 'summary.md');
  fs.writeFileSync(summaryPath, summary);

  // Cleanup and quit
  cleanup();
  app.quit();
});

ipcMain.handle('get-config', () => {
  return {
    taskId,
    model,
    apiBase: sdkServer ? sdkServer.url : '',
    sessionId,
    systemPrompt,
    userMessage
  };
});

// ============================================================================
// Sub-Agent IPC Handlers
// ============================================================================

// Store for tracking sub-agent sessions
const subagentSessions = new Map();

ipcMain.handle('spawn-subagent', async (_event, config) => {
  const { agentType, briefing, parentSessionId, model: explicitModel } = config;

  // Validate agent type
  if (!validateAgentType(agentType)) {
    throw new Error(`Invalid agent type: ${agentType}`);
  }

  if (!briefing) {
    throw new Error('Briefing is required');
  }

  // Resolve model using agent-model configuration
  // Priority: explicit model > configured model for agent type > parent model
  let resolvedModel = model; // Parent model from environment
  let modelWasRouted = false;

  if (explicitModel) {
    resolvedModel = explicitModel;
    modelWasRouted = false;
  } else {
    const modelConfig = getModelForAgent(agentType, model);
    resolvedModel = modelConfig.model;
    modelWasRouted = modelConfig.wasRouted;
  }

  logger.info('Spawning sub-agent', {
    agentType,
    model: resolvedModel,
    modelWasRouted,
    briefingPreview: briefing.substring(0, 50)
  });

  try {
    // Create child session
    const childSessionId = await createChildSession(sdkClient, parentSessionId);

    // Build system prompt for sub-agent
    const agentConfig = getAgentType(agentType);
    const tools = getAgentTools(agentType);

    let subagentSystemPrompt = `You are a ${agentType} sub-agent. ${agentConfig.description}\n\n`;
    subagentSystemPrompt += 'Tool Permissions:\n';
    subagentSystemPrompt += `- Read files: ${tools.read ? 'Yes' : 'No'}\n`;
    subagentSystemPrompt += `- Write files: ${tools.write ? 'Yes' : 'No'}\n`;
    subagentSystemPrompt += `- Run bash: ${tools.bash === true ? 'Yes' : tools.bash === false ? 'No' : tools.bash}\n`;
    subagentSystemPrompt += `- Spawn sub-tasks: ${tools.task ? 'Yes' : 'No'}\n\n`;
    subagentSystemPrompt += 'When you have completed your task, provide a concise summary of your findings.';

    // Send initial prompt to child session with resolved model
    await sendPrompt(sdkClient, childSessionId, {
      model: resolvedModel,
      system: subagentSystemPrompt,
      parts: [{ type: 'text', text: briefing }],
      tools
    });

    // Track the sub-agent session with model info
    subagentSessions.set(childSessionId, {
      agentType,
      briefing,
      model: resolvedModel,
      modelWasRouted,
      parentSessionId,
      startedAt: new Date(),
      completed: false,
      result: null
    });

    // Create sub-agent directory for persistence
    const subagentDir = path.join(sessionDir, 'subagents', childSessionId);
    fs.mkdirSync(subagentDir, { recursive: true });

    // Log the spawn with model info
    fs.writeFileSync(path.join(subagentDir, 'metadata.json'), JSON.stringify({
      agentType,
      briefing,
      model: resolvedModel,
      modelWasRouted,
      parentSessionId,
      startedAt: new Date().toISOString()
    }, null, 2));

    return {
      childSessionId,
      model: resolvedModel,
      modelWasRouted
    };

  } catch (error) {
    logger.error('Failed to spawn sub-agent', { error: error.message, agentType });
    throw error;
  }
});

ipcMain.handle('get-subagent-status', async (_event, childSessionId) => {
  const subagent = subagentSessions.get(childSessionId);

  if (!subagent) {
    throw new Error(`Sub-agent not found: ${childSessionId}`);
  }

  if (subagent.completed) {
    return { completed: true };
  }

  try {
    // Check session status via SDK
    const status = await getSessionStatus(sdkClient, childSessionId);

    // Check if the session has completed (no pending operations)
    const completed = status.status === 'completed' || status.status === 'idle';

    if (completed && !subagent.completed) {
      subagent.completed = true;
      subagent.completedAt = new Date();
    }

    return { completed };

  } catch (error) {
    logger.warn('Error checking sub-agent status', { error: error.message, childSessionId });
    return { completed: false };
  }
});

ipcMain.handle('get-subagent-result', async (_event, childSessionId) => {
  const subagent = subagentSessions.get(childSessionId);

  if (!subagent) {
    throw new Error(`Sub-agent not found: ${childSessionId}`);
  }

  try {
    // Get messages from child session
    const messages = await getMessages(sdkClient, childSessionId);

    // Find the last assistant message as the summary
    const lastAssistant = [...messages].reverse().find(m =>
      m.role === 'assistant' || (m.parts && m.parts.some(p => p.type === 'text'))
    );

    let summary = 'No result available.';
    if (lastAssistant) {
      if (lastAssistant.content) {
        summary = lastAssistant.content;
      } else if (lastAssistant.parts) {
        const textPart = lastAssistant.parts.find(p => p.type === 'text');
        if (textPart) {
          summary = textPart.text;
        }
      }
    }

    // Save the result
    subagent.result = summary;

    // Persist to file
    const subagentDir = path.join(sessionDir, 'subagents', childSessionId);
    fs.writeFileSync(path.join(subagentDir, 'summary.md'), summary);

    return { summary };

  } catch (error) {
    logger.error('Error getting sub-agent result', { error: error.message, childSessionId });
    throw error;
  }
});

// ============================================================================
// Agent-Model Configuration IPC Handlers
// ============================================================================

ipcMain.handle('get-agent-model-config', () => {
  return loadConfig();
});

ipcMain.handle('set-agent-model-config', (_event, config) => {
  return saveConfig(config);
});

// ============================================================================
// Request Cancellation IPC Handlers
// ============================================================================

ipcMain.handle('cancel-request', async () => {
  logger.info('Cancel request triggered');

  if (!isRequestInFlight) {
    return { success: false, message: 'No request in flight' };
  }

  try {
    // Abort the current request if we have an AbortController
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    isRequestInFlight = false;

    // Notify the renderer that the request was cancelled
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('request-cancelled');
    }

    return { success: true, message: 'Request cancelled' };
  } catch (error) {
    logger.error('Error cancelling request', { error: error.message });
    return { success: false, message: error.message };
  }
});

ipcMain.handle('set-request-state', (_event, inFlight) => {
  isRequestInFlight = inFlight;
  if (inFlight) {
    currentAbortController = new AbortController();
  } else {
    currentAbortController = null;
  }
  return { success: true };
});

ipcMain.handle('get-abort-signal', () => {
  // Note: AbortSignal cannot be directly passed via IPC
  // The renderer will need to handle cancellation via the 'request-cancelled' event
  return { hasController: !!currentAbortController };
});

// ============================================================================
// Server Health Check IPC Handlers
// ============================================================================

ipcMain.handle('check-server-health', async () => {
  try {
    if (!sdkClient) {
      return { healthy: false, lastCheck: new Date().toISOString() };
    }

    const isHealthy = await checkHealth(sdkClient);
    lastHealthStatus = isHealthy;
    lastHealthCheck = new Date().toISOString();

    return { healthy: isHealthy, lastCheck: lastHealthCheck };
  } catch (error) {
    logger.warn('Health check error', { error: error.message });
    lastHealthStatus = false;
    lastHealthCheck = new Date().toISOString();
    return { healthy: false, lastCheck: lastHealthCheck };
  }
});

// ============================================================================
// Cleanup
// ============================================================================

function cleanup() {
  if (sdkServer) {
    logger.info('Stopping OpenCode server');
    sdkServer.close();
    sdkServer = null;
    sdkClient = null;
  }
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(createWindow).catch((err) => {
  logger.error('Failed to start Electron app', { error: err.message });
  process.exit(1);
});

app.on('window-all-closed', () => {
  logger.info('Window closed without FOLD');

  // Get the last assistant message as summary (same as fold)
  const lastAssistant = [...conversationLog].reverse().find(m => m.role === 'assistant');
  const summary = lastAssistant?.content || '';

  // If we have a summary, output it
  if (summary) {
    // Save summary to file
    const summaryPath = path.join(sessionDir, 'summary.md');
    fs.writeFileSync(summaryPath, summary);

    // Output to stdout so CLI receives it
    process.stdout.write(summary);
  }

  cleanup();
  app.quit();
});

app.on('quit', cleanup);

module.exports = { WINDOW_CONFIG, START_PORT };
