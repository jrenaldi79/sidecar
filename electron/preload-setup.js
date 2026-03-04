/**
 * Sidecar Preload - Setup Mode
 *
 * Exposes IPC bridge for the setup window:
 *   - invoke: Generic IPC invoke for validate-key, save-key, setup-done
 *   - openExternal: Open URLs in default browser
 */

const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('sidecarSetup', {
  /** Generic IPC invoke for setup channels */
  invoke: (channel, ...args) => {
    const allowedChannels = [
      'sidecar:validate-key',
      'sidecar:save-key',
      'sidecar:remove-key',
      'sidecar:setup-done',
      'sidecar:save-config',
      'sidecar:get-config',
      'sidecar:get-api-keys',
      'sidecar:fetch-models'
    ];
    if (!allowedChannels.includes(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  /** Open a URL in the default browser */
  openExternal: (url) => {
    if (typeof url === 'string' && url.startsWith('https://')) {
      shell.openExternal(url);
    }
  }
});
