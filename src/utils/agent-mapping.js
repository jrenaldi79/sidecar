/**
 * Agent Mapping Module
 *
 * Maps agent names to OpenCode's native agent framework.
 *
 * OpenCode Native Agents (https://opencode.ai/docs/agents/):
 *
 * PRIMARY AGENTS (for main sidecar sessions):
 *   - Build: Default primary agent with full tool access
 *   - Plan: Read-only primary agent for analysis and planning
 *
 * SUBAGENTS (spawned within sessions):
 *   - General: Full-access subagent for research and parallel tasks
 *   - Explore: Read-only subagent for codebase exploration
 *
 * Custom agents defined in ~/.config/opencode/agents/ or .opencode/agents/
 * are passed through directly to OpenCode.
 */

/**
 * OpenCode's primary agent names (for main sessions)
 */
const PRIMARY_AGENTS = ['Build', 'Plan'];

/**
 * OpenCode's subagent names (spawned within sessions)
 */
const SUBAGENT_TYPES = ['General', 'Explore'];

/**
 * All OpenCode native agent names
 */
const OPENCODE_AGENTS = [...PRIMARY_AGENTS, ...SUBAGENT_TYPES];

/**
 * Map an agent name to OpenCode native agent configuration
 *
 * @param {string} agent - Agent name (OpenCode native or custom)
 * @returns {{agent: string}} OpenCode agent configuration
 *
 * @example
 * mapAgentToOpenCode('Build')   // { agent: 'Build' }
 * mapAgentToOpenCode('Plan')    // { agent: 'Plan' }
 * mapAgentToOpenCode('custom')  // { agent: 'custom' }
 */
function mapAgentToOpenCode(agent) {
  // Handle undefined/null/empty - default to Build
  if (!agent || (typeof agent === 'string' && agent.trim() === '')) {
    return { agent: 'Build' };
  }

  // Normalize for case-insensitive matching of native agents
  const normalized = agent.toLowerCase();

  // Check if it's an OpenCode native agent (case-insensitive match)
  const nativeMatch = OPENCODE_AGENTS.find(
    native => native.toLowerCase() === normalized
  );
  if (nativeMatch) {
    return { agent: nativeMatch };
  }

  // Pass through custom agent names unchanged
  return { agent };
}

/**
 * Check if an agent name is valid for primary sessions
 *
 * @param {string} agent - Agent name to validate
 * @returns {boolean} True if valid primary agent or custom agent
 */
function isValidPrimaryAgent(agent) {
  if (!isValidAgent(agent)) {
    return false;
  }

  // All non-empty strings are valid (custom agents allowed)
  return true;
}

/**
 * Check if an agent name is valid for subagents
 *
 * @param {string} agent - Agent name to validate
 * @returns {boolean} True if valid subagent type (General or Explore only)
 */
function isValidSubagent(agent) {
  if (!agent || typeof agent !== 'string') {
    return false;
  }

  const normalized = agent.toLowerCase();
  return SUBAGENT_TYPES.some(type => type.toLowerCase() === normalized);
}

/**
 * Check if an agent name is valid (non-empty string)
 *
 * All non-empty agent names are considered valid because:
 * 1. OpenCode native agents (Build, Plan, General, Explore) are always valid
 * 2. Custom agents defined in user's agent directory should be allowed
 *    (OpenCode will validate at runtime)
 *
 * @param {string} agent - Agent name to validate
 * @returns {boolean} True if valid (non-empty string)
 */
function isValidAgent(agent) {
  if (agent === null || agent === undefined) {
    return false;
  }

  if (typeof agent !== 'string') {
    return false;
  }

  return agent.trim().length > 0;
}

/**
 * Get the normalized OpenCode subagent name
 *
 * @param {string} agent - Subagent type (General or Explore)
 * @returns {string|null} Normalized agent name or null if invalid
 */
function normalizeSubagent(agent) {
  if (!agent || typeof agent !== 'string') {
    return null;
  }

  const normalized = agent.toLowerCase();
  const match = SUBAGENT_TYPES.find(type => type.toLowerCase() === normalized);
  return match || null;
}

module.exports = {
  PRIMARY_AGENTS,
  SUBAGENT_TYPES,
  OPENCODE_AGENTS,
  mapAgentToOpenCode,
  isValidAgent,
  isValidPrimaryAgent,
  isValidSubagent,
  normalizeSubagent
};
