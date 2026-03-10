/**
 * Alias Resolver Utilities
 *
 * Handles alias auto-repair and direct API fallback logic,
 * extracted from config.js to keep it under the 300-line limit.
 */

const { PROVIDER_ENV_MAP, readApiKeyValues } = require('./api-key-store');
const { logger } = require('./logger');

/**
 * Strip openrouter/ prefix when direct provider API key is available
 * but OPENROUTER_API_KEY is not.
 * @param {string} model - Full model identifier
 * @returns {string} Model with or without openrouter/ prefix
 */
function applyDirectApiFallback(model) {
  if (!model.startsWith('openrouter/')) {
    return model;
  }
  const persistedKeys = readApiKeyValues();
  if (process.env.OPENROUTER_API_KEY || persistedKeys.openrouter) {
    return model;
  }
  const direct = model.slice('openrouter/'.length);
  const provider = direct.split('/')[0];
  const envVar = PROVIDER_ENV_MAP[provider];
  if (envVar && (process.env[envVar] || persistedKeys[provider])) {
    logger.warn({ msg: 'Using direct provider API (OPENROUTER_API_KEY not set)', original: model, resolved: direct });
    process.stderr.write(
      `Notice: Using direct ${provider} API (OPENROUTER_API_KEY not set). ` +
      'Use --validate-model to verify model availability.\n'
    );
    return direct;
  }
  return model;
}

/**
 * Auto-repair a null alias by falling back to DEFAULT_ALIASES.
 * Updates config on disk and warns to stderr.
 * @param {string} alias - The alias name with null value
 * @param {object|null} config - Current config object
 * @param {object} defaultAliases - DEFAULT_ALIASES map
 * @param {Function} saveConfig - saveConfig function reference
 * @returns {string} Repaired model string
 * @throws {Error} If no default exists for this alias
 */
function autoRepairAlias(alias, config, defaultAliases, saveConfig) {
  const defaultModel = defaultAliases[alias];
  if (defaultModel) {
    process.stderr.write(
      `Notice: Auto-repaired null alias '${alias}' -> '${defaultModel}'\n`
    );
    if (config && config.aliases) {
      config.aliases[alias] = defaultModel;
      try {
        saveConfig(config);
      } catch (err) {
        process.stderr.write(
          `Notice: Could not persist repaired alias '${alias}' (${err.message}). ` +
          'Using default for this session only.\n'
        );
      }
    }
    return applyDirectApiFallback(defaultModel);
  }
  throw new Error(
    `Alias '${alias}' is configured but has no model value. ` +
    `Fix with: sidecar setup --add-alias ${alias}=provider/model`
  );
}

module.exports = {
  applyDirectApiFallback,
  autoRepairAlias,
};
