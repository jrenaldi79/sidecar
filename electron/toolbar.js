/**
 * Sidecar Toolbar HTML Builder
 *
 * Generates the toolbar HTML for the bottom bar of the Electron window.
 * Supports two modes: 'sidecar' (default) and 'setup'.
 */

const TOOLBAR_H = 40;

/**
 * Get the brand name based on client type
 * @param {string} [client='code-local'] - Client type (code-local, code-web, cowork)
 * @returns {string} Brand name to display
 */
function getBrandName(client) {
  return client === 'cowork' ? 'Openwork Sidecar' : 'Claude Sidecar';
}

/**
 * Build toolbar HTML string
 * @param {object} [options={}]
 * @param {string} [options.mode='sidecar'] - 'sidecar' or 'setup'
 * @param {string} [options.taskId='unknown'] - Task ID to display
 * @param {string} [options.foldShortcut='Cmd+Shift+F'] - Shortcut label
 * @param {string} [options.client='code-local'] - Client type for branding
 * @returns {string} Complete HTML document for the toolbar
 */
function buildToolbarHTML(options = {}) {
  const {
    mode = 'sidecar',
    taskId = 'unknown',
    foldShortcut = 'Cmd+Shift+F',
    client = 'code-local',
    updateInfo = null
  } = options;

  const brandName = getBrandName(client);

  const baseStyles = `
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
  .action-btn {
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
  .action-btn:hover { background: #C4623F; }
  .action-btn:disabled { opacity: 0.5; cursor: default; }
  .icon-btn {
    background: none; border: 1px solid #3D3A38;
    border-radius: 4px; color: #A09B96; cursor: pointer;
    font-size: 14px; padding: 3px 8px; transition: all 0.15s;
    display: flex; align-items: center;
  }
  .icon-btn:hover { border-color: #D97757; color: #D97757; }
  .right-actions { display: flex; align-items: center; gap: 8px; }
  .update-banner {
    position: fixed;
    bottom: ${TOOLBAR_H}px;
    left: 0;
    right: 0;
    height: 32px;
    background: #3D3A38;
    border-bottom: 1px solid #4D4A48;
    display: none;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 12px;
    color: #D4D0CC;
    z-index: 100;
  }
  .update-banner .update-btn {
    padding: 2px 10px;
    background: #D97757;
    color: #FFF;
    border: none;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .update-banner .update-btn:hover { background: #C4623F; }
  .update-banner .update-btn:disabled { opacity: 0.5; cursor: default; }
  .update-banner .dismiss-btn {
    background: none;
    border: none;
    color: #7A756F;
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
  }
  .update-banner .dismiss-btn:hover { color: #D4D0CC; }`;

  const logoSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 2v12" stroke="#D97757" stroke-width="2" stroke-linecap="round"/>
      <path d="M10 2v5c0 2-3 3-7 5" stroke="#D97757" stroke-width="2" stroke-linecap="round" stroke-opacity="0.6"/>
    </svg>`;

  if (mode === 'setup') {
    return `<!DOCTYPE html>
<html><head><style>${baseStyles}</style></head><body>
  <div class="info">
    ${logoSvg}
    <span class="brand">${brandName}</span>
  </div>
  <button class="action-btn" id="continue-btn" disabled>Continue</button>
<script>
  document.getElementById('continue-btn').addEventListener('click', function() {
    if (!this.disabled) {
      window.sidecar && window.sidecar.setupDone();
    }
  });
</script>
</body></html>`;
  }

  // Default: sidecar mode
  return `<!DOCTYPE html>
<html><head><style>${baseStyles}</style></head><body>
  <div class="update-banner" id="update-banner">
    <span id="update-text"></span>
    <button class="update-btn" id="update-btn">Update</button>
    <button class="dismiss-btn" id="dismiss-btn">&times;</button>
  </div>
  <div class="info">
    ${logoSvg}
    <span class="brand">${brandName}</span>
    <span class="sep">|</span>
    <span class="detail" title="Task ID — use with: sidecar resume ${taskId}">task: ${taskId}</span>
    <span class="sep">|</span>
    <span class="timer" id="timer">0:00</span>
  </div>
  <div class="right-actions">
    <button class="icon-btn" id="settings-btn" title="Settings">&#x2699;</button>
    <button class="action-btn" id="fold-btn">Fold (${foldShortcut})</button>
  </div>
<script>
  var start = Date.now();
  setInterval(function() {
    var s = Math.floor((Date.now() - start) / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    document.getElementById('timer').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);
  // contextBridge doesn't work with data: URLs, so use window action flags
  // that the main process polls via executeJavaScript (same pattern as update banner).
  window.__sidecarToolbarAction = null;
  document.getElementById('fold-btn').addEventListener('click', function() {
    window.__sidecarToolbarAction = 'fold';
  });
  document.getElementById('settings-btn').addEventListener('click', function() {
    window.__sidecarToolbarAction = 'open-settings';
  });

  // Update banner logic (data injected at build time, no IPC needed)
  (function() {
    var updateInfo = ${JSON.stringify(updateInfo)};
    if (!updateInfo || !updateInfo.hasUpdate) { return; }

    var banner = document.getElementById('update-banner');
    var text = document.getElementById('update-text');
    var btn = document.getElementById('update-btn');
    var dismiss = document.getElementById('dismiss-btn');

    text.textContent = 'v' + updateInfo.latest + ' available';
    banner.style.display = 'flex';

    // Notify main process to expand toolbar area
    // Uses postMessage since preload contextBridge doesn't work with data: URLs
    window.__sidecarUpdateAction = null;
    btn.addEventListener('click', function() {
      btn.disabled = true;
      btn.textContent = 'Updating...';
      dismiss.style.display = 'none';
      window.__sidecarUpdateAction = 'perform-update';
    });

    dismiss.addEventListener('click', function() {
      banner.style.display = 'none';
      window.__sidecarUpdateAction = 'dismiss';
    });
  })();
</script>
</body></html>`;
}

module.exports = { buildToolbarHTML, TOOLBAR_H, getBrandName };
