/**
 * Sidecar Setup Wizard
 *
 * Provides interactive setup, alias management, and API key detection
 * for the sidecar configuration.
 */

const fs = require('fs');
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
 * @param {string} name - Alias name (e.g., 'my-model')
 * @param {string} modelString - Full model identifier (e.g., 'openrouter/custom/model-v1')
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
  logger.info('Default config created', { default: defaultModel, aliasCount: Object.keys(cfg.aliases).length });
  return cfg;
}

/**
 * Detect available API keys from environment variables and OpenCode's auth.json
 * @param {string} authDir - Path to directory containing auth.json
 * @returns {{openrouter: boolean, google: boolean, openai: boolean, anthropic: boolean}}
 */
function detectApiKeys(authDir) {
  const result = {
    openrouter: false,
    google: false,
    openai: false,
    anthropic: false
  };

  // Check environment variables
  if (process.env.OPENROUTER_API_KEY) {
    result.openrouter = true;
  }
  if (process.env.GEMINI_API_KEY) {
    result.google = true;
  }
  if (process.env.OPENAI_API_KEY) {
    result.openai = true;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    result.anthropic = true;
  }

  // Check auth.json in the provided directory
  try {
    const authPath = path.join(authDir, 'auth.json');
    if (fs.existsSync(authPath)) {
      const content = fs.readFileSync(authPath, 'utf-8');
      const authData = JSON.parse(content);

      if (authData.openrouter && authData.openrouter.apiKey) {
        result.openrouter = true;
      }
      if (authData.google && authData.google.apiKey) {
        result.google = true;
      }
      if (authData.openai && authData.openai.apiKey) {
        result.openai = true;
      }
      if (authData.anthropic && authData.anthropic.apiKey) {
        result.anthropic = true;
      }
    }
  } catch (_err) {
    logger.debug('Could not read auth.json', { authDir, error: _err.message });
  }

  return result;
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
  // Try as a number
  const num = parseInt(input, 10);
  if (num >= 1 && num <= MODEL_CHOICES.length) {
    return MODEL_CHOICES[num - 1].alias;
  }

  // Try as an alias name from default aliases
  const defaults = getDefaultAliases();
  if (defaults[input] !== undefined) {
    return input;
  }

  return null;
}

/**
 * Run the interactive setup wizard
 *
 * Guides the user through:
 * 1. API key detection
 * 2. Default model selection
 * 3. Config file creation with all default aliases
 */
/* eslint-disable no-console -- CLI wizard requires direct console output */
async function runInteractiveSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    // Welcome message
    console.log('');
    console.log('=== Sidecar Setup Wizard ===');
    console.log('');

    // Detect API keys
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const authDir = path.join(homeDir, '.config', 'opencode');
    const keys = detectApiKeys(authDir);

    const foundKeys = Object.entries(keys)
      .filter(([, found]) => found)
      .map(([provider]) => provider);

    if (foundKeys.length > 0) {
      console.log(`API keys detected: ${foundKeys.join(', ')}`);
    } else {
      console.log('No API keys detected. Set OPENROUTER_API_KEY to get started.');
    }
    console.log('');

    // Present model choices
    console.log('Choose your default model:');
    console.log('');
    for (const choice of MODEL_CHOICES) {
      console.log(`  ${choice.number}) ${choice.alias} - ${choice.label}`);
    }
    console.log('');

    // Get user choice
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

/* eslint-enable no-console */

module.exports = {
  addAlias,
  createDefaultConfig,
  detectApiKeys,
  runInteractiveSetup,
  MODEL_CHOICES,
};
