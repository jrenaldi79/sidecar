/**
 * Thinking Picker Module
 *
 * Provides thinking/reasoning intensity level selection for controlling model
 * reasoning effort. Lower levels = faster responses, higher levels = deeper thinking.
 *
 * Dynamically filters available levels based on selected model's capabilities.
 *
 * Spec Reference: OpenRouter API reasoning.effort parameter
 */

/**
 * All available thinking levels with descriptions
 * @type {Array<{id: string, name: string, description: string, tokenPercent: number}>}
 */
const THINKING_LEVELS = [
  {
    id: 'none',
    name: 'None',
    description: 'No reasoning, fastest possible responses',
    tokenPercent: 0
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Fastest responses, minimal reasoning (~10% tokens)',
    tokenPercent: 10
  },
  {
    id: 'low',
    name: 'Low',
    description: 'Quick responses with basic reasoning (~20% tokens)',
    tokenPercent: 20
  },
  {
    id: 'medium',
    name: 'Medium',
    description: 'Balanced speed and reasoning (default, ~50% tokens)',
    tokenPercent: 50
  },
  {
    id: 'high',
    name: 'High',
    description: 'Thorough reasoning, slower responses (~80% tokens)',
    tokenPercent: 80
  },
  {
    id: 'xhigh',
    name: 'Maximum',
    description: 'Deepest thinking, slowest responses (~95% tokens)',
    tokenPercent: 95
  }
];

/**
 * Default thinking level
 */
const DEFAULT_THINKING_LEVEL = 'medium';

/**
 * Find a thinking level by its ID
 * @param {string|null|undefined} levelId - Level ID to find
 * @returns {Object|undefined} Level object or undefined if not found
 */
function findLevelById(levelId) {
  if (!levelId) return undefined;
  return THINKING_LEVELS.find(l => l.id === levelId);
}

/**
 * Get thinking levels filtered for a specific model
 * @param {string} modelId - Model ID to check capabilities for
 * @returns {Array} Array of supported thinking levels for this model
 */
function getLevelsForModel(modelId) {
  // Default levels to show (excludes 'none' for cleaner UX)
  const defaultLevels = ['minimal', 'low', 'medium', 'high', 'xhigh'];

  // Try to get model-specific levels from ModelPicker
  if (typeof window !== 'undefined' && window.ModelPicker) {
    const supportedLevels = window.ModelPicker.getSupportedThinkingLevels(modelId);
    if (supportedLevels && supportedLevels.length > 0) {
      // Filter THINKING_LEVELS to only include supported ones
      // Exclude 'none' for better UX unless explicitly needed
      const filteredIds = supportedLevels.filter(id => id !== 'none');
      return THINKING_LEVELS.filter(l => filteredIds.includes(l.id));
    }
  }

  // Fallback to default levels
  return THINKING_LEVELS.filter(l => defaultLevels.includes(l.id));
}

/**
 * Check if a model supports reasoning at all
 * @param {string} modelId - Model ID to check
 * @returns {boolean} True if model supports reasoning
 */
function modelSupportsReasoning(modelId) {
  if (typeof window !== 'undefined' && window.ModelPicker) {
    return window.ModelPicker.supportsReasoning(modelId);
  }
  // Default to true
  return true;
}

/**
 * Get display name for a thinking level
 * @param {string} levelId - Level ID
 * @returns {string} Display name
 */
function getLevelDisplayName(levelId) {
  const level = findLevelById(levelId);
  return level ? level.name : levelId;
}

/**
 * Format thinking level for API request
 * @param {string|null|undefined} levelId - Thinking level ID
 * @returns {{effort: string}|undefined} Reasoning object for API or undefined if default
 */
function formatThinkingForAPI(levelId) {
  // Return undefined for default level (API will use its default)
  if (!levelId || levelId === DEFAULT_THINKING_LEVEL) {
    return undefined;
  }
  return { effort: levelId };
}

/**
 * Validate a thinking level ID
 * @param {string} levelId - Level ID to validate
 * @returns {boolean} True if valid
 */
function isValidThinkingLevel(levelId) {
  return THINKING_LEVELS.some(l => l.id === levelId);
}

/**
 * Validate a thinking level for a specific model
 * @param {string} levelId - Level ID to validate
 * @param {string} modelId - Model ID to check against
 * @returns {{valid: boolean, adjustedLevel?: string, warning?: string}}
 */
function validateLevelForModel(levelId, modelId) {
  if (!levelId) {
    return { valid: true };
  }

  const modelLevels = getLevelsForModel(modelId);
  const levelIds = modelLevels.map(l => l.id);

  if (levelIds.includes(levelId)) {
    return { valid: true };
  }

  // Find best fallback level
  let fallback = DEFAULT_THINKING_LEVEL;
  if (levelId === 'minimal' && levelIds.includes('low')) {
    fallback = 'low';
  } else if (!levelIds.includes(fallback)) {
    // Use the highest available level that's still reasonable
    fallback = levelIds.includes('medium') ? 'medium' :
               levelIds.includes('low') ? 'low' :
               levelIds[Math.floor(levelIds.length / 2)] || 'medium';
  }

  return {
    valid: false,
    adjustedLevel: fallback,
    warning: `This model doesn't support '${levelId}' thinking. Using '${fallback}' instead.`
  };
}

/**
 * Thinking Picker State Manager
 * Manages current thinking level selection with event notifications
 * and model-aware validation
 */
class ThinkingPickerState {
  constructor() {
    this._currentLevel = DEFAULT_THINKING_LEVEL;
    this._currentModel = null;
    this._listeners = [];
    this._enabled = true;
  }

  /**
   * Get the current thinking level
   * @returns {string}
   */
  getCurrentLevel() {
    return this._currentLevel;
  }

  /**
   * Check if thinking is enabled (model supports it)
   * @returns {boolean}
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * Set the current model and update enabled state
   * @param {string} modelId - New model ID
   */
  setModel(modelId) {
    this._currentModel = modelId;
    this._enabled = modelSupportsReasoning(modelId);

    // Validate current level against new model
    if (this._enabled) {
      const validation = validateLevelForModel(this._currentLevel, modelId);
      if (!validation.valid && validation.adjustedLevel) {
        this._currentLevel = validation.adjustedLevel;
        // Notify listeners of the adjustment
        this._listeners.forEach(listener => {
          listener({
            previousLevel: this._currentLevel,
            currentLevel: validation.adjustedLevel,
            adjusted: true,
            warning: validation.warning
          });
        });
      }
    }

    // Notify listeners of model change (for UI update)
    this._listeners.forEach(listener => {
      listener({
        modelChanged: true,
        modelId: modelId,
        enabled: this._enabled,
        currentLevel: this._currentLevel
      });
    });
  }

  /**
   * Set the current thinking level and notify listeners
   * @param {string} levelId - New thinking level ID
   */
  setCurrentLevel(levelId) {
    const previousLevel = this._currentLevel;

    // Validate level
    if (!isValidThinkingLevel(levelId)) {
      console.warn(`Invalid thinking level: ${levelId}, keeping ${previousLevel}`);
      return;
    }

    // Don't emit event if level hasn't changed
    if (previousLevel === levelId) {
      return;
    }

    // Validate against current model
    if (this._currentModel) {
      const validation = validateLevelForModel(levelId, this._currentModel);
      if (!validation.valid) {
        console.warn(validation.warning);
        levelId = validation.adjustedLevel || levelId;
      }
    }

    this._currentLevel = levelId;

    // Notify listeners
    this._listeners.forEach(listener => {
      listener({ previousLevel, currentLevel: levelId });
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
   * Reset to default level
   */
  reset() {
    this.setCurrentLevel(DEFAULT_THINKING_LEVEL);
  }

  /**
   * Get available levels for the current model
   * @returns {Array} Array of available thinking level objects
   */
  getAvailableLevels() {
    if (this._currentModel) {
      return getLevelsForModel(this._currentModel);
    }
    // Default: all levels except 'none'
    return THINKING_LEVELS.filter(l => l.id !== 'none');
  }
}

// Export for both Node.js (CommonJS) and browser (global) environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    THINKING_LEVELS,
    DEFAULT_THINKING_LEVEL,
    findLevelById,
    getLevelsForModel,
    modelSupportsReasoning,
    getLevelDisplayName,
    formatThinkingForAPI,
    isValidThinkingLevel,
    validateLevelForModel,
    ThinkingPickerState
  };
}

// Browser global (for use in renderer.js)
if (typeof window !== 'undefined') {
  window.ThinkingPicker = {
    THINKING_LEVELS,
    DEFAULT_THINKING_LEVEL,
    findLevelById,
    getLevelsForModel,
    modelSupportsReasoning,
    getLevelDisplayName,
    formatThinkingForAPI,
    isValidThinkingLevel,
    validateLevelForModel,
    ThinkingPickerState
  };
}
