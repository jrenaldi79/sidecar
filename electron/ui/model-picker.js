/**
 * Model Picker Module
 *
 * Provides dynamic model list from OpenRouter API with favorites and provider grouping.
 * This module works in both Node.js (for testing) and browser contexts.
 */

/**
 * Static fallback models (used when API is unavailable)
 * @type {Array<{id: string, name: string, provider: string, contextSize: string, category: string, description: string}>}
 */
const FALLBACK_MODELS = [
  {
    id: 'openrouter/google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    provider: 'Google',
    contextSize: '1M',
    category: 'google',
    description: 'Fast and efficient for quick tasks',
    supportsReasoning: true,
    supportedThinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  },
  {
    id: 'openrouter/google/gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    provider: 'Google',
    contextSize: '2M',
    category: 'google',
    description: 'Most capable for complex work',
    supportsReasoning: true,
    supportedThinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  },
  {
    id: 'openrouter/openai/gpt-5.2',
    name: 'GPT-5.2',
    provider: 'OpenAI',
    contextSize: '400K',
    category: 'openai',
    description: 'Advanced reasoning and coding',
    supportsReasoning: true,
    supportedThinkingLevels: ['none', 'low', 'medium', 'high', 'xhigh'] // No minimal
  },
  {
    id: 'openrouter/openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    contextSize: '128K',
    category: 'openai',
    description: 'Best for everyday tasks',
    supportsReasoning: true,
    supportedThinkingLevels: ['none', 'low', 'medium', 'high', 'xhigh']
  },
  {
    id: 'openrouter/openai/o3-mini',
    name: 'o3-mini',
    provider: 'OpenAI',
    contextSize: '128K',
    category: 'openai',
    description: 'Advanced reasoning capabilities',
    supportsReasoning: true,
    supportedThinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  },
  {
    id: 'openrouter/x-ai/grok-4',
    name: 'Grok 4',
    provider: 'xAI',
    contextSize: '128K',
    category: 'x-ai',
    description: 'Real-time knowledge access',
    supportsReasoning: true,
    supportedThinkingLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  },
  {
    id: 'openrouter/deepseek/deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'DeepSeek',
    contextSize: '64K',
    category: 'deepseek',
    description: 'Cost-effective for simple tasks',
    supportsReasoning: false,
    supportedThinkingLevels: []
  }
];

// Use fallback models as initial AVAILABLE_MODELS
// Will be replaced by dynamic data from ModelRegistry
let AVAILABLE_MODELS = [...FALLBACK_MODELS];

/**
 * Extract short model name from full model path
 * @param {string|null|undefined} modelString - Full model path (e.g., "openrouter/google/gemini-3-flash-preview")
 * @returns {string|null|undefined} Short model name (e.g., "gemini-3-flash-preview")
 */
function extractModelName(modelString) {
  if (!modelString) return modelString;
  const parts = modelString.split('/');
  return parts[parts.length - 1];
}

/**
 * Find a model by its ID
 * @param {string|null|undefined} modelId - Model ID to find
 * @returns {Object|undefined} Model object or undefined if not found
 */
function findModelById(modelId) {
  if (!modelId) return undefined;

  // Try ModelRegistry first if available
  if (typeof window !== 'undefined' && window.ModelRegistry && window.ModelRegistry.instance) {
    const model = window.ModelRegistry.instance.findModel(modelId);
    if (model) {
      // Convert to expected format
      return {
        id: model.apiId || model.id,
        name: model.name,
        provider: model.providerName || model.provider,
        contextSize: model.contextString,
        category: model.provider,
        description: model.description,
        supportsReasoning: model.supportsReasoning,
        supportedThinkingLevels: model.supportedThinkingLevels,
        costString: model.costString,
        isRecent: model.isRecent
      };
    }
  }

  // Fallback to static list
  return AVAILABLE_MODELS.find(m => m.id === modelId);
}

/**
 * Get supported thinking levels for a model
 * @param {string} modelId - Model ID
 * @returns {string[]} Array of supported thinking level IDs
 */
function getSupportedThinkingLevels(modelId) {
  const model = findModelById(modelId);
  if (model && model.supportedThinkingLevels) {
    return model.supportedThinkingLevels;
  }
  // Default: all levels
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
}

/**
 * Check if a model supports reasoning/thinking
 * @param {string} modelId - Model ID
 * @returns {boolean} True if model supports reasoning
 */
function supportsReasoning(modelId) {
  const model = findModelById(modelId);
  return model ? model.supportsReasoning !== false : true;
}

/**
 * Group models by their category/provider
 * @param {Array} models - Array of model objects
 * @returns {Object} Object with categories as keys and model arrays as values
 */
function groupModelsByCategory(models) {
  if (!models || models.length === 0) return {};

  return models.reduce((acc, model) => {
    const category = model.category || model.provider || 'other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(model);
    return acc;
  }, {});
}

/**
 * Get human-readable display name for a category/provider
 * @param {string} category - Category key
 * @returns {string} Human-readable category name
 */
function getCategoryDisplayName(category) {
  const displayNames = {
    google: 'Google',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    'x-ai': 'xAI',
    deepseek: 'DeepSeek',
    meta: 'Meta',
    mistralai: 'Mistral',
    qwen: 'Qwen',
    cohere: 'Cohere',
    perplexity: 'Perplexity'
  };
  return displayNames[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Format model string for OpenCode API
 * Converts from string format (e.g., 'openrouter/google/gemini-3-flash-preview')
 * to API object format ({ providerID: 'openrouter', modelID: 'google/gemini-3-flash-preview' })
 *
 * @param {string|object} modelString - Model identifier or already-parsed object
 * @returns {{providerID: string, modelID: string}} API model specification
 */
function formatModelForAPI(modelString) {
  // If already an object with providerID, return as-is
  if (typeof modelString === 'object' && modelString !== null && modelString.providerID) {
    return modelString;
  }

  // Handle empty/null
  if (!modelString) {
    return { providerID: 'openrouter', modelID: '' };
  }

  const parts = modelString.split('/');

  // Single part (just model name) - default to openrouter
  if (parts.length === 1) {
    return { providerID: 'openrouter', modelID: modelString };
  }

  // Two or more parts - first is provider, rest is modelID
  return {
    providerID: parts[0],
    modelID: parts.slice(1).join('/')
  };
}

/**
 * Get starred/favorite models
 * @returns {Array} Array of favorite model objects
 */
function getStarredModels() {
  if (typeof window !== 'undefined' && window.ModelRegistry && window.ModelRegistry.instance) {
    const starred = window.ModelRegistry.instance.getStarredModels();
    return starred.map(m => ({
      id: m.apiId || `openrouter/${m.id}`,
      name: m.name,
      provider: m.providerName || m.provider,
      contextSize: m.contextString,
      category: m.provider,
      description: m.description,
      supportsReasoning: m.supportsReasoning,
      supportedThinkingLevels: m.supportedThinkingLevels,
      costString: m.costString,
      isRecent: m.isRecent
    }));
  }
  // Fallback to static list
  return AVAILABLE_MODELS;
}

/**
 * Get all models grouped by provider
 * @param {boolean} excludeStarred - Exclude starred models from groups
 * @returns {Object} Grouped models
 */
function getGroupedModels(excludeStarred = false) {
  if (typeof window !== 'undefined' && window.ModelRegistry && window.ModelRegistry.instance) {
    const groups = window.ModelRegistry.instance.getModelsByProvider(excludeStarred);
    // Convert to expected format
    const result = {};
    for (const [key, group] of Object.entries(groups)) {
      result[key] = {
        name: group.providerName,
        models: group.models.map(m => ({
          id: m.apiId || `openrouter/${m.id}`,
          name: m.name,
          provider: m.providerName || m.provider,
          contextSize: m.contextString,
          category: m.provider,
          description: m.description,
          supportsReasoning: m.supportsReasoning,
          supportedThinkingLevels: m.supportedThinkingLevels,
          costString: m.costString,
          isRecent: m.isRecent
        }))
      };
    }
    return result;
  }
  // Fallback to static grouping
  return groupModelsByCategory(AVAILABLE_MODELS);
}

/**
 * Check if a model is starred/favorite
 * @param {string} modelId - Model ID
 * @returns {boolean} True if starred
 */
function isStarred(modelId) {
  if (typeof window !== 'undefined' && window.ModelRegistry && window.ModelRegistry.instance) {
    // Extract the model ID without openrouter/ prefix
    const cleanId = modelId.replace(/^openrouter\//, '');
    return window.ModelRegistry.instance.isFavorite(cleanId);
  }
  return false;
}

/**
 * Toggle star/favorite status for a model
 * @param {string} modelId - Model ID
 * @returns {boolean} New starred status
 */
function toggleStar(modelId) {
  if (typeof window !== 'undefined' && window.ModelRegistry && window.ModelRegistry.instance) {
    const cleanId = modelId.replace(/^openrouter\//, '');
    return window.ModelRegistry.instance.toggleFavorite(cleanId);
  }
  return false;
}

/**
 * Search models by query
 * @param {string} query - Search query
 * @returns {Array} Matching models
 */
function searchModels(query) {
  if (typeof window !== 'undefined' && window.ModelRegistry && window.ModelRegistry.instance) {
    const results = window.ModelRegistry.instance.searchModels(query);
    return results.map(m => ({
      id: m.apiId || `openrouter/${m.id}`,
      name: m.name,
      provider: m.providerName || m.provider,
      contextSize: m.contextString,
      category: m.provider,
      description: m.description,
      supportsReasoning: m.supportsReasoning,
      supportedThinkingLevels: m.supportedThinkingLevels,
      costString: m.costString,
      isRecent: m.isRecent
    }));
  }
  // Fallback: simple search
  const queryLower = query.toLowerCase();
  return AVAILABLE_MODELS.filter(m =>
    m.name.toLowerCase().includes(queryLower) ||
    m.id.toLowerCase().includes(queryLower)
  );
}

/**
 * Model Picker State Manager
 * Manages current model selection and history with event notifications
 */
class ModelPickerState {
  constructor() {
    this._currentModel = null;
    this._history = [];
    this._listeners = [];
  }

  /**
   * Get the current model ID
   * @returns {string|null}
   */
  getCurrentModel() {
    return this._currentModel;
  }

  /**
   * Set the current model and notify listeners
   * @param {string} modelId - New model ID
   */
  setCurrentModel(modelId) {
    const previousModel = this._currentModel;

    // Don't emit event if model hasn't changed
    if (previousModel === modelId) {
      return;
    }

    this._currentModel = modelId;
    this._history.push(modelId);

    // Notify listeners
    this._listeners.forEach(listener => {
      listener({ previousModel, currentModel: modelId });
    });
  }

  /**
   * Register a change listener
   * @param {Function} listener - Callback function
   */
  onChange(listener) {
    this._listeners.push(listener);
  }

  /**
   * Get model history
   * @returns {Array<string>}
   */
  getHistory() {
    return [...this._history];
  }
}

// Export for both Node.js (CommonJS) and browser (global) environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AVAILABLE_MODELS,
    FALLBACK_MODELS,
    extractModelName,
    findModelById,
    getSupportedThinkingLevels,
    supportsReasoning,
    groupModelsByCategory,
    getCategoryDisplayName,
    formatModelForAPI,
    getStarredModels,
    getGroupedModels,
    isStarred,
    toggleStar,
    searchModels,
    ModelPickerState
  };
}

// Browser global (for use in renderer.js)
if (typeof window !== 'undefined') {
  window.ModelPicker = {
    AVAILABLE_MODELS,
    FALLBACK_MODELS,
    extractModelName,
    findModelById,
    getSupportedThinkingLevels,
    supportsReasoning,
    groupModelsByCategory,
    getCategoryDisplayName,
    formatModelForAPI,
    getStarredModels,
    getGroupedModels,
    isStarred,
    toggleStar,
    searchModels,
    ModelPickerState
  };
}
