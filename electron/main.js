/**
 * Sidecar Electron Shell - v3
 *
 * Uses BrowserView to split the window into two physical areas:
 *   - Top: OpenCode Web UI (gets its own viewport, no CSS conflicts)
 *   - Bottom 40px: Sidecar toolbar (branding, task ID, timer, fold button)
 *
 * Spec Reference: §4.4 Electron Wrapper
 */

const { app, BrowserWindow, BrowserView, globalShortcut, ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const { logger } = require('../src/utils/logger');
const { getSummaryTemplate } = require('../src/prompt-builder');

// ============================================================================
// EPIPE Error Handling
// ============================================================================

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') { return; }
  console.error('stdout error:', err);
});
process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') { return; }
});
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') { return; }
  console.error('Uncaught exception:', err);
});

// ============================================================================
// Configuration from Environment (set by src/sidecar/start.js)
// ============================================================================

const TASK_ID = process.env.SIDECAR_TASK_ID || 'unknown';
const MODEL = process.env.SIDECAR_MODEL || 'unknown';
const CWD = process.env.SIDECAR_CWD || process.cwd();
const CLIENT = process.env.SIDECAR_CLIENT || 'code-local';
const OPENCODE_PORT = process.env.SIDECAR_OPENCODE_PORT || '4096';
const OPENCODE_SESSION_ID = process.env.SIDECAR_SESSION_ID;
const FOLD_SHORTCUT = process.env.SIDECAR_FOLD_SHORTCUT || 'CommandOrControl+Shift+F';

const OPENCODE_URL = `http://localhost:${OPENCODE_PORT}`;
const TOOLBAR_H = 40;

// ============================================================================
// State
// ============================================================================

let mainWindow = null;
let contentView = null;
let hasFolded = false;

// ============================================================================
// Toolbar HTML
// ============================================================================

function buildToolbarHTML() {
  const shortcutLabel = FOLD_SHORTCUT.replace('CommandOrControl', 'Cmd');
  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: ${TOOLBAR_H}px;
    background: #2D2B2A;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    border-top: 1px solid #3D3A38;
    -webkit-app-region: no-drag;
    user-select: none;
  }
  .info {
    color: #A09B96;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand {
    color: #D97757;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .sep { color: #3D3A38; font-size: 14px; }
  .detail, .timer {
    color: #7A756F;
    font-size: 11px;
    font-family: 'SF Mono', Menlo, Monaco, monospace;
  }
  .fold-btn {
    padding: 5px 14px;
    background: #D97757;
    color: #FFF;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .fold-btn:hover { background: #C4623F; }
</style></head><body>
  <div class="info">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 2v12" stroke="#D97757" stroke-width="2" stroke-linecap="round"/>
      <path d="M10 2v5c0 2-3 3-7 5" stroke="#D97757" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/>
    </svg>
    <span class="brand">OpenCode Sidecar</span>
    <span class="sep">|</span>
    <span class="detail" title="Task ID — use with: sidecar resume ${TASK_ID}">task: ${TASK_ID}</span>
    <span class="sep">|</span>
    <span class="timer" id="timer">0:00</span>
  </div>
  <button class="fold-btn" id="fold-btn">Fold (${shortcutLabel})</button>
<script>
  var start = Date.now();
  setInterval(function() {
    var s = Math.floor((Date.now() - start) / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    document.getElementById('timer').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);
  document.getElementById('fold-btn').addEventListener('click', function() {
    window.sidecar && window.sidecar.fold();
  });
</script>
</body></html>`;
}

// ============================================================================
// Window Creation
// ============================================================================

function createWindow() {
  // Main window hosts the toolbar HTML at the bottom
  mainWindow = new BrowserWindow({
    width: 720,
    height: 850,
    minWidth: 550,
    minHeight: 600,
    frame: true,
    backgroundColor: '#2D2B2A',
    title: 'OpenCode Sidecar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // Load toolbar HTML in the main window
  const toolbarUrl = `data:text/html;charset=utf-8,${encodeURIComponent(buildToolbarHTML())}`;
  mainWindow.loadURL(toolbarUrl);

  // Override page title
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // Create BrowserView for OpenCode content — gets its own viewport
  contentView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  mainWindow.addBrowserView(contentView);

  // Size the content view to fill everything above the toolbar
  updateContentBounds();
  mainWindow.on('resize', updateContentBounds);

  // Load OpenCode UI in the content view
  logger.info('Loading OpenCode Web UI', {
    url: OPENCODE_URL, sessionId: OPENCODE_SESSION_ID, taskId: TASK_ID
  });
  contentView.webContents.loadURL(OPENCODE_URL);

  // After OpenCode loads: rebrand and auto-navigate
  contentView.webContents.on('did-finish-load', () => {
    rebrandUI();
    if (OPENCODE_SESSION_ID) {
      navigateToSession(OPENCODE_SESSION_ID);
    }
  });

  // Register fold shortcut
  globalShortcut.register(FOLD_SHORTCUT, () => {
    triggerFold();
  });

  // Close handling
  mainWindow.on('close', () => {
    if (!hasFolded && mainWindow) {
      mainWindow.destroy();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    contentView = null;
    globalShortcut.unregisterAll();
    app.quit();
  });
}

/** Update BrowserView bounds to fill window minus toolbar */
function updateContentBounds() {
  if (!mainWindow || !contentView) { return; }
  const [w, h] = mainWindow.getContentSize();
  contentView.setBounds({ x: 0, y: 0, width: w, height: h - TOOLBAR_H });
}

// ============================================================================
// UI Rebranding
// ============================================================================

/**
 * Hide the OpenCode header bar in the content view.
 */
function rebrandUI() {
  if (!contentView) { return; }

  const js = `
    (function() {
      document.title = 'OpenCode Sidecar';
      var header = document.querySelector('#root > div > header');
      if (header) { header.style.display = 'none'; }
    })();
  `;

  contentView.webContents.executeJavaScript(js).catch(() => {});
}

// ============================================================================
// Session Navigation
// ============================================================================

/**
 * Auto-navigate to the active session by clicking through the SPA.
 */
function navigateToSession(sessionId, retries = 8) {
  if (!contentView || retries <= 0) { return; }

  const js = `
    (function() {
      const clickables = [...document.querySelectorAll('a, button')];

      for (const el of clickables) {
        const text = el.textContent || '';
        const href = el.href || '';
        if (href.includes('${sessionId}') || text.includes('${sessionId}')) {
          el.click();
          return 'clicked session';
        }
      }

      for (const el of clickables) {
        const text = el.textContent || '';
        if (text.includes('sidecar') && !text.includes('Fold')) {
          el.click();
          return 'clicked project';
        }
      }

      for (const el of clickables) {
        const text = el.textContent || '';
        const href = el.href || '';
        if (href.includes('ses_') || text.includes('ses_')) {
          el.click();
          return 'clicked first session';
        }
      }

      return null;
    })();
  `;

  setTimeout(() => {
    if (!contentView) { return; }
    contentView.webContents.executeJavaScript(js).then(result => {
      if (result) {
        logger.debug('Session navigation', { result, sessionId, retries });
        if (result === 'clicked project') {
          navigateToSession(sessionId, retries - 1);
        }
      } else {
        navigateToSession(sessionId, retries - 1);
      }
    }).catch(() => {
      if (!contentView) { return; }
      navigateToSession(sessionId, retries - 1);
    });
  }, 1500);
}

// ============================================================================
// Summary Generation via OpenCode API
// ============================================================================

/**
 * Make an HTTP request to the OpenCode server.
 * @param {string} method - HTTP method
 * @param {string} urlPath - URL path (e.g., '/session/abc/prompt_async')
 * @param {object} [body] - JSON body to send
 * @returns {Promise<object>} Parsed JSON response
 */
function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: OPENCODE_PORT,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (_e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) { req.write(JSON.stringify(body)); }
    req.end();
  });
}

/**
 * Request the model to generate a handoff summary via the OpenCode API.
 * Sends the SUMMARY_TEMPLATE as a new message, polls for the response.
 */
async function requestSummaryFromModel() {
  if (!OPENCODE_SESSION_ID) { return ''; }

  const summaryPrompt = getSummaryTemplate();
  logger.info('Requesting fold summary from model', { sessionId: OPENCODE_SESSION_ID });

  // Send summary prompt asynchronously
  await apiRequest('POST', `/session/${OPENCODE_SESSION_ID}/prompt_async`, {
    parts: [{ type: 'text', text: summaryPrompt }]
  });

  // Poll for the model's response (up to 60 seconds)
  const startTime = Date.now();
  const timeoutMs = 60000;
  let lastMessageCount = 0;
  let stablePolls = 0;
  let summaryText = '';

  while ((Date.now() - startTime) < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const messages = await apiRequest('GET', `/session/${OPENCODE_SESSION_ID}/message`);
      const msgArray = Array.isArray(messages) ? messages : [];

      // Look for the latest assistant text content
      let latestAssistantText = '';
      let assistantFinished = false;

      for (const msg of msgArray) {
        if (msg.info?.role === 'assistant') {
          if (msg.info.time?.completed) { assistantFinished = true; }
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.type === 'text' && part.text) {
                latestAssistantText = part.text;
              }
            }
          }
        }
      }

      // Check if stable (same message count for 2 polls and assistant finished)
      if (assistantFinished && msgArray.length === lastMessageCount) {
        stablePolls++;
        if (stablePolls >= 2) {
          summaryText = latestAssistantText;
          break;
        }
      } else {
        stablePolls = 0;
      }
      lastMessageCount = msgArray.length;

    } catch (err) {
      logger.debug('Summary poll error', { error: err.message });
    }
  }

  logger.info('Summary captured', { length: summaryText.length });
  return summaryText;
}

// ============================================================================
// Fold Logic
// ============================================================================

async function triggerFold() {
  if (hasFolded) { return; }
  hasFolded = true;

  // Show fold progress in toolbar and content overlay
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      var btn = document.getElementById('fold-btn');
      if (btn) {
        btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;">' +
          '<span style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block;"></span>' +
          'Generating summary\u2026</span>';
        btn.disabled = true;
        btn.style.opacity = '0.85';
        btn.style.cursor = 'default';
      }
      if (!document.getElementById('fold-spin-style')) {
        var style = document.createElement('style');
        style.id = 'fold-spin-style';
        style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
      }
    `).catch(() => {});
  }
  if (contentView) {
    contentView.webContents.executeJavaScript(`
      (function() {
        var overlay = document.createElement('div');
        overlay.id = 'sidecar-fold-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;';
        overlay.innerHTML =
          '<div style="width:32px;height:32px;border:3px solid rgba(217,119,87,0.3);border-top-color:#D97757;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px;"></div>' +
          '<div style="color:#E8E0D8;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:500;">Generating summary\u2026</div>' +
          '<div style="color:#7A756F;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;margin-top:6px;">Folding session back to Claude Code</div>';
        if (!document.getElementById('fold-spin-style')) {
          var style = document.createElement('style');
          style.id = 'fold-spin-style';
          style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
          document.head.appendChild(style);
        }
        document.body.appendChild(overlay);
      })();
    `).catch(() => {});
  }

  try {
    // Ask the model to generate a structured summary
    let summary = '';
    try {
      summary = await requestSummaryFromModel();
    } catch (err) {
      logger.warn('Failed to get model summary', { error: err.message });
    }

    const output = [
      '[SIDECAR_FOLD]',
      `Model: ${MODEL}`,
      `Session: ${OPENCODE_SESSION_ID || TASK_ID}`,
      `Client: ${CLIENT}`,
      `CWD: ${CWD}`,
      `Mode: interactive`,
      '---',
      summary || 'Session ended without summary.'
    ].join('\n');

    process.stdout.write(output + '\n');
    logger.info('Fold completed', { taskId: TASK_ID });
  } catch (err) {
    logger.error('Fold failed', { error: err.message });
    hasFolded = false;
    return;
  }

  // Close the window after fold
  if (mainWindow) {
    mainWindow.close();
  } else {
    app.quit();
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle('sidecar:fold', () => triggerFold());

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});
