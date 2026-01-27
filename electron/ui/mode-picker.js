/**
 * Mode Picker Module
 *
 * Provides agent type switching capability for mid-conversation mode changes.
 * Uses OpenCode's native primary agent types:
 *   - Build: Full tool access for development and implementation
 *   - Plan: Read-only mode for analysis and planning
 *
 * This module is designed to work in both Node.js (for testing) and browser contexts.
 */

/**
 * OpenCode Primary Agent Types
 * These control tool permissions at the SDK level.
 * @type {Array<{id: string, name: string, description: string, icon: string, toolAccess: string}>}
 */
const AVAILABLE_AGENTS = [
  {
    id: 'Build',
    name: 'Build Mode',
    description: 'Full tool access - read, write, edit, bash',
    icon: 'build',
    toolAccess: 'full',
  },
  {
    id: 'Plan',
    name: 'Plan Mode',
    description: 'Read-only - analyze and plan without changes',
    icon: 'plan',
    toolAccess: 'readonly',
  },
];

// Legacy alias for backward compatibility
const AVAILABLE_MODES = AVAILABLE_AGENTS;

/**
 * Tools available for each agent type
 * Note: These are enforced by OpenCode's agent framework, not system prompts
 */
const AGENT_TOOLS = {
  Build: [
    'read',
    'write',
    'edit',
    'patch',
    'bash',
    'glob',
    'grep',
    'list',
    'webfetch',
    'question',
    'task',
    'todowrite',
    'todoread',
    'skill',
  ],
  Plan: [
    'read',
    'glob',
    'grep',
    'list',
    'webfetch',
    'question',
    'task',
    'todowrite',
    'todoread',
    'skill',
  ],
};

// Legacy alias for backward compatibility
const MODE_TOOLS = AGENT_TOOLS;

/**
 * SVG icons for agent types
 */
const AGENT_ICONS = {
  // Build mode - hammer/wrench icon for development
  Build: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  // Plan mode - clipboard/document icon for planning
  Plan: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/></svg>',
};

// Legacy alias
const MODE_ICONS = AGENT_ICONS;

/**
 * Find an agent by its ID (case-insensitive)
 * @param {string|null|undefined} agentId - Agent ID to find
 * @returns {Object|undefined} Agent object or undefined if not found
 */
function findAgentById(agentId) {
  if (!agentId) return undefined;
  const normalized = agentId.toLowerCase();
  return AVAILABLE_AGENTS.find((a) => a.id.toLowerCase() === normalized);
}

// Legacy alias
function findModeById(modeId) {
  return findAgentById(modeId);
}

/**
 * Get SVG icon for an agent type
 * @param {string} agentId - Agent ID
 * @returns {string} SVG icon HTML
 */
function getAgentIcon(agentId) {
  // Try exact match first
  if (AGENT_ICONS[agentId]) {
    return AGENT_ICONS[agentId];
  }
  // Try case-insensitive match
  const normalized = agentId ? agentId.charAt(0).toUpperCase() + agentId.slice(1).toLowerCase() : '';
  return (
    AGENT_ICONS[normalized] ||
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
  );
}

// Legacy alias
function getModeIcon(modeId) {
  return getAgentIcon(modeId);
}

/**
 * Get available tools for an agent type
 * @param {string} agentId - Agent ID
 * @returns {string[]} Array of tool names
 */
function getToolsForAgent(agentId) {
  // Try exact match first
  if (AGENT_TOOLS[agentId]) {
    return AGENT_TOOLS[agentId];
  }
  // Try case-insensitive match
  const normalized = agentId ? agentId.charAt(0).toUpperCase() + agentId.slice(1).toLowerCase() : '';
  return AGENT_TOOLS[normalized] || AGENT_TOOLS.Build;
}

// Legacy alias
function getToolsForMode(modeId) {
  return getToolsForAgent(modeId);
}

/**
 * Normalize agent ID to OpenCode format (Build, Plan)
 * @param {string} agentId - Agent ID in any case
 * @returns {string} Normalized agent ID
 */
function normalizeAgentId(agentId) {
  if (!agentId) return 'Build'; // Default to Build
  const lower = agentId.toLowerCase();
  if (lower === 'build') return 'Build';
  if (lower === 'plan') return 'Plan';
  // Return as-is for custom agents
  return agentId;
}

/**
 * Format agent for OpenCode API
 * @param {string} agentId - Agent identifier
 * @param {Object} [options] - Options
 * @param {boolean} [options.omitDefault] - If true, omit agent param for default Build mode
 * @returns {Object} API agent specification
 */
function formatAgentForAPI(agentId, options = {}) {
  const normalized = normalizeAgentId(agentId);
  if (options.omitDefault && normalized === 'Build') {
    return {};
  }
  return { agent: normalized };
}

// Legacy alias
function formatModeForAPI(modeId, options = {}) {
  return formatAgentForAPI(modeId, options);
}

/**
 * Check if an agent has full tool access
 * @param {string} agentId - Agent ID
 * @returns {boolean} True if agent has full access
 */
function hasFullAccess(agentId) {
  const agent = findAgentById(agentId);
  return agent ? agent.toolAccess === 'full' : true; // Default to full access
}

/**
 * Check if an agent is read-only
 * @param {string} agentId - Agent ID
 * @returns {boolean} True if agent is read-only
 */
function isReadOnly(agentId) {
  const agent = findAgentById(agentId);
  return agent ? agent.toolAccess === 'readonly' : false;
}

/**
 * Agent Picker State Manager
 * Manages current agent selection and history with event notifications
 */
class AgentPickerState {
  constructor() {
    this._currentAgent = null;
    this._history = [];
    this._listeners = [];
  }

  /**
   * Get the current agent ID
   * @returns {string|null}
   */
  getCurrentAgent() {
    return this._currentAgent;
  }

  // Legacy alias
  getCurrentMode() {
    return this._currentAgent;
  }

  /**
   * Set the current agent and notify listeners
   * @param {string} agentId - New agent ID
   */
  setCurrentAgent(agentId) {
    const previousAgent = this._currentAgent;
    const normalized = normalizeAgentId(agentId);

    // Don't emit event if agent hasn't changed
    if (previousAgent === normalized) {
      return;
    }

    this._currentAgent = normalized;
    this._history.push(normalized);

    // Notify listeners
    this._listeners.forEach((listener) => {
      listener({
        previousAgent,
        currentAgent: normalized,
        // Legacy fields for backward compatibility
        previousMode: previousAgent,
        currentMode: normalized,
      });
    });
  }

  // Legacy alias
  setCurrentMode(modeId) {
    this.setCurrentAgent(modeId);
  }

  /**
   * Register a change listener
   * @param {Function} listener - Callback function
   */
  onChange(listener) {
    this._listeners.push(listener);
  }

  /**
   * Get agent history
   * @returns {Array<string>}
   */
  getHistory() {
    return [...this._history];
  }
}

// Legacy alias
const ModePickerState = AgentPickerState;

// Export for both Node.js (CommonJS) and browser (global) environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // New API (OpenCode agent-based)
    AVAILABLE_AGENTS,
    AGENT_TOOLS,
    AGENT_ICONS,
    findAgentById,
    getAgentIcon,
    getToolsForAgent,
    normalizeAgentId,
    formatAgentForAPI,
    hasFullAccess,
    isReadOnly,
    AgentPickerState,
    // Legacy API (for backward compatibility)
    AVAILABLE_MODES,
    MODE_TOOLS,
    MODE_ICONS,
    findModeById,
    getModeIcon,
    getToolsForMode,
    formatModeForAPI,
    ModePickerState,
  };
}

// Browser global (for use in renderer.js)
if (typeof window !== 'undefined') {
  window.ModePicker = {
    // New API (OpenCode agent-based)
    AVAILABLE_AGENTS,
    AGENT_TOOLS,
    AGENT_ICONS,
    findAgentById,
    getAgentIcon,
    getToolsForAgent,
    normalizeAgentId,
    formatAgentForAPI,
    hasFullAccess,
    isReadOnly,
    AgentPickerState,
    // Legacy API (for backward compatibility)
    AVAILABLE_MODES,
    MODE_TOOLS,
    MODE_ICONS,
    findModeById,
    getModeIcon,
    getToolsForMode,
    formatModeForAPI,
    ModePickerState,
  };
}
