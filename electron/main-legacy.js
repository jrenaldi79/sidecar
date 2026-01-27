/**
 * Electron Main Process
 *
 * Spec Reference:
 * - 9.2 Electron Shell
 * - 14.3 Styling Investigation
 *
 * Creates the sidecar GUI window wrapping OpenCode's web UI.
 *
 * Window Configuration (per spec):
 * - 500x900 dimensions
 * - Frameless
 * - Always on top
 * - Dark background (#0d0d0d)
 *
 * Environment Variables:
 * - SIDECAR_TASK_ID: Unique identifier for this sidecar session
 * - SIDECAR_MODEL: Model being used (e.g., google/gemini-2.5)
 * - SIDECAR_SYSTEM_PROMPT: Initial system prompt for the conversation
 * - SIDECAR_PROJECT: Project directory path
 * - SIDECAR_RESUME: 'true' if resuming a previous session
 * - SIDECAR_CONVERSATION: Previous conversation JSONL for resume
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

// ============================================================================
// Configuration (Spec 9.2)
// ============================================================================

const theme = require('./theme.js');

/** Window dimensions per spec */
const WINDOW_CONFIG = {
  width: 700,
  height: 900,
  frame: true,  // Use framed window to avoid macOS security issues with frameless
  alwaysOnTop: false,  // Don't force always on top
  backgroundColor: theme.dark.background,  // Claude Desktop dark theme background
  title: 'Sidecar'
};

/** Starting port for OpenCode server */
const START_PORT = 4440;

/** Server readiness check configuration */
const SERVER_CHECK = {
  maxRetries: 30,
  retryDelayMs: 500
};

/** Summary prompt injected on Fold (Spec 6.1) */
const SUMMARY_PROMPT = `Generate a handoff summary of our conversation. Format as:

## Sidecar Results: [Brief Title]

**Task:** [What was requested]
**Findings:** [Key discoveries]
**Recommendations:** [Suggested actions]
**Code Changes:** (if any with file paths)
**Files Modified/Created:** (if any)
**Open Questions:** (if any)

Be concise but complete enough to act on immediately.`;

// ============================================================================
// Environment Variables
// ============================================================================

const taskId = process.env.SIDECAR_TASK_ID || 'unknown';
const model = process.env.SIDECAR_MODEL || 'unknown';
const systemPrompt = process.env.SIDECAR_SYSTEM_PROMPT || '';
const briefing = process.env.SIDECAR_BRIEFING || '';
const project = process.env.SIDECAR_PROJECT || process.cwd();
const isResume = process.env.SIDECAR_RESUME === 'true';
const existingConversation = process.env.SIDECAR_CONVERSATION || '';

// ============================================================================
// State
// ============================================================================

let mainWindow = null;
let serverProcess = null;
let conversationLog = [];

/** Session directory for this sidecar */
const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);

// ============================================================================
// Port Finding
// ============================================================================

/**
 * Find an available port starting from the given port number.
 * Spec Reference: 9.2 - "Find available port starting at 4440"
 *
 * @param {number} startPort - Port to start searching from
 * @returns {Promise<number>} Available port number
 */
async function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => {
        resolve(port);
      });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try next one
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

// ============================================================================
// Server Readiness
// ============================================================================

/**
 * Wait for the OpenCode server to be ready.
 * Spec Reference: 9.2 - "Wait for server to be ready before loading URL"
 *
 * @param {string} url - Server URL to check
 * @param {number} retries - Number of retries remaining
 * @param {number} delay - Delay between retries in ms
 * @returns {Promise<void>}
 */
async function waitForServer(url, retries = SERVER_CHECK.maxRetries, delay = SERVER_CHECK.retryDelayMs) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          resolve(res.statusCode);
        });

        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });

      // Server responded, it's ready
      return;
    } catch (err) {
      // Server not ready, wait and retry
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Server failed to start');
}

/**
 * Create a new session via the OpenCode API.
 * This is required to get the chat UI instead of the project selector.
 *
 * @param {number} port - Server port
 * @returns {Promise<string>} Session ID
 */
async function createSession(port) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({});

    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: '/session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.id) {
            resolve(response.id);
          } else {
            reject(new Error('No session ID in response'));
          }
        } catch (err) {
          reject(new Error(`Failed to parse session response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to create session: ${err.message}`));
    });

    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Session creation timed out'));
    });

    req.write(postData);
    req.end();
  });
}

// ============================================================================
// Window Creation
// ============================================================================

/**
 * Create the main Electron window.
 * Spec Reference: 9.2 - Window configuration
 */
async function createWindow() {
  // Find an available port
  const port = await findAvailablePort(START_PORT);
  console.error(`[Sidecar] Using port ${port}`);

  // Ensure session directory exists
  fs.mkdirSync(sessionDir, { recursive: true });

  // Save initial context (system prompt) if not resuming
  if (!isResume) {
    fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), systemPrompt);
  }

  // Load existing conversation if resuming
  if (isResume && existingConversation) {
    conversationLog = existingConversation
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    console.error(`[Sidecar] Resuming with ${conversationLog.length} previous messages`);
  }

  // Start OpenCode server
  // Use OPENCODE_COMMAND env var if set, otherwise use npx opencode-ai
  // Explicitly bind to 127.0.0.1 to avoid macOS firewall prompts
  const openCodeCommand = process.env.OPENCODE_COMMAND || 'npx';
  const openCodeArgs = process.env.OPENCODE_COMMAND
    ? ['serve', '--port', String(port), '--hostname', '127.0.0.1']
    : ['opencode-ai', 'serve', '--port', String(port), '--hostname', '127.0.0.1'];

  serverProcess = spawn(openCodeCommand, openCodeArgs, {
    cwd: project,
    env: { ...process.env, OPENCODE_MODEL: model },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Log server output to stderr (not stdout - per spec 11.2)
  serverProcess.stdout.on('data', (data) => {
    console.error(`[OpenCode] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[OpenCode] ${data.toString().trim()}`);
  });

  serverProcess.on('error', (err) => {
    console.error(`[Sidecar] Failed to start OpenCode: ${err.message}`);
    process.exit(1);
  });

  // Create the browser window with spec configuration
  mainWindow = new BrowserWindow({
    ...WINDOW_CONFIG,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Enable web features needed by OpenCode's React app
      javascript: true,
      webgl: true,
      experimentalFeatures: false
    }
  });

  // Open DevTools in development for debugging
  if (process.env.SIDECAR_DEBUG === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Handle web content errors and debugging
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Sidecar] Page failed to load: ${errorDescription} (${errorCode}) URL: ${validatedURL}`);
  });

  mainWindow.webContents.on('did-start-loading', () => {
    console.error(`[Sidecar] Page started loading...`);
  });

  mainWindow.webContents.on('did-stop-loading', () => {
    console.error(`[Sidecar] Page stopped loading`);
  });

  mainWindow.webContents.on('dom-ready', () => {
    console.error(`[Sidecar] DOM ready`);
  });

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    console.error(`[Sidecar:Console:${level}] ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Sidecar] Render process gone: ${details.reason}`);
  });

  // Wait for server to be ready
  const serverUrl = `http://127.0.0.1:${port}`;
  console.error(`[Sidecar] Waiting for server at ${serverUrl}...`);

  try {
    await waitForServer(serverUrl);
    console.error(`[Sidecar] Server ready`);
  } catch (err) {
    console.error(`[Sidecar] ${err.message}`);
    cleanup();
    process.exit(1);
  }

  // Create a session via API
  let sessionId;
  try {
    console.error(`[Sidecar] Creating session...`);
    sessionId = await createSession(port);
    console.error(`[Sidecar] Session created: ${sessionId}`);
  } catch (err) {
    console.error(`[Sidecar] Failed to create session: ${err.message}`);
    cleanup();
    process.exit(1);
  }

  // Store port and sessionId on mainWindow for IPC handler access
  mainWindow.apiPort = port;
  mainWindow.sessionId = sessionId;

  // Load the custom UI instead of OpenCode's web UI
  const customUIPath = path.join(__dirname, 'ui', 'index.html');
  console.error(`[Sidecar] Loading custom UI from ${customUIPath}`);

  // Configuration to inject after page loads
  const uiConfig = {
    taskId: taskId,
    model: model,
    briefing: briefing,
    systemPrompt: systemPrompt,
    apiBase: serverUrl,
    sessionId: sessionId
  };

  // Debug: Log the config before injection
  console.error('[Sidecar] uiConfig before injection:', JSON.stringify(uiConfig, null, 2));
  console.error('[Sidecar] sessionId value:', sessionId, 'type:', typeof sessionId);

  // Set up the load handler BEFORE loading the file
  mainWindow.webContents.once('did-finish-load', () => {
    console.error('[Sidecar] Custom UI loaded');

    const configJson = JSON.stringify(uiConfig);
    console.error('[Sidecar] Injecting config JSON:', configJson);

    mainWindow.webContents.executeJavaScript(`
      window.sidecarConfig = ${configJson};
      console.log('[Sidecar] Config injected:', window.sidecarConfig);
      if (typeof init === 'function') {
        init();
      } else {
        console.error('[Sidecar] init() function not found');
      }
    `).catch(err => console.error('[Sidecar] Config injection failed:', err.message));
  });

  // Load the file (event listener is already set up)
  await mainWindow.loadFile(customUIPath);

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Handle get-config IPC call.
 * Returns the sidecar configuration to the renderer.
 */
ipcMain.handle('get-config', () => {
  return {
    taskId: taskId,
    model: model,
    briefing: briefing,
    systemPrompt: systemPrompt,
    apiBase: `http://127.0.0.1:${mainWindow?.apiPort || START_PORT}`,
    sessionId: mainWindow?.sessionId || null
  };
});

/**
 * Handle log-message IPC call.
 * Captures conversation messages in real-time.
 * Spec Reference: 8.2 - Conversation Capture
 */
ipcMain.handle('log-message', (_event, msg) => {
  conversationLog.push(msg);

  // Write to file in real-time
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');
  fs.appendFileSync(conversationPath, JSON.stringify(msg) + '\n');
});

/**
 * Handle fold IPC call.
 * Extracts conversation summary and outputs to stdout.
 * Spec Reference: 6.1 - The Fold Mechanism
 */
ipcMain.handle('fold', async () => {
  console.error('[Sidecar] Fold triggered...');

  // Extract summary from conversation log (last assistant message)
  let summary = '';

  // Try to get the last assistant message from our custom UI
  try {
    summary = await mainWindow.webContents.executeJavaScript(`
      (function() {
        const msgs = document.querySelectorAll('.message.assistant .message-content');
        if (msgs.length > 0) {
          return msgs[msgs.length - 1].textContent.trim();
        }
        return '';
      })();
    `);
  } catch (err) {
    console.error(`[Sidecar] Failed to extract summary from UI: ${err.message}`);
  }

  // Fallback to conversation log
  if (!summary && conversationLog.length > 0) {
    const lastAssistant = [...conversationLog].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) {
      summary = lastAssistant.content;
    }
  }

  // Use fallback if no summary extracted
  if (!summary) {
    summary = 'Sidecar session ended without summary.';
  }

  console.error(`[Sidecar] Summary extracted (${summary.length} chars)`);

  // Output summary to stdout (per spec 11.2)
  // This is the ONLY thing that should go to stdout
  process.stdout.write(summary);

  // Save summary to file
  const summaryPath = path.join(sessionDir, 'summary.md');
  fs.writeFileSync(summaryPath, summary);

  // Cleanup and quit
  cleanup();
  app.quit();
});

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up resources before exit.
 */
function cleanup() {
  if (serverProcess) {
    console.error('[Sidecar] Stopping OpenCode server...');
    serverProcess.kill();
    serverProcess = null;
  }
}

// ============================================================================
// App Lifecycle
// ============================================================================

// Start the app when ready
app.whenReady().then(createWindow).catch((err) => {
  console.error(`[Sidecar] Failed to start: ${err.message}`);
  process.exit(1);
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});

// Handle app quit
app.on('quit', () => {
  cleanup();
});

// Export for testing
module.exports = {
  WINDOW_CONFIG,
  START_PORT,
  SERVER_CHECK,
  SUMMARY_PROMPT,
  findAvailablePort,
  waitForServer,
  createSession
};
