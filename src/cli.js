/**
 * CLI Argument Parser
 *
 * Spec Reference: §4 CLI Interface
 * Parses command line arguments for all sidecar commands.
 */

/**
 * Default values per spec §4.1
 */
const DEFAULTS = {
  session: 'current',
  project: process.cwd(),
  'context-turns': 50,
  'context-max-tokens': 80000,
  timeout: 15,
  headless: false
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
    'summary',
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

  // Required: --briefing
  if (!args.briefing) {
    return { valid: false, error: 'Error: --briefing is required' };
  }

  // Validate model format: provider/model
  if (!isValidModelFormat(args.model)) {
    return { valid: false, error: 'Error: --model must be in format provider/model (e.g., google/gemini-2.5)' };
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

  return { valid: true };
}

/**
 * Check if model format is valid (provider/model)
 */
function isValidModelFormat(model) {
  // Must contain exactly one slash, with non-empty parts on both sides
  const parts = model.split('/');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

/**
 * Check if duration format is valid (e.g., 30m, 2h, 1d)
 */
function isValidDurationFormat(duration) {
  return /^\d+[mhd]$/.test(duration);
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

Options for 'start':
  --model <provider/model>     Required. Model to use (e.g., google/gemini-2.5)
  --briefing <text>            Required. Task description
  --session <id|"current">     Session ID to pull context from (default: current)
  --project <path>             Project directory (default: cwd)
  --headless                   Run without GUI (autonomous mode)
  --timeout <minutes>          Headless timeout (default: 15)
  --context-turns <N>          Max conversation turns (default: 50)
  --context-since <duration>   Time filter (e.g., 2h). Overrides turns.
  --context-max-tokens <N>     Max context tokens (default: 80000)

Options for 'list':
  --status <filter>            Filter by status (running, complete)
  --all                        Show all projects
  --json                       Output as JSON

Options for 'read':
  --summary                    Show summary (default)
  --conversation               Show full conversation

Examples:
  sidecar start --model google/gemini-2.5 --briefing "Debug auth issue"
  sidecar start --model openai/o3 --briefing "Generate tests" --headless
  sidecar list
  sidecar resume abc123
  sidecar read abc123 --conversation
`;
}

module.exports = {
  parseArgs,
  validateStartArgs,
  getUsage,
  DEFAULTS
};
