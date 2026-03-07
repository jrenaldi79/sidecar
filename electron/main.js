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
const { buildToolbarHTML, TOOLBAR_H, getBrandName } = require('./toolbar');
const { createFoldHandler } = require('./fold');
const { registerSetupHandlers } = require('./ipc-setup');

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

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
let currentToolbarH = TOOLBAR_H;

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
    show: false,
    frame: true, backgroundColor: '#2D2B2A',
    title: CLIENT === 'cowork' ? 'Openwork Sidecar' : 'Claude Sidecar',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });

  // Check for updates before building toolbar (uses cached data, no network call)
  const { getUpdateInfo, initUpdateCheck } = require('../src/utils/updater');
  initUpdateCheck();
  const updateInfo = getUpdateInfo();
  if (updateInfo) {
    currentToolbarH = TOOLBAR_H + 32; // Expand for 32px update banner
    logger.info('Update available', { current: updateInfo.current, latest: updateInfo.latest });
  }

  const toolbarHtml = buildToolbarHTML({
    mode: 'sidecar', taskId: TASK_ID, foldShortcut: shortcutLabel, client: CLIENT, updateInfo
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
  // Load OpenCode off-screen first; only attach BrowserView after rebranding
  // to prevent the OpenCode logo/splash from flashing during load.
  mainWindow.on('resize', updateContentBounds);

  logger.info('Loading OpenCode Web UI', {
    url: OPENCODE_URL, sessionId: OPENCODE_SESSION_ID, taskId: TASK_ID
  });

  // Use Electron's insertCSS API on dom-ready to hide OpenCode branding.
  // This is more reliable than preload DOM injection in BrowserView.
  contentView.webContents.on('dom-ready', () => {
    contentView.webContents.insertCSS(`
      #root > div > header { display: none !important; }
      svg[viewBox="0 0 234 42"] { visibility: hidden !important; }
    `).catch(() => {});
  });

  contentView.webContents.loadURL(OPENCODE_URL);

  contentView.webContents.on('did-finish-load', () => {
    // Wait for React to render, then rebrand and show window
    setTimeout(() => {
      rebrandUI().then(() => {
        mainWindow.addBrowserView(contentView);
        updateContentBounds();
        mainWindow.show();
        if (OPENCODE_SESSION_ID) { navigateToSession(OPENCODE_SESSION_ID); }
      });
    }, 500);
  });

  globalShortcut.register(FOLD_SHORTCUT, () => {
    foldHandler.triggerFold(mainWindow, contentView);
  });

  // Poll toolbar for button clicks (IPC doesn't work with data: URLs).
  // Fold, settings, and update actions all use window.__sidecar*Action flags.
  const toolbarPoll = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) { clearInterval(toolbarPoll); return; }
    mainWindow.webContents.executeJavaScript('window.__sidecarToolbarAction').then(action => {
      if (!action) { return; }
      mainWindow.webContents.executeJavaScript('window.__sidecarToolbarAction = null');
      if (action === 'fold') {
        foldHandler.triggerFold(mainWindow, contentView);
      } else if (action === 'open-settings') {
        createSettingsChildWindow();
      }
    }).catch(() => {});
  }, 300);

  if (updateInfo) {
    const updatePoll = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) { clearInterval(updatePoll); return; }
      mainWindow.webContents.executeJavaScript('window.__sidecarUpdateAction').then(action => {
        if (action === 'perform-update') {
          mainWindow.webContents.executeJavaScript('window.__sidecarUpdateAction = null');
          const { performUpdate } = require('../src/utils/updater');
          performUpdate().then(result => {
            if (!mainWindow || mainWindow.isDestroyed()) { return; }
            if (result.success) {
              mainWindow.webContents.executeJavaScript(`
                document.getElementById('update-text').textContent = 'Updated! Your next sidecar session will use the new version.';
                document.getElementById('update-btn').style.display = 'none';
                document.getElementById('dismiss-btn').style.display = '';
              `);
            } else {
              mainWindow.webContents.executeJavaScript(`
                document.getElementById('update-text').textContent = 'Update failed: ${(result.error || 'unknown').replace(/'/g, "\\'")}';
                document.getElementById('update-btn').textContent = 'Retry';
                document.getElementById('update-btn').disabled = false;
                document.getElementById('dismiss-btn').style.display = '';
              `);
            }
          });
        } else if (action === 'dismiss') {
          mainWindow.webContents.executeJavaScript('window.__sidecarUpdateAction = null');
          currentToolbarH = TOOLBAR_H;
          updateContentBounds();
          clearInterval(updatePoll);
        }
      }).catch(() => {});
    }, 500);
  }

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
    title: `${getBrandName(CLIENT)} Setup`,
    icon: ICON_PATH,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-setup.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });

  const html = buildSetupHTML({ client: CLIENT });
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
  contentView.setBounds({ x: 0, y: 0, width: w, height: h - currentToolbarH });
}

// Sidecar wordmark SVG in the same pixel/block art style as the OpenCode logo.
// Uses the same CSS variables (--icon-base, --icon-weak-base) and viewBox
// proportions. Built on a 6px grid: each letter 24px wide, 30px tall (y:6-36),
// 6px gaps between letters. Total 7 letters = 204px wide.
const SIDECAR_WORDMARK = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 234 43" fill="none" class="CLASS">',
  '<g>',
  // S (x:0-24): top-right bar, left arm, full middle, right arm, bottom-left bar
  '<path d="M24 12H6V6H24ZM6 18H0V12H6ZM24 24H0V18H24ZM24 30H18V24H24ZM18 36H0V30H18Z" fill="var(--icon-base)"/>',
  // I (x:30-54): top bar, center stem, bottom bar
  '<path d="M54 12H30V6H54ZM48 30H36V12H48ZM54 36H30V30H54Z" fill="var(--icon-base)"/>',
  // D (x:60-84): box outline with lighter inner
  '<path d="M78 30H66V12H78Z" fill="var(--icon-weak-base)"/>',
  '<path d="M84 12H60V6H84ZM66 30H60V12H66ZM84 30H78V12H84ZM84 36H60V30H84Z" fill="var(--icon-base)"/>',
  // E (x:90-114): top bar, left wall, middle tab, bottom bar
  '<path d="M114 12H90V6H114ZM96 30H90V12H96ZM108 24H96V18H108Z" fill="var(--icon-weak-base)"/>',
  '<path d="M114 12H90V6H114ZM96 36H90V6H96ZM108 24H90V18H108ZM114 36H90V30H114Z" fill="var(--icon-base)"/>',
  // C (x:120-144): top bar, left wall, bottom bar
  '<path d="M144 12H120V6H144ZM126 30H120V12H126ZM144 36H120V30H144Z" fill="var(--icon-base)"/>',
  // A (x:150-174): peak, walls, crossbar with lighter inner
  '<path d="M168 30H156V24H168Z" fill="var(--icon-weak-base)"/>',
  '<path d="M168 12H156V6H168ZM156 36H150V12H156ZM174 36H168V12H174ZM174 24H150V18H174Z" fill="var(--icon-base)"/>',
  // R (x:180-204): top bar, left wall, bump, diagonal leg
  '<path d="M198 18H186V12H198Z" fill="var(--icon-weak-base)"/>',
  '<path d="M204 12H180V6H204ZM186 36H180V12H186ZM204 18H198V12H204ZM198 24H186V18H198ZM204 36H198V24H204Z" fill="var(--icon-base)"/>',
  '</g></svg>',
].join('');

function rebrandUI() {
  if (!contentView) { return Promise.resolve(); }
  const brandName = getBrandName(CLIENT);
  // The OpenCode logo may be hidden (display:none/visibility:hidden) by preload.js
  // or insertCSS before this runs. Use a MutationObserver with a fallback timeout
  // to catch it whenever React renders it into the DOM.
  return contentView.webContents.executeJavaScript(`
    (function() {
      document.title = '${brandName}';
      var header = document.querySelector('#root > div > header');
      if (header) { header.style.display = 'none'; }

      function replaceLogo() {
        // Match both visible and hidden logos
        var logo = document.querySelector('svg[viewBox="0 0 234 42"]');
        if (!logo) { return false; }
        var cls = logo.getAttribute('class') || '';
        var markup = ${JSON.stringify(SIDECAR_WORDMARK)}.replace('CLASS', cls);
        logo.insertAdjacentHTML('afterend', markup);
        logo.remove();
        return true;
      }

      // Try immediately
      if (replaceLogo()) { return 'replaced'; }

      // Observe DOM for the logo appearing (React may render it after initial load)
      return new Promise(function(resolve) {
        var observer = new MutationObserver(function() {
          if (replaceLogo()) {
            observer.disconnect();
            resolve('replaced-observed');
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Give up after 5s
        setTimeout(function() {
          observer.disconnect();
          resolve(replaceLogo() ? 'replaced-late' : 'logo-not-found');
        }, 5000);
      });
    })();
  `).catch(() => {});
}

function navigateToSession(sessionId, retries = 8) {
  if (!contentView || retries <= 0) { return; }

  const safeId = JSON.stringify(sessionId);
  const js = `
    (function() {
      const targetId = ${safeId};

      // Strategy 1: Find a link whose href contains the session ID (most reliable)
      const links = [...document.querySelectorAll('a')];
      for (const el of links) {
        const href = el.href || '';
        if (href.includes(targetId)) {
          el.click();
          return 'clicked session';
        }
      }

      // Strategy 2: Find a link whose href contains 'ses_' (any session link)
      for (const el of links) {
        const href = el.href || '';
        if (href.includes('ses_')) {
          el.click();
          return 'clicked first session';
        }
      }

      // Strategy 3: Find the project button in the sidebar by aria-label.
      // Avoid matching the search bar (which also contains the project name).
      const sidebarProjectBtn = document.querySelector(
        'button[aria-label="sidecar"], button[aria-label="' + document.title.replace(/\\s+sidecar$/i, '').replace(/ /g, '') + '"]'
      );
      if (sidebarProjectBtn) {
        sidebarProjectBtn.click();
        return 'clicked project';
      }

      return null;
    })();
  `;

  setTimeout(() => {
    if (!contentView) { return; }
    contentView.webContents.executeJavaScript(js).then(result => {
      logger.debug('Session navigation', { result, sessionId, retries });
      if (result) {
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

// Update check
ipcMain.handle('sidecar:get-update-info', () => {
  const { getUpdateInfo, initUpdateCheck } = require('../src/utils/updater');
  initUpdateCheck();
  return getUpdateInfo();
});

// Perform update
ipcMain.handle('sidecar:perform-update', async () => {
  const { performUpdate } = require('../src/utils/updater');
  const result = await performUpdate();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sidecar:update-result', result);
  }
  return result;
});

// Resize toolbar area (called when update banner shows/hides)
ipcMain.handle('sidecar:resize-toolbar', (_event, height) => {
  currentToolbarH = height;
  updateContentBounds();
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
    title: `${getBrandName(CLIENT)} Settings`,
    icon: ICON_PATH,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-setup.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });

  const html = buildSetupHTML({ client: CLIENT });
  settingsWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  settingsWin.webContents.on('page-title-updated', (e) => e.preventDefault());
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const { nativeImage } = require('electron');
    const icon = nativeImage.createFromPath(ICON_PATH);
    if (!icon.isEmpty()) { app.dock.setIcon(icon); }
  }

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
