/**
 * CLI Argument Parser
 *
 * Spec Reference: §4 CLI Interface
 * Parses command line arguments for all sidecar commands.
 */

const {
  validatePromptContent,
  validateCwdPath,
  validateExplicitSession,
  validateAgentMode,
  validateHeadlessAgent,
  validateMcpSpec,
  validateMcpConfigFile,
  validateApiKey,
  validateThinkingLevel
} = require('./utils/validators');
const { logger } = require('./utils/logger');

/**
 * Default values per spec §4.1
 */
const DEFAULTS = {
  'session-id': 'current',
  cwd: process.cwd(),
  'context-turns': 50,
   'context-max-tokens': 80000,
   timeout: 15,
   'no-ui': false,
   'summary-length': 'normal' // Default summary length
};

/**
 * Parse command line arguments
 * @param {string[]} argv - Command line arguments (without node and script name)
 * @returns {object} Parsed arguments
 */
function parseArgs(argv) {
  const result = {
    _: [],
    ...DEFAULTS
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];

      // Boolean flags (no value expected)
      if (isBooleanFlag(key)) {
        result[key] = true;
        continue;
      }

      // Array accumulation flags
      if (key === 'exclude-mcp' && next && !next.startsWith('--')) {
        result['exclude-mcp'] = result['exclude-mcp'] || [];
        result['exclude-mcp'].push(next);
        i++;
        continue;
      }

      // Options with values
      if (next && !next.startsWith('--')) {
        result[key] = parseValue(key, next);
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(arg);
    }
  }

  return result;
}

/**
 * Check if a flag is boolean (doesn't take a value)
 */
function isBooleanFlag(key) {
   const booleanFlags = [
     'no-ui',
     'no-mcp',
     'setup',
     'all',
     // 'summary', // summary is now an option with a value
     'conversation',
     'json',
     'version',
     'help',
     'api-keys'
   ];
  return booleanFlags.includes(key);
}

/**
 * Parse a value to the appropriate type
 */
function parseValue(key, value) {
  // Numeric options
  const numericOptions = ['context-turns', 'context-max-tokens', 'timeout', 'opencode-port'];
   if (numericOptions.includes(key)) {
     return parseInt(value, 10);
   }

   // Specific string options
   if (key === 'summary-length') {
     const validLengths = ['brief', 'normal', 'verbose'];
     if (!validLengths.includes(value.toLowerCase())) {
       logger.warn('Invalid summary-length value, using default', { value, default: 'normal' });
       return DEFAULTS['summary-length'];
     }
     return value.toLowerCase();
   }

   return value;
}

/**
 * Validate arguments for the 'start' command
 * @param {object} args - Parsed arguments
 * @returns {{ valid: boolean, error?: string }}
 */
function validateStartArgs(args) {
  // Required: --prompt (presence check)
  if (!args.prompt) {
    return { valid: false, error: 'Error: --prompt is required' };
  }

  // Validate prompt content (not empty/whitespace-only)
  const promptCheck = validatePromptContent(args.prompt);
  if (!promptCheck.valid) {
    return promptCheck;
  }

  // Validate model format if model is present (model is resolved externally via resolveModel)
  if (args.model && !isValidModelFormat(args.model)) {
    return { valid: false, error: 'Error: --model must be in format provider/model (e.g., google/gemini-2.5-flash) or openrouter/provider/model' };
  }

  // Validate cwd path exists (if provided)
  const cwdCheck = validateCwdPath(args.cwd);
  if (!cwdCheck.valid) {
    return cwdCheck;
  }

  // Validate explicit session ID exists (if not 'current')
  const sessionCheck = validateExplicitSession(args['session-id'], args.cwd);
  if (!sessionCheck.valid) {
    return sessionCheck;
  }

  // Validate agent mode (if provided)
  const agentCheck = validateAgentMode(args.agent);
  if (!agentCheck.valid) {
    return agentCheck;
  }

  // Validate agent is headless-safe when --no-ui is set
  let headlessWarning;
  if (args['no-ui']) {
    const headlessCheck = validateHeadlessAgent(args.agent);
    if (!headlessCheck.valid) {
      return headlessCheck;
    }
    if (headlessCheck.warning) {
      logger.warn('Custom agent headless warning', { warning: headlessCheck.warning });
      headlessWarning = headlessCheck.warning;
    }
  }

  // Validate --client (if provided)
  if (args.client) {
    const validClients = ['code-local', 'code-web', 'cowork'];
    if (!validClients.includes(args.client)) {
      return { valid: false, error: `Error: --client must be one of: ${validClients.join(', ')}` };
    }
    // Require --session-dir when client is code-web
    if (args.client === 'code-web' && !args['session-dir']) {
      return { valid: false, error: 'Error: --session-dir is required when --client is code-web' };
    }
  }

  // Validate MCP spec format (if provided)
  const mcpCheck = validateMcpSpec(args.mcp);
  if (!mcpCheck.valid) {
    return mcpCheck;
  }

  // Validate MCP config file (if provided)
  const mcpConfigCheck = validateMcpConfigFile(args['mcp-config']);
  if (!mcpConfigCheck.valid) {
    return mcpConfigCheck;
  }

  // Validate timeout is positive
  if (args.timeout !== undefined && args.timeout <= 0) {
    return { valid: false, error: 'Error: --timeout must be a positive number' };
  }

  // Validate context-turns is positive
  if (args['context-turns'] !== undefined && args['context-turns'] <= 0) {
    return { valid: false, error: 'Error: --context-turns must be a positive number' };
  }

  // Validate context-since format if provided
  if (args['context-since'] && !isValidDurationFormat(args['context-since'])) {
    return { valid: false, error: 'Error: --context-since must be in format like 30m, 2h, or 1d' };
  }

  // Validate summary-length
  const validSummaryLengths = ['brief', 'normal', 'verbose'];
  if (args['summary-length'] && !validSummaryLengths.includes(args['summary-length'])) {
    return { valid: false, error: `Error: --summary-length must be one of: ${validSummaryLengths.join(', ')}` };
  }

  // Validate thinking effort level (if provided), with model-specific support check
  const thinkingCheck = validateThinkingLevel(args.thinking, args.model);
  if (!thinkingCheck.valid) {
    return thinkingCheck;
  }
  // If model doesn't support the level, adjust it and warn
  if (thinkingCheck.warning) {
    logger.warn('Thinking level adjusted', { warning: thinkingCheck.warning, adjustedLevel: thinkingCheck.adjustedLevel });
    args.thinking = thinkingCheck.adjustedLevel;
  }

  // Validate API key is present for the model's provider
  const apiKeyCheck = validateApiKey(args.model);
  if (!apiKeyCheck.valid) {
    return apiKeyCheck;
  }

  const result = { valid: true };
  if (headlessWarning) {
    result.warning = headlessWarning;
  }
  return result;
}

/**
 * Check if model format is valid
 * Supports:
 *   - Direct API: provider/model (e.g., google/gemini-2.5-flash)
 *   - OpenRouter: openrouter/provider/model (e.g., openrouter/google/gemini-2.5-flash)
 */
function isValidModelFormat(model) {
  const parts = model.split('/');
  // Must have at least 2 parts (provider/model) and at most 3 (openrouter/provider/model)
  if (parts.length < 2 || parts.length > 3) {
    return false;
  }
  // All parts must be non-empty
  return parts.every(part => part.length > 0);
}

/**
 * Check if duration format is valid (e.g., 30m, 2h, 1d)
 */
function isValidDurationFormat(duration) {
  return /^\d+[mhd]$/.test(duration);
}

/**
 * Validate arguments for the 'subagent' command
 * @param {object} args - Parsed arguments
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSubagentArgs(args) {
  const subcommand = args._[1]; // subagent spawn|list|read

  if (!subcommand) {
    return { valid: false, error: 'Error: subagent command requires a subcommand (spawn, list, or read)' };
  }

  const validSubcommands = ['spawn', 'list', 'read'];
  if (!validSubcommands.includes(subcommand)) {
    return { valid: false, error: `Error: Invalid subagent subcommand: ${subcommand}. Use: spawn, list, or read` };
  }

  if (subcommand === 'spawn') {
    // Required: --parent
    if (!args.parent) {
      return { valid: false, error: 'Error: --parent is required for subagent spawn' };
    }

    // Required: --agent (subagent type)
    if (!args.agent) {
      return { valid: false, error: 'Error: --agent is required for subagent spawn (General or Explore)' };
    }

    // Validate subagent type - only OpenCode native subagents allowed
    const { isValidSubagent, SUBAGENT_TYPES } = require('./utils/agent-mapping');
    if (!isValidSubagent(args.agent)) {
      return { valid: false, error: `Error: Invalid subagent type: ${args.agent}. Use: ${SUBAGENT_TYPES.join(' or ')}` };
    }

    // Required: --briefing (or --prompt)
    if (!args.briefing && !args.prompt) {
      return { valid: false, error: 'Error: --briefing is required for subagent spawn' };
    }
  }

  if (subcommand === 'list') {
    // Required: --parent
    if (!args.parent) {
      return { valid: false, error: 'Error: --parent is required for subagent list' };
    }
  }

  if (subcommand === 'read') {
    // Subagent ID is required as positional arg
    const subagentId = args._[2];
    if (!subagentId) {
      return { valid: false, error: 'Error: subagent ID is required for subagent read' };
    }
  }

  return { valid: true };
}

/**
 * Get usage text
 */
function getUsage() {
  return `
Usage: sidecar <command> [options]

Commands:
  start       Launch a new sidecar
  list        Show previous sidecars
  resume      Reopen a previous sidecar
  continue    New sidecar building on previous
  read        Output sidecar summary/conversation
  abort       Abort a running sidecar session
  subagent    Manage sub-agents within a sidecar
  setup       Configure default model and aliases
    --api-keys               Open API key setup window
  mcp         Start MCP server (stdio transport)

Options for 'start':
  --model <model>              Optional (uses config default). Model to use:
                               - Short aliases: gemini, opus, gpt (see 'sidecar setup')
                               - Direct API: google/gemini-2.5-flash
                               - OpenRouter: openrouter/google/gemini-2.5-flash
  --prompt <text>              Required. Task description
  --agent <agent>              OpenCode agent to use (see Agent Types below)
  --session-id <id|"current">  Session ID to pull context from (default: current)
  --cwd <path>                 Project directory (default: cwd)
  --no-ui                      Run without GUI (autonomous mode)
  --timeout <minutes>          Headless timeout (default: 15)
  --client <type>              Client type: code-local, code-web, cowork
  --session-dir <path>         Explicit session data directory
  --setup                      Force open configuration
  --fold-shortcut <key>        Customize fold shortcut
  --opencode-port <port>       Port override for OpenCode server
  --context-turns <N>          Max conversation turns (default: 50)
  --context-since <duration>   Time filter (e.g., 2h). Overrides turns.
   --context-max-tokens <N>     Max context tokens (default: 80000)
   --summary-length <length>    Summary verbosity: brief, normal (default), verbose
   --mcp <spec>                 Add MCP server. Formats:
                                - name=url (remote server)
                                - name=command (local server)
  --mcp-config <path>          Path to opencode.json with MCP config
  --no-mcp                       Don't inherit MCP servers from parent LLM
  --exclude-mcp <name>           Exclude specific MCP server (repeatable)

Options for 'list':
  --status <filter>            Filter by status (running, complete)
  --all                        Show all projects
  --json                       Output as JSON

Options for 'read':
  --summary                    Show summary (default)
  --conversation               Show full conversation

Subagent Commands:
  subagent spawn               Spawn a new sub-agent
    --parent <id>              Required. Parent sidecar ID
    --agent <type>             Required. Subagent type (General or Explore)
    --briefing <text>          Required. Task description

  subagent list                List sub-agents for a sidecar
    --parent <id>              Required. Parent sidecar ID
    --status <filter>          Filter by status (running, completed, failed)

  subagent read <id>           Read sub-agent results
    --summary                  Show summary (default)
    --conversation             Show full conversation

OpenCode Agent Types:
  PRIMARY AGENTS (for main sidecar sessions):
    Chat       Reads auto, writes/bash ask permission (interactive default)
    Build      Full tool access (headless default)
    Plan       Read-only analysis and planning

  SUBAGENTS (spawned within sessions):
    General    Full-access subagent for research
    Explore    Read-only subagent for codebase exploration

  NOTE: --agent chat is interactive-only (incompatible with --no-ui).
  Headless mode defaults to build agent.

Custom agents defined in ~/.config/opencode/agents/ or
.opencode/agents/ are also supported for primary sessions.

Examples:
  sidecar start --model google/gemini-2.5 --prompt "Debug auth issue"
  sidecar start --model openai/o3 --prompt "Generate tests" --no-ui
  sidecar start --model gemini --prompt "Review code" --agent Plan
  sidecar list
  sidecar resume abc123
  sidecar read abc123 --conversation
  sidecar subagent spawn --parent abc123 --agent Explore --briefing "Find API endpoints"
  sidecar subagent spawn --parent abc123 --agent General --briefing "Research auth patterns"
  sidecar subagent list --parent abc123
  sidecar subagent read subagent-xyz --summary
`;
}

module.exports = {
  parseArgs,
  validateStartArgs,
  validateSubagentArgs,
  getUsage,
  DEFAULTS
};
