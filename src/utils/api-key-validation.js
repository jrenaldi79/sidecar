/**
 * API Key Validation — test API keys against provider endpoints.
 * Extracted from api-key-store.js to keep modules under 300 lines.
 */
const https = require('https');
const http = require('http');

/** Validation endpoints per provider */
const VALIDATION_ENDPOINTS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` })
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` })
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    authHeader: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    })
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    authHeader: () => ({})
  },
  deepseek: {
    url: 'https://api.deepseek.com/models',
    authHeader: (key) => ({ 'Authorization': `Bearer ${key}` })
  }
};

/**
 * Build a dynamic validation endpoint for a custom provider
 * @param {object} customProvider - {name, baseUrl, authType, envVar}
 * @returns {object} Validation endpoint config
 */
function buildCustomEndpoint(customProvider) {
  const baseUrl = customProvider.baseUrl.replace(/\/+$/, '');
  return {
    url: `${baseUrl}/models`,
    authHeader: (k) => {
      if (customProvider.authType === 'x-api-key') {
        return { 'x-api-key': k };
      }
      if (customProvider.authType === 'none') {
        return {};
      }
      return { 'Authorization': `Bearer ${k}` };
    }
  };
}

/** Validate an API key by making a test request to the provider's API */
function validateApiKey(provider, key) {
  if (!key || key.trim().length === 0) {
    return Promise.resolve({ valid: false, error: 'API key is required' });
  }

  let endpoint = VALIDATION_ENDPOINTS[provider];
  let isCustom = false;

  // If not a built-in provider, check custom providers
  if (!endpoint) {
    const { getCustomProviders } = require('./config');
    const custom = getCustomProviders();
    if (custom[provider]) {
      endpoint = buildCustomEndpoint(custom[provider]);
      isCustom = true;
    }
  }

  if (!endpoint) {
    return Promise.resolve({ valid: false, error: `Unknown provider: ${provider}` });
  }

  const trimmedKey = key.trim();

  // Google uses query param auth, not header
  let url = endpoint.url;
  if (provider === 'google') {
    url = `${endpoint.url}?key=${trimmedKey}`;
  }

  const headers = endpoint.authHeader(trimmedKey);
  const transport = url.startsWith('http://') ? http : https;

  return new Promise((resolve) => {
    const req = transport.get(url, { headers }, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        // Anthropic returns 401 for invalid key, 400/405 for valid key with no body
        if (provider === 'anthropic') {
          if (res.statusCode === 401) {
            resolve({ valid: false, error: 'Invalid API key (401)' });
          } else {
            resolve({ valid: true });
          }
          return;
        }

        // Custom providers: be lenient — any non-auth-error means reachable
        if (isCustom) {
          if (res.statusCode === 401 || res.statusCode === 403) {
            resolve({ valid: false, error: `Invalid API key (${res.statusCode})` });
          } else {
            resolve({ valid: true });
          }
          return;
        }

        if (res.statusCode === 200) {
          resolve({ valid: true });
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({ valid: false, error: `Invalid API key (${res.statusCode})` });
        } else {
          resolve({ valid: false, error: `Unexpected response (${res.statusCode})` });
        }
      });
    });
    req.on('error', (err) => {
      resolve({ valid: false, error: err.message });
    });
  });
}

// Backwards compat alias
const validateOpenRouterKey = validateApiKey;

module.exports = {
  validateApiKey,
  validateOpenRouterKey,
  VALIDATION_ENDPOINTS
};
