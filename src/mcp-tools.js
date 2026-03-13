/**
 * MCP Tool Definitions for Sidecar
 *
 * Defines all tools exposed by the sidecar MCP server.
 * Uses Zod schemas for input validation (converted to JSON Schema by MCP SDK).
 *
 * @module mcp-tools
 */

const { z } = require('zod');
const { formatAliasNames } = require('./utils/config');

/** Zod pattern for safe task IDs (alphanumeric, hyphens, underscores only) */
const safeTaskId = z.string().regex(
  /^[a-zA-Z0-9_-]{1,64}$/,
  'Task ID must be 1-64 alphanumeric, hyphen, or underscore characters'
);

/** Zod pattern for safe model identifiers (must not start with -) */
const safeModel = z.string().regex(
  /^[a-zA-Z0-9_/.@:][a-zA-Z0-9_/.@:-]{0,199}$/,
  'Model must be 1-200 chars, start with alphanumeric, and contain only provider/model characters'
);

/**
 * Build all MCP tools with dynamic descriptions that include live alias names.
 * @returns {Array<{name: string, description: string, inputSchema: object}>}
 */
function getTools() {
  const aliasNames = formatAliasNames();
  return [
  {
    name: 'sidecar_start',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Spawn a sidecar conversation with a different LLM. Returns a task ID immediately. ' +
      'Mode selection: use INTERACTIVE (default, noUi: false) for research, ' +
      'exploration, analysis, and any task where the user benefits from watching ' +
      'progress live. It eliminates the polling problem entirely. ' +
      'Use HEADLESS (noUi: true) only for background automation the user does NOT ' +
      'need to monitor. When in doubt, use interactive. ' +
      'EXCEPTION: When spawning multiple sidecars simultaneously, ' +
      'ALWAYS use HEADLESS (noUi: true) for all of them unless the user ' +
      'explicitly requests interactive. Opening multiple Electron windows ' +
      'at once is disruptive. ' +
      'For headless mode, ALWAYS run `sleep 25` in your shell before each ' +
      'sidecar_status call to enforce the polling interval. ' +
      'For interactive mode, do not poll. Wait for the user to tell you ' +
      'they\'ve clicked Fold, then use sidecar_read. ' +
      'Call sidecar_guide first if you need help choosing a model or writing a good briefing.' +
      ' Pass includeContext: false when the briefing is fully self-contained.',
    inputSchema: {
      model: safeModel.optional().describe(
        `Short alias (${aliasNames}) or full provider/model ID. ` +
        'If omitted, uses the configured default. Call sidecar_guide to see all aliases.'
      ),
      prompt: z.string().describe(
        'Detailed task briefing. Include: objective, background, ' +
        'files of interest, success criteria.'
      ),
      agent: z.enum(['Chat', 'Plan', 'Build']).optional()
        .default('Chat').describe(
          'Agent mode. Chat (default): reads auto, writes ask ' +
          'permission. Plan: read-only analysis. Build: full auto ' +
          '(all operations approved).'
        ),
      noUi: z.boolean().optional().default(false).describe(
        'Run headless without GUI. Default false (opens Electron window).'
      ),
      thinking: z.enum([
        'none', 'minimal', 'low', 'medium', 'high', 'xhigh'
      ]).optional().describe(
        'Reasoning effort level. Default: medium.'
      ),
      timeout: z.number().optional().describe(
        'Headless timeout in minutes. Default: 15. Only applies when noUi is true.'
      ),
      contextTurns: z.number().optional().describe(
        'Max conversation turns to include from your Claude session. Default: 50.'
      ),
      contextSince: z.string().optional().describe(
        'Time filter for context — include only turns from the last N minutes/hours/days. ' +
        'Format: 30m, 2h, 1d. Overrides contextTurns when set.'
      ),
      contextMaxTokens: z.number().optional().describe(
        'Cap on context size in tokens. Default: 80000.'
      ),
      summaryLength: z.enum(['brief', 'normal', 'verbose']).optional().describe(
        'Fold summary verbosity. brief: key findings only. normal (default): full ' +
        'structured output. verbose: maximum detail.'
      ),
      includeContext: z.boolean().optional().default(true).describe(
        'Whether to include parent conversation history as context. '
        + 'Default: true. Set to false when the briefing is self-contained '
        + 'and does not depend on prior conversation. See sidecar_guide for guidance.'
      ),
      coworkProcess: z.string().optional().describe(
        'Cowork VM process name (e.g., "modest-laughing-goodall"). ' +
        'Extract from CWD: /sessions/<name>/. Required for parent context loading.'
      ),
      parentSession: z.string().optional().describe(
        'Claude Code session UUID for exact context matching. ' +
        'Strongly recommended when includeContext is true — prevents the sidecar from ' +
        'picking up the wrong session when multiple are active. ' +
        'Hook-triggered skills receive this in the additionalContext payload.'
      ),
      windowPosition: z.enum(['right', 'left', 'center']).optional()
        .default('right').describe(
          'Where to place the sidecar window on screen. ' +
          'right (default): flush against the right edge. ' +
          'left: flush against the left edge. center: centered.'
        ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'sidecar_status',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Check the status of a running sidecar task. Returns status ' +
      '(running/complete), elapsed time, and progress info. Primarily ' +
      'for headless mode \u2014 in interactive mode, wait for the user to ' +
      'tell you the sidecar is done instead of polling.',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID returned by sidecar_start.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'sidecar_read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Read the results of a completed sidecar task. Returns the summary ' +
      'by default, or full conversation history, or session metadata.',
    inputSchema: {
      taskId: safeTaskId.describe('The task ID to read.'),
      mode: z.enum(['summary', 'conversation', 'metadata']).optional()
        .default('summary').describe(
          'What to read. summary (default): the fold summary. ' +
          'conversation: full message history. metadata: session info.'
        ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'sidecar_list',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'List all sidecar sessions for the current project. Shows task ID, ' +
      'model, status, age, and briefing excerpt.',
    inputSchema: {
      status: z.enum(['all', 'running', 'complete']).optional().describe(
        'Filter by status. Default: show all.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'sidecar_resume',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Reopen a previous sidecar session with full conversation history ' +
      'preserved. The sidecar continues in the same OpenCode session. ' +
      'Returns a task ID immediately — use sidecar_status to poll.',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID of the session to resume.'
      ),
      noUi: z.boolean().optional().default(false).describe(
        'Resume in headless mode. Default false (opens Electron window).'
      ),
      timeout: z.number().optional().describe(
        'Headless timeout in minutes. Default: 15. Only applies when noUi is true.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'sidecar_continue',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Start a new sidecar session that inherits a previous session\'s ' +
      'conversation as context. The previous session\'s messages become ' +
      'read-only background for the new task. Returns a task ID ' +
      'immediately — use sidecar_status to poll.',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID of the previous session to continue from.'
      ),
      prompt: z.string().describe(
        'New task description for the continuation.'
      ),
      model: safeModel.optional().describe(
        `Override model — short alias (${aliasNames}) or full provider/model ID. Defaults to the original session's model.`
      ),
      agent: z.enum(['Chat', 'Plan', 'Build']).optional().describe(
        'Agent mode override. Chat: reads auto, writes ask. Plan: read-only. ' +
        'Build: full auto. Defaults to Build in headless mode, Chat in interactive.'
      ),
      noUi: z.boolean().optional().default(false).describe(
        'Run headless. Default false (opens Electron window).'
      ),
      timeout: z.number().optional().describe(
        'Headless timeout in minutes. Default: 15. Only applies when noUi is true.'
      ),
      contextTurns: z.number().optional().describe(
        'Max turns from the previous session\'s conversation to include as context. Default: 80000 tokens.'
      ),
      contextMaxTokens: z.number().optional().describe(
        'Cap on previous session context size in tokens. Default: 80000.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'sidecar_setup',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Open the sidecar setup wizard to configure API keys and default ' +
      'model. Launches an interactive Electron window for configuration.',
    inputSchema: {},
  },
  {
    name: 'sidecar_abort',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description:
      'Abort a running sidecar session. Stops the OpenCode agent ' +
      'immediately. Use when a sidecar is taking too long or is no ' +
      'longer needed.',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID of the running session to abort.'
      ),
      project: z.string().optional().describe(
        'Optional project directory path. Auto-detected from working directory if omitted.'
      ),
    },
  },
  {
    name: 'sidecar_guide',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      'Get detailed usage instructions for sidecar — when to spawn ' +
      'sidecars, how to write good briefings, agent selection guidelines, ' +
      'and the async workflow pattern. Call this first if you haven\'t ' +
      'used sidecar before.',
    inputSchema: {},
  },
  ];
}

/**
 * Returns the guide text for the sidecar_guide tool.
 * Includes live alias table from user config.
 * @returns {string} Markdown-formatted guide text
 */
function getGuideText() {
  const { getEffectiveAliases } = require('./utils/config');
  const aliases = getEffectiveAliases();
  const aliasRows = Object.entries(aliases)
    .map(([name, model]) => `| ${name} | ${model} |`)
    .join('\n');

  return `# Sidecar Usage Guide

## What Is Sidecar?
Sidecar spawns parallel conversations with different LLMs and folds results back into your context.

## When to Use Sidecars
**DO:** Different model's strengths needed, deep exploration, parallel investigation.
**DON'T:** Simple tasks you can handle directly.

## Async Workflow

### Headless Mode (noUi: true)
1. sidecar_start with model + prompt + noUi: true -> get task ID
2. Run \`sleep 25\` in your shell (this enforces the polling interval)
3. sidecar_status to check progress
4. If still running, run \`sleep 25\` again before each subsequent sidecar_status call
5. sidecar_read to get the summary once complete
6. Act on findings

**IMPORTANT:** Always run \`sleep 25\` before every sidecar_status call. This is not optional. Each premature poll wastes context tokens for zero benefit. The sleep command enforces the wait mechanically.

### Interactive Mode (noUi: false, default)
1. sidecar_start with model + prompt -> get task ID
2. Tell the user: "Let me know when you're done with the sidecar and have clicked Fold."
3. Do NOT poll sidecar_status. Wait for the user to tell you it's done.
4. If the user starts a new message without mentioning the sidecar, ask if they're done or just call sidecar_read
5. Act on findings

## Agent Selection
| Agent | Reads | Writes | Bash | Use When |
|-------|-------|--------|------|----------|
| Chat (default) | auto | asks | asks | Questions, analysis |
| Plan | auto | denied | denied | Read-only analysis |
| Build | auto | auto | auto | Implementation tasks |

## Writing Good Briefings
Include: Objective, Background, Files of interest, Success criteria, Constraints.

## Available Model Aliases
| Alias | Model |
|-------|-------|
${aliasRows}

Or use full IDs in provider/model format (e.g., openrouter/provider/model-id).
Run sidecar_setup to configure defaults and add custom aliases.

## Session Matching (Important for Context Accuracy)
**Always pass parentSession** when you know your Claude Code session UUID — this prevents
the sidecar from picking up the wrong session's context when multiple sessions are active.
Without it, sidecar falls back to the most recently modified session file, which may be wrong.

- Cowork: pass coworkProcess (extract from CWD: /sessions/<name>/).
- Claude Code CLI: pass parentSession with your session UUID.
- Hook-triggered skills: the hook's additionalContext includes the session ID — pass it through.

## Context Control (includeContext)

By default, sidecar includes your parent conversation history as context. Set \`includeContext: false\` to skip this and save tokens when the briefing is self-contained.

### MUST Include Context (Red Flags)
- Task references prior conversation ("the code we discussed", "that bug", "the approach you suggested")
- Fact checking or second opinions on recent work
- Code review of changes made in this session (reviewer needs to know WHY changes were made)
- "Does this look right?" or validation requests
- Continuing a debugging thread
- Auto-skills (review, security, unblock, bmad) — these always need conversation context
- Any task where the sidecar needs to understand what happened before

### Safe to Skip Context
- Greenfield tasks with explicit file paths and instructions
- General knowledge or research questions
- Tasks fully scoped in the briefing (files, criteria, constraints all specified)
- Independent analysis unrelated to current conversation

### Self-Contained Briefing Template
When setting \`includeContext: false\`, write a richer briefing:

\`\`\`
**Objective:** [Specific goal]
**Files to read:** [Exact paths]
**Relevant code:** [Paste key snippets if needed]
**Success criteria:** [How to know when done]
**Constraints:** [Scope limits, things to avoid]
\`\`\`

The sidecar has NO other context. Everything it needs must be in the briefing.

## Existing Sessions
Call sidecar_list before spawning. Use sidecar_resume to reopen or sidecar_continue to build on previous findings.
`;
}

module.exports = {
  getTools,
  getGuideText,
  safeTaskId,
  safeModel,
};
