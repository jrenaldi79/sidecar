/**
 * MCP Manager Module
 *
 * Provides MCP server management capability for mid-conversation server changes.
 * This module is designed to work in both Node.js (for testing) and browser contexts.
 */

/**
 * MCP Server Types
 */
const MCP_SERVER_TYPES = {
  LOCAL: 'local',
  REMOTE: 'remote',
};

/**
 * SVG icons for MCP server types
 */
const MCP_ICONS = {
  // Local server - terminal/command icon
  local:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  // Remote server - cloud/network icon
  remote:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
  // Default/unknown - plug icon
  default:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v6M12 18v4M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M18 12h4M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/></svg>',
};

/**
 * Get SVG icon for an MCP server type
 * @param {string} type - Server type (local or remote)
 * @returns {string} SVG icon HTML
 */
function getMcpIcon(type) {
  return MCP_ICONS[type] || MCP_ICONS.default;
}

/**
 * Parse a server spec value into a config object
 * @param {string} name - Server name
 * @param {string} value - Server URL or command
 * @returns {object} Server configuration
 */
function parseServerSpec(name, value) {
  // If value looks like a URL, treat as remote
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return {
      type: MCP_SERVER_TYPES.REMOTE,
      url: value,
      enabled: true,
    };
  }

  // Otherwise treat as local command
  return {
    type: MCP_SERVER_TYPES.LOCAL,
    command: value.split(' '),
    enabled: true,
  };
}

/**
 * Validate server input
 * @param {string} name - Server name
 * @param {string} value - Server URL or command
 * @returns {{valid: boolean, error?: string}}
 */
function validateServerInput(name, value) {
  if (!name || !name.trim()) {
    return { valid: false, error: 'Server name is required' };
  }

  if (!value || !value.trim()) {
    return { valid: false, error: 'Server URL or command is required' };
  }

  return { valid: true };
}

/**
 * Format server config for display
 * @param {object} config - Server configuration
 * @returns {{typeLabel: string, detail: string, enabled: boolean}}
 */
function formatServerForDisplay(config) {
  const typeLabel = config.type === MCP_SERVER_TYPES.LOCAL ? 'Local' : 'Remote';

  let detail = '';
  if (config.type === MCP_SERVER_TYPES.LOCAL && config.command) {
    detail = config.command.join(' ');
  } else if (config.type === MCP_SERVER_TYPES.REMOTE && config.url) {
    // Extract hostname from URL for display
    try {
      const url = new URL(config.url);
      detail = url.hostname;
    } catch {
      detail = config.url;
    }
  }

  return {
    typeLabel,
    detail,
    enabled: config.enabled !== false,
  };
}

/**
 * MCP Manager State
 * Manages MCP server configurations with event notifications
 */
class McpManagerState {
  constructor() {
    this._servers = {};
    this._listeners = [];
  }

  /**
   * Get all servers
   * @returns {object} Server configurations keyed by name
   */
  getServers() {
    return { ...this._servers };
  }

  /**
   * Load servers from config object
   * @param {object} config - MCP config object
   */
  loadConfig(config) {
    this._servers = { ...config };
    this._notifyListeners({ action: 'load', servers: this._servers });
  }

  /**
   * Add a new server
   * @param {string} name - Server name
   * @param {object} config - Server configuration
   */
  addServer(name, config) {
    this._servers[name] = config;
    this._notifyListeners({ action: 'add', name, config });
  }

  /**
   * Remove a server
   * @param {string} name - Server name
   */
  removeServer(name) {
    delete this._servers[name];
    this._notifyListeners({ action: 'remove', name });
  }

  /**
   * Toggle server enabled state
   * @param {string} name - Server name
   */
  toggleServer(name) {
    if (this._servers[name]) {
      this._servers[name].enabled = !this._servers[name].enabled;
      this._notifyListeners({
        action: 'toggle',
        name,
        enabled: this._servers[name].enabled,
      });
    }
  }

  /**
   * Get count of enabled servers
   * @returns {number}
   */
  getEnabledCount() {
    return Object.values(this._servers).filter((s) => s.enabled !== false).length;
  }

  /**
   * Register a change listener
   * @param {Function} listener - Callback function
   */
  onChange(listener) {
    this._listeners.push(listener);
  }

  /**
   * Notify all listeners of a change
   * @param {object} event - Change event
   */
  _notifyListeners(event) {
    this._listeners.forEach((listener) => listener(event));
  }

  /**
   * Export current config for saving
   * @returns {object} MCP config object
   */
  exportConfig() {
    return { ...this._servers };
  }
}

// Export for both Node.js (CommonJS) and browser (global) environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MCP_SERVER_TYPES,
    getMcpIcon,
    parseServerSpec,
    validateServerInput,
    formatServerForDisplay,
    McpManagerState,
  };
}

// Browser global (for use in renderer.js)
if (typeof window !== 'undefined') {
  window.McpManager = {
    MCP_SERVER_TYPES,
    getMcpIcon,
    parseServerSpec,
    validateServerInput,
    formatServerForDisplay,
    McpManagerState,
  };
}
