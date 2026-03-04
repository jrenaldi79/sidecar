/**
 * MCP Tool Definitions for Sidecar
 *
 * Defines all tools exposed by the sidecar MCP server.
 * Uses Zod schemas for input validation (converted to JSON Schema by MCP SDK).
 *
 * @module mcp-tools
 */

const { z } = require('zod');

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
 * All MCP tools exposed by the sidecar server.
 * Each tool has a name, description, and Zod-based inputSchema.
 * @type {Array<{name: string, description: string, inputSchema: object}>}
 */
const TOOLS = [
  {
    name: 'sidecar_start',
    description:
      'Spawn a multi-model sidecar conversation with a different LLM ' +
      '(Gemini, GPT, etc.). Returns a task ID immediately — the sidecar ' +
      'runs asynchronously in the background. Use sidecar_status to poll ' +
      'for completion and sidecar_read to get results. Opens an interactive ' +
      'Electron GUI by default; pass noUi: true for autonomous headless ' +
      'mode. Call sidecar_guide first if you need help choosing models or ' +
      'writing a good briefing.',
    inputSchema: {
      model: safeModel.optional().describe(
        'Model alias (gemini, opus, gpt) or full ID ' +
        '(openrouter/google/gemini-3-flash-preview). ' +
        'If omitted, uses the configured default model.'
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
    },
  },
  {
    name: 'sidecar_status',
    description:
      'Check the status of a running sidecar task. Returns status ' +
      '(running/complete), elapsed time, and model info. Use after ' +
      'sidecar_start to poll for completion.',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID returned by sidecar_start.'
      ),
    },
  },
  {
    name: 'sidecar_read',
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
    },
  },
  {
    name: 'sidecar_list',
    description:
      'List all sidecar sessions for the current project. Shows task ID, ' +
      'model, status, age, and briefing excerpt.',
    inputSchema: {
      status: z.enum(['all', 'running', 'complete']).optional().describe(
        'Filter by status. Default: show all.'
      ),
    },
  },
  {
    name: 'sidecar_resume',
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
    },
  },
  {
    name: 'sidecar_continue',
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
        'Override model. Defaults to the original session\'s model.'
      ),
      noUi: z.boolean().optional().default(false).describe(
        'Run headless. Default false (opens Electron window).'
      ),
    },
  },
  {
    name: 'sidecar_setup',
    description:
      'Open the sidecar setup wizard to configure API keys and default ' +
      'model. Launches an interactive Electron window for configuration.',
    inputSchema: {},
  },
  {
    name: 'sidecar_abort',
    description:
      'Abort a running sidecar session. Stops the OpenCode agent ' +
      'immediately. Use when a sidecar is taking too long or is no ' +
      'longer needed.',
    inputSchema: {
      taskId: safeTaskId.describe(
        'The task ID of the running session to abort.'
      ),
    },
  },
  {
    name: 'sidecar_guide',
    description:
      'Get detailed usage instructions for sidecar — when to spawn ' +
      'sidecars, how to write good briefings, agent selection guidelines, ' +
      'and the async workflow pattern. Call this first if you haven\'t ' +
      'used sidecar before.',
    inputSchema: {},
  },
];

/**
 * Returns the guide text for the sidecar_guide tool.
 * Provides comprehensive usage instructions for Claude or other LLMs.
 * @returns {string} Markdown-formatted guide text
 */
function getGuideText() {
  return `# Sidecar Usage Guide

## What Is Sidecar?

Sidecar spawns parallel conversations with different LLMs (Gemini, GPT, o3, \
etc.) and folds the results back into your context.

## When to Use Sidecars

**DO spawn a sidecar when:**
- Task benefits from a different model's strengths (Gemini's large context, \
o3's reasoning)
- Deep exploration that would pollute your main context
- User explicitly requests a different model
- Parallel investigation while you continue other work

**DON'T spawn a sidecar when:**
- Simple task you can handle directly
- Task requires your specific context that's hard to transfer

## Async Workflow Pattern

1. Call sidecar_start with model + prompt -> get task ID immediately
2. Continue your work while sidecar runs in background
3. Call sidecar_status to check if done
4. Call sidecar_read to get the summary when complete
5. Act on the findings

## Agent Selection

| Agent | Reads | Writes | Bash | Use When |
|-------|-------|--------|------|----------|
| Chat (default) | auto | asks | asks | Questions, analysis, guided work |
| Plan | auto | denied | denied | Read-only analysis, code review |
| Build | auto | auto | auto | Offloading implementation tasks |

## Writing Good Briefings

Include in your prompt:
- Objective: One-line goal
- Background: Context and what led to this task
- Files of interest: Specific file paths
- Success criteria: How to know when done
- Constraints: Scope limits, things to avoid

## Model Aliases

Use short aliases: gemini, opus, gpt, deepseek
Or full IDs: openrouter/google/gemini-3-flash-preview
Run sidecar_setup to configure defaults and aliases.

## Existing Sessions

Before spawning a new sidecar, call sidecar_list to check for relevant \
past work.
Use sidecar_resume to reopen, or sidecar_continue to build on previous \
findings.
`;
}

module.exports = {
  TOOLS,
  getGuideText,
  safeTaskId,
  safeModel,
};
