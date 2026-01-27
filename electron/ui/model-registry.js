/**
 * Model Registry Module
 *
 * Fetches and organizes models from OpenRouter API for dynamic model selection.
 * Provides favorites, provider grouping, and rich model metadata.
 *
 * This module works in browser context and fetches data client-side.
 */

/**
 * Featured providers - these get priority in the UI
 */
const FEATURED_PROVIDERS = ['openai', 'google', 'anthropic', 'x-ai', 'deepseek', 'meta'];

/**
 * Provider display names and icons
 */
const PROVIDER_INFO = {
  'openai': { name: 'OpenAI', icon: 'O' },
  'google': { name: 'Google', icon: 'G' },
  'anthropic': { name: 'Anthropic', icon: 'A' },
  'x-ai': { name: 'xAI', icon: 'X' },
  'deepseek': { name: 'DeepSeek', icon: 'D' },
  'meta': { name: 'Meta', icon: 'M' },
  'mistralai': { name: 'Mistral', icon: 'M' },
  'qwen': { name: 'Qwen', icon: 'Q' },
  'cohere': { name: 'Cohere', icon: 'C' },
  'perplexity': { name: 'Perplexity', icon: 'P' }
};

/**
 * Local storage key for favorites
 */
const FAVORITES_STORAGE_KEY = 'sidecar_model_favorites';

/**
 * Local storage key for model cache
 */
const CACHE_STORAGE_KEY = 'sidecar_model_cache';

/**
 * Cache TTL in milliseconds (4 hours)
 */
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Default favorite model patterns - latest models from major providers
 * These are patterns that match model IDs, prioritizing recent releases
 * NOTE: Anthropic models excluded since sidecar is used to fork from Claude
 */
const DEFAULT_FAVORITE_PATTERNS = [
  // Google - latest (great for large context)
  'google/gemini-3',
  'google/gemini-2.5',
  // OpenAI - latest (strong reasoning)
  'openai/gpt-5',
  'openai/o3',
  // xAI - latest
  'x-ai/grok-4',
  // DeepSeek - cost-effective
  'deepseek/deepseek-r2',
];

/**
 * Model Registry class - manages model data and favorites
 */
class ModelRegistry {
  constructor() {
    this._models = [];
    this._favorites = new Set();
    this._listeners = [];
    this._loading = false;
    this._error = null;
    this._lastFetch = null;

    // Load favorites from storage
    this._loadFavorites();
  }

  /**
   * Load favorites from local storage
   */
  _loadFavorites() {
    try {
      const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this._favorites = new Set(Array.isArray(parsed) ? parsed : []);
      }
    } catch (e) {
      console.warn('Failed to load favorites:', e);
    }
  }

  /**
   * Save favorites to local storage
   */
  _saveFavorites() {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...this._favorites]));
    } catch (e) {
      console.warn('Failed to save favorites:', e);
    }
  }

  /**
   * Load cached models from local storage
   * @returns {object|null} Cached data or null
   */
  _loadCache() {
    try {
      const stored = localStorage.getItem(CACHE_STORAGE_KEY);
      if (stored) {
        const cache = JSON.parse(stored);
        const age = Date.now() - (cache.timestamp || 0);
        if (age < CACHE_TTL_MS) {
          return cache;
        }
      }
    } catch (e) {
      console.warn('Failed to load model cache:', e);
    }
    return null;
  }

  /**
   * Save models to local storage cache
   */
  _saveCache() {
    try {
      const cache = {
        timestamp: Date.now(),
        models: this._models
      };
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('Failed to save model cache:', e);
    }
  }

  /**
   * Check if a model matches any of the default favorite patterns
   * @param {string} modelId - Model ID to check
   * @returns {boolean} True if matches a default favorite pattern
   */
  _matchesDefaultFavorite(modelId) {
    const idLower = modelId.toLowerCase();
    return DEFAULT_FAVORITE_PATTERNS.some(pattern =>
      idLower.includes(pattern.toLowerCase())
    );
  }

  /**
   * Fetch models from OpenRouter API
   * @param {boolean} forceRefresh - Force refresh even if cached
   * @returns {Promise<void>}
   */
  async fetchModels(forceRefresh = false) {
    // Try cache first
    if (!forceRefresh) {
      const cached = this._loadCache();
      if (cached && cached.models) {
        this._models = cached.models;
        this._lastFetch = new Date(cached.timestamp);
        this._notifyListeners('loaded');
        return;
      }
    }

    if (this._loading) return;

    this._loading = true;
    this._error = null;
    this._notifyListeners('loading');

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response');
      }

      // Process and enrich model data
      this._models = data.data.map(model => this._processModel(model)).filter(Boolean);

      // Sort by relevance
      this._models.sort((a, b) => {
        // Favorites first
        const aFav = this.isFavorite(a.id) ? 1 : 0;
        const bFav = this.isFavorite(b.id) ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;

        // Then by provider priority
        const aProvPriority = FEATURED_PROVIDERS.indexOf(a.provider) !== -1 ?
          FEATURED_PROVIDERS.indexOf(a.provider) : 999;
        const bProvPriority = FEATURED_PROVIDERS.indexOf(b.provider) !== -1 ?
          FEATURED_PROVIDERS.indexOf(b.provider) : 999;
        if (aProvPriority !== bProvPriority) return aProvPriority - bProvPriority;

        // Then by name
        return a.name.localeCompare(b.name);
      });

      this._lastFetch = new Date();
      this._saveCache();
      this._notifyListeners('loaded');
    } catch (e) {
      this._error = e.message;
      this._notifyListeners('error');
      console.error('Failed to fetch models:', e);
    } finally {
      this._loading = false;
    }
  }

  /**
   * Process raw model data from API
   * @param {object} rawModel - Raw model from API
   * @returns {object|null} Processed model or null if invalid
   */
  _processModel(rawModel) {
    const id = rawModel.id;
    if (!id) return null;

    // Extract provider from ID (e.g., "openai/gpt-4o" -> "openai")
    const parts = id.split('/');
    const provider = parts[0] || 'unknown';
    const modelSlug = parts.slice(1).join('/') || id;

    // Get pricing info
    const pricing = rawModel.pricing || {};
    const promptPrice = parseFloat(pricing.prompt) || 0;
    const completionPrice = parseFloat(pricing.completion) || 0;

    // Calculate cost per 1M tokens (more readable)
    const promptCostPerMillion = promptPrice * 1000000;
    const completionCostPerMillion = completionPrice * 1000000;

    // Format cost string
    let costString = 'Free';
    if (promptCostPerMillion > 0 || completionCostPerMillion > 0) {
      costString = `$${promptCostPerMillion.toFixed(2)}/$${completionCostPerMillion.toFixed(2)} per 1M tokens`;
    }

    // Get supported parameters
    const supportedParams = rawModel.supported_parameters || [];
    const supportsReasoning = supportedParams.includes('reasoning') ||
                              supportedParams.includes('reasoning_effort');
    const supportsReasoningEffort = supportedParams.includes('reasoning_effort');

    // Determine supported thinking levels
    let supportedThinkingLevels = ['none', 'low', 'medium', 'high', 'xhigh'];
    if (supportsReasoningEffort) {
      supportedThinkingLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    }

    // Format context size
    const contextLength = rawModel.context_length || 0;
    let contextString = `${Math.round(contextLength / 1000)}K`;
    if (contextLength >= 1000000) {
      contextString = `${(contextLength / 1000000).toFixed(1)}M`;
    }

    // Get description or generate one
    let description = rawModel.description || '';
    if (!description) {
      description = `${contextString} context`;
      if (supportsReasoning) {
        description += ', supports reasoning';
      }
    }

    // Truncate long descriptions
    if (description.length > 150) {
      description = description.substring(0, 147) + '...';
    }

    // Check if this is a recent model (for highlighting)
    const createdAt = rawModel.created ? new Date(rawModel.created * 1000) : null;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const isRecent = createdAt && createdAt > sixMonthsAgo;

    return {
      id: id,
      apiId: `openrouter/${id}`, // Full ID for API calls
      name: rawModel.name || modelSlug,
      provider: provider,
      providerName: PROVIDER_INFO[provider]?.name || provider,
      providerIcon: PROVIDER_INFO[provider]?.icon || provider.charAt(0).toUpperCase(),
      modelSlug: modelSlug,
      contextLength: contextLength,
      contextString: contextString,
      description: description,
      costString: costString,
      promptCostPerMillion: promptCostPerMillion,
      completionCostPerMillion: completionCostPerMillion,
      supportsReasoning: supportsReasoning,
      supportsReasoningEffort: supportsReasoningEffort,
      supportedThinkingLevels: supportedThinkingLevels,
      supportedParams: supportedParams,
      isRecent: isRecent,
      createdAt: createdAt,
      isFree: promptCostPerMillion === 0 && completionCostPerMillion === 0
    };
  }

  /**
   * Get all models
   * @returns {object[]} Array of models
   */
  getModels() {
    return this._models;
  }

  /**
   * Get favorite models
   * @returns {object[]} Array of favorite models
   */
  getFavorites() {
    return this._models.filter(m => this.isFavorite(m.id));
  }

  /**
   * Get default favorites (for initial state)
   * @returns {object[]} Array of models matching default patterns
   */
  getDefaultFavorites() {
    return this._models.filter(m => this._matchesDefaultFavorite(m.id));
  }

  /**
   * Get starred models (user favorites + defaults if no user favorites)
   * @returns {object[]} Array of starred models
   */
  getStarredModels() {
    const userFavorites = this.getFavorites();
    if (userFavorites.length > 0) {
      return userFavorites;
    }
    // Return default favorites if user hasn't set any
    return this.getDefaultFavorites().slice(0, 8); // Limit to 8
  }

  /**
   * Get models grouped by provider
   * @param {boolean} excludeFavorites - Exclude favorites from groups
   * @returns {object} Object with provider keys and model arrays
   */
  getModelsByProvider(excludeFavorites = false) {
    const models = excludeFavorites ?
      this._models.filter(m => !this.isFavorite(m.id)) :
      this._models;

    const groups = {};
    for (const model of models) {
      const provider = model.provider;
      if (!groups[provider]) {
        groups[provider] = {
          provider: provider,
          providerName: model.providerName,
          providerIcon: model.providerIcon,
          models: []
        };
      }
      groups[provider].models.push(model);
    }

    // Sort providers by priority
    const sortedGroups = {};
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const aPriority = FEATURED_PROVIDERS.indexOf(a);
      const bPriority = FEATURED_PROVIDERS.indexOf(b);
      if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
      if (aPriority !== -1) return -1;
      if (bPriority !== -1) return 1;
      return a.localeCompare(b);
    });

    for (const key of sortedKeys) {
      sortedGroups[key] = groups[key];
    }

    return sortedGroups;
  }

  /**
   * Check if a model is a favorite
   * @param {string} modelId - Model ID
   * @returns {boolean} True if favorite
   */
  isFavorite(modelId) {
    return this._favorites.has(modelId) || this._matchesDefaultFavorite(modelId);
  }

  /**
   * Check if a model is a user-set favorite (not default)
   * @param {string} modelId - Model ID
   * @returns {boolean} True if user favorite
   */
  isUserFavorite(modelId) {
    return this._favorites.has(modelId);
  }

  /**
   * Toggle favorite status for a model
   * @param {string} modelId - Model ID
   * @returns {boolean} New favorite status
   */
  toggleFavorite(modelId) {
    if (this._favorites.has(modelId)) {
      this._favorites.delete(modelId);
    } else {
      this._favorites.add(modelId);
    }
    this._saveFavorites();
    this._notifyListeners('favorites-changed');
    return this._favorites.has(modelId);
  }

  /**
   * Find a model by ID
   * @param {string} modelId - Model ID (can be full or short form)
   * @returns {object|undefined} Model object
   */
  findModel(modelId) {
    if (!modelId) return undefined;

    // Try exact match
    let model = this._models.find(m => m.id === modelId || m.apiId === modelId);
    if (model) return model;

    // Try without openrouter/ prefix
    const withoutPrefix = modelId.replace(/^openrouter\//, '');
    model = this._models.find(m => m.id === withoutPrefix);
    if (model) return model;

    // Try short name match
    const shortName = modelId.split('/').pop();
    return this._models.find(m => m.modelSlug === shortName || m.id.endsWith('/' + shortName));
  }

  /**
   * Search models by query
   * @param {string} query - Search query
   * @returns {object[]} Matching models
   */
  searchModels(query) {
    if (!query) return this._models;

    const queryLower = query.toLowerCase();
    return this._models.filter(m =>
      m.name.toLowerCase().includes(queryLower) ||
      m.id.toLowerCase().includes(queryLower) ||
      m.provider.toLowerCase().includes(queryLower) ||
      m.description.toLowerCase().includes(queryLower)
    );
  }

  /**
   * Get models that support reasoning
   * @returns {object[]} Models with reasoning support
   */
  getReasoningModels() {
    return this._models.filter(m => m.supportsReasoning);
  }

  /**
   * Register a listener for registry events
   * @param {Function} listener - Callback function
   */
  onChange(listener) {
    this._listeners.push(listener);
  }

  /**
   * Notify all listeners of an event
   * @param {string} event - Event name
   */
  _notifyListeners(event) {
    this._listeners.forEach(listener => {
      try {
        listener(event, this);
      } catch (e) {
        console.error('Listener error:', e);
      }
    });
  }

  /**
   * Check if registry is loading
   * @returns {boolean}
   */
  isLoading() {
    return this._loading;
  }

  /**
   * Get last error
   * @returns {string|null}
   */
  getError() {
    return this._error;
  }

  /**
   * Get last fetch timestamp
   * @returns {Date|null}
   */
  getLastFetch() {
    return this._lastFetch;
  }
}

// Create singleton instance
const modelRegistry = new ModelRegistry();

// Export for both Node.js (CommonJS) and browser (global) environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ModelRegistry,
    modelRegistry,
    FEATURED_PROVIDERS,
    PROVIDER_INFO,
    DEFAULT_FAVORITE_PATTERNS
  };
}

// Browser global
if (typeof window !== 'undefined') {
  window.ModelRegistry = {
    ModelRegistry,
    instance: modelRegistry,
    FEATURED_PROVIDERS,
    PROVIDER_INFO,
    DEFAULT_FAVORITE_PATTERNS
  };
}
