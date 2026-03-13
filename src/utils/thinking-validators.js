/**
 * Thinking Level Validators
 *
 * Model-specific thinking level validation.
 * Extracted from validators.js to keep modules under 300 lines.
 */

/**
 * Model-specific thinking level support (static fallback)
 * Maps model patterns to their supported thinking levels.
 *
 * NOTE: For dynamic, up-to-date capabilities, use model-capabilities.js
 * which fetches from OpenRouter API and caches the results.
 * This static map is used as a fast fallback for CLI validation.
 */
const MODEL_THINKING_SUPPORT = {
  // OpenAI GPT-5.x does NOT support 'minimal'
  'gpt-5': ['none', 'low', 'medium', 'high', 'xhigh'],
  // o3/o3-mini supports all levels
  'o3': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  // Gemini supports all levels
  'gemini': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  // Default: all levels supported
  'default': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
};

/**
 * Get supported thinking levels for a model (synchronous, static fallback)
 *
 * For dynamic lookup from OpenRouter API cache, use:
 *   const { getSupportedThinkingLevels } = require('./model-capabilities');
 *
 * @param {string} model - Model identifier
 * @returns {string[]} Array of supported thinking levels
 */
function getSupportedThinkingLevels(model) {
  if (!model) {return MODEL_THINKING_SUPPORT.default;}

  const modelLower = model.toLowerCase();

  // Check each known model pattern
  for (const [pattern, levels] of Object.entries(MODEL_THINKING_SUPPORT)) {
    if (pattern !== 'default' && modelLower.includes(pattern)) {
      return levels;
    }
  }

  return MODEL_THINKING_SUPPORT.default;
}

/**
 * Validate thinking level for a specific model (synchronous)
 *
 * For async validation with dynamic API cache, use:
 *   const { validateThinkingForModel } = require('./model-capabilities');
 *
 * @param {string} thinking - Thinking level ('minimal', 'low', 'medium', 'high', 'xhigh', 'none')
 * @param {string} model - Model identifier
 * @returns {{valid: boolean, error?: string, warning?: string, adjustedLevel?: string}}
 */
function validateThinkingLevel(thinking, model) {
  if (!thinking) {
    return { valid: true };
  }

  const allLevels = MODEL_THINKING_SUPPORT.default;
  if (!allLevels.includes(thinking)) {
    return {
      valid: false,
      error: `Error: --thinking must be one of: ${allLevels.join(', ')}`
    };
  }

  const supportedLevels = getSupportedThinkingLevels(model);
  if (!supportedLevels.includes(thinking)) {
    // Map to nearest supported level — prefer highest available for high/xhigh requests
    const levelOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    const requestedIndex = levelOrder.indexOf(thinking);
    let fallback = 'medium';
    if (thinking === 'minimal') {
      fallback = 'low';
    } else if (requestedIndex > levelOrder.indexOf('medium')) {
      for (let i = requestedIndex; i >= 0; i--) {
        if (supportedLevels.includes(levelOrder[i])) {
          fallback = levelOrder[i];
          break;
        }
      }
    }
    return {
      valid: true,
      warning: `Warning: Model '${model}' does not support thinking level '${thinking}'. Using '${fallback}' instead.`,
      adjustedLevel: fallback
    };
  }

  return { valid: true };
}

module.exports = {
  MODEL_THINKING_SUPPORT,
  getSupportedThinkingLevels,
  validateThinkingLevel
};
