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

/** Window dimensions per spec */
const WINDOW_CONFIG = {
  width: 500,
  height: 900,
  frame: false,
  alwaysOnTop: true,
  backgroundColor: '#0d0d0d'
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
  serverProcess = spawn('opencode', ['serve', '--port', String(port)], {
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
      nodeIntegration: false
    }
  });

  // Wait for server to be ready
  const serverUrl = `http://localhost:${port}`;
  console.error(`[Sidecar] Waiting for server at ${serverUrl}...`);

  try {
    await waitForServer(serverUrl);
    console.error(`[Sidecar] Server ready, loading UI`);
  } catch (err) {
    console.error(`[Sidecar] ${err.message}`);
    cleanup();
    process.exit(1);
  }

  // Load the OpenCode UI
  await mainWindow.loadURL(serverUrl);

  // Inject custom UI after page loads
  mainWindow.webContents.on('did-finish-load', () => {
    injectUI();

    // If resuming, show previous conversation notice
    if (isResume && conversationLog.length > 0) {
      injectResumeNotice();
    }

    // Set up message observer for conversation capture
    setupMessageObserver();
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });
}

// ============================================================================
// UI Injection (Spec 14.3)
// ============================================================================

/**
 * Inject custom UI elements into the OpenCode page.
 * Spec Reference: 14.3 - Styling Investigation
 *
 * TODO: Replace hardcoded colors with values extracted from Claude Code Desktop
 * See Spec 14.3 for investigation plan
 */
function injectUI() {
  // Load and inject CSS file
  const cssPath = path.join(__dirname, 'inject.css');
  if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, 'utf-8');
    mainWindow.webContents.insertCSS(css);
  }

  // Inject title bar via CSS pseudo-element
  const titleBarCSS = `
    body::before {
      content: 'Sidecar ${taskId.slice(0, 6)} | ${model}';
      position: fixed;
      top: 0;
      left: 0;
      right: 60px;
      height: 28px;
      background: #1a1a1a;
      color: #888;
      font-size: 11px;
      line-height: 28px;
      padding-left: 12px;
      -webkit-app-region: drag;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  `;
  mainWindow.webContents.insertCSS(titleBarCSS);

  // Inject FOLD button via JavaScript
  const foldButtonJS = `
    (function() {
      // Remove existing button if present (for re-injection)
      const existing = document.getElementById('fold-btn');
      if (existing) existing.remove();

      const btn = document.createElement('button');
      btn.id = 'fold-btn';
      btn.textContent = 'FOLD';
      btn.style.cssText = 'position:fixed;top:4px;right:8px;padding:4px 14px;background:#2d5a27;color:white;border:none;border-radius:4px;cursor:pointer;z-index:10001;font-weight:bold;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

      btn.onmouseenter = function() { btn.style.background = '#3d7a37'; };
      btn.onmouseleave = function() { btn.style.background = '#2d5a27'; };
      btn.onclick = function() { window.electronAPI.fold(); };

      document.body.appendChild(btn);
    })();
  `;
  mainWindow.webContents.executeJavaScript(foldButtonJS);
}

/**
 * Inject resume notice when resuming a session.
 */
function injectResumeNotice() {
  const noticeJS = `
    (function() {
      const notice = document.createElement('div');
      notice.id = 'resume-notice';
      notice.style.cssText = 'background:#2a2a2a;color:#888;padding:8px 12px;font-size:12px;border-bottom:1px solid #333;position:fixed;top:28px;left:0;right:0;z-index:9999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
      notice.textContent = 'Resumed session with ${conversationLog.length} previous messages';
      document.body.appendChild(notice);
    })();
  `;
  mainWindow.webContents.executeJavaScript(noticeJS);
}

/**
 * Set up message observer for conversation capture.
 * Spec Reference: 8.2 - "Electron shell intercepts all messages and writes to conversation.jsonl in real-time"
 */
function setupMessageObserver() {
  const observerJS = `
    (function() {
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          m.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) {
              const role = node.getAttribute ? node.getAttribute('data-role') : null;
              const content = node.textContent ? node.textContent.trim() : '';
              if (role && content) {
                window.electronAPI.logMessage({
                  role: role,
                  content: content,
                  timestamp: new Date().toISOString()
                });
              }
            }
          });
        });
      });

      // Start observing (adjust selector based on OpenCode's DOM structure)
      const chatContainer = document.querySelector('main') || document.body;
      observer.observe(chatContainer, { childList: true, subtree: true });
    })();
  `;
  mainWindow.webContents.executeJavaScript(observerJS);
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Handle log-message IPC call.
 * Captures conversation messages in real-time.
 * Spec Reference: 8.2 - Conversation Capture
 */
ipcMain.handle('log-message', (event, msg) => {
  conversationLog.push(msg);

  // Write to file in real-time
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');
  fs.appendFileSync(conversationPath, JSON.stringify(msg) + '\n');
});

/**
 * Handle fold IPC call.
 * Injects summary prompt, waits for response, outputs to stdout, quits.
 * Spec Reference: 6.1 - The Fold Mechanism
 */
ipcMain.handle('fold', async () => {
  console.error('[Sidecar] Fold triggered, generating summary...');

  // Inject summary request
  const injectPromptJS = `
    (function() {
      const input = document.querySelector('textarea');
      if (input) {
        input.value = ${JSON.stringify(SUMMARY_PROMPT)};
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // Try to submit the form
        const form = input.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true }));
        } else {
          // Try pressing Enter
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        }
      }
    })();
  `;

  try {
    await mainWindow.webContents.executeJavaScript(injectPromptJS);
  } catch (err) {
    console.error(`[Sidecar] Failed to inject summary prompt: ${err.message}`);
  }

  // Wait for response (spec says wait 6 seconds)
  await new Promise((r) => setTimeout(r, 6000));

  // Extract summary from the last assistant message
  let summary = '';
  try {
    summary = await mainWindow.webContents.executeJavaScript(`
      (function() {
        const msgs = document.querySelectorAll('[data-role="assistant"]');
        return msgs.length > 0 ? msgs[msgs.length - 1].textContent.trim() : '';
      })();
    `);
  } catch (err) {
    console.error(`[Sidecar] Failed to extract summary: ${err.message}`);
  }

  // Use fallback if no summary extracted
  if (!summary) {
    summary = 'Sidecar session ended without summary.';
  }

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
  waitForServer
};
