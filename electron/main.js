/**
 * Sidecar Electron Shell - v3
 *
 * Uses BrowserView to split the window into two physical areas:
 *   - Top: OpenCode Web UI (gets its own viewport, no CSS conflicts)
 *   - Bottom 40px: Sidecar toolbar (branding, task ID, timer, fold button)
 *
 * Supports two modes via SIDECAR_MODE env var:
 *   - 'sidecar' (default): OpenCode conversation with fold toolbar
 *   - 'setup': API key configuration form
 *
 * Spec Reference: §4.4 Electron Wrapper
 */

const { app, BrowserWindow, BrowserView, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { logger } = require('../src/utils/logger');
const { buildToolbarHTML, TOOLBAR_H } = require('./toolbar');
const { createFoldHandler } = require('./fold');
const { registerSetupHandlers } = require('./ipc-setup');

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
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ============================================================================
// Configuration from Environment (set by src/sidecar/start.js)
// ============================================================================

const MODE = process.env.SIDECAR_MODE || 'sidecar';
const TASK_ID = process.env.SIDECAR_TASK_ID || 'unknown';
const MODEL = process.env.SIDECAR_MODEL || 'unknown';
const CWD = process.env.SIDECAR_CWD || process.cwd();
const CLIENT = process.env.SIDECAR_CLIENT || 'code-local';
const OPENCODE_PORT = parseInt(process.env.SIDECAR_OPENCODE_PORT || '4096', 10);
const OPENCODE_SESSION_ID = process.env.SIDECAR_SESSION_ID;
const FOLD_SHORTCUT = process.env.SIDECAR_FOLD_SHORTCUT || 'CommandOrControl+Shift+F';

const OPENCODE_URL = `http://localhost:${OPENCODE_PORT}`;

// ============================================================================
// State
// ============================================================================

let mainWindow = null;
let contentView = null;

const foldHandler = createFoldHandler({
  model: MODEL,
  client: CLIENT,
  cwd: CWD,
  sessionId: OPENCODE_SESSION_ID,
  taskId: TASK_ID,
  port: OPENCODE_PORT
});

// ============================================================================
// Sidecar Window (OpenCode + Toolbar)
// ============================================================================

function createSidecarWindow() {
  const shortcutLabel = FOLD_SHORTCUT.replace('CommandOrControl', 'Cmd');

  mainWindow = new BrowserWindow({
    width: 720, height: 850, minWidth: 550, minHeight: 600,
    frame: true, backgroundColor: '#2D2B2A',
    title: 'OpenCode Sidecar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });

  const toolbarHtml = buildToolbarHTML({
    mode: 'sidecar', taskId: TASK_ID, foldShortcut: shortcutLabel
  });
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbarHtml)}`);
  mainWindow.webContents.on('page-title-updated', (e) => e.preventDefault());

  // BrowserView for OpenCode content
  contentView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });
  mainWindow.addBrowserView(contentView);
  updateContentBounds();
  mainWindow.on('resize', updateContentBounds);

  logger.info('Loading OpenCode Web UI', {
    url: OPENCODE_URL, sessionId: OPENCODE_SESSION_ID, taskId: TASK_ID
  });
  contentView.webContents.loadURL(OPENCODE_URL);

  contentView.webContents.on('did-finish-load', () => {
    rebrandUI();
    if (OPENCODE_SESSION_ID) { navigateToSession(OPENCODE_SESSION_ID); }
  });

  globalShortcut.register(FOLD_SHORTCUT, () => {
    foldHandler.triggerFold(mainWindow, contentView);
  });

  mainWindow.on('close', () => {
    if (!foldHandler.hasFolded() && mainWindow) { mainWindow.destroy(); }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    contentView = null;
    globalShortcut.unregisterAll();
    app.quit();
  });
}

// ============================================================================
// Setup Window (API Key Form)
// ============================================================================

function createSetupWindow() {
  // Lazy-load setup UI to avoid loading it for sidecar mode
  const { buildSetupHTML } = require('./setup-ui');

  mainWindow = new BrowserWindow({
    width: 560, height: 680, minWidth: 480, minHeight: 580,
    frame: true, backgroundColor: '#2D2B2A',
    title: 'Sidecar Setup',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-setup.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });

  const html = buildSetupHTML();
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  mainWindow.webContents.on('page-title-updated', (e) => e.preventDefault());

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Setup renderer crashed', details);
  });
}

// ============================================================================
// Shared Helpers
// ============================================================================

function updateContentBounds() {
  if (!mainWindow || !contentView) { return; }
  const [w, h] = mainWindow.getContentSize();
  contentView.setBounds({ x: 0, y: 0, width: w, height: h - TOOLBAR_H });
}

function rebrandUI() {
  if (!contentView) { return; }
  contentView.webContents.executeJavaScript(`
    (function() {
      document.title = 'OpenCode Sidecar';
      var header = document.querySelector('#root > div > header');
      if (header) { header.style.display = 'none'; }
    })();
  `).catch(() => {});
}

function navigateToSession(sessionId, retries = 8) {
  if (!contentView || retries <= 0) { return; }

  // Use JSON.stringify to safely escape sessionId for JS interpolation
  const safeId = JSON.stringify(sessionId);
  const js = `
    (function() {
      const targetId = ${safeId};
      const clickables = [...document.querySelectorAll('a, button')];
      for (const el of clickables) {
        const text = el.textContent || '';
        const href = el.href || '';
        if (href.includes(targetId) || text.includes(targetId)) {
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
// IPC Handlers
// ============================================================================

// Sidecar mode: fold
ipcMain.handle('sidecar:fold', () => {
  return foldHandler.triggerFold(mainWindow, contentView);
});

// Sidecar mode: open settings in a child window
ipcMain.handle('sidecar:open-settings', () => {
  createSettingsChildWindow();
});

// Setup mode: all setup IPC handlers (extracted to ipc-setup.js)
registerSetupHandlers(ipcMain, () => mainWindow);

// ============================================================================
// Settings Child Window (opened from sidecar toolbar gear button)
// ============================================================================

function createSettingsChildWindow() {
  const { buildSetupHTML } = require('./setup-ui');

  const settingsWin = new BrowserWindow({
    width: 560, height: 680,
    parent: mainWindow, modal: false,
    frame: true, backgroundColor: '#2D2B2A',
    title: 'Sidecar Settings',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-setup.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });

  const html = buildSetupHTML();
  settingsWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  settingsWin.webContents.on('page-title-updated', (e) => e.preventDefault());
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(() => {
  if (MODE === 'setup') {
    createSetupWindow();
  } else {
    createSidecarWindow();
  }
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});
