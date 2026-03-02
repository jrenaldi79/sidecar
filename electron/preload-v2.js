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
  setAgentModelConfig: (config) => ipcRenderer.invoke('set-agent-model-config', config),

  // ============================================================================
  // API Proxy (bypasses Chromium network service issues)
  // ============================================================================

  /**
   * Make an API call through the main process network stack.
   * This bypasses Chromium's potentially unstable network service.
   *
   * @param {Object} options - Request options
   * @param {string} options.method - HTTP method (GET, POST, etc.)
   * @param {string} options.endpoint - API endpoint path (e.g., '/session/abc/message')
   * @param {Object} [options.body] - Request body (will be JSON stringified)
   * @returns {Promise<{ok: boolean, status: number, data: any}>}
   */
  proxyApiCall: (options) => ipcRenderer.invoke('proxy-api-call', options),

  // ============================================================================
  // Error Reporting & Health Check APIs
  // ============================================================================

  /**
   * Report an error from renderer to main process for logging.
   *
   * @param {Object} errorData - Error information
   * @param {string} errorData.source - Error source (e.g., 'fetch', 'api', 'render')
   * @param {string} errorData.message - Error message
   * @param {Object} [errorData.context] - Additional context
   * @param {string} [errorData.stack] - Stack trace
   * @returns {Promise<{logged: boolean, errorCount: number}>}
   */
  reportError: (errorData) => ipcRenderer.invoke('report-error', errorData),

  /**
   * Get the error log for diagnostics.
   *
   * @returns {Promise<Array>} Array of logged errors
   */
  getErrorLog: () => ipcRenderer.invoke('get-error-log'),

  /**
   * Perform a health check on the backend services.
   *
   * @returns {Promise<{timestamp: number, server: boolean, session: boolean, apiReachable: boolean}>}
   */
  healthCheck: () => ipcRenderer.invoke('health-check'),

  /**
   * Listen for error notifications from main process.
   *
   * @param {Function} callback - Called with error data when an error occurs
   */
  onError: (callback) => ipcRenderer.on('error-notification', (_event, data) => callback(data)),

  /**
   * Listen for request cancellation notifications.
   *
   * @param {Function} callback - Called when request is cancelled
   */
  onRequestCancelled: (callback) => ipcRenderer.on('request-cancelled', () => callback()),

  // ============================================================================
  // SSE Streaming Support
  // ============================================================================

  /**
   * Subscribe to SSE events from the server.
   * Events will be delivered via the onSSEEvent callback.
   *
   * @returns {Promise<{success: boolean}>}
   */
  subscribeSSE: () => ipcRenderer.invoke('subscribe-sse'),

  /**
   * Unsubscribe from SSE events.
   *
   * @returns {Promise<{success: boolean}>}
   */
  unsubscribeSSE: () => ipcRenderer.invoke('unsubscribe-sse'),

  /**
   * Listen for SSE events from the server.
   *
   * @param {Function} callback - Called with event data
   */
  onSSEEvent: (callback) => ipcRenderer.on('sse-event', (_event, data) => callback(data)),

  /**
   * Send a message asynchronously (returns immediately, events via SSE).
   *
   * @param {Object} options - Request options
   * @returns {Promise<{ok: boolean, status: string}>}
   */
  sendMessageAsync: (options) => ipcRenderer.invoke('send-message-async', options)
});
