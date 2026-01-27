/**
 * Agent-Model Configuration - Persistence layer
 *
 * Stores user preferences for which models to use with each agent type.
 * Configuration is saved to ~/.config/sidecar/agent-models.json
 *
 * Each agent can be configured to:
 * - 'inherit': Use the parent session's model
 * - 'select': Use a specific model chosen by the user
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./logger');

/**
 * Path to the agent-model configuration file
 * @constant {string}
 */
const CONFIG_DIR = path.join(os.homedir(), '.config', 'sidecar');
const CONFIG_PATH = path.join(CONFIG_DIR, 'agent-models.json');

/**
 * Default cheap model for Explore agents
 * @constant {string}
 */
const DEFAULT_EXPLORE_MODEL = 'openrouter/google/gemini-3-flash-preview';

/**
 * @typedef {'inherit' | 'select'} AgentModelMode
 */

/**
 * @typedef {Object} AgentModelSetting
 * @property {AgentModelMode} mode - 'inherit' or 'select'
 * @property {string|null} model - Model ID when mode is 'select', null otherwise
 */

/**
 * @typedef {Object} AgentModelConfig
 * @property {AgentModelSetting} Explore - Explore agent settings
 * @property {AgentModelSetting} Plan - Plan agent settings
 * @property {AgentModelSetting} General - General agent settings
 */

/**
 * Get default configuration
 * Explore defaults to using a cheap model, others inherit parent
 *
 * @returns {AgentModelConfig} Default configuration
 */
function getDefaultConfig() {
  return {
    Explore: { mode: 'select', model: DEFAULT_EXPLORE_MODEL },
    Plan: { mode: 'inherit', model: null },
    General: { mode: 'inherit', model: null }
  };
}

/**
 * Load agent-model configuration from disk
 *
 * @returns {AgentModelConfig} Configuration object
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      const config = JSON.parse(content);

      // Merge with defaults to ensure all keys exist
      const defaults = getDefaultConfig();
      return {
        Explore: { ...defaults.Explore, ...config.Explore },
        Plan: { ...defaults.Plan, ...config.Plan },
        General: { ...defaults.General, ...config.General }
      };
    }
  } catch (error) {
    // Log error but return defaults
    logger.warn('Error loading agent-model config', { error: error.message });
  }

  return getDefaultConfig();
}

/**
 * Save agent-model configuration to disk
 *
 * @param {AgentModelConfig} config - Configuration to save
 * @returns {boolean} True if saved successfully
 */
function saveConfig(config) {
  try {
    // Ensure directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // Validate config structure before saving
    const validated = {
      Explore: validateAgentSetting(config.Explore),
      Plan: validateAgentSetting(config.Plan),
      General: validateAgentSetting(config.General)
    };

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2));
    return true;
  } catch (error) {
    logger.error('Error saving agent-model config', { error: error.message });
    return false;
  }
}

/**
 * Validate and normalize an agent setting
 *
 * @param {Object} setting - Setting to validate
 * @returns {AgentModelSetting} Validated setting
 */
function validateAgentSetting(setting) {
  if (!setting || typeof setting !== 'object') {
    return { mode: 'inherit', model: null };
  }

  const mode = setting.mode === 'select' ? 'select' : 'inherit';
  const model = mode === 'select' && setting.model ? String(setting.model) : null;

  return { mode, model };
}

/**
 * Get the model to use for a specific agent type
 *
 * @param {string} agentType - Agent type (Explore, Plan, General)
 * @param {string} parentModel - Parent session's model (used when mode is 'inherit')
 * @param {AgentModelConfig} [config] - Optional config (loads from disk if not provided)
 * @returns {{model: string, wasRouted: boolean}} Model to use and whether it was routed
 */
function getModelForAgent(agentType, parentModel, config = null) {
  const cfg = config || loadConfig();

  // Normalize agent type
  const normalizedType = normalizeAgentType(agentType);
  if (!normalizedType || !cfg[normalizedType]) {
    return { model: parentModel, wasRouted: false };
  }

  const setting = cfg[normalizedType];

  if (setting.mode === 'select' && setting.model) {
    return { model: setting.model, wasRouted: true };
  }

  return { model: parentModel, wasRouted: false };
}

/**
 * Normalize agent type to standard capitalization
 *
 * @param {string} agentType - Agent type to normalize
 * @returns {string|null} Normalized agent type
 */
function normalizeAgentType(agentType) {
  if (!agentType || typeof agentType !== 'string') {
    return null;
  }
  const normalized = agentType.toLowerCase();
  if (normalized === 'explore') { return 'Explore'; }
  if (normalized === 'plan') { return 'Plan'; }
  if (normalized === 'general') { return 'General'; }
  return null;
}

/**
 * Update configuration for a single agent type
 *
 * @param {string} agentType - Agent type to update
 * @param {AgentModelMode} mode - 'inherit' or 'select'
 * @param {string|null} model - Model ID when mode is 'select'
 * @returns {boolean} True if saved successfully
 */
function setAgentModel(agentType, mode, model = null) {
  const normalizedType = normalizeAgentType(agentType);
  if (!normalizedType) {
    logger.error('Invalid agent type', { agentType });
    return false;
  }

  const config = loadConfig();
  config[normalizedType] = validateAgentSetting({ mode, model });
  return saveConfig(config);
}

module.exports = {
  loadConfig,
  saveConfig,
  getDefaultConfig,
  getModelForAgent,
  setAgentModel,
  validateAgentSetting,
  CONFIG_PATH,
  CONFIG_DIR,
  DEFAULT_EXPLORE_MODEL
};
