/**
 * API Key Validation — test API keys against provider endpoints.
 * Extracted from api-key-store.js to keep modules under 300 lines.
 */
const https = require('https');

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

/** Validate an API key by making a test request to the provider's API */
function validateApiKey(provider, key) {
  if (!key || key.trim().length === 0) {
    return Promise.resolve({ valid: false, error: 'API key is required' });
  }

  const endpoint = VALIDATION_ENDPOINTS[provider];
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

  return new Promise((resolve) => {
    const req = https.get(url, { headers }, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        // Anthropic returns 401 for invalid key, 400/405 for valid key with no body
        if (provider === 'anthropic') {
          if (res.statusCode === 401) {
            resolve({ valid: false, error: 'Invalid API key (401)' });
          } else if (res.statusCode >= 500 || res.statusCode === 429) {
            resolve({ valid: false, error: `Server error (${res.statusCode})` });
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
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ valid: false, error: 'Request timed out' });
    });
    req.on('error', (err) => {
      resolve({ valid: false, error: err.message });
    });
  });
}

// Backwards compat alias — wraps the new function with the old single-arg signature
const validateOpenRouterKey = (key) => validateApiKey('openrouter', key);

module.exports = {
  validateApiKey,
  validateOpenRouterKey,
  VALIDATION_ENDPOINTS
};
