/**
 * Model Validator
 *
 * Validates that a direct-API fallback model exists on the provider.
 * When a model is not found, prompts the user to pick an alternative
 * (interactive) or fails with available models (headless).
 */

const readline = require('readline');
const { fetchModelsFromProvider } = require('./model-fetcher');
const { readApiKeyValues } = require('./api-key-store');
const { loadConfig, saveConfig, getConfigPath } = require('./config');
const { logger } = require('./logger');

/**
 * Normalize a model ID to include the provider prefix.
 * @param {string} provider - e.g. 'google', 'openai'
 * @param {string} id - Model ID, may or may not have provider prefix
 * @returns {string} Normalized ID with provider prefix
 */
function normalizeModelId(provider, id) {
  if (id.startsWith(provider + '/')) {
    return id;
  }
  return `${provider}/${id}`;
}

/** Alias-to-search-term mapping for filtering provider model lists */
const ALIAS_SEARCH_TERMS = {
  'gemini': 'gemini', 'gemini-pro': 'gemini',
  'gpt': 'gpt', 'gpt-pro': 'gpt', 'codex': 'gpt',
  'claude': 'claude', 'sonnet': 'claude', 'opus': 'claude', 'haiku': 'claude',
  'deepseek': 'deepseek',
};

/**
 * Validate a direct-API fallback model exists on the provider.
 * Returns silently if valid. On failure: prompts (interactive) or throws (headless).
 *
 * @param {string} resolvedModel - e.g. 'google/gemini-3.1-flash-lite-preview'
 * @param {string} alias - Original alias name (e.g. 'gemini')
 * @param {object} [options]
 * @param {boolean} [options.headless] - If true, throw instead of prompting
 * @returns {Promise<string>} Confirmed model string
 */
async function validateDirectModel(resolvedModel, alias, options = {}) {
  const parts = resolvedModel.split('/');
  if (parts.length < 2) { return resolvedModel; }

  const provider = parts[0];
  const modelId = parts.slice(1).join('/');

  const keys = readApiKeyValues();
  const providerKey = keys[provider];
  if (!providerKey) { return resolvedModel; }

  let models;
  try {
    models = await fetchModelsFromProvider(provider, providerKey);
  } catch (err) {
    logger.debug({ msg: 'Model fetch failed, skipping validation', error: err.message });
    return resolvedModel;
  }

  if (!models || models.length === 0) { return resolvedModel; }

  const found = models.some(m => m.id === resolvedModel || m.id === modelId);
  if (found) { return resolvedModel; }

  const relevant = filterRelevantModels(models, alias);

  if (options.headless || !process.stdin.isTTY) {
    const list = relevant.slice(0, 10).map(m => `  ${normalizeModelId(provider, m.id)}`).join('\n');
    throw new Error(
      `Model '${modelId}' not found on ${provider} API.\n` +
      `Available models:\n${list}\n` +
      `Fix with: sidecar setup --add-alias ${alias}=${relevant[0] ? normalizeModelId(provider, relevant[0].id) : 'provider/model'}`
    );
  }

  return promptModelSelection(relevant, alias, provider, modelId);
}

/**
 * Filter models to those relevant to the alias
 * @param {Array<{id: string, name: string}>} models
 * @param {string} alias - e.g. 'gemini', 'gpt', 'opus'
 * @returns {Array<{id: string, name: string}>} Filtered, sorted, max 15
 */
function filterRelevantModels(models, alias) {
  const term = (ALIAS_SEARCH_TERMS[alias] || alias).toLowerCase();

  let filtered = models.filter(m =>
    m.id.toLowerCase().includes(term) ||
    m.name.toLowerCase().includes(term)
  );

  if (filtered.length === 0) { filtered = models; }

  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return filtered.slice(0, 15);
}

/** Interactive prompt — ask user to pick from available models */
async function promptModelSelection(models, alias, provider, failedModelId) {
  process.stderr.write(`\n  Model '${failedModelId}' not found on ${provider} API.\n`);
  process.stderr.write('  Available models:\n');
  models.forEach((m, i) => {
    const label = (m.name && m.name !== m.id) ? `${m.name} (${m.id})` : m.id;
    process.stderr.write(`    ${i + 1}. ${label}\n`);
  });
  process.stderr.write('\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  const answer = await new Promise(resolve => {
    rl.question(`  Select a model (1-${models.length}) or press Enter to cancel: `, resolve);
  });
  rl.close();

  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= models.length) {
    throw new Error('Model selection cancelled.');
  }

  const selected = models[idx];
  const newModel = normalizeModelId(provider, selected.id);

  let config = loadConfig();
  if (!config) {
    const fs = require('fs');
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      throw new Error(
        `Cannot save model selection: config file at ${configPath} is malformed. ` +
        'Fix it manually or run \'sidecar setup\'.'
      );
    }
    config = {};
  }
  if (!config.aliases) { config.aliases = {}; }
  config.aliases[alias] = newModel;
  try {
    saveConfig(config);
    process.stderr.write(`  Saved: ${alias} → ${newModel}\n`);
  } catch (err) {
    process.stderr.write(`  Warning: Could not save selection (${err.message}). Using for this session only.\n`);
  }
  process.stderr.write(`  (To change later: sidecar setup --add-alias ${alias}=...)\n\n`);

  return newModel;
}

module.exports = { validateDirectModel, filterRelevantModels, normalizeModelId };
