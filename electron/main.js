/**
 * Electron Main Process - Version 2
 *
 * Uses custom chat UI instead of hacking OpenCode's web interface.
 * Communicates with OpenCode via HTTP API.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Handle EPIPE errors gracefully (happens when stdout/stderr pipe closes)
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') return; // Ignore EPIPE
  console.error('stdout error:', err);
});
process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') return; // Ignore EPIPE
});

// Catch uncaught exceptions to prevent app crash
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') return; // Ignore EPIPE errors
  console.error('Uncaught exception:', err);
});
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

// Error tracking for diagnostics
const errorLog = [];
const MAX_ERROR_LOG_SIZE = 100;

/**
 * Log an error for diagnostics and potential server reporting
 * @param {string} source - Where the error occurred (renderer, main, network)
 * @param {string} message - Error message
 * @param {object} [context] - Additional context
 */
function logError(source, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    message,
    context,
    taskId,
    sessionId
  };

  errorLog.push(entry);
  if (errorLog.length > MAX_ERROR_LOG_SIZE) {
    errorLog.shift();
  }

  logger.error(`[${source}] ${message}`, context);

  // Write to error log file for post-mortem analysis
  const errorLogPath = path.join(sessionDir, 'errors.jsonl');
  try {
    fs.appendFileSync(errorLogPath, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Ignore write errors
  }
}

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
// Pre-Launch Validation
// ============================================================================

/**
 * Validate connectivity to the API before showing the UI
 * This helps detect issues like network service problems early
 *
 * NOTE: We intentionally DON'T send test messages to avoid polluting the session
 * with test data. We only check that the server endpoints are reachable.
 *
 * @param {string} apiBase - API base URL
 * @param {string} testSessionId - Session ID to test
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
async function validateConnectivity(apiBase, testSessionId) {
  const errors = [];
  const http = require('http');

  // Test 1: Can we reach the config endpoint?
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(`${apiBase}/config`, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Config endpoint returned ${res.statusCode}`));
        } else {
          // Consume the response
          res.on('data', () => {});
          res.on('end', resolve);
        }
      });
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Config request timeout'));
      });
    });
    logger.debug('Pre-launch: Config endpoint reachable');
  } catch (err) {
    errors.push(`Config endpoint: ${err.message}`);
  }

  // Test 2: Can we reach the session endpoint?
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(`${apiBase}/session/${testSessionId}`, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Session endpoint returned ${res.statusCode}`));
        } else {
          // Consume the response
          res.on('data', () => {});
          res.on('end', resolve);
        }
      });
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Session request timeout'));
      });
    });
    logger.debug('Pre-launch: Session endpoint reachable');
  } catch (err) {
    errors.push(`Session endpoint: ${err.message}`);
  }

  // Test 3: Check providers endpoint (validates API is functional without sending messages)
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(`${apiBase}/config/providers`, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Providers endpoint returned ${res.statusCode}`));
        } else {
          // Consume the response
          res.on('data', () => {});
          res.on('end', resolve);
        }
      });
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Providers request timeout'));
      });
    });
    logger.debug('Pre-launch: Providers endpoint reachable');
  } catch (err) {
    errors.push(`Providers endpoint: ${err.message}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
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

  // Pre-launch validation: Test API connectivity before showing UI
  // This catches issues like network service crashes early
  logger.debug('Running pre-launch validation');
  const validation = await validateConnectivity(apiBase, sessionId);
  if (!validation.valid) {
    logger.error('Pre-launch validation failed', { errors: validation.errors });
    logError('validation', 'Pre-launch validation failed', { errors: validation.errors });

    // Write validation errors to session directory for debugging
    const validationPath = path.join(sessionDir, 'validation_errors.json');
    fs.writeFileSync(validationPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      errors: validation.errors,
      apiBase,
      sessionId
    }, null, 2));

    // Exit with error - don't show a broken UI
    cleanup();
    process.exit(1);
  }
  logger.info('Pre-launch validation passed');

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
    logger.info('Window closed event triggered');
    mainWindow = null;
    cleanup();
  });

  // Log when window is about to close (can be prevented)
  mainWindow.on('close', (event) => {
    logger.info('Window close requested', { reason: 'close event' });
  });

  // ============================================================================
  // Crash and Error Detection
  // ============================================================================

  // Detect renderer process crash
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logError('renderer', 'Renderer process crashed', {
      reason: details.reason,
      exitCode: details.exitCode
    });

    // Attempt recovery for certain crash types
    if (details.reason === 'crashed' || details.reason === 'oom') {
      logger.warn('Attempting to recover from renderer crash');
      try {
        mainWindow.reload();
      } catch (e) {
        logError('renderer', 'Failed to recover from crash', { error: e.message });
      }
    }
  });

  // Detect unresponsive renderer
  mainWindow.webContents.on('unresponsive', () => {
    logError('renderer', 'Renderer became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    logger.info('Renderer became responsive again');
  });

  // Detect GPU/network service crashes via console messages
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    // Capture network service crash errors
    if (message.includes('Network service crashed') ||
        message.includes('network_service_instance_impl')) {
      logError('network', 'Network service crash detected', { message });
    }

    // Capture fetch failures that might indicate connectivity issues
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
      logError('network', 'Fetch failure detected', { message, line, sourceId });
    }

    // Forward errors and warnings to main process log
    if (level >= 2) { // Warning or Error
      logger.debug('Renderer console', { level, message: message.slice(0, 500) });
    }
  });

  // Detect certificate errors (could indicate network issues)
  mainWindow.webContents.on('certificate-error', (event, url, error) => {
    logError('network', 'Certificate error', { url, error });
  });

  // Detect navigation failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logError('renderer', 'Page failed to load', {
      errorCode,
      errorDescription,
      url: validatedURL
    });
  });
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Proxy API call from renderer through main process network stack
 * This bypasses Chromium's network service which can be unstable
 *
 * Note: OpenCode API returns chunked responses that may take 1-2 seconds
 * to complete. We use a response buffer and wait for the 'end' event.
 */
ipcMain.handle('proxy-api-call', async (_event, { method, endpoint, body }) => {
  const http = require('http');

  return new Promise((resolve, reject) => {
    const url = new URL(`${sdkServer.url}${endpoint}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method || 'GET',
      headers: {
        'Accept': 'application/json'
      }
    };

    let postData = null;
    if (body) {
      postData = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    logger.debug('IPC proxy request', {
      method,
      endpoint,
      hasBody: !!body,
      bodyPreview: body ? JSON.stringify(body).slice(0, 300) : null
    });

    const req = http.request(options, (res) => {
      // Use array to collect chunks (more efficient for large responses)
      const chunks = [];
      let totalSize = 0;

      logger.debug('IPC proxy response started', {
        status: res.statusCode,
        headers: {
          contentType: res.headers['content-type'],
          transferEncoding: res.headers['transfer-encoding']
        }
      });

      res.on('data', chunk => {
        chunks.push(chunk);
        totalSize += chunk.length;
        logger.debug('IPC proxy received chunk', { size: chunk.length, totalSize });
      });

      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        logger.debug('IPC proxy response complete', {
          status: res.statusCode,
          bodyLength: responseBody.length,
          bodyPreview: responseBody.slice(0, 100)
        });

        try {
          const data = responseBody ? JSON.parse(responseBody) : null;
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data
          });
        } catch (err) {
          resolve({
            ok: false,
            status: res.statusCode,
            error: `JSON parse error: ${err.message}`,
            rawBody: responseBody.slice(0, 500)
          });
        }
      });

      // Handle response errors
      res.on('error', (err) => {
        logError('proxy', 'Response stream error', { endpoint, error: err.message });
        reject(err);
      });
    });

    req.on('error', (err) => {
      logError('proxy', 'API proxy request failed', { endpoint, error: err.message });
      reject(err);
    });

    // 5 minute timeout for long-running API calls (LLM responses can take a while)
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
});

ipcMain.handle('log-message', (_event, msg) => {
  conversationLog.push(msg);

  // Write to file in real-time
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');
  fs.appendFileSync(conversationPath, JSON.stringify(msg) + '\n');
});

// Error reporting from renderer
ipcMain.handle('report-error', (_event, errorData) => {
  logError(errorData.source || 'renderer', errorData.message, {
    ...errorData.context,
    stack: errorData.stack
  });

  // Return error log for diagnostics
  return { logged: true, errorCount: errorLog.length };
});

// Get error log for diagnostics
ipcMain.handle('get-error-log', () => {
  return errorLog;
});

// Health check endpoint for renderer to verify connectivity
ipcMain.handle('health-check', async () => {
  const checks = {
    timestamp: Date.now(),
    server: false,
    session: false,
    apiReachable: false
  };

  try {
    if (sdkClient) {
      checks.server = await checkHealth(sdkClient);
    }
    checks.session = !!sessionId;

    // Quick API connectivity test
    if (sdkServer) {
      const http = require('http');
      await new Promise((resolve, reject) => {
        const req = http.get(`${sdkServer.url}/config`, (res) => {
          checks.apiReachable = res.statusCode === 200;
          resolve();
        });
        req.on('error', reject);
        req.setTimeout(2000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
    }
  } catch (err) {
    logError('main', 'Health check failed', { error: err.message });
  }

  return checks;
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

  // Resolve model: explicit model takes priority, otherwise use parent model
  const resolvedModel = explicitModel || model;

  logger.info('Spawning sub-agent', {
    agentType,
    model: resolvedModel,
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
// SSE Streaming IPC Handlers
// ============================================================================

// SSE connection state
let sseRequest = null;

/**
 * Subscribe to SSE events from the OpenCode server.
 * Events are forwarded to the renderer process.
 */
ipcMain.handle('subscribe-sse', async () => {
  if (sseRequest) {
    logger.debug('SSE already subscribed');
    return { success: true, message: 'Already subscribed' };
  }

  if (!sdkServer) {
    logger.error('Cannot subscribe to SSE: server not started');
    return { success: false, message: 'Server not started' };
  }

  const http = require('http');

  try {
    const url = new URL(`${sdkServer.url}/global/event`);
    logger.info('Subscribing to SSE', { url: url.href });

    sseRequest = http.get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        logger.error('SSE connection failed', { status: res.statusCode });
        sseRequest = null;
        return;
      }

      logger.info('SSE connection established');

      // Buffer for incomplete SSE messages
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();

        // Process complete SSE messages (separated by double newlines)
        const messages = buffer.split('\n\n');
        buffer = messages.pop() || ''; // Keep incomplete message in buffer

        for (const message of messages) {
          if (!message.trim()) continue;

          // Parse SSE format: "event: eventType\ndata: jsonData"
          const lines = message.split('\n');
          let eventType = 'message';
          let eventData = null;

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              try {
                eventData = JSON.parse(dataStr);
              } catch {
                eventData = dataStr;
              }
            }
          }

          if (eventData !== null) {
            logger.debug('SSE event received', { eventType, dataPreview: JSON.stringify(eventData).slice(0, 100) });

            // Forward to renderer
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send('sse-event', {
                type: eventType,
                data: eventData
              });
            }
          }
        }
      });

      res.on('end', () => {
        logger.info('SSE connection closed by server');
        sseRequest = null;
      });

      res.on('error', (err) => {
        logger.error('SSE stream error', { error: err.message });
        sseRequest = null;
      });
    });

    sseRequest.on('error', (err) => {
      logger.error('SSE request error', { error: err.message });
      sseRequest = null;
    });

    return { success: true };

  } catch (error) {
    logger.error('Failed to subscribe to SSE', { error: error.message });
    return { success: false, message: error.message };
  }
});

/**
 * Unsubscribe from SSE events.
 */
ipcMain.handle('unsubscribe-sse', () => {
  if (sseRequest) {
    logger.info('Unsubscribing from SSE');
    sseRequest.destroy();
    sseRequest = null;
  }
  return { success: true };
});

/**
 * Send a message asynchronously (returns immediately, progress via SSE).
 * This uses the prompt_async endpoint.
 */
ipcMain.handle('send-message-async', async (_event, { sessionId: targetSessionId, content, model: msgModel, system, reasoning }) => {
  const http = require('http');

  const sid = targetSessionId || sessionId;
  if (!sid) {
    return { ok: false, error: 'No session ID' };
  }

  return new Promise((resolve, reject) => {
    // Use the standard /message endpoint
    // SSE events will provide real-time streaming updates
    const url = new URL(`${sdkServer.url}/session/${sid}/message`);

    // Build request body matching the sync API format
    const body = {
      parts: [{ type: 'text', text: content }]
    };

    // Add optional parameters
    if (msgModel) {
      body.model = msgModel;
    }
    if (system) {
      body.system = system;
    }
    if (reasoning) {
      body.reasoning = reasoning;
    }

    const postData = JSON.stringify(body);

    logger.info('Sending async message', {
      sessionId: sid,
      contentPreview: content.slice(0, 50),
      hasModel: !!msgModel,
      hasReasoning: !!reasoning
    });

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk.toString();
      });

      res.on('end', () => {
        logger.debug('Async message sent', { status: res.statusCode });

        try {
          const data = responseBody ? JSON.parse(responseBody) : null;
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data
          });
        } catch (err) {
          resolve({
            ok: false,
            status: res.statusCode,
            error: `JSON parse error: ${err.message}`
          });
        }
      });
    });

    req.on('error', (err) => {
      logger.error('Async message error', { error: err.message });
      reject(err);
    });

    // Use longer timeout for LLM responses (5 minutes)
    // The /message endpoint blocks until the model completes
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
});

// ============================================================================
// Cleanup
// ============================================================================

function cleanup() {
  // Close SSE connection
  if (sseRequest) {
    logger.debug('Closing SSE connection');
    sseRequest.destroy();
    sseRequest = null;
  }

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
