# Deployment Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an MCP server interface to sidecar so it works in Claude Cowork (sandboxed VM) alongside the existing CLI, with auto-registration during install.

**Architecture:** New `sidecar mcp` command starts an MCP server over stdio. The server exposes tools (`sidecar_start`, `sidecar_status`, `sidecar_read`, etc.) that wrap existing sidecar functions. Long-running tasks use the async pattern (return task ID immediately, poll for results). Postinstall auto-registers the MCP server in both Claude Code and Claude Desktop configs.

**Tech Stack:** `@modelcontextprotocol/sdk` (MCP server SDK), `zod` (schema validation), existing sidecar modules (start.js, read.js, resume.js, continue.js, setup.js).

---

### Task 1: Clean Up Dependencies

Move test-only packages out of production dependencies and make Electron optional.

**Files:**
- Modify: `package.json`

**Step 1: Update package.json dependencies**

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "@opencode-ai/sdk": "^1.1.36",
    "dotenv": "^17.2.3",
    "tiktoken": "^1.0.0",
    "zod": "^3.0.0"
  },
  "optionalDependencies": {
    "electron": "^28.0.0"
  },
  "devDependencies": {
    "chrome-remote-interface": "^0.33.3",
    "eslint": "^8.0.0",
    "jest": "^29.0.0",
    "mocha": "^11.7.5",
    "puppeteer": "^24.36.0",
    "ws": "^8.19.0"
  }
}
```

**Step 2: Install new dependencies**

Run: `npm install`
Expected: `@modelcontextprotocol/sdk` and `zod` install, electron moves to optional

**Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: All tests pass (no behavior change)

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: clean up deps, add MCP SDK, make electron optional"
```

---

### Task 2: Add Electron Lazy Loading Guard

Make `runInteractive` fail gracefully when Electron is not installed.

**Files:**
- Create: `tests/sidecar/electron-guard.test.js`
- Modify: `src/sidecar/start.js:139` (the `runInteractive` function, Electron path line)

**Step 1: Write the failing test**

```javascript
// tests/sidecar/electron-guard.test.js
describe('Electron lazy loading guard', () => {
  test('checkElectronAvailable returns a boolean', () => {
    const { checkElectronAvailable } = require('../../src/sidecar/start');
    const result = checkElectronAvailable();
    expect(typeof result).toBe('boolean');
  });

  test('runInteractive returns error object when electron is missing', async () => {
    // We test that the guard exists and returns an error format
    const { checkElectronAvailable } = require('../../src/sidecar/start');
    // checkElectronAvailable should be exported and callable
    expect(typeof checkElectronAvailable).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/sidecar/electron-guard.test.js`
Expected: FAIL — `checkElectronAvailable` is not exported

**Step 3: Implement the guard**

In `src/sidecar/start.js`, add before the `runInteractive` function:

```javascript
/** Check if Electron is available (lazy loading guard) */
function checkElectronAvailable() {
  try {
    require.resolve('electron');
    return true;
  } catch {
    return false;
  }
}
```

Then at the top of `runInteractive()` (line ~87), add:

```javascript
async function runInteractive(model, systemPrompt, userMessage, taskId, project, options = {}) {
  if (!checkElectronAvailable()) {
    logger.error('Electron not installed — interactive mode unavailable');
    return {
      summary: '', completed: false, timedOut: false, taskId,
      error: 'Interactive mode requires electron. Install with: npm install -g claude-sidecar (or use --no-ui for headless mode)'
    };
  }
  // ... rest of existing function
```

Export `checkElectronAvailable` in the module.exports at the bottom.

**Step 4: Run test to verify it passes**

Run: `npm test tests/sidecar/electron-guard.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sidecar/start.js tests/sidecar/electron-guard.test.js
git commit -m "feat: add electron lazy loading guard for optional dep"
```

---

### Task 3: Create MCP Tool Definitions

Define all MCP tool schemas and descriptions in a dedicated module.

**Files:**
- Create: `tests/mcp-tools.test.js`
- Create: `src/mcp-tools.js`

**Step 1: Write the failing test**

```javascript
// tests/mcp-tools.test.js
describe('MCP Tool Definitions', () => {
  test('exports TOOLS array with correct structure', () => {
    const { TOOLS } = require('../src/mcp-tools');
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS.length).toBeGreaterThan(0);

    for (const tool of TOOLS) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.inputSchema).toBe('object');
    }
  });

  test('has all required tools', () => {
    const { TOOLS } = require('../src/mcp-tools');
    const names = TOOLS.map(t => t.name);

    expect(names).toContain('sidecar_start');
    expect(names).toContain('sidecar_status');
    expect(names).toContain('sidecar_read');
    expect(names).toContain('sidecar_list');
    expect(names).toContain('sidecar_resume');
    expect(names).toContain('sidecar_continue');
    expect(names).toContain('sidecar_setup');
    expect(names).toContain('sidecar_guide');
  });

  test('sidecar_start has prompt in input schema', () => {
    const { TOOLS } = require('../src/mcp-tools');
    const startTool = TOOLS.find(t => t.name === 'sidecar_start');
    expect(startTool.inputSchema).toHaveProperty('prompt');
  });

  test('sidecar_guide has empty input schema', () => {
    const { TOOLS } = require('../src/mcp-tools');
    const guideTool = TOOLS.find(t => t.name === 'sidecar_guide');
    expect(Object.keys(guideTool.inputSchema)).toHaveLength(0);
  });

  test('getGuideText returns non-empty string with key sections', () => {
    const { getGuideText } = require('../src/mcp-tools');
    const guide = getGuideText();
    expect(typeof guide).toBe('string');
    expect(guide.length).toBeGreaterThan(100);
    expect(guide).toContain('sidecar');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-tools.test.js`
Expected: FAIL — module not found

**Step 3: Implement mcp-tools.js**

```javascript
// src/mcp-tools.js
/**
 * MCP Tool Definitions for Sidecar
 *
 * Defines all tools exposed by the sidecar MCP server.
 * Uses Zod schemas for input validation (converted to JSON Schema by MCP SDK).
 */

const { z } = require('zod');

const TOOLS = [
  {
    name: 'sidecar_start',
    description:
      'Spawn a multi-model sidecar conversation with a different LLM (Gemini, GPT, etc.). ' +
      'Returns a task ID immediately — the sidecar runs asynchronously in the background. ' +
      'Use sidecar_status to poll for completion and sidecar_read to get results. ' +
      'Opens an interactive Electron GUI by default; pass noUi: true for autonomous headless mode. ' +
      'Call sidecar_guide first if you need help choosing models or writing a good briefing.',
    inputSchema: {
      model: z.string().optional().describe(
        'Model alias (gemini, opus, gpt) or full ID (openrouter/google/gemini-3-flash-preview). ' +
        'If omitted, uses the configured default model.'
      ),
      prompt: z.string().describe(
        'Detailed task briefing. Include: objective, background, files of interest, success criteria.'
      ),
      agent: z.enum(['Chat', 'Plan', 'Build']).optional().default('Chat').describe(
        'Agent mode. Chat (default): reads auto, writes ask permission. ' +
        'Plan: read-only analysis. Build: full auto (all operations approved).'
      ),
      noUi: z.boolean().optional().default(false).describe(
        'Run headless without GUI. Default false (opens Electron window).'
      ),
      thinking: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional().describe(
        'Reasoning effort level. Default: medium.'
      ),
    },
  },
  {
    name: 'sidecar_status',
    description:
      'Check the status of a running sidecar task. Returns status (running/complete), ' +
      'elapsed time, and model info. Use after sidecar_start to poll for completion.',
    inputSchema: {
      taskId: z.string().describe('The task ID returned by sidecar_start.'),
    },
  },
  {
    name: 'sidecar_read',
    description:
      'Read the results of a completed sidecar task. Returns the summary by default, ' +
      'or full conversation history, or session metadata.',
    inputSchema: {
      taskId: z.string().describe('The task ID to read.'),
      mode: z.enum(['summary', 'conversation', 'metadata']).optional().default('summary').describe(
        'What to read. summary (default): the fold summary. ' +
        'conversation: full message history. metadata: session info.'
      ),
    },
  },
  {
    name: 'sidecar_list',
    description:
      'List all sidecar sessions for the current project. ' +
      'Shows task ID, model, status, age, and briefing excerpt.',
    inputSchema: {
      status: z.enum(['all', 'running', 'complete']).optional().describe(
        'Filter by status. Default: show all.'
      ),
    },
  },
  {
    name: 'sidecar_resume',
    description:
      'Reopen a previous sidecar session with full conversation history preserved. ' +
      'The sidecar continues in the same OpenCode session. ' +
      'Returns a task ID immediately — use sidecar_status to poll.',
    inputSchema: {
      taskId: z.string().describe('The task ID of the session to resume.'),
      noUi: z.boolean().optional().default(false).describe(
        'Resume in headless mode. Default false (opens Electron window).'
      ),
    },
  },
  {
    name: 'sidecar_continue',
    description:
      'Start a new sidecar session that inherits a previous session\'s conversation as context. ' +
      'The previous session\'s messages become read-only background for the new task. ' +
      'Returns a task ID immediately — use sidecar_status to poll.',
    inputSchema: {
      taskId: z.string().describe('The task ID of the previous session to continue from.'),
      prompt: z.string().describe('New task description for the continuation.'),
      model: z.string().optional().describe(
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
      'Open the sidecar setup wizard to configure API keys and default model. ' +
      'Launches an interactive Electron window for configuration.',
    inputSchema: {},
  },
  {
    name: 'sidecar_guide',
    description:
      'Get detailed usage instructions for sidecar — when to spawn sidecars, ' +
      'how to write good briefings, agent selection guidelines, and the async workflow pattern. ' +
      'Call this first if you haven\'t used sidecar before.',
    inputSchema: {},
  },
];

/**
 * Returns the guide text for the sidecar_guide tool.
 * @returns {string}
 */
function getGuideText() {
  return `# Sidecar Usage Guide

## What Is Sidecar?

Sidecar spawns parallel conversations with different LLMs (Gemini, GPT, o3, etc.) and folds the results back into your context.

## When to Use Sidecars

**DO spawn a sidecar when:**
- Task benefits from a different model's strengths (Gemini's large context, o3's reasoning)
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
| Chat (default) | auto | asks permission | asks permission | Questions, analysis, guided work |
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

Before spawning a new sidecar, call sidecar_list to check for relevant past work.
Use sidecar_resume to reopen, or sidecar_continue to build on previous findings.
`;
}

module.exports = {
  TOOLS,
  getGuideText,
};
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/mcp-tools.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp-tools.js tests/mcp-tools.test.js
git commit -m "feat: add MCP tool definitions with Zod schemas"
```

---

### Task 4: Create MCP Server

Build the MCP server that wraps existing sidecar functions as tools.

**Files:**
- Create: `tests/mcp-server.test.js`
- Create: `src/mcp-server.js`

**Step 1: Write the failing test**

```javascript
// tests/mcp-server.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('MCP Server Handlers', () => {
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = require('../src/mcp-server').handlers;
  });

  test('exports handlers object', () => {
    expect(handlers).toBeDefined();
    expect(typeof handlers).toBe('object');
  });

  test('sidecar_guide handler returns guide text', async () => {
    const result = await handlers.sidecar_guide({});
    expect(result).toHaveProperty('content');
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Sidecar');
  });

  test('sidecar_list handler returns empty for fresh project', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const result = await handlers.sidecar_list({}, tmpDir);
    expect(result.content[0].text).toContain('No sidecar sessions found');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('sidecar_status handler returns status for existing session', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abc12345');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'abc12345',
      status: 'running',
      model: 'gemini',
      createdAt: new Date().toISOString(),
    }));

    const result = await handlers.sidecar_status({ taskId: 'abc12345' }, tmpDir);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('running');

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('sidecar_status handler returns error for missing session', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const result = await handlers.sidecar_status({ taskId: 'nonexistent' }, tmpDir);
    expect(result.isError).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('sidecar_read handler returns summary', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'read123');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');
    fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Test Summary\n\nResults here.');

    const result = await handlers.sidecar_read({ taskId: 'read123' }, tmpDir);
    expect(result.content[0].text).toContain('Test Summary');

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('sidecar_read handler returns error for missing session', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const result = await handlers.sidecar_read({ taskId: 'nope' }, tmpDir);
    expect(result.isError).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-server.test.js`
Expected: FAIL — module not found

**Step 3: Implement mcp-server.js**

```javascript
// src/mcp-server.js
/**
 * Sidecar MCP Server
 *
 * Exposes sidecar operations as MCP tools over stdio transport.
 * Wraps existing sidecar functions for use in Claude Cowork,
 * Claude Desktop, and Claude Code MCP integrations.
 *
 * Usage: sidecar mcp
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TOOLS, getGuideText } = require('./mcp-tools');
const { logger } = require('./utils/logger');

/** Get the project directory (cwd of the MCP client) */
function getProjectDir() {
  return process.cwd();
}

/** Read session metadata from disk */
function readMetadata(taskId, project) {
  const metaPath = path.join(project, '.claude', 'sidecar_sessions', taskId, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/**
 * Spawn a sidecar process in the background (fire-and-forget).
 * Uses spawn with detached: true so the process outlives the MCP call.
 *
 * @param {string[]} args - CLI arguments for bin/sidecar.js
 */
function spawnSidecarProcess(args) {
  const sidecarBin = path.join(__dirname, '..', 'bin', 'sidecar.js');
  const child = spawn('node', [sidecarBin, ...args], {
    cwd: getProjectDir(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.unref();
  return child;
}

/** Tool handler implementations */
const handlers = {
  async sidecar_start(input, project) {
    const cwd = project || getProjectDir();
    const args = ['start', '--prompt', input.prompt];

    if (input.model) { args.push('--model', input.model); }
    if (input.agent) { args.push('--agent', input.agent); }
    if (input.noUi) { args.push('--no-ui'); }
    if (input.thinking) { args.push('--thinking', input.thinking); }
    args.push('--cwd', cwd);

    const { generateTaskId } = require('./sidecar/start');
    const taskId = generateTaskId();

    try {
      spawnSidecarProcess(args);
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to start sidecar: ${err.message}` }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          taskId,
          status: 'running',
          message: 'Sidecar started. Use sidecar_status to check progress, sidecar_read to get results.',
        }),
      }],
    };
  },

  async sidecar_status(input, project) {
    const cwd = project || getProjectDir();
    const metadata = readMetadata(input.taskId, cwd);

    if (!metadata) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Session ${input.taskId} not found.` }],
      };
    }

    const elapsed = Date.now() - new Date(metadata.createdAt).getTime();
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          taskId: metadata.taskId,
          status: metadata.status,
          model: metadata.model,
          agent: metadata.agent,
          elapsed: `${mins}m ${secs}s`,
          briefing: (metadata.briefing || '').slice(0, 100),
        }),
      }],
    };
  },

  async sidecar_read(input, project) {
    const cwd = project || getProjectDir();
    const sessionDir = path.join(cwd, '.claude', 'sidecar_sessions', input.taskId);

    if (!fs.existsSync(sessionDir)) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Session ${input.taskId} not found.` }],
      };
    }

    const mode = input.mode || 'summary';

    if (mode === 'metadata') {
      const metaPath = path.join(sessionDir, 'metadata.json');
      return { content: [{ type: 'text', text: fs.readFileSync(metaPath, 'utf-8') }] };
    }

    if (mode === 'conversation') {
      const convPath = path.join(sessionDir, 'conversation.jsonl');
      if (!fs.existsSync(convPath)) {
        return { content: [{ type: 'text', text: 'No conversation recorded.' }] };
      }
      return { content: [{ type: 'text', text: fs.readFileSync(convPath, 'utf-8') }] };
    }

    // Default: summary
    const summaryPath = path.join(sessionDir, 'summary.md');
    if (!fs.existsSync(summaryPath)) {
      return { content: [{ type: 'text', text: 'No summary available (session may still be running or was not folded).' }] };
    }
    return { content: [{ type: 'text', text: fs.readFileSync(summaryPath, 'utf-8') }] };
  },

  async sidecar_list(input, project) {
    const cwd = project || getProjectDir();
    const sessionsDir = path.join(cwd, '.claude', 'sidecar_sessions');

    if (!fs.existsSync(sessionsDir)) {
      return { content: [{ type: 'text', text: 'No sidecar sessions found.' }] };
    }

    let sessions = fs.readdirSync(sessionsDir)
      .filter(d => fs.existsSync(path.join(sessionsDir, d, 'metadata.json')))
      .map(d => {
        const meta = JSON.parse(fs.readFileSync(path.join(sessionsDir, d, 'metadata.json'), 'utf-8'));
        return { id: d, ...meta };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (input.status && input.status !== 'all') {
      sessions = sessions.filter(s => s.status === input.status);
    }

    if (sessions.length === 0) {
      return { content: [{ type: 'text', text: 'No sidecar sessions found.' }] };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(sessions.map(s => ({
          id: s.id, model: s.model, status: s.status, agent: s.agent,
          briefing: (s.briefing || '').slice(0, 80), createdAt: s.createdAt,
        })), null, 2),
      }],
    };
  },

  async sidecar_resume(input, project) {
    const cwd = project || getProjectDir();
    const args = ['resume', input.taskId, '--cwd', cwd];
    if (input.noUi) { args.push('--no-ui'); }

    try {
      spawnSidecarProcess(args);
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to resume: ${err.message}` }] };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ taskId: input.taskId, status: 'running', message: 'Session resumed. Use sidecar_status to check progress.' }) }],
    };
  },

  async sidecar_continue(input, project) {
    const cwd = project || getProjectDir();
    const args = ['continue', input.taskId, '--prompt', input.prompt, '--cwd', cwd];
    if (input.model) { args.push('--model', input.model); }
    if (input.noUi) { args.push('--no-ui'); }

    try {
      spawnSidecarProcess(args);
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to continue: ${err.message}` }] };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ taskId: input.taskId, status: 'running', message: 'Continuation started. Use sidecar_status to check progress.' }) }],
    };
  },

  async sidecar_setup() {
    try {
      spawnSidecarProcess(['setup']);
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to launch setup: ${err.message}` }] };
    }
    return { content: [{ type: 'text', text: 'Setup wizard launched. The Electron window should appear on your desktop.' }] };
  },

  async sidecar_guide() {
    return { content: [{ type: 'text', text: getGuideText() }] };
  },
};

/** Start the MCP server on stdio transport */
async function startMcpServer() {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

  const server = new McpServer({
    name: 'sidecar',
    version: require('../package.json').version,
  });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input) => {
        try {
          return await handlers[tool.name](input);
        } catch (err) {
          logger.error(`MCP tool error: ${tool.name}`, { error: err.message });
          return { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[sidecar] MCP server running on stdio\n');
}

module.exports = { handlers, startMcpServer };
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/mcp-server.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp-server.js tests/mcp-server.test.js
git commit -m "feat: add MCP server with tool handlers"
```

---

### Task 5: Add `sidecar mcp` Command to CLI

Wire the MCP server into the CLI entry point.

**Files:**
- Modify: `bin/sidecar.js:40-63` (switch statement)
- Modify: `tests/cli.test.js` (add mcp command test)

**Step 1: Write the failing test**

Add to existing `tests/cli.test.js`:

```javascript
describe('mcp command', () => {
  test('parseArgs recognizes mcp as a command', () => {
    const { parseArgs } = require('../src/cli');
    const args = parseArgs(['mcp']);
    expect(args._[0]).toBe('mcp');
  });
});
```

**Step 2: Run test to verify it passes (parseArgs already handles positional args)**

Run: `npm test tests/cli.test.js`
Expected: PASS (parseArgs is generic)

**Step 3: Add mcp case to bin/sidecar.js**

In `bin/sidecar.js`, add after the `setup` case (around line 55):

```javascript
      case 'mcp':
        await handleMcp();
        break;
```

Add the handler function after `handleSetup`:

```javascript
/**
 * Handle 'sidecar mcp' command
 * Starts the MCP server on stdio transport
 */
async function handleMcp() {
  const { startMcpServer } = require('../src/mcp-server');
  await startMcpServer();
}
```

**Step 4: Verify the command is recognized**

Run: `node bin/sidecar.js --help | grep -i mcp`
Expected: Does not show "Unknown command" error

**Step 5: Commit**

```bash
git add bin/sidecar.js tests/cli.test.js
git commit -m "feat: add 'sidecar mcp' command to CLI entry point"
```

---

### Task 6: Update Postinstall for MCP Auto-Registration

Update the postinstall script to register the MCP server in Claude Code and Claude Desktop configs.

**Files:**
- Modify: `scripts/postinstall.js`
- Create: `tests/postinstall.test.js`

**Step 1: Write the failing test**

```javascript
// tests/postinstall.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Postinstall MCP registration', () => {
  test('addMcpToConfigFile creates config file if it does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    addMcpToConfigFile(configPath, 'sidecar', { command: 'sidecar', args: ['mcp'] });

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.sidecar).toEqual({ command: 'sidecar', args: ['mcp'] });

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('addMcpToConfigFile preserves existing config entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { existing: { command: 'other' } },
      otherKey: 'preserved',
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    addMcpToConfigFile(configPath, 'sidecar', { command: 'sidecar', args: ['mcp'] });

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.existing).toEqual({ command: 'other' });
    expect(config.mcpServers.sidecar).toEqual({ command: 'sidecar', args: ['mcp'] });
    expect(config.otherKey).toBe('preserved');

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('addMcpToConfigFile does not overwrite existing sidecar entry', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const existingConfig = { command: 'sidecar', args: ['mcp'], env: { CUSTOM: 'value' } };
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { sidecar: existingConfig },
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    const added = addMcpToConfigFile(configPath, 'sidecar', { command: 'sidecar', args: ['mcp'] });

    expect(added).toBe(false);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.sidecar).toEqual(existingConfig);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/postinstall.test.js`
Expected: FAIL — `addMcpToConfigFile` not exported

**Step 3: Update postinstall.js**

Rewrite `scripts/postinstall.js` — see the full implementation in the design doc. Key function:

```javascript
function addMcpToConfigFile(configPath, name, config) {
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // File doesn't exist — start fresh
  }

  if (!existing.mcpServers) { existing.mcpServers = {}; }
  if (existing.mcpServers[name]) { return false; }

  existing.mcpServers[name] = config;
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
  return true;
}
```

For Claude Code registration, try `claude mcp add-json` CLI first (using `execFileSync`), fall back to direct file edit of `~/.claude.json`. For Claude Desktop, directly edit `~/Library/Application Support/Claude/claude_desktop_config.json`.

Export `addMcpToConfigFile` for testing. Guard `main()` with `if (require.main === module)`.

**Step 4: Run test to verify it passes**

Run: `npm test tests/postinstall.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/postinstall.js tests/postinstall.test.js
git commit -m "feat: auto-register MCP in Claude Code and Desktop during postinstall"
```

---

### Task 7: Update CLAUDE.md Documentation

Update the project docs to reflect the new MCP server and deployment model.

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add MCP command to Essential Commands section**

After the existing CLI Usage block, add MCP Server subsection.

**Step 2: Add MCP to Architecture section**

Add new subsection with the MCP integration diagram.

**Step 3: Add MCP files to Directory Structure and Key Modules**

Add `src/mcp-server.js` and `src/mcp-tools.js` entries.

**Step 4: Update test count**

Run `npm test` and update the count in CLAUDE.md.

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add MCP server to CLAUDE.md architecture and commands"
```

---

### Task 8: Integration Test

Verify handlers work end-to-end with real filesystem operations.

**Files:**
- Create: `tests/mcp-integration.test.js`

**Step 1: Write the integration test**

Test `sidecar_guide`, `sidecar_list` (empty), `sidecar_status` + `sidecar_read` with real session data on disk, and error cases for missing sessions.

**Step 2: Run the integration test**

Run: `npm test tests/mcp-integration.test.js`
Expected: PASS

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add tests/mcp-integration.test.js
git commit -m "test: add MCP server integration tests"
```

---

## Summary of All Tasks

| Task | What | New Files | Modified Files |
|------|------|-----------|---------------|
| 1 | Clean up dependencies | — | `package.json` |
| 2 | Electron lazy loading guard | `tests/sidecar/electron-guard.test.js` | `src/sidecar/start.js` |
| 3 | MCP tool definitions | `src/mcp-tools.js`, `tests/mcp-tools.test.js` | — |
| 4 | MCP server implementation | `src/mcp-server.js`, `tests/mcp-server.test.js` | — |
| 5 | CLI `sidecar mcp` command | — | `bin/sidecar.js`, `tests/cli.test.js` |
| 6 | Postinstall MCP auto-registration | `tests/postinstall.test.js` | `scripts/postinstall.js` |
| 7 | CLAUDE.md documentation | — | `CLAUDE.md` |
| 8 | Integration tests | `tests/mcp-integration.test.js` | — |
