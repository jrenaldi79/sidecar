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
  logMessage: (msg) => ipcRenderer.invoke('log-message', msg),

  /**
   * Get the sidecar configuration.
   *
   * @returns {Promise<Object>} Configuration object
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
   * When called:
   * 1. Main process aborts the current OpenCode API request
   * 2. Session returns to idle state
   * 3. User can send new messages
   *
   * @returns {Promise<{success: boolean, message: string}>} Cancellation result
   */
  cancelRequest: () => ipcRenderer.invoke('cancel-request'),

  /**
   * Check the OpenCode server health status.
   *
   * Used for connection status indicator in the UI.
   * Returns immediately with cached status or performs health check.
   *
   * @returns {Promise<{healthy: boolean, lastCheck: string}>} Health status
   */
  checkServerHealth: () => ipcRenderer.invoke('check-server-health'),

  /**
   * Get agent-model configuration.
   *
   * Returns the current configuration for which models to use with each agent type.
   * Each agent can be set to 'inherit' (use parent model) or 'select' (use specific model).
   *
   * @returns {Promise<Object>} Configuration with Explore, Plan, General settings
   */
  getAgentModelConfig: () => ipcRenderer.invoke('get-agent-model-config'),

  /**
   * Save agent-model configuration.
   *
   * Persists the agent-model settings to disk (~/.config/sidecar/agent-models.json).
   *
   * @param {Object} config - Configuration object
   * @param {Object} config.Explore - Explore agent settings
   * @param {Object} config.Plan - Plan agent settings
   * @param {Object} config.General - General agent settings
   * @returns {Promise<boolean>} True if saved successfully
   */
  setAgentModelConfig: (config) => ipcRenderer.invoke('set-agent-model-config', config)
});
