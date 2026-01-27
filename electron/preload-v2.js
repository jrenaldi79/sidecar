/**
 * Electron Preload Script - Version 2
 *
 * Exposes secure bridge between the custom chat UI and Electron's main process.
 * This version includes all IPC handlers needed by the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Trigger the Fold mechanism to generate summary and close.
   */
  fold: () => ipcRenderer.invoke('fold'),

  /**
   * Log a conversation message for capture.
   */
  logMessage: (msg) => ipcRenderer.invoke('log-message', msg),

  /**
   * Get sidecar configuration.
   */
  getConfig: () => ipcRenderer.invoke('get-config'),

  /**
   * Spawn a sub-agent.
   *
   * @param {Object} config - Sub-agent configuration
   * @param {string} config.agentType - Type of agent (general, explore, security, test)
   * @param {string} config.briefing - Task description
   * @param {string} config.parentSessionId - Parent session ID
   * @returns {Promise<Object>} Sub-agent result with childSessionId
   */
  spawnSubagent: (config) => ipcRenderer.invoke('spawn-subagent', config),

  /**
   * Get sub-agent status.
   *
   * @param {string} childSessionId - Child session ID
   * @returns {Promise<Object>} Status object with completed flag
   */
  getSubagentStatus: (childSessionId) => ipcRenderer.invoke('get-subagent-status', childSessionId),

  /**
   * Get sub-agent result.
   *
   * @param {string} childSessionId - Child session ID
   * @returns {Promise<Object>} Result object with summary
   */
  getSubagentResult: (childSessionId) => ipcRenderer.invoke('get-subagent-result', childSessionId),

  /**
   * Cancel the current in-flight request.
   *
   * @returns {Promise<{success: boolean, message: string}>} Cancellation result
   */
  cancelRequest: () => ipcRenderer.invoke('cancel-request'),

  /**
   * Check the OpenCode server health status.
   *
   * @returns {Promise<{healthy: boolean, lastCheck: string}>} Health status
   */
  checkServerHealth: () => ipcRenderer.invoke('check-server-health'),

  /**
   * Get agent-model configuration.
   *
   * @returns {Promise<Object>} Configuration with Explore, Plan, General settings
   */
  getAgentModelConfig: () => ipcRenderer.invoke('get-agent-model-config'),

  /**
   * Save agent-model configuration.
   *
   * @param {Object} config - Configuration object
   * @returns {Promise<boolean>} True if saved successfully
   */
  setAgentModelConfig: (config) => ipcRenderer.invoke('set-agent-model-config', config)
});
