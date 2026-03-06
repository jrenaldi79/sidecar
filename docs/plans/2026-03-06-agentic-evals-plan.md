# Agentic Eval System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an eval system that spawns real Claude Code with the sidecar MCP server, runs tasks in sandbox projects, and grades decision-making quality with programmatic checks + LLM-as-judge.

**Architecture:** Node.js eval runner spawns Claude Code CLI with `--output-format stream-json` and sidecar MCP config. Each eval copies a fixture project to `/tmp`, runs Claude against it, parses the stream-json transcript, checks programmatic criteria against the transcript + sandbox filesystem, then optionally sends transcript to Haiku for quality scoring.

**Tech Stack:** Node.js, Claude Code CLI (`claude -p`), stream-json parsing, Anthropic SDK (for LLM-as-judge)

---

### Task 1: Scaffold evals directory and fixtures

**Files:**
- Create: `evals/eval_tasks.json`
- Create: `evals/fixtures/buggy-auth-app/package.json`
- Create: `evals/fixtures/buggy-auth-app/src/auth.js`
- Create: `evals/fixtures/buggy-auth-app/src/server.js`
- Create: `evals/fixtures/todo-api/package.json`
- Create: `evals/fixtures/todo-api/src/routes/todos.js`
- Create: `evals/fixtures/todo-api/src/app.js`
- Create: `evals/fixtures/research-task/package.json`
- Create: `evals/fixtures/research-task/README.md`
- Modify: `.gitignore` (add `evals/workspace/`)

**Step 1: Create fixture — buggy-auth-app**

`evals/fixtures/buggy-auth-app/package.json`:
```json
{
  "name": "buggy-auth-app",
  "version": "1.0.0",
  "description": "Test app with an auth bug for sidecar eval"
}
```

`evals/fixtures/buggy-auth-app/src/server.js`:
```js
const express = require('express');
const { authenticate, refreshToken } = require('./auth');

const app = express();
app.use(express.json());

app.post('/login', async (req, res) => {
  try {
    const token = await authenticate(req.body.username, req.body.password);
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/protected', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) { return res.status(401).json({ error: 'No token' }); }
  const token = authHeader.replace('Bearer ', '');
  try {
    const user = verifyToken(token);
    res.json({ user });
  } catch (err) {
    // BUG: When token is expired, we try to refresh but don't await it
    // This causes intermittent 401 errors because the refresh hasn't completed
    const newToken = refreshToken(token);  // missing await
    if (newToken) {
      res.json({ user: 'refreshed', token: newToken });
    } else {
      res.status(401).json({ error: 'Token expired' });
    }
  }
});

module.exports = app;
```

`evals/fixtures/buggy-auth-app/src/auth.js`:
```js
const tokens = new Map();
let tokenCounter = 0;

async function authenticate(username, password) {
  // Simulate async auth check
  await new Promise(r => setTimeout(r, 10));
  if (!username || !password) {
    throw new Error('Invalid credentials');
  }
  const token = `token_${++tokenCounter}_${Date.now()}`;
  tokens.set(token, { username, expiresAt: Date.now() + 3600000 });
  return token;
}

function verifyToken(token) {
  const session = tokens.get(token);
  if (!session) { throw new Error('Invalid token'); }
  if (session.expiresAt < Date.now()) { throw new Error('Token expired'); }
  return session.username;
}

// BUG: This function is async but callers don't always await it
async function refreshToken(oldToken) {
  const session = tokens.get(oldToken);
  if (!session) { return null; }
  // Simulate async token refresh
  await new Promise(r => setTimeout(r, 50));
  const newToken = `token_${++tokenCounter}_${Date.now()}`;
  tokens.set(newToken, { username: session.username, expiresAt: Date.now() + 3600000 });
  tokens.delete(oldToken);
  return newToken;
}

module.exports = { authenticate, verifyToken, refreshToken };
```

**Step 2: Create fixture — todo-api**

`evals/fixtures/todo-api/package.json`:
```json
{
  "name": "todo-api",
  "version": "1.0.0",
  "description": "Simple CRUD API with no tests"
}
```

`evals/fixtures/todo-api/src/app.js`:
```js
const express = require('express');
const todosRouter = require('./routes/todos');

const app = express();
app.use(express.json());
app.use('/todos', todosRouter);

module.exports = app;
```

`evals/fixtures/todo-api/src/routes/todos.js`:
```js
const express = require('express');
const router = express.Router();

let todos = [];
let nextId = 1;

router.get('/', (req, res) => {
  res.json(todos);
});

router.get('/:id', (req, res) => {
  const todo = todos.find(t => t.id === parseInt(req.params.id));
  if (!todo) { return res.status(404).json({ error: 'Not found' }); }
  res.json(todo);
});

router.post('/', (req, res) => {
  if (!req.body.title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const todo = { id: nextId++, title: req.body.title, completed: false };
  todos.push(todo);
  res.status(201).json(todo);
});

router.put('/:id', (req, res) => {
  const todo = todos.find(t => t.id === parseInt(req.params.id));
  if (!todo) { return res.status(404).json({ error: 'Not found' }); }
  if (req.body.title !== undefined) { todo.title = req.body.title; }
  if (req.body.completed !== undefined) { todo.completed = req.body.completed; }
  res.json(todo);
});

router.delete('/:id', (req, res) => {
  const idx = todos.findIndex(t => t.id === parseInt(req.params.id));
  if (idx === -1) { return res.status(404).json({ error: 'Not found' }); }
  todos.splice(idx, 1);
  res.status(204).send();
});

module.exports = router;
```

**Step 3: Create fixture — research-task**

`evals/fixtures/research-task/package.json`:
```json
{
  "name": "research-task",
  "version": "1.0.0",
  "description": "Empty project for research eval"
}
```

`evals/fixtures/research-task/README.md`:
```markdown
# Research Project

This project needs a design document for JWT token rotation best practices.
```

**Step 4: Create eval_tasks.json**

`evals/eval_tasks.json`:
```json
[
  {
    "id": 1,
    "name": "Debug Auth Bug",
    "description": "Claude should use sidecar to find and fix a known auth bug",
    "fixture": "buggy-auth-app",
    "prompt": "There's a bug in this project's authentication flow causing intermittent 401 errors on the /protected endpoint. The token refresh seems to fail sometimes. Use sidecar to have a different model analyze the auth code in src/auth.js and src/server.js, find the root cause, and suggest a fix. Then apply the fix yourself.",
    "max_budget_usd": 2.0,
    "model": "sonnet",
    "success_criteria": {
      "programmatic": [
        {"type": "tool_called", "tool": "sidecar_start"},
        {"type": "tool_called", "tool": "sidecar_read"},
        {"type": "file_changed", "path": "src/server.js"}
      ],
      "llm_judge": {
        "rubric": [
          "Did the LLM choose an appropriate model for code analysis? (1-5)",
          "Was the briefing detailed enough — mentioning the specific files and the 401 symptom? (1-5)",
          "Did the LLM act on the sidecar's findings to fix the missing await? (1-5)",
          "Did the LLM choose an appropriate agent mode for the task? (1-5)"
        ],
        "pass_threshold": 3.5
      }
    }
  },
  {
    "id": 2,
    "name": "Generate Tests",
    "description": "Claude should use sidecar to generate tests for a CRUD API",
    "fixture": "todo-api",
    "prompt": "This todo API in src/routes/todos.js has no tests. Use sidecar to have another model generate comprehensive tests for all the CRUD endpoints. The tests should be written to a tests/ directory using a standard testing framework.",
    "max_budget_usd": 2.0,
    "model": "sonnet",
    "success_criteria": {
      "programmatic": [
        {"type": "tool_called", "tool": "sidecar_start"},
        {"type": "tool_called", "tool": "sidecar_read"},
        {"type": "file_created", "pattern": "tests/.*\\.js$"}
      ],
      "llm_judge": {
        "rubric": [
          "Did the LLM choose an appropriate model for test generation? (1-5)",
          "Was the briefing specific about which files to test and what framework to use? (1-5)",
          "Did the LLM choose Build agent or headless mode for autonomous work? (1-5)",
          "Are the generated test files syntactically valid and cover multiple endpoints? (1-5)"
        ],
        "pass_threshold": 3.5
      }
    }
  },
  {
    "id": 3,
    "name": "Research and Document",
    "description": "Claude should use sidecar to research and create a design document",
    "fixture": "research-task",
    "prompt": "This project needs a design document about JWT token rotation best practices. Use sidecar to have another model research current best practices for JWT token rotation, refresh token strategies, and security considerations. Then create a docs/jwt-rotation-design.md file with the findings.",
    "max_budget_usd": 2.0,
    "model": "sonnet",
    "success_criteria": {
      "programmatic": [
        {"type": "tool_called", "tool": "sidecar_start"},
        {"type": "tool_called", "tool": "sidecar_read"},
        {"type": "file_created", "pattern": "docs/.*\\.md$"}
      ],
      "llm_judge": {
        "rubric": [
          "Did the LLM choose a model well-suited for research tasks? (1-5)",
          "Was the briefing specific about what to research and what format to produce? (1-5)",
          "Does the created document contain substantive, accurate information about JWT rotation? (1-5)",
          "Did the LLM integrate the sidecar's research findings into the final document? (1-5)"
        ],
        "pass_threshold": 3.5
      }
    }
  }
]
```

**Step 5: Add workspace to .gitignore**

Append to `.gitignore`:
```
evals/workspace/
```

**Step 6: Commit**

```bash
git add evals/ .gitignore
git commit -m "feat(evals): scaffold fixtures and eval task definitions"
```

---

### Task 2: Implement transcript_parser.js

**Files:**
- Create: `evals/transcript_parser.js`
- Create: `evals/tests/transcript_parser.test.js`

**Step 1: Write failing tests**

`evals/tests/transcript_parser.test.js`:
```js
const { parseTranscript } = require('../transcript_parser');

describe('parseTranscript', () => {
  test('extracts MCP tool calls from stream-json lines', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"sidecar_start","input":{"model":"gemini","prompt":"test","agent":"Build"}}]}}',
      '{"type":"result","subtype":"tool_result","tool_use_id":"1","content":"{\\"taskId\\":\\"abc123\\"}"}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.toolCalls).toHaveLength(1);
    expect(transcript.toolCalls[0].tool).toBe('sidecar_start');
    expect(transcript.toolCalls[0].params.model).toBe('gemini');
    expect(transcript.toolCalls[0].result).toContain('abc123');
  });

  test('extracts token usage from usage events', () => {
    const lines = [
      '{"type":"usage","usage":{"input_tokens":1000,"output_tokens":500}}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.inputTokens).toBe(1000);
    expect(transcript.outputTokens).toBe(500);
  });

  test('captures errors from tool results', () => {
    const lines = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"sidecar_status","input":{"taskId":"bad"}}]}}',
      '{"type":"result","subtype":"tool_result","tool_use_id":"1","content":"Error: Session bad not found.","is_error":true}',
    ];
    const transcript = parseTranscript(lines);
    expect(transcript.errors).toHaveLength(1);
    expect(transcript.errors[0]).toContain('not found');
  });

  test('handles empty input', () => {
    const transcript = parseTranscript([]);
    expect(transcript.toolCalls).toEqual([]);
    expect(transcript.errors).toEqual([]);
    expect(transcript.inputTokens).toBe(0);
    expect(transcript.outputTokens).toBe(0);
  });

  test('skips malformed JSON lines gracefully', () => {
    const lines = ['not json', '{"type":"usage","usage":{"input_tokens":10,"output_tokens":5}}'];
    const transcript = parseTranscript(lines);
    expect(transcript.inputTokens).toBe(10);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest evals/tests/transcript_parser.test.js`
Expected: FAIL — module not found

**Step 3: Implement transcript_parser.js**

`evals/transcript_parser.js`:
```js
/**
 * Parse Claude Code stream-json output into structured transcript.
 * @param {string[]} lines - Raw stream-json lines
 * @returns {{ toolCalls: Array, errors: string[], inputTokens: number, outputTokens: number }}
 */
function parseTranscript(lines) {
  const toolCalls = [];
  const errors = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let pendingToolUse = null;

  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }

    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_use') {
          pendingToolUse = {
            tool: block.name,
            params: block.input || {},
            toolUseId: block.id,
            result: null,
          };
        }
      }
    }

    if (event.type === 'result' && event.subtype === 'tool_result') {
      const resultText = typeof event.content === 'string'
        ? event.content
        : JSON.stringify(event.content);

      if (event.is_error) {
        errors.push(resultText);
      }

      if (pendingToolUse) {
        pendingToolUse.result = resultText;
        toolCalls.push(pendingToolUse);
        pendingToolUse = null;
      }
    }

    if (event.type === 'usage' && event.usage) {
      inputTokens += event.usage.input_tokens || 0;
      outputTokens += event.usage.output_tokens || 0;
    }
  }

  return { toolCalls, errors, inputTokens, outputTokens };
}

module.exports = { parseTranscript };
```

**Step 4: Run tests to verify they pass**

Run: `npx jest evals/tests/transcript_parser.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add evals/transcript_parser.js evals/tests/transcript_parser.test.js
git commit -m "feat(evals): implement transcript parser for stream-json"
```

---

### Task 3: Implement evaluator.js

**Files:**
- Create: `evals/evaluator.js`
- Create: `evals/tests/evaluator.test.js`

**Step 1: Write failing tests**

`evals/tests/evaluator.test.js`:
```js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runProgrammaticChecks } = require('../evaluator');

describe('runProgrammaticChecks', () => {
  test('tool_called passes when tool was called', () => {
    const transcript = {
      toolCalls: [{ tool: 'sidecar_start', params: { model: 'gemini' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_called', tool: 'sidecar_start' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('tool_called fails when tool was not called', () => {
    const transcript = { toolCalls: [], errors: [] };
    const criteria = [{ type: 'tool_called', tool: 'sidecar_start' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
  });

  test('tool_param passes when param matches expected value', () => {
    const transcript = {
      toolCalls: [{ tool: 'sidecar_start', params: { agent: 'Build' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_param', tool: 'sidecar_start', param: 'agent', expected: 'Build' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('tool_param_matches passes on regex match', () => {
    const transcript = {
      toolCalls: [{ tool: 'sidecar_start', params: { model: 'openrouter/google/gemini-2.5-flash' }, result: '{}' }],
      errors: [],
    };
    const criteria = [{ type: 'tool_param_matches', tool: 'sidecar_start', param: 'model', pattern: 'gemini' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('file_changed passes when file was modified', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    const filePath = path.join(tmpDir, 'src', 'auth.js');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'modified content');

    // Simulate "changed" by checking file exists and has content
    const criteria = [{ type: 'file_changed', path: 'src/auth.js' }];
    const results = runProgrammaticChecks(criteria, { toolCalls: [], errors: [] }, tmpDir);
    expect(results[0].passed).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('file_created passes when file matching pattern exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    const filePath = path.join(tmpDir, 'tests', 'todo.test.js');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'test content');

    const criteria = [{ type: 'file_created', pattern: 'tests/.*\\.js$' }];
    const results = runProgrammaticChecks(criteria, { toolCalls: [], errors: [] }, tmpDir);
    expect(results[0].passed).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('file_contains passes when file has matching content', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    const filePath = path.join(tmpDir, 'src', 'auth.js');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'const result = await refreshToken(old);');

    const criteria = [{ type: 'file_contains', path: 'src/auth.js', pattern: 'await.*refresh' }];
    const results = runProgrammaticChecks(criteria, { toolCalls: [], errors: [] }, tmpDir);
    expect(results[0].passed).toBe(true);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('no_errors passes when transcript has no errors', () => {
    const transcript = { toolCalls: [], errors: [] };
    const criteria = [{ type: 'no_errors' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(true);
  });

  test('no_errors fails when transcript has errors', () => {
    const transcript = { toolCalls: [], errors: ['Something broke'] };
    const criteria = [{ type: 'no_errors' }];
    const results = runProgrammaticChecks(criteria, transcript, '/tmp');
    expect(results[0].passed).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest evals/tests/evaluator.test.js`
Expected: FAIL

**Step 3: Implement evaluator.js**

`evals/evaluator.js`:
```js
const fs = require('fs');
const path = require('path');

/**
 * Run programmatic checks against transcript and sandbox filesystem.
 * @param {Array} criteria - Programmatic criteria from eval task
 * @param {object} transcript - Parsed transcript
 * @param {string} sandboxDir - Path to sandbox directory
 * @returns {Array<{type: string, passed: boolean, detail: string}>}
 */
function runProgrammaticChecks(criteria, transcript, sandboxDir) {
  return criteria.map(c => {
    switch (c.type) {
      case 'tool_called': {
        const found = transcript.toolCalls.find(tc => tc.tool === c.tool);
        return { type: c.type, tool: c.tool, passed: !!found, detail: found ? `Called` : 'Not called' };
      }
      case 'tool_param': {
        const call = transcript.toolCalls.find(tc => tc.tool === c.tool);
        if (!call) { return { type: c.type, passed: false, detail: `Tool ${c.tool} not called` }; }
        const actual = call.params[c.param];
        const passed = actual === c.expected;
        return { type: c.type, passed, detail: `${c.param}=${actual} (expected ${c.expected})` };
      }
      case 'tool_param_matches': {
        const call = transcript.toolCalls.find(tc => tc.tool === c.tool);
        if (!call) { return { type: c.type, passed: false, detail: `Tool ${c.tool} not called` }; }
        const actual = String(call.params[c.param] || '');
        const passed = new RegExp(c.pattern).test(actual);
        return { type: c.type, passed, detail: `${c.param}="${actual}" vs /${c.pattern}/` };
      }
      case 'file_changed': {
        const filePath = path.join(sandboxDir, c.path);
        const exists = fs.existsSync(filePath);
        return { type: c.type, path: c.path, passed: exists, detail: exists ? 'File exists' : 'File not found' };
      }
      case 'file_created': {
        const regex = new RegExp(c.pattern);
        const found = findFilesRecursive(sandboxDir).some(f => regex.test(f));
        return { type: c.type, pattern: c.pattern, passed: found, detail: found ? 'Matching file found' : 'No match' };
      }
      case 'file_contains': {
        const filePath = path.join(sandboxDir, c.path);
        if (!fs.existsSync(filePath)) {
          return { type: c.type, passed: false, detail: `File ${c.path} not found` };
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const passed = new RegExp(c.pattern).test(content);
        return { type: c.type, path: c.path, passed, detail: passed ? 'Pattern matched' : 'Pattern not found' };
      }
      case 'no_errors': {
        const passed = transcript.errors.length === 0;
        return { type: c.type, passed, detail: passed ? 'No errors' : `${transcript.errors.length} errors` };
      }
      default:
        return { type: c.type, passed: false, detail: `Unknown criterion type: ${c.type}` };
    }
  });
}

/** Recursively find all files relative to baseDir */
function findFilesRecursive(baseDir, prefix = '') {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(path.join(baseDir, prefix), { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(baseDir, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

module.exports = { runProgrammaticChecks, findFilesRecursive };
```

**Step 4: Run tests to verify they pass**

Run: `npx jest evals/tests/evaluator.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add evals/evaluator.js evals/tests/evaluator.test.js
git commit -m "feat(evals): implement programmatic criteria evaluator"
```

---

### Task 4: Implement claude_runner.js

**Files:**
- Create: `evals/claude_runner.js`
- Create: `evals/tests/claude_runner.test.js`

**Step 1: Write failing tests**

`evals/tests/claude_runner.test.js`:
```js
const { buildClaudeCommand, createSandbox, buildMcpConfig } = require('../claude_runner');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('buildMcpConfig', () => {
  test('generates valid MCP config pointing to sidecar binary', () => {
    const config = buildMcpConfig();
    expect(config.mcpServers).toHaveProperty('sidecar');
    expect(config.mcpServers.sidecar.command).toBe('node');
    expect(config.mcpServers.sidecar.args[0]).toContain('sidecar.js');
    expect(config.mcpServers.sidecar.args[1]).toBe('mcp');
  });
});

describe('createSandbox', () => {
  test('copies fixture to temp directory', () => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    // Only run if fixtures exist
    if (!fs.existsSync(path.join(fixturesDir, 'buggy-auth-app'))) {
      return; // skip if fixtures not yet created
    }
    const sandbox = createSandbox('buggy-auth-app');
    expect(fs.existsSync(sandbox)).toBe(true);
    expect(fs.existsSync(path.join(sandbox, 'src', 'auth.js'))).toBe(true);
    fs.rmSync(sandbox, { recursive: true });
  });

  test('throws if fixture does not exist', () => {
    expect(() => createSandbox('nonexistent-fixture')).toThrow('Fixture not found');
  });
});

describe('buildClaudeCommand', () => {
  test('builds command with required flags', () => {
    const cmd = buildClaudeCommand({
      prompt: 'test prompt',
      model: 'sonnet',
      maxBudget: 2.0,
      mcpConfigPath: '/tmp/mcp.json',
      sandboxDir: '/tmp/sandbox',
    });
    expect(cmd.command).toBe('claude');
    expect(cmd.args).toContain('-p');
    expect(cmd.args).toContain('test prompt');
    expect(cmd.args).toContain('--output-format');
    expect(cmd.args).toContain('stream-json');
    expect(cmd.args).toContain('--model');
    expect(cmd.args).toContain('sonnet');
    expect(cmd.args).toContain('--max-budget-usd');
    expect(cmd.args).toContain('2');
    expect(cmd.args).toContain('--mcp-config');
    expect(cmd.args).toContain('/tmp/mcp.json');
    expect(cmd.env.CLAUDECODE).toBe('');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest evals/tests/claude_runner.test.js`
Expected: FAIL

**Step 3: Implement claude_runner.js**

`evals/claude_runner.js`:
```js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EVALS_DIR = __dirname;
const SIDECAR_BIN = path.join(EVALS_DIR, '..', 'bin', 'sidecar.js');
const FIXTURES_DIR = path.join(EVALS_DIR, 'fixtures');

/**
 * Build MCP config JSON for sidecar server.
 * @returns {object} MCP config object
 */
function buildMcpConfig() {
  return {
    mcpServers: {
      sidecar: {
        command: 'node',
        args: [SIDECAR_BIN, 'mcp'],
      },
    },
  };
}

/**
 * Copy fixture to a temp sandbox directory.
 * @param {string} fixtureName - Name of fixture in fixtures/
 * @returns {string} Path to sandbox directory
 */
function createSandbox(fixtureName) {
  const fixtureDir = path.join(FIXTURES_DIR, fixtureName);
  if (!fs.existsSync(fixtureDir)) {
    throw new Error(`Fixture not found: ${fixtureName}`);
  }
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), `sidecar-eval-${fixtureName}-`));
  copyDirRecursive(fixtureDir, sandboxDir);
  return sandboxDir;
}

/** Recursively copy a directory */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Build the Claude CLI command and args.
 * @param {object} opts
 * @returns {{ command: string, args: string[], env: object, cwd: string }}
 */
function buildClaudeCommand({ prompt, model, maxBudget, mcpConfigPath, sandboxDir }) {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--model', model,
    '--max-budget-usd', String(maxBudget),
    '--mcp-config', mcpConfigPath,
    '--verbose',
  ];

  return {
    command: 'claude',
    args,
    env: { ...process.env, CLAUDECODE: '' },
    cwd: sandboxDir,
  };
}

/**
 * Run Claude Code and capture stream-json output.
 * @param {object} opts - Same as buildClaudeCommand
 * @param {number} [timeoutMs=300000] - Timeout in ms (default 5 min)
 * @returns {Promise<{ lines: string[], duration: number, exitCode: number }>}
 */
function runClaude(opts, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const { command, args, env, cwd } = buildClaudeCommand(opts);
    const lines = [];
    const startTime = Date.now();

    const proc = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

    let timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Claude timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    let stdout = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const parts = stdout.split('\n');
      stdout = parts.pop(); // keep incomplete line
      for (const part of parts) {
        if (part.trim()) { lines.push(part.trim()); }
      }
    });

    proc.stderr.on('data', () => {}); // discard stderr

    proc.on('close', (code) => {
      clearTimeout(timeout);
      // flush remaining
      if (stdout.trim()) { lines.push(stdout.trim()); }
      resolve({ lines, duration: Date.now() - startTime, exitCode: code });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

module.exports = { buildMcpConfig, createSandbox, buildClaudeCommand, runClaude };
```

**Step 4: Run tests to verify they pass**

Run: `npx jest evals/tests/claude_runner.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add evals/claude_runner.js evals/tests/claude_runner.test.js
git commit -m "feat(evals): implement Claude Code runner with sandbox management"
```

---

### Task 5: Implement result_writer.js

**Files:**
- Create: `evals/result_writer.js`
- Create: `evals/tests/result_writer.test.js`

**Step 1: Write failing tests**

`evals/tests/result_writer.test.js`:
```js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeResults, formatSummaryLine } = require('../result_writer');

describe('formatSummaryLine', () => {
  test('formats passing eval', () => {
    const line = formatSummaryLine({
      eval_id: 1, eval_name: 'Debug Auth Bug', status: 'PASS', score: 0.85,
      duration_seconds: 92,
      token_usage: { claude: { input_tokens: 12500, output_tokens: 3200 } },
      sidecar_calls: [{ tool: 'sidecar_start', params: { model: 'gemini', agent: 'Build' } }],
    });
    expect(line).toContain('PASS');
    expect(line).toContain('Debug Auth Bug');
    expect(line).toContain('92s');
    expect(line).toContain('15.7k tok');
    expect(line).toContain('gemini');
    expect(line).toContain('Build');
  });

  test('formats failing eval', () => {
    const line = formatSummaryLine({
      eval_id: 3, eval_name: 'Research', status: 'FAIL', score: 0.6,
      duration_seconds: 78,
      token_usage: { claude: { input_tokens: 8000, output_tokens: 3300 } },
      sidecar_calls: [],
    });
    expect(line).toContain('FAIL');
  });
});

describe('writeResults', () => {
  test('writes result.json and transcript files to workspace dir', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-write-'));
    const result = {
      eval_id: 1, eval_name: 'Test', status: 'PASS', score: 1.0,
      duration_seconds: 10,
      token_usage: { claude: { input_tokens: 100, output_tokens: 50 } },
      programmatic_results: [], judge_results: null, sidecar_calls: [],
    };
    const rawLines = ['{"type":"usage","usage":{"input_tokens":100,"output_tokens":50}}'];

    writeResults(workDir, result, rawLines);

    expect(fs.existsSync(path.join(workDir, 'result.json'))).toBe(true);
    expect(fs.existsSync(path.join(workDir, 'transcript.jsonl'))).toBe(true);

    const written = JSON.parse(fs.readFileSync(path.join(workDir, 'result.json'), 'utf-8'));
    expect(written.eval_id).toBe(1);
    expect(written.status).toBe('PASS');

    fs.rmSync(workDir, { recursive: true });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest evals/tests/result_writer.test.js`
Expected: FAIL

**Step 3: Implement result_writer.js**

`evals/result_writer.js`:
```js
const fs = require('fs');
const path = require('path');

/**
 * Format token count as human-readable string (e.g., "15.7k tok").
 * @param {number} tokens
 * @returns {string}
 */
function formatTokens(tokens) {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k tok`;
  }
  return `${tokens} tok`;
}

/**
 * Format a single eval result as a summary line.
 * @param {object} result
 * @returns {string}
 */
function formatSummaryLine(result) {
  const totalTokens = (result.token_usage?.claude?.input_tokens || 0)
    + (result.token_usage?.claude?.output_tokens || 0);
  const tokStr = formatTokens(totalTokens);
  const durStr = `${result.duration_seconds}s`;
  const scoreStr = result.score.toFixed(2);

  let sidecarInfo = '';
  const startCall = result.sidecar_calls?.find(c => c.tool === 'sidecar_start');
  if (startCall) {
    const model = startCall.params?.model || 'unknown';
    const agent = startCall.params?.agent || 'Chat';
    sidecarInfo = `\n  Sidecar: ${model}, agent=${agent}`;
    if (result.token_usage?.sidecar) {
      const sTok = (result.token_usage.sidecar.input_tokens || 0)
        + (result.token_usage.sidecar.output_tokens || 0);
      sidecarInfo += `, ${formatTokens(sTok)}`;
    }
  }

  const name = result.eval_name.padEnd(30);
  return `Eval ${result.eval_id}: ${name} ${result.status}  ${scoreStr}  (${durStr}, ${tokStr})${sidecarInfo}`;
}

/**
 * Write eval results to workspace directory.
 * @param {string} workDir - Workspace directory path
 * @param {object} result - Eval result object
 * @param {string[]} rawLines - Raw stream-json lines
 */
function writeResults(workDir, result, rawLines) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'result.json'),
    JSON.stringify(result, null, 2)
  );
  fs.writeFileSync(
    path.join(workDir, 'transcript.jsonl'),
    rawLines.join('\n') + '\n'
  );
}

/**
 * Print summary table for multiple eval results.
 * @param {object[]} results
 */
function printSummary(results) {
  console.log('\nSidecar Eval Results');
  console.log('====================');
  for (const r of results) {
    console.log(formatSummaryLine(r));
  }
  const passed = results.filter(r => r.status === 'PASS').length;
  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
  const totalTokens = results.reduce((s, r) => {
    return s + (r.token_usage?.claude?.input_tokens || 0)
      + (r.token_usage?.claude?.output_tokens || 0);
  }, 0);
  console.log(`\nOverall: ${passed}/${results.length} passed, avg score: ${avgScore.toFixed(2)}, total: ${formatTokens(totalTokens)}`);
}

module.exports = { writeResults, formatSummaryLine, formatTokens, printSummary };
```

**Step 4: Run tests to verify they pass**

Run: `npx jest evals/tests/result_writer.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add evals/result_writer.js evals/tests/result_writer.test.js
git commit -m "feat(evals): implement result writer with summary formatting"
```

---

### Task 6: Implement LLM-as-judge in evaluator.js

**Files:**
- Modify: `evals/evaluator.js`
- Modify: `evals/tests/evaluator.test.js`

**Step 1: Add failing test for LLM-as-judge**

Append to `evals/tests/evaluator.test.js`:
```js
const { buildJudgePrompt, parseJudgeResponse } = require('../evaluator');

describe('buildJudgePrompt', () => {
  test('includes rubric items and transcript summary', () => {
    const rubric = ['Was the model choice appropriate? (1-5)', 'Was the briefing good? (1-5)'];
    const transcript = {
      toolCalls: [{ tool: 'sidecar_start', params: { model: 'gemini' }, result: '{"taskId":"abc"}' }],
      errors: [],
    };
    const prompt = buildJudgePrompt(rubric, transcript);
    expect(prompt).toContain('model choice');
    expect(prompt).toContain('briefing');
    expect(prompt).toContain('sidecar_start');
    expect(prompt).toContain('gemini');
    expect(prompt).toContain('JSON');
  });
});

describe('parseJudgeResponse', () => {
  test('extracts scores from JSON response', () => {
    const response = '{"scores": [4, 3, 5, 4]}';
    const rubric = ['Q1', 'Q2', 'Q3', 'Q4'];
    const result = parseJudgeResponse(response, rubric, 3.5);
    expect(result.scores).toHaveLength(4);
    expect(result.scores[0].score).toBe(4);
    expect(result.average).toBe(4.0);
    expect(result.passed).toBe(true);
  });

  test('fails when average below threshold', () => {
    const response = '{"scores": [1, 2, 1, 2]}';
    const rubric = ['Q1', 'Q2', 'Q3', 'Q4'];
    const result = parseJudgeResponse(response, rubric, 3.5);
    expect(result.passed).toBe(false);
    expect(result.average).toBe(1.5);
  });

  test('handles JSON embedded in text', () => {
    const response = 'Here are my scores:\n{"scores": [5, 4, 5, 4]}\nDone.';
    const rubric = ['Q1', 'Q2', 'Q3', 'Q4'];
    const result = parseJudgeResponse(response, rubric, 3.5);
    expect(result.scores).toHaveLength(4);
    expect(result.passed).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest evals/tests/evaluator.test.js`
Expected: FAIL (buildJudgePrompt and parseJudgeResponse not exported)

**Step 3: Add judge functions to evaluator.js**

Append to `evals/evaluator.js`:
```js
/**
 * Build the prompt for LLM-as-judge evaluation.
 * @param {string[]} rubric - Rubric questions
 * @param {object} transcript - Parsed transcript
 * @returns {string}
 */
function buildJudgePrompt(rubric, transcript) {
  const toolSummary = transcript.toolCalls.map(tc =>
    `- ${tc.tool}(${JSON.stringify(tc.params)}) -> ${(tc.result || '').slice(0, 200)}`
  ).join('\n');

  const rubricText = rubric.map((q, i) => `${i + 1}. ${q}`).join('\n');

  return `You are evaluating an LLM's use of the "sidecar" tool (a multi-model subagent system).

## Tool Calls Made
${toolSummary || '(none)'}

## Errors
${transcript.errors.length ? transcript.errors.join('\n') : '(none)'}

## Rubric
Score each item from 1 (poor) to 5 (excellent):
${rubricText}

Respond with ONLY a JSON object: {"scores": [N, N, N, ...]}
One integer per rubric item, in order. No explanation needed.`;
}

/**
 * Parse the LLM judge's response into structured scores.
 * @param {string} response - Raw LLM response text
 * @param {string[]} rubric - Original rubric questions
 * @param {number} passThreshold - Minimum average to pass
 * @returns {{ scores: Array<{rubric: string, score: number}>, average: number, pass_threshold: number, passed: boolean }}
 */
function parseJudgeResponse(response, rubric, passThreshold) {
  // Extract JSON from response (may be embedded in text)
  const jsonMatch = response.match(/\{[^}]*"scores"\s*:\s*\[[^\]]*\][^}]*\}/);
  if (!jsonMatch) {
    return {
      scores: rubric.map(r => ({ rubric: r, score: 0 })),
      average: 0, pass_threshold: passThreshold, passed: false,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const scores = rubric.map((r, i) => ({
    rubric: r,
    score: parsed.scores[i] || 0,
  }));
  const average = scores.reduce((s, x) => s + x.score, 0) / scores.length;

  return {
    scores,
    average,
    pass_threshold: passThreshold,
    passed: average >= passThreshold,
  };
}
```

Update `module.exports`:
```js
module.exports = { runProgrammaticChecks, findFilesRecursive, buildJudgePrompt, parseJudgeResponse };
```

**Step 4: Run tests to verify they pass**

Run: `npx jest evals/tests/evaluator.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add evals/evaluator.js evals/tests/evaluator.test.js
git commit -m "feat(evals): add LLM-as-judge prompt builder and response parser"
```

---

### Task 7: Implement run_eval.js (orchestrator)

**Files:**
- Create: `evals/run_eval.js`

**Step 1: Implement the orchestrator**

`evals/run_eval.js`:
```js
#!/usr/bin/env node

/**
 * Sidecar Agentic Eval Runner
 *
 * Spawns real Claude Code with sidecar MCP server, runs tasks in sandboxed
 * fixture projects, grades with programmatic checks + LLM-as-judge.
 */

const fs = require('fs');
const path = require('path');
const { parseTranscript } = require('./transcript_parser');
const { runProgrammaticChecks, buildJudgePrompt, parseJudgeResponse } = require('./evaluator');
const { buildMcpConfig, createSandbox, runClaude } = require('./claude_runner');
const { writeResults, printSummary } = require('./result_writer');

const EVALS_DIR = __dirname;
const TASKS_FILE = path.join(EVALS_DIR, 'eval_tasks.json');
const WORKSPACE_DIR = path.join(EVALS_DIR, 'workspace');

/** Load eval tasks */
function loadTasks() {
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
}

/** Run LLM-as-judge via Claude CLI (cheap model) */
async function runJudge(rubric, transcript, passThreshold) {
  const prompt = buildJudgePrompt(rubric, transcript);
  try {
    const { lines } = await runClaude({
      prompt,
      model: 'haiku',
      maxBudget: 0.05,
      mcpConfigPath: null,
      sandboxDir: process.cwd(),
    }, 60000);

    // Extract text content from stream-json
    let responseText = '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') { responseText += block.text; }
          }
        }
        // Also handle result type
        if (event.type === 'result' && event.result) {
          responseText += typeof event.result === 'string' ? event.result : '';
        }
      } catch { /* skip */ }
    }

    return parseJudgeResponse(responseText, rubric, passThreshold);
  } catch (err) {
    console.error(`  Judge failed: ${err.message}`);
    return {
      scores: rubric.map(r => ({ rubric: r, score: 0 })),
      average: 0, pass_threshold: passThreshold, passed: false,
    };
  }
}

/** Run a single eval task */
async function runEval(task, opts = {}) {
  const timestamp = Date.now();
  const workDir = path.join(WORKSPACE_DIR, `eval-${task.id}-${timestamp}`);

  console.log(`\nRunning Eval ${task.id}: ${task.name}`);
  console.log(`  Fixture: ${task.fixture}`);
  console.log(`  Model: ${opts.model || task.model}`);

  // 1. Create sandbox
  const sandboxDir = createSandbox(task.fixture);
  console.log(`  Sandbox: ${sandboxDir}`);

  // 2. Write MCP config
  const mcpConfig = buildMcpConfig();
  const mcpConfigPath = path.join(sandboxDir, '.mcp-config.json');
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));

  // 3. Dry run?
  if (opts.dryRun) {
    const { buildClaudeCommand } = require('./claude_runner');
    const cmd = buildClaudeCommand({
      prompt: task.prompt,
      model: opts.model || task.model,
      maxBudget: task.max_budget_usd,
      mcpConfigPath,
      sandboxDir,
    });
    console.log(`  DRY RUN: ${cmd.command} ${cmd.args.join(' ')}`);
    fs.rmSync(sandboxDir, { recursive: true });
    return null;
  }

  // 4. Run Claude
  console.log('  Running Claude Code...');
  let runResult;
  try {
    runResult = await runClaude({
      prompt: task.prompt,
      model: opts.model || task.model,
      maxBudget: task.max_budget_usd,
      mcpConfigPath,
      sandboxDir,
    });
  } catch (err) {
    console.error(`  Claude failed: ${err.message}`);
    const failResult = {
      eval_id: task.id, eval_name: task.name, status: 'ERROR',
      score: 0, duration_seconds: 0,
      token_usage: { claude: { input_tokens: 0, output_tokens: 0 } },
      programmatic_results: [], judge_results: null, sidecar_calls: [],
      error: err.message,
    };
    writeResults(workDir, failResult, []);
    fs.rmSync(sandboxDir, { recursive: true });
    return failResult;
  }

  const durationSec = Math.round(runResult.duration / 1000);
  console.log(`  Completed in ${durationSec}s (exit code: ${runResult.exitCode})`);

  // 5. Parse transcript
  const transcript = parseTranscript(runResult.lines);
  console.log(`  Tool calls: ${transcript.toolCalls.length}, Errors: ${transcript.errors.length}`);
  console.log(`  Tokens: ${transcript.inputTokens} in, ${transcript.outputTokens} out`);

  // 6. Extract sidecar calls
  const sidecarCalls = transcript.toolCalls
    .filter(tc => tc.tool.startsWith('sidecar_'))
    .map(tc => ({ tool: tc.tool, params: tc.params }));

  // 7. Programmatic checks
  const progResults = runProgrammaticChecks(
    task.success_criteria.programmatic, transcript, sandboxDir
  );
  const progPassed = progResults.every(r => r.passed);
  console.log(`  Programmatic: ${progResults.filter(r => r.passed).length}/${progResults.length} passed`);
  for (const r of progResults) {
    console.log(`    ${r.passed ? 'PASS' : 'FAIL'} ${r.type}: ${r.detail}`);
  }

  // 8. LLM-as-judge (only if programmatic passed)
  let judgeResults = null;
  if (progPassed && task.success_criteria.llm_judge) {
    console.log('  Running LLM-as-judge...');
    judgeResults = await runJudge(
      task.success_criteria.llm_judge.rubric,
      transcript,
      task.success_criteria.llm_judge.pass_threshold
    );
    console.log(`  Judge avg: ${judgeResults.average.toFixed(1)} (threshold: ${judgeResults.pass_threshold})`);
  }

  // 9. Build result
  const allPassed = progPassed && (!judgeResults || judgeResults.passed);
  const score = progPassed
    ? (judgeResults ? judgeResults.average / 5 : 1.0)
    : progResults.filter(r => r.passed).length / progResults.length;

  const result = {
    eval_id: task.id,
    eval_name: task.name,
    status: allPassed ? 'PASS' : 'FAIL',
    score,
    duration_seconds: durationSec,
    token_usage: {
      claude: { input_tokens: transcript.inputTokens, output_tokens: transcript.outputTokens },
    },
    programmatic_results: progResults,
    judge_results: judgeResults,
    sidecar_calls: sidecarCalls,
  };

  // 10. Write results
  writeResults(workDir, result, runResult.lines);
  console.log(`  Result: ${result.status} (score: ${result.score.toFixed(2)})`);
  console.log(`  Output: ${workDir}`);

  // 11. Cleanup sandbox
  fs.rmSync(sandboxDir, { recursive: true });

  return result;
}

/** Main CLI */
async function main() {
  const args = process.argv.slice(2);
  const evalId = args.includes('--eval-id') ? parseInt(args[args.indexOf('--eval-id') + 1]) : null;
  const runAll = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const modelOverride = args.includes('--model') ? args[args.indexOf('--model') + 1] : null;

  if (!evalId && !runAll) {
    console.log('Usage:');
    console.log('  node evals/run_eval.js --eval-id <id>');
    console.log('  node evals/run_eval.js --all');
    console.log('  node evals/run_eval.js --all --dry-run');
    console.log('  node evals/run_eval.js --eval-id 1 --model opus');
    process.exit(1);
  }

  const tasks = loadTasks();
  const toRun = runAll ? tasks : tasks.filter(t => t.id === evalId);

  if (toRun.length === 0) {
    console.error(`No eval found with id ${evalId}`);
    process.exit(1);
  }

  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const results = [];
  for (const task of toRun) {
    const result = await runEval(task, { dryRun, model: modelOverride });
    if (result) { results.push(result); }
  }

  if (results.length > 0) {
    printSummary(results);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
```

**Step 2: Test with dry run**

Run: `node evals/run_eval.js --eval-id 1 --dry-run`
Expected: Prints the Claude command without executing

**Step 3: Commit**

```bash
git add evals/run_eval.js
git commit -m "feat(evals): implement eval runner orchestrator"
```

---

### Task 8: Run all eval tests and verify

**Step 1: Run all eval unit tests**

Run: `npx jest evals/tests/`
Expected: ALL PASS

**Step 2: Run dry-run for all evals**

Run: `node evals/run_eval.js --all --dry-run`
Expected: Prints 3 Claude commands without executing

**Step 3: Run sidecar's full test suite for regressions**

Run: `npm test`
Expected: ALL PASS (eval tests should also be picked up by Jest)

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test(evals): verify eval system with dry runs and unit tests"
```

---

### Task 9: Run a real eval (manual verification)

This task is manual — run a real eval to verify the full pipeline.

**Step 1: Run eval 1 for real**

Run: `node evals/run_eval.js --eval-id 1`
Expected: Claude spawns, calls sidecar_start, polls, reads results, modifies files in sandbox

**Step 2: Check workspace output**

```bash
ls evals/workspace/eval-1-*/
cat evals/workspace/eval-1-*/result.json
```

**Step 3: Verify result makes sense**

- Did Claude call sidecar_start?
- Was a model selected?
- Did programmatic checks run?
- If LLM-as-judge ran, are scores reasonable?

**Step 4: Commit workspace gitignore confirmation**

```bash
git status  # verify evals/workspace/ is ignored
```
