/**
 * Sidecar Config Module
 *
 * Manages sidecar configuration: config directory resolution,
 * config file I/O, model alias resolution, config hashing,
 * and alias table formatting.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Default model alias map
 * Maps short alias names to full OpenRouter model identifiers.
 */
const DEFAULT_ALIASES = {
  'gemini': 'openrouter/google/gemini-3-flash-preview',
  'gemini-pro': 'openrouter/google/gemini-3-pro-preview',
  'gemini-3.1': 'openrouter/google/gemini-3.1-pro-preview',
  'gpt': 'openrouter/openai/gpt-5.2-chat',
  'gpt-pro': 'openrouter/openai/gpt-5.2-pro',
  'codex': 'openrouter/openai/gpt-5.3-codex',
  'claude': 'openrouter/anthropic/claude-sonnet-4.6',
  'sonnet': 'openrouter/anthropic/claude-sonnet-4.6',
  'opus': 'openrouter/anthropic/claude-opus-4.6',
  'haiku': 'openrouter/anthropic/claude-haiku-4.5',
  'deepseek': 'openrouter/deepseek/deepseek-v3.2',
  'qwen': 'openrouter/qwen/qwen3.5-397b-a17b',
  'qwen-coder': 'openrouter/qwen/qwen3-coder-next',
  'qwen-flash': 'openrouter/qwen/qwen3.5-flash-02-23',
  'mistral': 'openrouter/mistralai/mistral-large-2512',
  'devstral': 'openrouter/mistralai/devstral-2512',
  'glm': 'openrouter/z-ai/glm-5',
  'minimax': 'openrouter/minimax/minimax-m2.5',
  'grok': 'openrouter/x-ai/grok-4.1-fast',
  'kimi': 'openrouter/moonshotai/kimi-k2.5',
  'seed': 'openrouter/bytedance-seed/seed-2.0-mini',
};

/**
 * Get the sidecar configuration directory path
 * @returns {string} Config directory path
 */
function getConfigDir() {
  if (process.env.SIDECAR_CONFIG_DIR) {
    const resolved = path.resolve(process.env.SIDECAR_CONFIG_DIR);
    if (resolved.includes('\0')) {
      throw new Error('Invalid SIDECAR_CONFIG_DIR: null bytes not allowed');
    }
    return resolved;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  return path.join(homeDir, '.config', 'sidecar');
}

/**
 * Get the path to the config.json file
 * @returns {string} Full path to config.json
 */
function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Load and parse the config file
 * @returns {object|null} Parsed config data, or null if missing/invalid
 */
function loadConfig() {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    if (!content || content.trim().length === 0) {
      return null;
    }
    return JSON.parse(content);
  } catch (_err) {
    return null;
  }
}

/**
 * Save config data to disk, creating the directory if needed
 * @param {object} configData - Configuration object to persist
 */
function saveConfig(configData) {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), { mode: 0o600 });
}

/**
 * Get the default alias map
 * @returns {object} Map of alias name to full model identifier
 */
function getDefaultAliases() {
  return { ...DEFAULT_ALIASES };
}

/**
 * Resolve a model argument to a full model identifier
 *
 * Resolution order:
 * 1. If modelArg contains '/' -> return as-is (full model string)
 * 2. If modelArg is a key in config.aliases -> return resolved string
 * 3. If modelArg is unknown alias -> throw Error mentioning 'sidecar setup'
 * 4. If modelArg is undefined and config.default exists -> resolve that alias
 * 5. If no default -> throw Error
 *
 * @param {string|undefined} modelArg - Model argument from CLI or undefined
 * @returns {string} Resolved full model identifier
 * @throws {Error} When alias is unknown or no default configured
 */
function resolveModel(modelArg) {
  const config = loadConfig();

  // If modelArg is provided
  if (modelArg !== undefined && modelArg !== null) {
    // Full model string with slash - return as-is
    if (modelArg.includes('/')) {
      return modelArg;
    }

    // Try to resolve as alias
    const aliases = (config && config.aliases) || {};
    if (aliases[modelArg] !== undefined) {
      return aliases[modelArg];
    }

    // Unknown alias
    throw new Error(
      `Unknown model alias '${modelArg}'. Run 'sidecar setup' to configure aliases.`
    );
  }

  // modelArg is undefined - use default
  if (!config || !config.default) {
    throw new Error(
      'No model specified and no default configured. Run \'sidecar setup\' to set a default model.'
    );
  }

  const defaultValue = config.default;

  // Default is a full model string
  if (defaultValue.includes('/')) {
    return defaultValue;
  }

  // Default is an alias - resolve it
  const aliases = (config && config.aliases) || {};
  if (aliases[defaultValue] !== undefined) {
    return aliases[defaultValue];
  }

  // Default alias not found in aliases map
  throw new Error(
    `Default alias '${defaultValue}' not found in aliases. Run 'sidecar setup' to fix configuration.`
  );
}

/**
 * Compute SHA-256 hash of the config file content (first 8 hex chars)
 * @returns {string|null} 8-char hex hash, or null if no config file
 */
function computeConfigHash() {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
  } catch (_err) {
    return null;
  }
}

/**
 * Format aliases as a markdown table with (default) marker
 * @returns {string} Markdown-formatted alias table, or empty string if no aliases
 */
function buildAliasTable() {
  const config = loadConfig();
  if (!config || !config.aliases || Object.keys(config.aliases).length === 0) {
    return '';
  }

  const defaultAlias = config.default || null;
  const lines = [];

  lines.push('| Alias | Model |');
  lines.push('|-------|-------|');

  for (const [alias, model] of Object.entries(config.aliases)) {
    const marker = (alias === defaultAlias) ? ' (default)' : '';
    lines.push(`| ${alias}${marker} | ${model} |`);
  }

  return lines.join('\n');
}

/**
 * Check whether the config file has changed compared to a known hash
 * @param {string|null} currentHash - Previously known hash to compare
 * @returns {{changed: boolean, newHash: string|null, updateData?: string}}
 */
function checkConfigChanged(currentHash) {
  const newHash = computeConfigHash();

  if (currentHash === newHash) {
    return { changed: false, newHash };
  }

  // Config has changed (or was created/removed)
  const aliasTable = buildAliasTable();
  const hashComment = newHash ? `<!-- sidecar-config-hash: ${newHash} -->` : '';
  const updateData = [hashComment, aliasTable].filter(Boolean).join('\n');

  return {
    changed: true,
    newHash,
    updateData: updateData || undefined,
  };
}

module.exports = {
  getConfigDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  getDefaultAliases,
  resolveModel,
  computeConfigHash,
  buildAliasTable,
  checkConfigChanged,
};
