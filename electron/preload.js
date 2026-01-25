/**
 * Electron Preload Script
 *
 * Spec Reference:
 * - 9.2 Electron Shell (preload.js section)
 *
 * This script runs in the renderer process before the web content loads.
 * It exposes a secure bridge between the web page and Electron's main process.
 *
 * Exposed API:
 * - window.electronAPI.fold() - Triggers summary generation and closes sidecar
 * - window.electronAPI.logMessage(msg) - Captures conversation messages
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose electronAPI to the renderer process via contextBridge.
 *
 * Using contextBridge ensures that the renderer process cannot directly
 * access Node.js APIs, maintaining security while still allowing
 * controlled communication with the main process.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Trigger the Fold mechanism.
   *
   * Spec Reference: 6.1 - The Fold Mechanism
   *
   * When called:
   * 1. Main process injects summary prompt into OpenCode
   * 2. Waits for LLM response
   * 3. Extracts summary and outputs to stdout
   * 4. Closes the window and quits
   *
   * @returns {Promise<void>}
   */
  fold: () => ipcRenderer.invoke('fold'),

  /**
   * Log a conversation message for capture.
   *
   * Spec Reference: 8.2 - Conversation Capture
   *
   * Messages are written to conversation.jsonl in real-time.
   * This allows full conversation history to be persisted for:
   * - Resume functionality
   * - Continue functionality
   * - Post-session analysis
   *
   * @param {Object} msg - Message object
   * @param {string} msg.role - 'user', 'assistant', or 'system'
   * @param {string} msg.content - Message content
   * @param {string} msg.timestamp - ISO timestamp
   * @returns {Promise<void>}
   */
  logMessage: (msg) => ipcRenderer.invoke('log-message', msg)
});
