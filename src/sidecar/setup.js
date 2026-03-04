/**
 * Sidecar Setup Wizard
 *
 * Provides interactive setup, alias management, and API key detection
 * for the sidecar configuration.
 *
 * runInteractiveSetup() is Electron-first: launches the GUI wizard,
 * falls back to runReadlineSetup() for headless environments.
 */

const path = require('path');
const readline = require('readline');
const { loadConfig, saveConfig, getDefaultAliases, getConfigDir } = require('../utils/config');
const { logger } = require('../utils/logger');

/**
 * Model choices presented during interactive setup
 * @type {Array<{number: number, alias: string, label: string}>}
 */
const MODEL_CHOICES = [
  { number: 1, alias: 'gemini', label: 'Gemini 3 Flash (fast, large context)' },
  { number: 2, alias: 'gemini-pro', label: 'Gemini 3 Pro (advanced reasoning)' },
  { number: 3, alias: 'gpt', label: 'GPT-5.2 Chat (strong coding)' },
  { number: 4, alias: 'opus', label: 'Claude Opus 4.6 (deep analysis)' },
  { number: 5, alias: 'deepseek', label: 'DeepSeek v3.2 (open-source)' },
];

/**
 * Add a model alias to the existing config (or create config if none exists)
 * @param {string} name - Alias name
 * @param {string} modelString - Full model identifier
 */
function addAlias(name, modelString) {
  const cfg = loadConfig() || { aliases: {} };
  if (!cfg.aliases) {
    cfg.aliases = {};
  }
  cfg.aliases[name] = modelString;
  saveConfig(cfg);
  logger.info('Alias added', { name, model: modelString });
}

/**
 * Create a new config with all default aliases and the chosen default model
 * @param {string} defaultModel - Default model alias or full model string
 * @returns {object} The created config object
 */
function createDefaultConfig(defaultModel) {
  const cfg = {
    default: defaultModel,
    aliases: getDefaultAliases()
  };
  saveConfig(cfg);
  logger.info('Default config created', {
    default: defaultModel,
    aliasCount: Object.keys(cfg.aliases).length
  });
  return cfg;
}

/**
 * Detect available API keys from .env file and process.env
 * @returns {{openrouter: boolean, google: boolean, openai: boolean, anthropic: boolean}}
 */
function detectApiKeys() {
  const { readApiKeys } = require('../utils/api-key-store');
  return readApiKeys();
}

/**
 * Prompt the user with a question via readline
 * @param {readline.Interface} rl - Readline interface
 * @param {string} prompt - Question text
 * @returns {Promise<string>} User's answer
 */
function askQuestion(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Resolve user input to a model alias name
 * @param {string} input - User input (number 1-5 or alias name)
 * @returns {string|null} Resolved alias name, or null if invalid
 */
function resolveChoice(input) {
  const num = parseInt(input, 10);
  if (num >= 1 && num <= MODEL_CHOICES.length) {
    return MODEL_CHOICES[num - 1].alias;
  }

  const defaults = getDefaultAliases();
  if (defaults[input] !== undefined) {
    return input;
  }

  return null;
}

/**
 * Launch the Electron setup wizard
 * @returns {Promise<{success: boolean, default?: string, keyCount?: number}>}
 */
async function launchWizard() {
  const { launchSetupWindow } = require('./setup-window');
  return launchSetupWindow();
}

/**
 * Standalone API key setup — launches the Electron window directly
 * Used by `sidecar setup --api-keys`
 * @returns {Promise<boolean>} true if keys were configured
 */
async function runApiKeySetup() {
  try {
    const result = await launchWizard();
    return result.success;
  } catch (err) {
    logger.warn('Could not launch setup window', { error: err.message });
    return false;
  }
}

/**
 * Run the readline-based setup wizard (headless fallback)
 *
 * Guides the user through:
 * 1. API key detection
 * 2. Default model selection
 * 3. Config file creation
 */
/* eslint-disable no-console -- CLI wizard requires direct console output */
async function runReadlineSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log('');
    console.log('=== Sidecar Setup Wizard ===');
    console.log('');

    const keys = detectApiKeys();

    const foundKeys = Object.entries(keys)
      .filter(([, found]) => found)
      .map(([provider]) => provider);

    if (foundKeys.length > 0) {
      console.log(`API keys detected: ${foundKeys.join(', ')}`);
    } else {
      console.log('No API keys detected.');
      console.log('Set OPENROUTER_API_KEY to get started, or run: sidecar setup');
    }
    console.log('');

    console.log('Choose your default model:');
    console.log('');
    for (const choice of MODEL_CHOICES) {
      console.log(`  ${choice.number}) ${choice.alias} - ${choice.label}`);
    }
    console.log('');

    const answer = await askQuestion(rl, 'Pick a default (1-5 or alias name): ');
    const chosen = resolveChoice(answer);

    if (!chosen) {
      console.log(`Invalid choice: "${answer}". Using "gemini" as default.`);
      const cfg = createDefaultConfig('gemini');
      const aliasCount = Object.keys(cfg.aliases).length;
      console.log('');
      console.log(`Config created with ${aliasCount} aliases.`);
      console.log(`Config path: ${path.join(getConfigDir(), 'config.json')}`);
      return;
    }

    const cfg = createDefaultConfig(chosen);
    const aliasCount = Object.keys(cfg.aliases).length;

    console.log('');
    console.log(`Default model set to: ${chosen}`);
    console.log(`Config created with ${aliasCount} aliases.`);
    console.log(`Config path: ${path.join(getConfigDir(), 'config.json')}`);
  } finally {
    rl.close();
  }
}

/**
 * Run the interactive setup wizard (Electron-first)
 *
 * Attempts to launch the Electron GUI wizard. If Electron is not
 * available or fails, falls back to the readline-based setup.
 */
async function runInteractiveSetup() {
  try {
    const result = await launchWizard();
    if (result.success) {
      // Wizard handled config creation; if it returned a default, ensure config exists
      if (result.default) {
        const existing = loadConfig();
        if (!existing || !existing.default) {
          createDefaultConfig(result.default);
        }
      }

      const configPath = path.join(getConfigDir(), 'config.json');
      const keyLabel = result.keyCount
        ? `${result.keyCount} API key(s) configured.`
        : 'API keys configured.';
      const modelLabel = result.default
        ? `Default model: ${result.default}`
        : '';

      console.log('');
      console.log('Setup complete!');
      if (keyLabel) { console.log(keyLabel); }
      if (modelLabel) { console.log(modelLabel); }
      console.log(`Config: ${configPath}`);
      return;
    }
  } catch (err) {
    logger.debug('Electron wizard unavailable, falling back to readline', {
      error: err.message
    });
  }

  // Fallback to readline
  await runReadlineSetup();
}

/* eslint-enable no-console */

module.exports = {
  addAlias,
  createDefaultConfig,
  detectApiKeys,
  runInteractiveSetup,
  runReadlineSetup,
  runApiKeySetup,
  MODEL_CHOICES,
};
