/**
 * Subagent Type Definitions
 *
 * OpenCode Native Subagent Types (https://opencode.ai/docs/agents/):
 *   - General: Full-access subagent for research and parallel tasks
 *   - Explore: Read-only subagent for codebase exploration
 *
 * Tool permissions are enforced by OpenCode's native agent framework,
 * not via system prompt text. These descriptions are for documentation.
 */

const { normalizeSubagent } = require('./utils/agent-mapping');

/**
 * @typedef {Object} SubagentConfig
 * @property {string} description - Human-readable description
 * @property {string} toolAccess - Tool access level description
 */

/**
 * Subagent configurations aligned with OpenCode's native agents
 * @type {Object.<string, SubagentConfig>}
 */
const AGENT_TYPES = {
  general: {
    description: 'Full-access subagent for research and parallel tasks',
    toolAccess: 'Full (read, write, bash, task)'
  },
  explore: {
    description: 'Read-only subagent for codebase exploration',
    toolAccess: 'Read-only'
  }
};

/**
 * Get subagent configuration by name
 * @param {string} typeName - Subagent type name (case-insensitive)
 * @returns {SubagentConfig|null} Configuration or null if not found
 */
function getAgentType(typeName) {
  if (!typeName || typeof typeName !== 'string') {
    return null;
  }
  const normalizedName = typeName.toLowerCase();
  return AGENT_TYPES[normalizedName] || null;
}

/**
 * Validate if a subagent type name is valid
 * @param {string} typeName - Subagent type name to validate
 * @returns {boolean} True if valid subagent type (General or Explore)
 */
function validateAgentType(typeName) {
  if (!typeName || typeof typeName !== 'string') {
    return false;
  }
  const normalizedName = typeName.toLowerCase();
  return normalizedName in AGENT_TYPES;
}

/**
 * Get tool access description for a subagent type
 * @param {string} typeName - Subagent type name
 * @returns {string|null} Tool access description or null if invalid type
 */
function getAgentTools(typeName) {
  const agent = getAgentType(typeName);
  if (!agent) {
    return null;
  }
  return agent.toolAccess;
}

/**
 * Get description for a subagent type
 * @param {string} typeName - Subagent type name
 * @returns {string|null} Description or null if invalid type
 */
function getAgentDescription(typeName) {
  const agent = getAgentType(typeName);
  if (!agent) {
    return null;
  }
  return agent.description;
}

/**
 * List all available subagent type names
 * @returns {string[]} Array of subagent type names
 */
function listAgentTypes() {
  return Object.keys(AGENT_TYPES);
}

/**
 * Get the OpenCode-normalized subagent name
 * @param {string} typeName - Subagent type name
 * @returns {string|null} Normalized OpenCode agent name (General or Explore)
 */
function getOpenCodeAgentName(typeName) {
  return normalizeSubagent(typeName);
}

module.exports = {
  AGENT_TYPES,
  getAgentType,
  validateAgentType,
  getAgentTools,
  getAgentDescription,
  listAgentTypes,
  getOpenCodeAgentName
};
