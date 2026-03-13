/**
 * CLI Usage Text
 *
 * Extracted from cli.js to keep files under the 300-line limit.
 */

/** Commands section of usage text */
function getCommandsUsage() {
  return `
Usage: sidecar <command> [options]

Commands:
  start       Launch a new sidecar
  list        Show previous sidecars
  resume      Reopen a previous sidecar
  continue    New sidecar building on previous
  read        Output sidecar summary/conversation
  abort       Abort a running sidecar session
  setup       Configure default model and aliases
    --api-keys               Open API key setup window
  auto-skills List/enable/disable auto-skills
  update      Update to latest version
  mcp         Start MCP server (stdio transport)`;
}

/** Start command options */
function getStartOptionsUsage() {
  return `
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
  --no-context                   Skip parent conversation history context
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
  --validate-model             Verify model exists on provider API (opt-in)
  --position <pos>             Window position: right (default), left, center`;
}

/** Secondary command options, agent types, and examples */
function getSecondaryUsage() {
  return `
Options for 'list':
  --status <filter>            Filter by status (running, complete)
  --all                        Show all projects
  --json                       Output as JSON

Options for 'read':
  --summary                    Show summary (default)
  --conversation               Show full conversation

Options for 'auto-skills':
  --on [skill ...]             Enable all or specific auto-skills
  --off [skill ...]            Disable all or specific auto-skills
  (no flags)                   Show current status

OpenCode Agent Types:
    Chat       Reads auto, writes/bash ask permission (interactive default)
    Build      Full tool access (headless default)
    Plan       Read-only analysis and planning

  NOTE: --agent chat is interactive-only (incompatible with --no-ui).
  Headless mode defaults to build agent.

Custom agents defined in ~/.config/opencode/agents/ or
.opencode/agents/ are also supported.

Examples:
  sidecar start --model google/gemini-2.5 --prompt "Debug auth issue"
  sidecar start --model openai/o3 --prompt "Generate tests" --no-ui
  sidecar start --model gemini --prompt "Review code" --agent Plan
  sidecar list
  sidecar resume abc123
  sidecar read abc123 --conversation
`;
}

/**
 * Get usage text
 * @returns {string} Formatted usage/help string
 */
function getUsage() {
  return getCommandsUsage() + getStartOptionsUsage() + getSecondaryUsage();
}

module.exports = { getUsage };
