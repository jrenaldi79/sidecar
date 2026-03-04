/**
 * IPC Setup Handlers
 *
 * Extracted from main.js to keep file sizes under 300 lines.
 * Registers all setup-mode IPC handlers: validate-key, save-key,
 * remove-key, setup-done, save-config, get-config, get-api-keys,
 * and fetch-models.
 */

const { logger } = require('../src/utils/logger');

/**
 * Register all setup-related IPC handlers
 * @param {Electron.IpcMain} ipcMain - Electron IPC main
 * @param {function} getMainWindow - Returns the current main BrowserWindow
 */
function registerSetupHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('sidecar:validate-key', async (_event, provider, key) => {
    try {
      const { validateApiKey } = require('../src/utils/api-key-store');
      return await validateApiKey(provider, key);
    } catch (err) {
      logger.error('validate-key handler error', { error: err.message });
      return { valid: false, error: err.message };
    }
  });

  ipcMain.handle('sidecar:save-key', async (_event, provider, key) => {
    try {
      const { saveApiKey } = require('../src/utils/api-key-store');
      return saveApiKey(provider, key);
    } catch (err) {
      logger.error('save-key handler error', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sidecar:remove-key', async (_event, provider) => {
    try {
      const { removeApiKey } = require('../src/utils/api-key-store');
      return removeApiKey(provider);
    } catch (err) {
      logger.error('remove-key handler error', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sidecar:setup-done', (_event, defaultModel, keyCount) => {
    const { BrowserWindow } = require('electron');
    const senderWindow = BrowserWindow.fromWebContents(_event.sender);
    const mainWin = getMainWindow();

    // If sent from main window → stdout + close (CLI setup flow)
    // If sent from child window → just close it (settings flow)
    if (senderWindow === mainWin) {
      const result = JSON.stringify({
        status: 'complete',
        default: defaultModel || undefined,
        keyCount: keyCount || undefined
      });
      process.stdout.write(result + '\n');
      if (mainWin) { mainWin.close(); }
    } else if (senderWindow) {
      senderWindow.close();
    }
  });

  ipcMain.handle('sidecar:save-config', (_event, defaultModel, aliasOverrides) => {
    const { saveConfig, getDefaultAliases } = require('../src/utils/config');
    const aliases = getDefaultAliases();
    if (aliasOverrides && typeof aliasOverrides === 'object') {
      Object.assign(aliases, aliasOverrides);
    }
    saveConfig({ default: defaultModel, aliases });
    return { success: true };
  });

  ipcMain.handle('sidecar:get-config', () => {
    const { loadConfig } = require('../src/utils/config');
    return loadConfig();
  });

  ipcMain.handle('sidecar:get-api-keys', () => {
    const { readApiKeys, readApiKeyHints } = require('../src/utils/api-key-store');
    return { status: readApiKeys(), hints: readApiKeyHints() };
  });

  ipcMain.handle('sidecar:fetch-models', async () => {
    try {
      const { readApiKeyValues } = require('../src/utils/api-key-store');
      const { fetchAllModels, groupModelsByFamily } = require('../src/utils/model-fetcher');
      const keys = readApiKeyValues();
      const models = await fetchAllModels(keys);
      return groupModelsByFamily(models);
    } catch (err) {
      logger.error('fetch-models handler error', { error: err.message });
      return [];
    }
  });
}

module.exports = { registerSetupHandlers };
