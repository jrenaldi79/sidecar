/**
 * Fold Logic
 *
 * Handles the fold action: showing overlay, requesting summary,
 * outputting fold data to stdout, and closing the window.
 */

const { logger } = require('../src/utils/logger');
const { requestSummaryFromModel } = require('./summary');
const { getSummaryTemplate } = require('../src/prompt-builder');

/**
 * Create a fold handler bound to the window state
 * @param {object} state - Shared state object
 * @param {string} state.model - Model name
 * @param {string} state.client - Client type
 * @param {string} state.cwd - Working directory
 * @param {string} state.sessionId - OpenCode session ID
 * @param {string} state.taskId - Sidecar task ID
 * @param {number} state.port - OpenCode server port
 * @returns {{ triggerFold: Function, hasFolded: Function }}
 */
function createFoldHandler(state) {
  let folded = false;

  async function triggerFold(mainWindow, contentView) {
    if (folded) { return; }
    folded = true;

    // Show fold progress in toolbar and content overlay
    showFoldOverlay(mainWindow, contentView);

    try {
      // Ask the model to generate a structured summary
      let summary = '';
      try {
        summary = await requestSummaryFromModel(
          state.sessionId, state.port, getSummaryTemplate
        );
      } catch (err) {
        logger.warn('Failed to get model summary', { error: err.message });
      }

      const output = [
        '[SIDECAR_FOLD]',
        `Model: ${state.model}`,
        `Session: ${state.sessionId || state.taskId}`,
        `Client: ${state.client}`,
        `CWD: ${state.cwd}`,
        `Mode: interactive`,
        '---',
        summary || 'Session ended without summary.'
      ].join('\n');

      process.stdout.write(output + '\n');
      logger.info('Fold completed', { taskId: state.taskId });
    } catch (err) {
      logger.error('Fold failed', { error: err.message });
      folded = false;
      return;
    }

    // Close the window after fold
    const { app } = require('electron');
    if (mainWindow) {
      mainWindow.close();
    } else {
      app.quit();
    }
  }

  function hasFolded() {
    return folded;
  }

  return { triggerFold, hasFolded };
}

/**
 * Show fold progress overlay in both the toolbar and the content view.
 * Note: The JS strings below contain only hardcoded markup (no user input),
 * so there is no XSS risk from DOM manipulation.
 */
function showFoldOverlay(mainWindow, contentView) {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      (function() {
        var btn = document.getElementById('fold-btn');
        if (btn) {
          btn.textContent = '';
          var span = document.createElement('span');
          span.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
          var spinner = document.createElement('span');
          spinner.style.cssText = 'width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block;';
          span.appendChild(spinner);
          span.appendChild(document.createTextNode('Generating summary\\u2026'));
          btn.appendChild(span);
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
      })();
    `).catch(() => {});
  }
  if (contentView) {
    contentView.webContents.executeJavaScript(`
      (function() {
        if (!document.getElementById('fold-spin-style')) {
          var style = document.createElement('style');
          style.id = 'fold-spin-style';
          style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
          document.head.appendChild(style);
        }
        var overlay = document.createElement('div');
        overlay.id = 'sidecar-fold-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;';

        var spinDiv = document.createElement('div');
        spinDiv.style.cssText = 'width:32px;height:32px;border:3px solid rgba(217,119,87,0.3);border-top-color:#D97757;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px;';
        overlay.appendChild(spinDiv);

        var titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'color:#E8E0D8;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;font-weight:500;';
        titleDiv.textContent = 'Generating summary\\u2026';
        overlay.appendChild(titleDiv);

        var subtitleDiv = document.createElement('div');
        subtitleDiv.style.cssText = 'color:#7A756F;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;margin-top:6px;';
        subtitleDiv.textContent = 'Folding session back to Claude Code';
        overlay.appendChild(subtitleDiv);

        document.body.appendChild(overlay);
      })();
    `).catch(() => {});
  }
}

module.exports = { createFoldHandler, showFoldOverlay };
