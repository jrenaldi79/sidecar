/**
 * API Key Store — reading, saving, and validating API keys.
 * Keys stored in ~/.config/sidecar/.env with 0o600 permissions.
 */
const fs = require('fs');
const path = require('path');
const { validateApiKey, validateOpenRouterKey, VALIDATION_ENDPOINTS } = require('./api-key-validation');

/** Maps provider IDs to environment variable names */
const PROVIDER_ENV_MAP = {
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY'
};

/**
 * Get the full provider→envVar map (built-in + custom providers)
 * @returns {object} Merged map of providerId → envVar name
 */
function getFullProviderEnvMap() {
  const { getCustomProviders } = require('./config');
  const custom = getCustomProviders();
  const merged = { ...PROVIDER_ENV_MAP };
  for (const [id, cp] of Object.entries(custom)) {
    if (!merged[id] && cp.envVar) {
      merged[id] = cp.envVar;
    }
  }
  return merged;
}

/** Legacy key names that have been renamed (old -> new) */
const LEGACY_KEY_NAMES = {
  'GEMINI_API_KEY': 'GOOGLE_GENERATIVE_AI_API_KEY'
};

/** Get the path to the .env file */
function getEnvPath() {
  if (process.env.SIDECAR_ENV_DIR) {
    const resolved = path.resolve(process.env.SIDECAR_ENV_DIR);
    if (resolved.includes('\0')) {
      throw new Error('Invalid SIDECAR_ENV_DIR: null bytes not allowed');
    }
    return path.join(resolved, '.env');
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

/** Migrate a legacy key name in a .env file (best-effort, one-time) */
function migrateEnvFileKey(envPath, oldName, newName) {
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    const re = new RegExp(`^${oldName}=`, 'm');
    const updated = content.replace(re, `${newName}=`);
    if (updated !== content) {
      fs.writeFileSync(envPath, updated, { mode: 0o600 });
    }
  } catch (_err) {
    // Best effort
  }
}

/** Load .env file entries (auto-migrates legacy key names) */
function loadEnvEntries() {
  const envPath = getEnvPath();
  let fileEntries = new Map();
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      fileEntries = parseEnvContent(content);
      // Auto-migrate legacy key names
      for (const [oldName, newName] of Object.entries(LEGACY_KEY_NAMES)) {
        if (fileEntries.has(oldName) && !fileEntries.has(newName)) {
          fileEntries.set(newName, fileEntries.get(oldName));
          fileEntries.delete(oldName);
          migrateEnvFileKey(envPath, oldName, newName);
        }
      }
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
 * @returns {object} Map of providerId → boolean (includes custom providers)
 */
function readApiKeys() {
  const fullMap = getFullProviderEnvMap();
  const result = {};
  for (const provider of Object.keys(fullMap)) { result[provider] = false; }
  const entries = loadEnvEntries();
  for (const [provider, envVar] of Object.entries(fullMap)) {
    if (resolveKeyValue(entries, envVar)) { result[provider] = true; }
  }
  return result;
}

/**
 * Read API key hints (masked prefixes) for UI display
 * @returns {object} Map of providerId → masked string or false
 */
function readApiKeyHints() {
  const fullMap = getFullProviderEnvMap();
  const result = {};
  for (const provider of Object.keys(fullMap)) { result[provider] = false; }
  const entries = loadEnvEntries();
  for (const [provider, envVar] of Object.entries(fullMap)) {
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
  for (const [provider, envVar] of Object.entries(getFullProviderEnvMap())) {
    const value = resolveKeyValue(entries, envVar);
    if (value) { result[provider] = value; }
  }
  return result;
}

/** Save an API key for a provider to the .env file */
function saveApiKey(provider, key) {
  const fullMap = getFullProviderEnvMap();
  const envVar = fullMap[provider];
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
  const fullMap = getFullProviderEnvMap();
  const envVar = fullMap[provider];
  if (!envVar) {
    return { success: false, error: `Unknown provider: ${provider}` };
  }

  const envPath = getEnvPath();
  try {
    if (!fs.existsSync(envPath)) {
      const { checkAuthJson } = require('./auth-json');
      delete process.env[envVar];
      return { success: true, alsoInAuthJson: checkAuthJson(provider) };
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

  // Check if key also exists in auth.json (caller decides whether to clean)
  const { checkAuthJson } = require('./auth-json');
  return { success: true, alsoInAuthJson: checkAuthJson(provider) };
}

module.exports = {
  getEnvPath,
  readApiKeys,
  readApiKeyHints,
  readApiKeyValues,
  saveApiKey,
  removeApiKey,
  validateApiKey,
  validateOpenRouterKey,
  getFullProviderEnvMap,
  PROVIDER_ENV_MAP,
  LEGACY_KEY_NAMES,
  VALIDATION_ENDPOINTS
};
