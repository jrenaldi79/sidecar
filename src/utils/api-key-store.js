/**
 * API Key Store — reading, saving, and validating API keys.
 * Keys stored in ~/.config/sidecar/.env with 0o600 permissions.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

/** Maps provider IDs to environment variable names */
const PROVIDER_ENV_MAP = {
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY'
};

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
  }
};

/** Get the path to the .env file */
function getEnvPath() {
  if (process.env.SIDECAR_ENV_DIR) {
    return path.join(process.env.SIDECAR_ENV_DIR, '.env');
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  return path.join(homeDir, '.config', 'sidecar', '.env');
}

/** Parse a .env file into a key-value map (comments/blanks excluded) */
function parseEnvContent(content) {
  const entries = new Map();
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    entries.set(key, value);
  }
  return entries;
}

/** Load .env file entries */
function loadEnvEntries() {
  const envPath = getEnvPath();
  let fileEntries = new Map();
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      fileEntries = parseEnvContent(content);
    }
  } catch (_err) {
    // Ignore read errors
  }
  return fileEntries;
}

/** Resolve key value: file entry takes precedence over process.env */
function resolveKeyValue(fileEntries, envVar) {
  const fromFile = fileEntries.get(envVar);
  if (fromFile && fromFile.length > 0) { return fromFile; }
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.length > 0) { return fromEnv; }
  return '';
}

/**
 * Read API key availability from .env file and process.env
 * @returns {{openrouter: boolean, google: boolean, openai: boolean, anthropic: boolean}}
 */
function readApiKeys() {
  const result = { openrouter: false, google: false, openai: false, anthropic: false };
  const entries = loadEnvEntries();
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
    if (resolveKeyValue(entries, envVar)) { result[provider] = true; }
  }
  return result;
}

/**
 * Read API key hints (masked prefixes) for UI display
 * @returns {{openrouter: string|false, google: string|false, openai: string|false, anthropic: string|false}}
 */
function readApiKeyHints() {
  const result = { openrouter: false, google: false, openai: false, anthropic: false };
  const entries = loadEnvEntries();
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
    const key = resolveKeyValue(entries, envVar);
    if (key) {
      const visible = key.slice(0, 8);
      result[provider] = visible + '\u2022'.repeat(Math.max(0, Math.min(key.length - 8, 12)));
    }
  }
  return result;
}

/**
 * Read actual API key strings for configured providers.
 * Used by model-fetcher to authenticate against provider APIs.
 * @returns {Object<string, string>} Map of provider → key string (only set providers)
 */
function readApiKeyValues() {
  const result = {};
  const entries = loadEnvEntries();
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
    const value = resolveKeyValue(entries, envVar);
    if (value) { result[provider] = value; }
  }
  return result;
}

/** Save an API key for a provider to the .env file */
function saveApiKey(provider, key) {
  const envVar = PROVIDER_ENV_MAP[provider];
  if (!envVar) {
    return { success: false, error: `Unknown provider: ${provider}` };
  }

  const envPath = getEnvPath();
  const envDir = path.dirname(envPath);
  fs.mkdirSync(envDir, { recursive: true });

  // Read existing .env content, preserving comments and other lines
  let lines = [];
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      lines = content.split('\n');
    }
  } catch (_err) {
    // Start fresh
  }

  // Find and replace the line for this env var, or append
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith(envVar + '=')) {
      lines[i] = `${envVar}=${key}`;
      found = true;
      break;
    }
  }
  if (!found) {
    // Remove trailing empty lines before appending
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    lines.push(`${envVar}=${key}`);
  }

  // Write with trailing newline
  const output = lines.join('\n') + '\n';
  fs.writeFileSync(envPath, output, { mode: 0o600 });

  // Also set process.env so the key is immediately available
  process.env[envVar] = key;

  return { success: true };
}

/** Remove an API key for a provider from the .env file */
function removeApiKey(provider) {
  const envVar = PROVIDER_ENV_MAP[provider];
  if (!envVar) {
    return { success: false, error: `Unknown provider: ${provider}` };
  }

  const envPath = getEnvPath();
  try {
    if (!fs.existsSync(envPath)) {
      return { success: true };
    }
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n').filter(line => {
      return !line.trim().startsWith(envVar + '=');
    });

    // Remove trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }

    const output = lines.length > 0 ? lines.join('\n') + '\n' : '';
    fs.writeFileSync(envPath, output, { mode: 0o600 });
  } catch (_err) {
    // Ignore
  }

  delete process.env[envVar];
  return { success: true };
}

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
  getEnvPath,
  readApiKeys,
  readApiKeyHints,
  readApiKeyValues,
  saveApiKey,
  removeApiKey,
  validateApiKey,
  validateOpenRouterKey,
  PROVIDER_ENV_MAP,
  VALIDATION_ENDPOINTS
};
