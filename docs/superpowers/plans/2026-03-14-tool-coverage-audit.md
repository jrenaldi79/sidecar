# MCP App Tool Coverage Audit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the tool routing bug, refactor tool-output.js to an exported map, build a static test harness with coverage panel, add an integration test detecting tool drift, and document gaps.

**Architecture:** The tool routing pipeline flows from `renderers.js` (extracts tool name from API part) through `tool-output.js` (dispatches to per-tool formatters). The bug is in `renderers.js` reading the wrong field. The refactor converts `tool-output.js` from if/else chains to an exported `TOOL_HANDLERS` map. The integration test starts a real OpenCode server and compares its tool registry against our map keys.

**Tech Stack:** JavaScript (CJS for testable modules, ESM for browser-only), Jest, Vite, OpenCode SDK

---

## Chunk 1: Bug Fix + TOOL_HANDLERS Refactor

### Task 1: Refactor tool-output.js to TOOL_HANDLERS map

This is a pure refactor with no behavior change. Must be done first because the integration test (Task 5) imports `TOOL_HANDLERS`.

**Files:**
- Modify: `src/mcp-app/tool-output.js`
- Modify: `tests/mcp-app/tool-output.test.js`

- [ ] **Step 1: Write failing test for TOOL_HANDLERS export**

Add to `tests/mcp-app/tool-output.test.js`:

```js
const { formatToolOutput, TOOL_HANDLERS } = require('../../src/mcp-app/tool-output');

describe('TOOL_HANDLERS export', () => {
  test('exports a TOOL_HANDLERS map', () => {
    expect(TOOL_HANDLERS).toBeDefined();
    expect(typeof TOOL_HANDLERS).toBe('object');
  });

  test('contains all expected tool keys', () => {
    const expected = [
      'edit', 'write', 'bash', 'read', 'glob', 'grep',
      'question', 'askuserquestion', 'list', 'ls',
      'task', 'webfetch', 'todowrite', 'todoread',
    ];
    for (const key of expected) {
      expect(TOOL_HANDLERS).toHaveProperty(key);
      expect(typeof TOOL_HANDLERS[key]).toBe('function');
    }
  });

  test('aliases point to same handler', () => {
    expect(TOOL_HANDLERS.ls).toBe(TOOL_HANDLERS.list);
    expect(TOOL_HANDLERS.askuserquestion).toBe(TOOL_HANDLERS.question);
    expect(TOOL_HANDLERS.todoread).toBe(TOOL_HANDLERS.todowrite);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-app/tool-output.test.js`
Expected: FAIL -- `TOOL_HANDLERS` is `undefined` (not exported)

- [ ] **Step 3: Refactor tool-output.js to use TOOL_HANDLERS map**

Replace the entire content of `src/mcp-app/tool-output.js` with:

```js
const { formatGenericOutput } = require('./tools/generic');
const { formatBashOutput } = require('./tools/bash');
const { formatEditDiff } = require('./tools/edit');
const { formatFileOutput } = require('./tools/read');
const { formatWriteOutput } = require('./tools/write');
const { formatGrepOutput } = require('./tools/grep');
const { formatGlobOutput } = require('./tools/glob');
const { formatQuestionOutput } = require('./tools/question');
const { formatListOutput } = require('./tools/list');
const { formatTodoOutput } = require('./tools/todo');
const { formatWebfetchOutput } = require('./tools/webfetch');
const { formatTaskOutput } = require('./tools/task');

/**
 * Map of tool name (lowercase) to formatter function.
 * Aliases (ls, askuserquestion, todoread) point to the same handler.
 * Imported by the tool-coverage integration test to detect drift.
 *
 * Note: formatEditDiff only uses its first argument (input). The uniform
 * dispatch pattern passes (input, outputStr) to all handlers. JavaScript
 * silently ignores the extra argument. This is intentional -- keeping a
 * uniform interface is simpler than special-casing edit.
 * @type {Record<string, (input: object, output: string) => string>}
 */
const TOOL_HANDLERS = {
  edit: formatEditDiff,
  write: formatWriteOutput,
  bash: formatBashOutput,
  read: formatFileOutput,
  glob: formatGlobOutput,
  grep: formatGrepOutput,
  question: formatQuestionOutput,
  askuserquestion: formatQuestionOutput,
  list: formatListOutput,
  ls: formatListOutput,
  task: formatTaskOutput,
  webfetch: formatWebfetchOutput,
  todowrite: formatTodoOutput,
  todoread: formatTodoOutput,
};

/**
 * Routes a tool call to the appropriate HTML formatter.
 *
 * @param {string} toolName - Name of the tool (case-insensitive).
 * @param {object} input - Tool input parameters.
 * @param {*} output - Raw tool output.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatToolOutput(toolName, input, output) {
  const name = toolName.toLowerCase();
  const outputStr = output !== null && output !== undefined ? String(output) : '';
  const handler = TOOL_HANDLERS[name];
  if (handler) { return handler(input, outputStr); }
  if (typeof console !== 'undefined') {
    console.warn(`[tool-output] No renderer for tool: "${name}" -- using generic fallback`);
  }
  return formatGenericOutput(input, outputStr);
}

module.exports = { formatToolOutput, TOOL_HANDLERS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test tests/mcp-app/tool-output.test.js`
Expected: ALL PASS (existing tests + new TOOL_HANDLERS tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp-app/tool-output.js tests/mcp-app/tool-output.test.js
git commit -m "refactor: export TOOL_HANDLERS map from tool-output.js

Replace if/else chains with an exported map. Adds console.warn
fallback for unrecognized tools. No behavior change for existing tools."
```

### Task 2: Fix tool name routing in renderers.js

**Files:**
- Modify: `src/mcp-app/renderers.js:61-83`

**Context:** `renderers.js` is an ESM browser module that uses DOM APIs (`document.createElement`, `DOMParser`). Per `docs/testing.md` ("What NOT to Unit Test"), DOM manipulation in renderers is verified via the static test harness and interactive harness, not Jest unit tests. DOM mock tests test mock behavior, not real rendering.

**TDD exception:** This task does not follow red-green-refactor because the code under test is browser-only ESM with DOM dependencies. Verification is manual via the static test harness (Task 4) and interactive harness (`npm run dev:ui`).

- [ ] **Step 1: Apply the three-line fix in makeToolBlock**

In `src/mcp-app/renderers.js`, replace lines 62-63:

```js
// OLD (line 62):
  const name = part.toolName || part.state?.input?.description || 'tool';
```

With:

```js
  const toolId = (part.tool || part.toolName || '').toLowerCase();
  const displayName = part.state?.input?.description || toolId || 'tool';
```

Then replace line 71:

```js
// OLD (line 71):
  label.textContent = `${icon} ${name}`;
```

With:

```js
  label.textContent = `${icon} ${displayName}`;
```

Then replace line 83:

```js
// OLD (line 83):
    const html = formatToolOutput(name, part.state?.input, output);
```

With:

```js
    const html = formatToolOutput(toolId, part.state?.input, output);
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node -e "const fs = require('fs'); fs.readFileSync('src/mcp-app/renderers.js', 'utf-8');"` (sanity check file is readable)

The full verification happens in Task 3 (static harness) and manual testing via `npm run dev:ui`.

- [ ] **Step 3: Commit**

```bash
git add src/mcp-app/renderers.js
git commit -m "fix: route tool output by part.tool instead of part.toolName

The OpenCode API sends part.tool (e.g. 'bash'), not part.toolName.
Separate toolId (for routing) from displayName (for UI label).
Normalize with .toLowerCase() for case-insensitive matching."
```

---

## Chunk 2: Static Test Harness

### Task 3: Create test-harness.html

**Files:**
- Create: `src/mcp-app/test-harness.html`

**Context:** This is a standalone HTML page that uses the shared `styles.css` and loads `test-harness.js` as an ESM module. It simulates the Claude Desktop viewport with theme and size toggles. The `#sidecar-app` structure mirrors `interactive-harness.html` and `mcp-app.html`.

- [ ] **Step 1: Create the HTML file**

Create `src/mcp-app/test-harness.html`:

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sidecar Static Test Harness</title>
<link rel="stylesheet" href="./styles.css">
<style>
  /* Test harness chrome -- NOT part of shared styles */
  .harness-controls {
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 200;
    display: flex;
    gap: 6px;
  }
  .harness-btn {
    font-family: var(--mono);
    font-size: 10px;
    padding: 4px 10px;
    border: 1px solid var(--border-medium);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .harness-btn:hover { background: var(--bg-elevated); }
  .harness-btn.active {
    background: var(--accent-warm-soft);
    border-color: var(--accent-warm);
    color: var(--accent-warm);
  }
  #coverage-panel {
    margin: 12px 16px;
    padding: 12px;
    border: 1px solid var(--border-medium);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    font-family: var(--mono);
    font-size: 12px;
  }
  #coverage-panel h3 {
    font-size: 12px;
    margin-bottom: 8px;
    color: var(--text-secondary);
  }
  .coverage-item { padding: 2px 0; }
  .coverage-handled { color: #2ea043; }
  .coverage-missing { color: #f85149; }
  .coverage-note {
    color: var(--text-tertiary);
    font-size: 11px;
    margin-top: 8px;
    font-style: italic;
  }
</style>
<script>
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
</script>
</head>
<body>
<div class="harness-controls">
  <button class="harness-btn" id="theme-toggle">Toggle Dark</button>
  <button class="harness-btn" id="size-520" data-width="520">520px</button>
  <button class="harness-btn active" id="size-700" data-width="700">700px</button>
</div>

<div id="sidecar-app" style="max-width: 700px; margin: 0 auto;">
  <div id="sidecar-header">
    <div class="header-brand">
      <div class="status-dot connected" id="status-dot"></div>
      <span class="brand-name">Sidecar</span>
    </div>
    <span id="model-badge">test-harness</span>
    <div class="header-meta">
      <span id="timer">0:00</span>
    </div>
  </div>

  <div id="coverage-panel">
    <h3>Tool Coverage</h3>
    <div id="coverage-content">Loading coverage data...</div>
  </div>

  <div id="messages-container" style="height: calc(100vh - 160px); overflow-y: auto;"></div>
</div>

<script type="module" src="./test-harness.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify file renders without errors**

Open in browser later via `npm run qa:ui` (set up in Task 5). For now, just verify syntax:

Run: `node -e "require('fs').readFileSync('src/mcp-app/test-harness.html', 'utf-8'); console.log('OK')"`

- [ ] **Step 3: Commit**

```bash
git add src/mcp-app/test-harness.html
git commit -m "feat: add static test harness HTML shell

Provides Claude Desktop simulation frame with theme/size toggles
and tool coverage panel. Loads test-harness.js as ESM module."
```

### Task 4: Create test-harness.js with mock data for all tools

**Files:**
- Create: `src/mcp-app/test-harness.js`

**Context:** This file imports `renderMessage` from `renderers.js` and `setupAutoScroll` from `auto-scroll.js` (both via the Vite `cjsToEsm()` plugin for CJS compatibility). It creates mock message objects matching the OpenCode API shape (`parts` array with `type: 'tool'` entries) and renders them into the DOM. The coverage panel fetches `tool-coverage.json` (generated by the integration test, copied by `qa:ui` script).

**Important:** Each mock tool part must use `tool` (not `toolName`) as the tool identifier field, matching the real API shape and the bug fix in Task 2.

**Security note:** This file uses `DOMParser` for all HTML-to-DOM conversion (same pattern as `renderers.js`). Never use `element.innerHTML` directly per the project security hook.

- [ ] **Step 1: Create the JS file**

Create `src/mcp-app/test-harness.js`:

```js
/* eslint-env browser */
/**
 * Static test harness: renders mock messages for every tool type.
 * No API dependency -- all data is inline.
 *
 * Uses DOMParser for all HTML-to-DOM conversion (no direct innerHTML).
 */
import { renderMessage } from './renderers.js';
import { setupAutoScroll } from './auto-scroll.js';

const container = document.getElementById('messages-container');
setupAutoScroll(container);

// ---- Helpers ----

/** Parse an HTML string into DOM nodes via DOMParser (safe, no innerHTML). */
function htmlToDOM(html, parent) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  while (doc.body.firstChild) { parent.appendChild(doc.body.firstChild); }
}

// ---- Theme & size controls ----

document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
});

document.querySelectorAll('[data-width]').forEach(btn => {
  btn.addEventListener('click', () => {
    const app = document.getElementById('sidecar-app');
    app.style.maxWidth = btn.dataset.width + 'px';
    document.querySelectorAll('[data-width]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ---- Coverage panel ----

async function loadCoverage() {
  const panel = document.getElementById('coverage-content');
  try {
    const res = await fetch('./tool-coverage.json');
    if (!res.ok) { throw new Error('not found'); }
    const data = await res.json();
    let html = '';
    for (const t of data.handled || []) {
      html += `<div class="coverage-item coverage-handled">\u2713 ${t}</div>`;
    }
    for (const t of data.missing || []) {
      html += `<div class="coverage-item coverage-missing">\u2717 ${t}</div>`;
    }
    if (data.generated) {
      html += `<div class="coverage-note">Generated: ${data.generated}</div>`;
    }
    panel.textContent = '';
    htmlToDOM(html, panel);
  } catch {
    panel.textContent = '';
    htmlToDOM(
      '<div class="coverage-note">Run the coverage test to generate data:<br>' +
      '<code>npm test tests/mcp-app/tool-coverage-e2e.integration.test.js</code></div>',
      panel
    );
  }
}
loadCoverage();

// ---- Mock messages ----

/** Helper: create an assistant message with tool parts */
function toolMsg(parts) {
  return { info: { role: 'assistant' }, parts };
}

/** Helper: create a single tool part */
function toolPart(tool, input, output, status = 'completed') {
  return {
    type: 'tool',
    tool,
    state: { status, input, output },
  };
}

const mockMessages = [
  // User message
  { info: { role: 'user' }, parts: [{ type: 'text', text: 'Show me all the tool renderers.' }] },

  // Reasoning block (standalone)
  {
    info: { role: 'assistant' },
    parts: [
      { type: 'reasoning', text: 'The user wants to see all tool renderers. I should demonstrate each tool type with realistic mock data to verify the UI rendering pipeline.' },
      { type: 'text', text: 'Here are all the tool renderers:' },
    ],
  },

  // 1. bash
  toolMsg([toolPart('bash',
    { command: 'ls -la src/mcp-app/tools/', description: 'List tool formatter files' },
    'total 48\ndrwxr-xr-x  14 user  staff   448 Mar 14 10:00 .\n-rw-r--r--   1 user  staff  1234 Mar 14 09:55 bash.js\n-rw-r--r--   1 user  staff   890 Mar 14 09:55 edit.js\n-rw-r--r--   1 user  staff   456 Mar 14 09:55 generic.js\n-rw-r--r--   1 user  staff   678 Mar 14 09:55 glob.js\n-rw-r--r--   1 user  staff   567 Mar 14 09:55 grep.js\n-rw-r--r--   1 user  staff   345 Mar 14 09:55 list.js\n-rw-r--r--   1 user  staff   234 Mar 14 09:55 question.js\n-rw-r--r--   1 user  staff   456 Mar 14 09:55 read.js\n-rw-r--r--   1 user  staff   345 Mar 14 09:55 task.js\n-rw-r--r--   1 user  staff   234 Mar 14 09:55 todo.js\n-rw-r--r--   1 user  staff   567 Mar 14 09:55 webfetch.js\n-rw-r--r--   1 user  staff   456 Mar 14 09:55 write.js'
  )]),

  // 2. bash (running -- no output yet)
  toolMsg([toolPart('bash',
    { command: 'npm test', description: 'Run test suite' },
    null,
    'running'
  )]),

  // 3. read
  toolMsg([toolPart('read',
    { file_path: 'package.json' },
    '     1\t{\n     2\t  "name": "claude-sidecar",\n     3\t  "version": "0.4.0",\n     4\t  "description": "A parallel AI window for Claude Code.",\n     5\t  "main": "src/index.js"\n     6\t}'
  )]),

  // 4. write
  toolMsg([toolPart('write',
    { file_path: 'src/utils/rateLimit.js', content: 'const RATE_LIMIT = 100;\nmodule.exports = { RATE_LIMIT };' },
    'Successfully wrote to src/utils/rateLimit.js'
  )]),

  // 5. edit
  toolMsg([toolPart('edit',
    { file_path: 'package.json', old_string: '"test": "jest"', new_string: '"test": "jest --verbose",\n    "start": "node bin/sidecar.js"' },
    'Successfully edited package.json'
  )]),

  // 6. glob
  toolMsg([toolPart('glob',
    { pattern: 'src/mcp-app/tools/*.js' },
    'src/mcp-app/tools/bash.js\nsrc/mcp-app/tools/edit.js\nsrc/mcp-app/tools/generic.js\nsrc/mcp-app/tools/glob.js\nsrc/mcp-app/tools/grep.js\nsrc/mcp-app/tools/list.js\nsrc/mcp-app/tools/question.js\nsrc/mcp-app/tools/read.js\nsrc/mcp-app/tools/task.js\nsrc/mcp-app/tools/todo.js\nsrc/mcp-app/tools/webfetch.js\nsrc/mcp-app/tools/write.js'
  )]),

  // 7. grep
  toolMsg([toolPart('grep',
    { pattern: 'TODO', path: 'src/' },
    'src/mcp-app/tool-output.js:15:  // TODO: add websearch renderer\nsrc/headless.js:42:  // TODO: configurable timeout\nsrc/context.js:88:  // TODO: handle edge case for empty sessions'
  )]),

  // 8. question
  toolMsg([toolPart('question',
    { question: 'Which deployment target should I use for the staging environment?' },
    'Use the us-east-1 staging cluster.'
  )]),

  // 9. list / ls
  toolMsg([toolPart('list',
    { path: 'src/mcp-app/' },
    'auto-scroll.js\nchat-resource.js\ndev-server.mjs\nhighlight.js\nicons.js\ninteractive-harness.html\ninteractive-harness.js\nlogos.js\nmarkdown.js\nmcp-app.html\nmcp-app.js\nrenderers.js\nstyles.css\ntest-harness.html\ntest-harness.js\ntool-output.js\ntools/\nutils.js'
  )]),

  // 10. task
  toolMsg([toolPart('task',
    { id: 'task-abc123' },
    'Task task-abc123 created successfully.'
  )]),

  // 11. webfetch
  toolMsg([toolPart('webfetch',
    { url: 'https://example.com/api/status' },
    '{"status":"healthy","version":"2.1.0","uptime":"14d 3h 22m"}'
  )]),

  // 12. todowrite
  toolMsg([toolPart('todowrite',
    { todos: [{ id: '1', content: 'Fix tool routing bug', status: 'completed' }, { id: '2', content: 'Build static test harness', status: 'in_progress' }] },
    'Updated 2 todos.'
  )]),

  // 13. generic fallback (unknown tool)
  toolMsg([toolPart('unknowntool',
    { foo: 'bar', baz: 42 },
    'Some raw output from an unknown tool'
  )]),

  // 14. error state
  toolMsg([{
    type: 'tool',
    tool: 'bash',
    state: {
      status: 'error',
      input: { command: 'rm -rf /nonexistent', description: 'Delete nonexistent path' },
      output: 'rm: /nonexistent: No such file or directory',
    },
  }]),

  // Inline reasoning before tool call
  {
    info: { role: 'assistant' },
    parts: [
      { type: 'reasoning', text: 'I need to check the file before editing it to make sure the line exists.' },
      toolPart('read', { file_path: 'src/mcp-app/renderers.js' }, '     1\t/* eslint-env browser */\n     2\t/**\n     3\t * Message rendering functions.'),
      { type: 'text', text: 'I found the file. The rendering pipeline is working correctly.' },
    ],
  },
];

// ---- Render all mock messages ----

for (const msg of mockMessages) {
  const fragment = renderMessage(msg);
  if (fragment) {
    container.appendChild(fragment);
  }
}
```

- [ ] **Step 2: Verify file is syntactically valid**

Run: `node -e "require('fs').readFileSync('src/mcp-app/test-harness.js', 'utf-8'); console.log('OK')"`

- [ ] **Step 3: Commit**

```bash
git add src/mcp-app/test-harness.js
git commit -m "feat: add test harness JS with mock data for all 12 tool types

Exercises bash, read, write, edit, glob, grep, question, list, task,
webfetch, todowrite, and generic fallback. Includes running, error,
and reasoning scenarios. Coverage panel reads tool-coverage.json."
```

### Task 5: Add qa:ui script and Vite config

**Files:**
- Modify: `package.json`
- Create: `vite.config.test-harness.mjs`

**Context:** The test harness needs Vite's `cjsToEsm()` plugin (same one `dev-server.mjs` uses) to handle CJS imports in `tool-output.js` and its dependencies. Unlike `dev:ui`, no proxy or `define` globals are needed since all data is static mocks.

- [ ] **Step 1: Create vite.config.test-harness.mjs**

Create `vite.config.test-harness.mjs`:

```js
/**
 * Vite config for the static test harness.
 * Uses the cjsToEsm() plugin to handle CJS source files (tool-output.js, etc.)
 * No proxy or define globals needed -- all data is static mocks.
 */

/** Inline plugin: convert CJS patterns to ESM for Vite dev mode. */
function cjsToEsm() {
  return {
    name: 'cjs-to-esm',
    transform(code, id) {
      if (!id.endsWith('.js') || !id.includes('/mcp-app/')) { return null; }
      if (!code.includes('module.exports') && !code.includes('require(')) { return null; }
      let out = code;
      out = out.replace(
        /const\s+(\{[^}]+\})\s*=\s*require\((['"][^'"]+['"])\);?/g,
        'import $1 from $2;',
      );
      out = out.replace(
        /const\s+(\w+)\s*=\s*require\((['"][^'"]+['"])\);?/g,
        'import $1 from $2;',
      );
      out = out.replace(
        /module\.exports\s*=\s*\{([^}]+)\};?/g,
        (_match, inner) => `export { ${inner.trim()} };`,
      );
      if (out === code) { return null; }
      return { code: out, map: null };
    },
  };
}

export default {
  root: 'src/mcp-app',
  plugins: [cjsToEsm()],
  server: { port: 5175 },
};
```

- [ ] **Step 2: Add qa:ui script to package.json**

In `package.json`, add to the `"scripts"` section after the `"dev:ui"` line:

```json
"qa:ui": "cp tests/fixtures/tool-coverage.json src/mcp-app/tool-coverage.json 2>/dev/null; npx vite --open /test-harness.html --config vite.config.test-harness.mjs",
```

- [ ] **Step 3: Verify script syntax**

Run: `node -e "require('fs').readFileSync('vite.config.test-harness.mjs', 'utf-8'); console.log('OK')"`

Full visual verification happens after all tasks are complete (see Verification section).

- [ ] **Step 4: Commit**

```bash
git add vite.config.test-harness.mjs package.json
git commit -m "feat: add qa:ui script and Vite config for static test harness

npm run qa:ui opens the test harness on port 5175 with no OpenCode
dependency. Copies tool-coverage.json from tests/fixtures/ if available."
```

---

## Chunk 3: Integration Test + Gitignore + Docs

### Task 6: Add gitignore entries

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add gitignore entries for generated files**

Append to `.gitignore`:

```
# Tool coverage (generated by integration test, copied by qa:ui)
tests/fixtures/tool-coverage.json
src/mcp-app/tool-coverage.json
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore tool coverage JSON artifacts"
```

### Task 7: Create tool coverage integration test

**Files:**
- Create: `tests/fixtures/` (directory)
- Create: `tests/mcp-app/tool-coverage-e2e.integration.test.js`

**Context:** This test starts a real OpenCode server via `tests/helpers/start-server.js`, queries the `/experimental/tool/ids` endpoint, and compares the result against `Object.keys(TOOL_HANDLERS)`. It writes `tests/fixtures/tool-coverage.json` on every run. The test is skipped if `opencode-ai` is not installed. Known gaps (4 tools we don't have renderers for yet) are documented -- the test only fails on **new** undocumented tools.

- [ ] **Step 1: Create tests/fixtures directory**

Run: `mkdir -p tests/fixtures`

- [ ] **Step 2: Write the integration test**

Create `tests/mcp-app/tool-coverage-e2e.integration.test.js`:

```js
/**
 * Tool Coverage Integration Test
 *
 * Starts a real OpenCode server, queries the tool registry endpoint,
 * and asserts our TOOL_HANDLERS map covers every built-in tool.
 *
 * Skipped if opencode-ai is not installed (no LLM calls needed).
 * Writes tests/fixtures/tool-coverage.json for the static test harness.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { TOOL_HANDLERS } = require('../../src/mcp-app/tool-output');

// Skip if opencode-ai binary is not available
const HAS_OPENCODE = (() => {
  try { require.resolve('opencode-ai'); return true; } catch { return false; }
})();
const describeToolCoverage = HAS_OPENCODE ? describe : describe.skip;

/** Fetch JSON from a URL (no external deps). */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/** Known gaps: tools we know about but haven't built renderers for yet. */
const KNOWN_GAPS = ['websearch', 'codesearch', 'skill', 'apply_patch'];

describeToolCoverage('Tool Coverage E2E', () => {
  let serverProcess;
  let port;

  beforeAll(async () => {
    // Start real OpenCode server
    serverProcess = spawn(
      process.execPath,
      [path.join(__dirname, '..', 'helpers', 'start-server.js')],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Parse port from stdout
    const info = await new Promise((resolve, reject) => {
      let stdout = '';
      serverProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        const lines = stdout.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{')) {
            try {
              resolve(JSON.parse(trimmed));
            } catch { /* not valid JSON yet */ }
          }
        }
      });
      serverProcess.on('error', reject);
      setTimeout(() => reject(new Error('Server start timeout')), 30000);
    });

    port = info.port;
  }, 40000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  it('covers all OpenCode built-in tools (no undocumented gaps)', async () => {
    // 1. Query the authoritative tool list
    const toolIds = await fetchJSON(`http://localhost:${port}/experimental/tool/ids`);
    expect(Array.isArray(toolIds)).toBe(true);
    expect(toolIds.length).toBeGreaterThan(0);

    // 2. Filter out non-tool entries
    const builtinTools = toolIds
      .map(id => id.toLowerCase())
      .filter(id => id !== 'invalid')           // error sentinel
      .filter(id => !id.startsWith('mcp__'));   // provider-specific MCP tools

    // 3. Get our handled tool names
    const handledTools = Object.keys(TOOL_HANDLERS);

    // 4. Find missing tools
    const missing = builtinTools.filter(t => !handledTools.includes(t));

    // 5. Write coverage JSON (always, even on failure)
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    if (!fs.existsSync(fixturesDir)) { fs.mkdirSync(fixturesDir, { recursive: true }); }
    const coverageData = {
      generated: new Date().toISOString(),
      opencode: builtinTools,
      handled: handledTools.filter(t => builtinTools.includes(t)),
      missing,
    };
    fs.writeFileSync(
      path.join(fixturesDir, 'tool-coverage.json'),
      JSON.stringify(coverageData, null, 2) + '\n'
    );

    // 6. Assert: no UNDOCUMENTED missing tools
    const undocumented = missing.filter(t => !KNOWN_GAPS.includes(t));
    if (undocumented.length > 0) {
      throw new Error(
        `Missing renderer for undocumented tools: ${undocumented.join(', ')}\n` +
        'Add formatters in src/mcp-app/tools/ and wire them in tool-output.js.\n' +
        'Or add to KNOWN_GAPS in this test if intentionally deferred.\n' +
        'See docs/tool-coverage.md for instructions.'
      );
    }

    // 7. Log known gaps as info (not failure)
    const knownMissing = missing.filter(t => KNOWN_GAPS.includes(t));
    if (knownMissing.length > 0) {
      console.log(`Known gaps (deferred): ${knownMissing.join(', ')}`);
    }
  }, 60000);
});
```

- [ ] **Step 3: Run the test**

Run: `npm test tests/mcp-app/tool-coverage-e2e.integration.test.js`

Expected outcomes:
- If `opencode-ai` is installed: test runs, passes (known gaps are documented), writes `tests/fixtures/tool-coverage.json`
- If `opencode-ai` is not installed: test is skipped with "skipped 1 test"

- [ ] **Step 4: Commit**

```bash
git add tests/mcp-app/tool-coverage-e2e.integration.test.js
git commit -m "feat: add tool coverage integration test

Queries OpenCode /experimental/tool/ids endpoint and compares against
TOOL_HANDLERS map. Fails on undocumented missing tools. Writes
tests/fixtures/tool-coverage.json for the static test harness."
```

### Task 8: Create gap documentation

**Files:**
- Create: `docs/tool-coverage.md`

- [ ] **Step 1: Create the documentation file**

Create `docs/tool-coverage.md`:

```markdown
# Tool Coverage

Coverage matrix for MCP App tool renderers vs. OpenCode built-in tools.

## Coverage Matrix

| OpenCode Tool | Renderer | File |
|---------------|----------|------|
| `bash` | Yes | `src/mcp-app/tools/bash.js` |
| `read` | Yes | `src/mcp-app/tools/read.js` |
| `write` | Yes | `src/mcp-app/tools/write.js` |
| `edit` | Yes | `src/mcp-app/tools/edit.js` |
| `glob` | Yes | `src/mcp-app/tools/glob.js` |
| `grep` | Yes | `src/mcp-app/tools/grep.js` |
| `question` | Yes | `src/mcp-app/tools/question.js` |
| `list` / `ls` | Yes | `src/mcp-app/tools/list.js` |
| `task` | Yes | `src/mcp-app/tools/task.js` |
| `webfetch` | Yes | `src/mcp-app/tools/webfetch.js` |
| `todowrite` / `todoread` | Yes | `src/mcp-app/tools/todo.js` |
| `websearch` | **No** | Known gap |
| `codesearch` | **No** | Known gap |
| `skill` | **No** | Known gap |
| `apply_patch` | **No** | Known gap |

Tools not listed above (e.g. `mcp__*` prefixed) are provider-specific and use the generic fallback renderer (`src/mcp-app/tools/generic.js`).

## Missing Tool Details

| Tool | Description | Priority |
|------|-------------|----------|
| `websearch` | Web search with query, returns search results | Known gap |
| `codesearch` | Code-aware search (semantic/symbol search) | Known gap |
| `skill` | Invoke a skill by name with arguments | Known gap |
| `apply_patch` | Apply a unified diff patch to files | Known gap |

## How to Find Input/Output Schemas

Query the OpenCode tool schema endpoint with a valid provider/model pair:

    GET /experimental/tool?provider={provider}&model={model}

This returns JSON schemas for each tool's parameters. The `@opencode-ai/sdk` type definitions are also helpful: `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`.

## How to Build a New Renderer

1. Query the schema endpoint to understand the input/output shape
2. Start the interactive harness (`npm run dev:ui -- --model gemini --prompt "use <toolname>"`) and exercise the tool
3. Inspect raw API data via the browser console or CDP (see `docs/interactive-harness.md`)
4. Create `src/mcp-app/tools/<name>.js` following the CJS pattern:
   ```js
   const { escapeHtml } = require('../utils');

   function formatXxxOutput(input, output) {
     // Return an HTML string
     return '<div class="xxx-output">' + escapeHtml(output) + '</div>';
   }

   module.exports = { formatXxxOutput };
   ```
5. Add the entry to `TOOL_HANDLERS` in `src/mcp-app/tool-output.js`
6. Add mock data to `src/mcp-app/test-harness.js`
7. Add unit test in `tests/mcp-app/tools/<name>.test.js`
8. Remove from `KNOWN_GAPS` in `tests/mcp-app/tool-coverage-e2e.integration.test.js`
9. Run `npm run qa:ui` to visually verify the rendering

## Running the Coverage Test

```bash
# Run the integration test (requires opencode-ai installed)
npm test tests/mcp-app/tool-coverage-e2e.integration.test.js

# View the static test harness with coverage panel
npm run qa:ui
```

The integration test writes `tests/fixtures/tool-coverage.json`. The `qa:ui` script copies it to `src/mcp-app/tool-coverage.json` so the coverage panel can display it.

## Reference

- OpenCode SDK types: `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`
- Tool IDs endpoint: `GET /experimental/tool/ids`
- Tool schemas endpoint: `GET /experimental/tool?provider=X&model=Y`
- Existing renderer pattern: `src/mcp-app/tools/bash.js` (simplest example)
- Static test harness: `npm run qa:ui`
- Interactive harness: `npm run dev:ui` (see `docs/interactive-harness.md`)
```

- [ ] **Step 2: Commit**

```bash
git add docs/tool-coverage.md
git commit -m "docs: add tool coverage matrix and renderer build guide

Lists all OpenCode tools, which have renderers, and step-by-step
instructions for building missing ones. 4 known gaps documented."
```

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add new files to directory structure**

In the `CLAUDE.md` directory structure section, under `src/mcp-app/`, add these entries (after `tool-output.js`):

```
│   │   ├── test-harness.html    # Static test harness HTML (Vite-served)
│   │   ├── test-harness.js      # Mock data for all tool types (ESM)
```

Under the `tests/` section, add:

```
│   ├── fixtures/                # Generated test data (gitignored)
```

- [ ] **Step 2: Add to documentation index**

In the Documentation Index section at the bottom of CLAUDE.md, add:

```markdown
- [docs/tool-coverage.md](docs/tool-coverage.md) - Tool coverage matrix and renderer build guide
```

- [ ] **Step 3: Add qa:ui to Essential Commands**

In the Essential Commands section, under Development, add:

```bash
npm run qa:ui                     # Static test harness (no API needed)
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with test harness and coverage files"
```

---

## Verification

After all tasks are complete:

1. `npm test` -- all existing tests pass, new TOOL_HANDLERS tests pass
2. `npm test tests/mcp-app/tool-coverage-e2e.integration.test.js` -- passes (if opencode-ai installed) or skips gracefully
3. `npm run qa:ui` -- opens browser with all 12 tool types rendered correctly
4. Visual check: each tool renderer shows formatted output (not generic fallback)
5. Coverage panel shows green checks for handled tools, red X for known gaps
