/**
 * Credential Loader
 *
 * Loads API keys from multiple sources into process.env at CLI bootstrap.
 * Priority: process.env (already set) > sidecar .env > auth.json
 * Never overwrites existing process.env values.
 */
const { logger } = require('./logger');
const { loadEnvEntries, PROVIDER_ENV_MAP, LEGACY_KEY_NAMES } = require('./api-key-store');
const { readAuthJsonKeys } = require('./auth-json');

/**
 * Load credentials from all sources into process.env.
 * Call once at CLI startup, before any validation.
 *
 * Sources (in priority order):
 * 1. process.env - already set, never overwritten
 * 2. ~/.config/sidecar/.env - user-configured via `sidecar setup`
 * 3. ~/.local/share/opencode/auth.json - OpenCode SDK fallback
 */
function loadCredentials() {
  // Step 1: Load from sidecar .env file
  const fileEntries = loadEnvEntries();
  for (const [, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
    if (!process.env[envVar]) {
      const fromFile = fileEntries.get(envVar);
      if (fromFile && fromFile.length > 0) {
        process.env[envVar] = fromFile;
        logger.info(`Loaded ${envVar} from sidecar .env`);
      }
    }
  }

  // Step 1b: Handle legacy key names in process.env
  for (const [oldName, newName] of Object.entries(LEGACY_KEY_NAMES)) {
    if (process.env[oldName] && !process.env[newName]) {
      process.env[newName] = process.env[oldName];
      logger.info(`Migrated ${oldName} to ${newName}`);
    }
  }

  // Step 2: Import from auth.json (lowest priority)
  const authKeys = readAuthJsonKeys();
  for (const [provider, key] of Object.entries(authKeys)) {
    const envVar = PROVIDER_ENV_MAP[provider];
    if (envVar && !process.env[envVar]) {
      process.env[envVar] = key;
      logger.info(`Loaded ${envVar} from auth.json`);
    }
  }
}

module.exports = { loadCredentials };
