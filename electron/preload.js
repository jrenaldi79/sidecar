/**
 * Sidecar Preload - v3 Minimal
 *
 * Exposes only the fold IPC bridge to the renderer.
 * OpenCode's Web UI handles all other functionality natively.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sidecar', {
  /** Trigger fold: summarize and return to Claude Code */
  fold: () => ipcRenderer.invoke('sidecar:fold'),
  /** Open settings wizard in a child window */
  openSettings: () => ipcRenderer.invoke('sidecar:open-settings'),
});
