/**
 * Input Validators
 *
 * Validation helper functions for CLI argument validation.
 * These validators run before sidecar launch to fail fast with clear errors.
 */

const fs = require('fs');
const path = require('path');
const { isValidAgent, OPENCODE_AGENTS } = require('./agent-mapping');

/**
 * Valid agent modes for --agent option
 * These are OpenCode's native agents.
 * Custom agents defined in ~/.config/opencode/agents/ are also accepted.
 */
const VALID_AGENT_MODES = OPENCODE_AGENTS;

/**
 * Provider to API key mapping
 */
const PROVIDER_KEY_MAP = {
  'openrouter': { key: 'OPENROUTER_API_KEY', name: 'OpenRouter' },
  'google': { key: 'GEMINI_API_KEY', name: 'Google Gemini' },
  'openai': { key: 'OPENAI_API_KEY', name: 'OpenAI' },
  'anthropic': { key: 'ANTHROPIC_API_KEY', name: 'Anthropic' },
  'deepseek': { key: 'DEEPSEEK_API_KEY', name: 'DeepSeek' },
};

/**
 * Validate briefing content is not empty or whitespace-only
 * @param {string} briefing
 * @returns {{valid: boolean, error?: string}}
 */
function validateBriefingContent(briefing) {
  if (!briefing || briefing.trim().length === 0) {
    return { valid: false, error: 'Error: --briefing cannot be empty or whitespace-only' };
  }
  return { valid: true };
}

/**
 * Validate project directory exists
 * @param {string} projectPath
 * @returns {{valid: boolean, error?: string}}
 */
function validateProjectPath(projectPath) {
  // Skip validation if not provided (will use default)
  if (!projectPath) {
    return { valid: true };
  }

  if (!fs.existsSync(projectPath)) {
    return { valid: false, error: `Error: --project path does not exist: ${projectPath}` };
  }

  try {
    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) {
      return { valid: false, error: `Error: --project path is not a directory: ${projectPath}` };
    }
  } catch (e) {
    return { valid: false, error: `Error: --project path is not accessible: ${projectPath}` };
  }

  return { valid: true };
}

/**
 * Find a session file in Claude's project directories
 * Claude stores sessions in subdirectories named after the hashed project path
 * @param {string} baseDir - The base ~/.claude/projects directory
 * @param {string} sessionId - The session ID to find
 * @returns {boolean} Whether the session was found
 */
function findSessionInProjectDirs(baseDir, sessionId) {
  if (!fs.existsSync(baseDir)) {
    return false;
  }

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sessionFile = path.join(baseDir, entry.name, `${sessionId}.jsonl`);
        if (fs.existsSync(sessionFile)) {
          return true;
        }
      }
    }
  } catch (e) {
    // Ignore errors reading directories
  }

  return false;
}

/**
 * Validate explicit session ID exists
 * @param {string} session
 * @param {string} _projectPath - Project path (unused, for future use)
 * @returns {{valid: boolean, error?: string}}
 */
function validateExplicitSession(session, _projectPath) {
  // Skip validation for 'current' or undefined (deferred resolution)
  if (!session || session === 'current') {
    return { valid: true };
  }

  // Check in ~/.claude/projects subdirectories
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');

  // Check if explicit session file exists in any project subdirectory
  const found = findSessionInProjectDirs(claudeProjectsDir, session);
  if (!found) {
    return {
      valid: false,
      error: `Error: --session '${session}' not found. Use 'sidecar list' to see available sessions or omit --session for most recent.`
    };
  }

  return { valid: true };
}

/**
 * Validate agent mode
 *
 * Accepts:
 * - OpenCode native agents: Build, Plan, General, Explore
 * - Custom agents: any non-empty string (for user-defined OpenCode agents)
 *
 * @param {string} agent
 * @returns {{valid: boolean, error?: string}}
 */
function validateAgentMode(agent) {
  // Allow undefined/null - will default to Build
  if (!agent) {
    return { valid: true };
  }

  // Use isValidAgent which accepts all non-empty strings
  // This allows custom agents defined in user's OpenCode agent directory
  if (!isValidAgent(agent)) {
    return {
      valid: false,
      error: `Error: --agent cannot be empty. Examples: ${VALID_AGENT_MODES.join(', ')}`
    };
  }

  return { valid: true };
}

/**
 * Validate MCP spec format (OPTIONAL - only validates if provided)
 * @param {string} mcp
 * @returns {{valid: boolean, error?: string}}
 */
function validateMcpSpec(mcp) {
  // Skip validation if not provided - MCP is optional
  if (!mcp) {
    return { valid: true };
  }

  // Format: name=url or name=command
  if (!mcp.includes('=')) {
    return {
      valid: false,
      error: `Error: --mcp must be in format 'name=url' or 'name=command'. Got: '${mcp}'`
    };
  }

  // Split on first '=' only (value can contain '=')
  const eqIndex = mcp.indexOf('=');
  const name = mcp.slice(0, eqIndex);
  const value = mcp.slice(eqIndex + 1);

  if (!name || !value) {
    return {
      valid: false,
      error: `Error: --mcp must have both name and value. Got: '${mcp}'`
    };
  }

  return { valid: true };
}

/**
 * Validate MCP config file exists and is valid JSON (OPTIONAL)
 * @param {string} mcpConfig
 * @returns {{valid: boolean, error?: string}}
 */
function validateMcpConfigFile(mcpConfig) {
  // Skip validation if not provided - MCP config is optional
  if (!mcpConfig) {
    return { valid: true };
  }

  if (!fs.existsSync(mcpConfig)) {
    return {
      valid: false,
      error: `Error: --mcp-config file does not exist: ${mcpConfig}`
    };
  }

  try {
    const content = fs.readFileSync(mcpConfig, 'utf-8');
    JSON.parse(content);
  } catch (e) {
    return {
      valid: false,
      error: `Error: --mcp-config file is not valid JSON: ${mcpConfig}`
    };
  }

  return { valid: true };
}

/**
 * Model-specific thinking level support (static fallback)
 * Maps model patterns to their supported thinking levels.
 *
 * NOTE: For dynamic, up-to-date capabilities, use model-capabilities.js
 * which fetches from OpenRouter API and caches the results.
 * This static map is used as a fast fallback for CLI validation.
 */
const MODEL_THINKING_SUPPORT = {
  // OpenAI GPT-5.x does NOT support 'minimal'
  'gpt-5': ['none', 'low', 'medium', 'high', 'xhigh'],
  // o3/o3-mini supports all levels
  'o3': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  // Gemini supports all levels
  'gemini': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  // Default: all levels supported
  'default': ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
};

/**
 * Get supported thinking levels for a model (synchronous, static fallback)
 *
 * For dynamic lookup from OpenRouter API cache, use:
 *   const { getSupportedThinkingLevels } = require('./model-capabilities');
 *
 * @param {string} model - Model identifier
 * @returns {string[]} Array of supported thinking levels
 */
function getSupportedThinkingLevels(model) {
  if (!model) {return MODEL_THINKING_SUPPORT.default;}

  const modelLower = model.toLowerCase();

  // Check each known model pattern
  for (const [pattern, levels] of Object.entries(MODEL_THINKING_SUPPORT)) {
    if (pattern !== 'default' && modelLower.includes(pattern)) {
      return levels;
    }
  }

  return MODEL_THINKING_SUPPORT.default;
}

/**
 * Validate thinking level for a specific model (synchronous)
 *
 * For async validation with dynamic API cache, use:
 *   const { validateThinkingForModel } = require('./model-capabilities');
 *
 * @param {string} thinking - Thinking level ('minimal', 'low', 'medium', 'high', 'xhigh', 'none')
 * @param {string} model - Model identifier
 * @returns {{valid: boolean, error?: string, warning?: string, adjustedLevel?: string}}
 */
function validateThinkingLevel(thinking, model) {
  if (!thinking) {
    return { valid: true };
  }

  const allLevels = MODEL_THINKING_SUPPORT.default;
  if (!allLevels.includes(thinking)) {
    return {
      valid: false,
      error: `Error: --thinking must be one of: ${allLevels.join(', ')}`
    };
  }

  const supportedLevels = getSupportedThinkingLevels(model);
  if (!supportedLevels.includes(thinking)) {
    // Map to nearest supported level
    const fallback = thinking === 'minimal' ? 'low' : 'medium';
    return {
      valid: true,
      warning: `Warning: Model '${model}' does not support thinking level '${thinking}'. Using '${fallback}' instead.`,
      adjustedLevel: fallback
    };
  }

  return { valid: true };
}

/**
 * Validate API key is present for the given model's provider
 * @param {string} model - The model string (e.g., 'openrouter/google/gemini-2.5-flash')
 * @returns {{valid: boolean, error?: string}}
 */
function validateApiKey(model) {
  if (!model) {
    return { valid: true };
  }

  const provider = model.split('/')[0].toLowerCase();
  const providerInfo = PROVIDER_KEY_MAP[provider];

  if (!providerInfo) {
    // Unknown provider - skip validation, let runtime handle it
    return { valid: true };
  }

  if (!process.env[providerInfo.key]) {
    return {
      valid: false,
      error: `Error: ${providerInfo.key} environment variable is required for ${providerInfo.name} models. Set it with: export ${providerInfo.key}=your-api-key`
    };
  }

  return { valid: true };
}

module.exports = {
  VALID_AGENT_MODES,
  PROVIDER_KEY_MAP,
  MODEL_THINKING_SUPPORT,
  validateBriefingContent,
  validateProjectPath,
  validateExplicitSession,
  validateAgentMode,
  validateMcpSpec,
  validateMcpConfigFile,
  validateApiKey,
  validateThinkingLevel,
  getSupportedThinkingLevels,
  findSessionInProjectDirs
};
