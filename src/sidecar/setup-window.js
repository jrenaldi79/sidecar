/**
 * Setup Window Launcher
 *
 * Spawns the Electron window in setup mode (SIDECAR_MODE=setup)
 * for API key configuration. Waits for the window to close and
 * returns whether setup completed successfully.
 */

const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('../utils/logger');

/**
 * Launch the Electron setup window for API key entry
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
function launchSetupWindow() {
  return new Promise((resolve) => {
    const electronPath = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron');
    const mainPath = path.join(__dirname, '..', '..', 'electron', 'main.js');

    const env = {
      ...process.env,
      SIDECAR_MODE: 'setup'
    };

    logger.info('Launching setup window');

    const proc = spawn(electronPath, [mainPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });

    proc.stderr.setEncoding('utf-8');
    proc.stderr.on('data', (chunk) => {
      logger.debug('Setup window stderr', { data: chunk.trim() });
    });

    proc.on('close', (code) => {
      logger.info('Setup window closed', { code });

      // Check if setup completed (stdout contains JSON status)
      if (stdout.includes('"status":"complete"')) {
        // Parse enriched JSON for default model and keyCount
        try {
          const jsonLine = stdout.split('\n').find(l => l.includes('"status":"complete"'));
          const data = JSON.parse(jsonLine);
          const result = { success: true };
          if (data.default) { result.default = data.default; }
          if (data.keyCount) { result.keyCount = data.keyCount; }
          resolve(result);
        } catch (_err) {
          resolve({ success: true });
        }
      } else {
        resolve({
          success: false,
          error: 'Setup window closed without completing'
        });
      }
    });
  });
}

module.exports = { launchSetupWindow };
