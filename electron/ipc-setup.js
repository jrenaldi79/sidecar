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
      const { removeFromAuthJson } = require('../src/utils/auth-json');
      const result = removeApiKey(provider);
      // Clean auth.json when present — prevents auto-import from re-adding the key
      if (result.alsoInAuthJson) {
        try {
          removeFromAuthJson(provider);
          result.alsoInAuthJson = false;
        } catch (authErr) {
          logger.warn('Failed to remove from auth.json', { provider, error: authErr.message });
        }
      }
      return result;
    } catch (err) {
      logger.error('remove-key handler error', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sidecar:remove-from-opencode', async (_event, provider) => {
    try {
      const { removeFromAuthJson } = require('../src/utils/auth-json');
      removeFromAuthJson(provider);
      return { success: true };
    } catch (err) {
      logger.error('remove-from-opencode handler error', { error: err.message });
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
    try {
      const { readApiKeys, readApiKeyHints, saveApiKey } = require('../src/utils/api-key-store');
      const { importFromAuthJson } = require('../src/utils/auth-json');
      const status = readApiKeys();
      const hints = readApiKeyHints();

      // Auto-import keys from auth.json that sidecar doesn't have yet
      const { imported } = importFromAuthJson(status);
      const successfullyImported = [];
      for (const entry of imported) {
        const result = saveApiKey(entry.provider, entry.key);
        if (result.success) {
          status[entry.provider] = true;
          const visible = entry.key.slice(0, 8);
          hints[entry.provider] = visible + '\u2022'.repeat(Math.max(0, Math.min(entry.key.length - 8, 12)));
          successfullyImported.push(entry.provider);
        } else {
          logger.warn('Failed to import key from auth.json', { provider: entry.provider, error: result.error });
        }
      }

      return { status, hints, imported: successfullyImported };
    } catch (err) {
      logger.error('get-api-keys handler error', { error: err.message });
      return { status: {}, hints: {}, imported: [], error: err.message };
    }
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
