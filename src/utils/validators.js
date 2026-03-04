/**
 * Input Validators
 *
 * Validation helper functions for CLI argument validation.
 * These validators run before sidecar launch to fail fast with clear errors.
 */

const fs = require('fs');
const path = require('path');
const { isValidAgent, isHeadlessSafe, OPENCODE_AGENTS } = require('./agent-mapping');

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

/** Task ID format: alphanumeric, hyphens, underscores, 1-64 chars */
const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validate a task ID format (safe for use in file paths)
 * @param {string} taskId
 * @returns {{valid: boolean, error?: string}}
 */
function validateTaskId(taskId) {
  if (!taskId) {
    return { valid: false, error: 'Task ID is required' };
  }
  if (!TASK_ID_PATTERN.test(taskId)) {
    return { valid: false, error: 'Invalid task ID format. Must be 1-64 alphanumeric, hyphen, or underscore characters.' };
  }
  return { valid: true };
}

/**
 * Resolve and validate a session path, preventing path traversal.
 * @param {string} project - Project root directory
 * @param {string} taskId - Task ID (should be pre-validated with validateTaskId)
 * @returns {string} Absolute path to the session directory
 * @throws {Error} If resolved path escapes the sessions directory
 */
function safeSessionDir(project, taskId) {
  const sessionsDir = path.join(project, '.claude', 'sidecar_sessions');
  const resolved = path.resolve(sessionsDir, taskId);
  if (!resolved.startsWith(sessionsDir + path.sep)) {
    throw new Error('Invalid task ID: path traversal detected');
  }
  return resolved;
}

/**
 * Validate prompt content is not empty or whitespace-only
 * @param {string} prompt
 * @returns {{valid: boolean, error?: string}}
 */
function validatePromptContent(prompt) {
  if (!prompt || prompt.trim().length === 0) {
    return { valid: false, error: 'Error: --prompt cannot be empty or whitespace-only' };
  }
  return { valid: true };
}

/** @deprecated Use validatePromptContent instead */
const validateBriefingContent = validatePromptContent;

/**
 * Validate cwd directory exists
 * @param {string} cwdPath
 * @returns {{valid: boolean, error?: string}}
 */
function validateCwdPath(cwdPath) {
  // Skip validation if not provided (will use default)
  if (!cwdPath) {
    return { valid: true };
  }

  if (!fs.existsSync(cwdPath)) {
    return { valid: false, error: `Error: --cwd path does not exist: ${cwdPath}` };
  }

  try {
    const stat = fs.statSync(cwdPath);
    if (!stat.isDirectory()) {
      return { valid: false, error: `Error: --cwd path is not a directory: ${cwdPath}` };
    }
  } catch (e) {
    return { valid: false, error: `Error: --cwd path is not accessible: ${cwdPath}` };
  }

  return { valid: true };
}

/** @deprecated Use validateCwdPath instead */
const validateProjectPath = validateCwdPath;

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
 * Validate agent is compatible with headless (--no-ui) mode.
 * 'chat' agent requires user permission for writes/bash and stalls headless.
 *
 * @param {string} agent - Agent name
 * @returns {{valid: boolean, error?: string, warning?: string}}
 */
function validateHeadlessAgent(agent) {
  if (!agent) {
    return { valid: true };
  }

  const safe = isHeadlessSafe(agent);

  if (safe === false) {
    return {
      valid: false,
      error: 'Error: --agent chat requires interactive mode (remove --no-ui or use --agent build)'
    };
  }

  if (safe === null) {
    return {
      valid: true,
      warning: `Warning: Custom agent '${agent}' may not be headless-safe. Ensure it does not require user interaction.`
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
 *
 * NOTE: OpenCode manages its own credentials via `opencode auth`.
 * The env var check is a convenience hint, not a hard requirement.
 * If OpenCode has credentials configured, the model will work
 * even without the env var set.
 *
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
    return { valid: true };
  }

  if (!process.env[providerInfo.key]) {
    // Check if OpenCode has credentials configured (auth.json)
    const os = require('os');
    const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
    if (fs.existsSync(authPath)) {
      // OpenCode manages its own auth — skip env var check
      return { valid: true };
    }

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
  TASK_ID_PATTERN,
  validateTaskId,
  safeSessionDir,
  validatePromptContent,
  validateCwdPath,
  // Backward-compatible aliases
  validateBriefingContent,
  validateProjectPath,
  validateExplicitSession,
  validateAgentMode,
  validateHeadlessAgent,
  validateMcpSpec,
  validateMcpConfigFile,
  validateApiKey,
  validateThinkingLevel,
  getSupportedThinkingLevels,
  findSessionInProjectDirs
};
