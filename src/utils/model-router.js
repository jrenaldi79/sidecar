/**
 * Model Router - Intelligent model selection based on agent type
 *
 * Routes Explore subagents to cheaper models by default while preserving
 * explicit overrides and keeping Plan/General agents on the parent model.
 *
 * OpenCode SDK Note: This routing is implemented at the application level.
 * OpenCode's agent types (Build, Plan, Explore, General) control tool
 * permissions only - model selection is passed separately via the `model`
 * parameter in `sendPrompt()`.
 */

/**
 * Default cheap model for Explore tasks
 * @constant {string}
 */
const DEFAULT_CHEAP_MODEL = 'openrouter/google/gemini-3-flash-preview';

/**
 * Normalize agent type to standard capitalization
 * @param {string|null|undefined} agentType - Agent type to normalize
 * @returns {string|null} Normalized agent type or null
 */
function normalizeAgentType(agentType) {
  if (!agentType || typeof agentType !== 'string') {
    return null;
  }
  const normalized = agentType.toLowerCase();
  if (normalized === 'explore') { return 'Explore'; }
  if (normalized === 'plan') { return 'Plan'; }
  if (normalized === 'general') { return 'General'; }
  if (normalized === 'build') { return 'Build'; }
  return agentType; // Pass through custom agents
}

/**
 * Check if routing is enabled (can be disabled via env)
 * @returns {boolean} True if routing is enabled
 */
function isRoutingEnabled() {
  return process.env.SIDECAR_DISABLE_MODEL_ROUTING !== 'true';
}

/**
 * Get configured cheap model from environment
 * @returns {string} Model identifier for cheap/fast model
 */
function getConfiguredCheapModel() {
  return process.env.SIDECAR_EXPLORE_MODEL || DEFAULT_CHEAP_MODEL;
}

/**
 * Resolve the model to use for a subagent
 *
 * Resolution priority:
 * 1. Explicit model always wins
 * 2. Top-level sessions don't get routed
 * 3. Routing disabled returns parent model
 * 4. Explore agents get routed to cheap model
 * 5. All other agents inherit parent model
 *
 * @param {Object} options - Resolution options
 * @param {string} [options.agentType] - Agent type (General, Explore, Plan)
 * @param {string} [options.explicitModel] - Explicitly requested model (overrides routing)
 * @param {string} options.parentModel - Parent session's model
 * @param {boolean} [options.isSubagent=true] - Whether this is a subagent (vs top-level)
 * @returns {{model: string, wasRouted: boolean, reason: string}} Resolution result
 *
 * @example
 * // Explore subagent gets cheap model
 * resolveModel({ agentType: 'Explore', parentModel: 'claude-opus' })
 * // => { model: 'gemini-3-flash', wasRouted: true, reason: 'routed_explore' }
 *
 * @example
 * // Explicit model overrides routing
 * resolveModel({ agentType: 'Explore', explicitModel: 'gpt-4', parentModel: 'claude-opus' })
 * // => { model: 'gpt-4', wasRouted: false, reason: 'explicit_override' }
 *
 * @example
 * // Plan agent inherits parent model
 * resolveModel({ agentType: 'Plan', parentModel: 'claude-opus' })
 * // => { model: 'claude-opus', wasRouted: false, reason: 'inherited_parent' }
 */
function resolveModel(options) {
  const { explicitModel, parentModel, isSubagent = true } = options;
  const agentType = normalizeAgentType(options.agentType);

  // 1. Explicit model always wins
  if (explicitModel) {
    return {
      model: explicitModel,
      wasRouted: false,
      reason: 'explicit_override'
    };
  }

  // 2. Top-level sessions don't get routed
  if (!isSubagent) {
    return {
      model: parentModel,
      wasRouted: false,
      reason: 'top_level_session'
    };
  }

  // 3. Check if routing is disabled
  if (!isRoutingEnabled()) {
    return {
      model: parentModel,
      wasRouted: false,
      reason: 'routing_disabled'
    };
  }

  // 4. Route ONLY Explore to cheap model
  if (agentType === 'Explore') {
    return {
      model: getConfiguredCheapModel(),
      wasRouted: true,
      reason: 'routed_explore'
    };
  }

  // 5. Default: inherit parent model (Plan, General, Build, custom, null, etc.)
  return {
    model: parentModel,
    wasRouted: false,
    reason: 'inherited_parent'
  };
}

module.exports = {
  resolveModel,
  getConfiguredCheapModel,
  isRoutingEnabled,
  normalizeAgentType,
  DEFAULT_CHEAP_MODEL
};
