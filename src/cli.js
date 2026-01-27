/**
 * CLI Argument Parser
 *
 * Spec Reference: §4 CLI Interface
 * Parses command line arguments for all sidecar commands.
 */

const {
  validateBriefingContent,
  validateProjectPath,
  validateExplicitSession,
  validateAgentMode,
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
  session: 'current',
  project: process.cwd(),
  'context-turns': 50,
   'context-max-tokens': 80000,
   timeout: 15,
   headless: false,
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
     'headless',
     'all',
     // 'summary', // summary is now an option with a value
     'conversation',
     'json',
     'version',
     'help'
   ];
  return booleanFlags.includes(key);
}

/**
 * Parse a value to the appropriate type
 */
function parseValue(key, value) {
  // Numeric options
  const numericOptions = ['context-turns', 'context-max-tokens', 'timeout'];
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
  // Required: --model
  if (!args.model) {
    return { valid: false, error: 'Error: --model is required' };
  }

  // Required: --briefing (presence check)
  if (!args.briefing) {
    return { valid: false, error: 'Error: --briefing is required' };
  }

  // Validate briefing content (not empty/whitespace-only)
  const briefingCheck = validateBriefingContent(args.briefing);
  if (!briefingCheck.valid) {
    return briefingCheck;
  }

  // Validate model format: provider/model
  if (!isValidModelFormat(args.model)) {
    return { valid: false, error: 'Error: --model must be in format provider/model (e.g., google/gemini-2.5-flash) or openrouter/provider/model' };
  }

  // Validate project path exists (if provided)
  const projectCheck = validateProjectPath(args.project);
  if (!projectCheck.valid) {
    return projectCheck;
  }

  // Validate explicit session ID exists (if not 'current')
  const sessionCheck = validateExplicitSession(args.session, args.project);
  if (!sessionCheck.valid) {
    return sessionCheck;
  }

  // Validate agent mode (if provided)
  const agentCheck = validateAgentMode(args.agent);
  if (!agentCheck.valid) {
    return agentCheck;
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

  return { valid: true };
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

    // Required: --briefing
    if (!args.briefing) {
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
  subagent    Manage sub-agents within a sidecar

Options for 'start':
  --model <model>              Required. Model to use:
                               - Direct API: google/gemini-2.5-flash
                               - OpenRouter: openrouter/google/gemini-2.5-flash
  --briefing <text>            Required. Task description
  --agent <agent>              OpenCode agent to use (see Agent Types below)
  --session <id|"current">     Session ID to pull context from (default: current)
  --project <path>             Project directory (default: cwd)
  --headless                   Run without GUI (autonomous mode)
  --timeout <minutes>          Headless timeout (default: 15)
  --context-turns <N>          Max conversation turns (default: 50)
  --context-since <duration>   Time filter (e.g., 2h). Overrides turns.
   --context-max-tokens <N>     Max context tokens (default: 80000)
   --summary-length <length>    Summary verbosity: brief, normal (default), verbose
   --mcp <spec>                 Add MCP server. Formats:
                                - name=url (remote server)
                                - name=command (local server)
  --mcp-config <path>          Path to opencode.json with MCP config

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
    Build      Full tool access (default)
    Plan       Read-only analysis and planning

  SUBAGENTS (spawned within sessions):
    General    Full-access subagent for research
    Explore    Read-only subagent for codebase exploration

Custom agents defined in ~/.config/opencode/agents/ or
.opencode/agents/ are also supported for primary sessions.

Examples:
  sidecar start --model google/gemini-2.5 --briefing "Debug auth issue"
  sidecar start --model openai/o3 --briefing "Generate tests" --headless
  sidecar start --model gemini --briefing "Review code" --agent Plan
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
