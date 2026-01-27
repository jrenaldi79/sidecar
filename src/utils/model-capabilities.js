/**
 * Model Capabilities Module
 *
 * Fetches and caches model capabilities from OpenRouter API to determine
 * which parameters (especially reasoning/thinking levels) each model supports.
 *
 * This eliminates hardcoded model mappings and ensures we stay up-to-date
 * as new models are published.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

// Cache file location
const CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.cache', 'sidecar');
const CACHE_FILE = path.join(CACHE_DIR, 'model-capabilities.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Default thinking levels (fallback when model info unavailable)
 */
const DEFAULT_THINKING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/**
 * Effort level to approximate token percentage mapping
 * Used for understanding relative reasoning intensity
 */
const EFFORT_TOKEN_PERCENTAGES = {
  'xhigh': 0.95,
  'high': 0.80,
  'medium': 0.50,
  'low': 0.20,
  'minimal': 0.10,
  'none': 0
};

/**
 * Fetch model list from OpenRouter API
 * @returns {Promise<object[]>} Array of model objects
 */
async function fetchModelsFromAPI() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/models',
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.data && Array.isArray(json.data)) {
            resolve(json.data);
          } else {
            reject(new Error('Invalid API response: missing data array'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('API request timed out'));
    });
    req.end();
  });
}

/**
 * Extract reasoning capabilities from model's supported_parameters
 * @param {object} model - Model object from API
 * @returns {object} Reasoning capabilities
 */
function extractReasoningCapabilities(model) {
  const params = model.supported_parameters || [];

  const capabilities = {
    supportsReasoning: params.includes('reasoning') || params.includes('reasoning_effort'),
    supportsReasoningEffort: params.includes('reasoning_effort'),
    supportsIncludeReasoning: params.includes('include_reasoning'),
    // Default to all levels if model supports reasoning_effort
    supportedEffortLevels: DEFAULT_THINKING_LEVELS
  };

  // Models that support reasoning but not reasoning_effort may have limited levels
  // This is a heuristic - OpenRouter doesn't expose exact level support per model
  if (capabilities.supportsReasoning && !capabilities.supportsReasoningEffort) {
    // Conservative: assume only standard levels without 'minimal'
    capabilities.supportedEffortLevels = ['none', 'low', 'medium', 'high', 'xhigh'];
  }

  return capabilities;
}

/**
 * Build capabilities cache from API response
 * @param {object[]} models - Array of model objects
 * @returns {object} Capabilities cache object
 */
function buildCapabilitiesCache(models) {
  const cache = {
    fetchedAt: new Date().toISOString(),
    modelCount: models.length,
    models: {}
  };

  for (const model of models) {
    // Store by both full ID and short name for flexible lookup
    const id = model.id || model.canonical_slug;
    if (!id) {continue;}

    const capabilities = extractReasoningCapabilities(model);

    cache.models[id] = {
      name: model.name,
      contextLength: model.context_length,
      ...capabilities
    };

    // Also index by short name (last part of ID)
    const shortName = id.split('/').pop();
    if (shortName && shortName !== id) {
      cache.models[shortName] = cache.models[id];
    }
  }

  return cache;
}

/**
 * Load cache from disk
 * @returns {object|null} Cache object or null if not found/expired
 */
function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return null;
    }

    const content = fs.readFileSync(CACHE_FILE, 'utf-8');
    const cache = JSON.parse(content);

    // Check if cache is expired
    const fetchedAt = new Date(cache.fetchedAt);
    const age = Date.now() - fetchedAt.getTime();
    if (age > CACHE_TTL_MS) {
      return null; // Cache expired
    }

    return cache;
  } catch (e) {
    return null;
  }
}

/**
 * Save cache to disk
 * @param {object} cache - Cache object to save
 */
function saveCache(cache) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    // Silently fail - cache is optional optimization
    logger.warn('Failed to save model capabilities cache', { error: e.message });
  }
}

/**
 * Get model capabilities (from cache or API)
 * @param {boolean} forceRefresh - Force refresh from API
 * @returns {Promise<object>} Capabilities cache
 */
async function getModelCapabilities(forceRefresh = false) {
  // Try cache first
  if (!forceRefresh) {
    const cache = loadCache();
    if (cache) {
      return cache;
    }
  }

  // Fetch from API
  try {
    const models = await fetchModelsFromAPI();
    const cache = buildCapabilitiesCache(models);
    saveCache(cache);
    return cache;
  } catch (e) {
    // If API fails, try stale cache
    const staleCache = loadCache();
    if (staleCache) {
      logger.warn('Using stale model capabilities cache', { error: e.message });
      return staleCache;
    }

    // Return empty cache with defaults
    return {
      fetchedAt: null,
      modelCount: 0,
      models: {},
      error: e.message
    };
  }
}

/**
 * Get supported thinking levels for a specific model
 * @param {string} modelId - Model identifier (e.g., 'openrouter/google/gemini-3-pro-preview')
 * @param {object} [cache] - Optional pre-loaded cache
 * @returns {Promise<string[]>} Array of supported thinking levels
 */
async function getSupportedThinkingLevels(modelId, cache = null) {
  if (!modelId) {return DEFAULT_THINKING_LEVELS;}

  // Load cache if not provided
  const capabilities = cache || await getModelCapabilities();

  // Try various forms of the model ID
  const modelLower = modelId.toLowerCase();

  // Direct lookup
  if (capabilities.models[modelId]) {
    return capabilities.models[modelId].supportedEffortLevels || DEFAULT_THINKING_LEVELS;
  }

  // Try without provider prefix (e.g., 'openrouter/google/gemini-3-pro' -> 'google/gemini-3-pro')
  const withoutProvider = modelId.replace(/^openrouter\//, '');
  if (capabilities.models[withoutProvider]) {
    return capabilities.models[withoutProvider].supportedEffortLevels || DEFAULT_THINKING_LEVELS;
  }

  // Try short name (last segment)
  const shortName = modelId.split('/').pop();
  if (capabilities.models[shortName]) {
    return capabilities.models[shortName].supportedEffortLevels || DEFAULT_THINKING_LEVELS;
  }

  // Pattern-based fallback for known limitations
  // GPT-5.x doesn't support 'minimal' (confirmed via benchmark)
  if (modelLower.includes('gpt-5')) {
    return ['none', 'low', 'medium', 'high', 'xhigh'];
  }

  // Default: all levels
  return DEFAULT_THINKING_LEVELS;
}

/**
 * Check if a model supports reasoning at all
 * @param {string} modelId - Model identifier
 * @param {object} [cache] - Optional pre-loaded cache
 * @returns {Promise<boolean>} Whether model supports reasoning
 */
async function supportsReasoning(modelId, cache = null) {
  if (!modelId) {return true;} // Assume yes if unknown

  const capabilities = cache || await getModelCapabilities();

  // Try various forms
  const lookupKeys = [
    modelId,
    modelId.replace(/^openrouter\//, ''),
    modelId.split('/').pop()
  ];

  for (const key of lookupKeys) {
    if (capabilities.models[key]) {
      return capabilities.models[key].supportsReasoning;
    }
  }

  // Default: assume supported
  return true;
}

/**
 * Validate and potentially adjust thinking level for a model
 * @param {string} thinking - Requested thinking level
 * @param {string} modelId - Model identifier
 * @returns {Promise<{valid: boolean, level: string, warning?: string}>}
 */
async function validateThinkingForModel(thinking, modelId) {
  if (!thinking) {
    return { valid: true, level: thinking };
  }

  const allLevels = DEFAULT_THINKING_LEVELS;
  if (!allLevels.includes(thinking)) {
    return {
      valid: false,
      level: thinking,
      error: `Invalid thinking level '${thinking}'. Must be one of: ${allLevels.join(', ')}`
    };
  }

  const supportedLevels = await getSupportedThinkingLevels(modelId);

  if (!supportedLevels.includes(thinking)) {
    // Find nearest supported level
    const fallback = thinking === 'minimal' ? 'low' : 'medium';
    const adjustedLevel = supportedLevels.includes(fallback) ? fallback : supportedLevels[Math.floor(supportedLevels.length / 2)];

    return {
      valid: true,
      level: adjustedLevel,
      warning: `Model '${modelId}' does not support thinking level '${thinking}'. Using '${adjustedLevel}' instead.`
    };
  }

  return { valid: true, level: thinking };
}

/**
 * Refresh the capabilities cache (for use in scripts/CI)
 * @returns {Promise<object>} Fresh cache
 */
async function refreshCache() {
  return getModelCapabilities(true);
}

/**
 * Get cache info (for diagnostics)
 * @returns {object} Cache metadata
 */
function getCacheInfo() {
  const cache = loadCache();
  if (!cache) {
    return { exists: false };
  }

  return {
    exists: true,
    fetchedAt: cache.fetchedAt,
    modelCount: cache.modelCount,
    ageMs: Date.now() - new Date(cache.fetchedAt).getTime(),
    cachePath: CACHE_FILE
  };
}

module.exports = {
  DEFAULT_THINKING_LEVELS,
  EFFORT_TOKEN_PERCENTAGES,
  getModelCapabilities,
  getSupportedThinkingLevels,
  supportsReasoning,
  validateThinkingForModel,
  refreshCache,
  getCacheInfo,
  // Exported for testing
  fetchModelsFromAPI,
  buildCapabilitiesCache,
  CACHE_FILE,
  CACHE_TTL_MS
};
