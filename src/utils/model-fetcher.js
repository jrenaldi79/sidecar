/**
 * Model Fetcher
 *
 * Fetches available model lists from provider APIs for the dropdown selector.
 * Uses the same HTTPS pattern as api-key-store.js validateApiKey().
 */

const https = require('https');

/** Hardcoded Anthropic models (no public listing endpoint) */
const ANTHROPIC_MODELS = [
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-3-5-haiku', name: 'Claude 3.5 Haiku' }
];

const PROVIDER_FAMILY_NAMES = {
  openrouter: 'OpenRouter',
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic'
};

/** Provider API configs for fetching model lists */
const PROVIDER_FETCH_CONFIG = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `openrouter/${m.id}`,
        name: m.name || m.id
      }));
    }
  },
  google: {
    url: null, // built dynamically with key
    authHeader: () => ({}),
    buildUrl: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.models || []).map(m => ({
        id: `google/${m.name.replace('models/', '')}`,
        name: m.displayName || m.name.replace('models/', '')
      }));
    }
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
    normalize: (body) => {
      const data = JSON.parse(body);
      return (data.data || []).map(m => ({
        id: `openai/${m.id}`,
        name: m.id
      }));
    }
  }
};

const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch models from a single provider API
 * @param {string} provider - Provider name (openrouter, google, openai, anthropic)
 * @param {string} key - API key
 * @returns {Promise<Array<{id: string, name: string}>>} Normalized model list
 */
function fetchModelsFromProvider(provider, key) {
  if (provider === 'anthropic') {
    return Promise.resolve(ANTHROPIC_MODELS);
  }

  const config = PROVIDER_FETCH_CONFIG[provider];
  if (!config) {
    return Promise.resolve([]);
  }

  const url = config.buildUrl ? config.buildUrl(key) : config.url;
  const headers = config.authHeader(key);

  return new Promise((resolve) => {
    let chunks = '';
    const timer = setTimeout(() => {
      req.destroy();
      resolve([]);
    }, FETCH_TIMEOUT_MS);

    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.on('data', () => {});
        res.on('end', () => resolve([]));
        return;
      }
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          resolve(config.normalize(chunks));
        } catch (_err) {
          resolve([]);
        }
      });
    });
    req.on('error', () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
}

/**
 * Fetch models from all providers that have keys configured
 * @param {Object<string, string>} keys - Map of provider → API key string
 * @returns {Promise<Array<{id: string, name: string}>>} Combined model list
 */
async function fetchAllModels(keys) {
  const providers = Object.keys(keys).filter(p => keys[p]);
  const fetches = providers.map(p => fetchModelsFromProvider(p, keys[p]));

  // Always include anthropic
  if (!providers.includes('anthropic')) {
    fetches.push(fetchModelsFromProvider('anthropic', ''));
  }

  const results = await Promise.all(fetches);
  return results.flat();
}

/**
 * Group models by provider family for <optgroup> rendering
 * @param {Array<{id: string, name: string}>} models
 * @returns {Array<{family: string, models: Array<{id: string, name: string}>}>}
 */
function groupModelsByFamily(models) {
  if (models.length === 0) { return []; }

  const groups = new Map();

  for (const model of models) {
    const prefix = model.id.split('/')[0];
    const family = PROVIDER_FAMILY_NAMES[prefix] || prefix;
    if (!groups.has(family)) {
      groups.set(family, []);
    }
    groups.get(family).push(model);
  }

  return Array.from(groups.entries()).map(([family, familyModels]) => ({
    family,
    models: familyModels
  }));
}

module.exports = {
  fetchModelsFromProvider,
  fetchAllModels,
  groupModelsByFamily,
  ANTHROPIC_MODELS,
  PROVIDER_FAMILY_NAMES
};
