# MCP Project Directory Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix sidecar MCP server failing in Cowork where `process.cwd()` returns `/` by adding a smart project directory fallback chain.

**Architecture:** Replace `getProjectDir()` one-liner with a fallback chain (explicit > cwd > $HOME). Add optional `project` param to MCP tool schemas. Wire `input.project` through handler dispatch.

**Tech Stack:** Node.js, Zod (MCP schemas), Jest

---

### Task 1: Write failing tests for `getProjectDir()`

**Files:**
- Create: `tests/mcp-project-dir.test.js`

**Step 1: Write failing tests**

```js
const os = require('os');
const path = require('path');

// We'll test the exported getProjectDir after implementation
// For now, test the contract we want

describe('getProjectDir', () => {
  let getProjectDir;

  beforeEach(() => {
    jest.resetModules();
  });

  test('returns explicit project path when valid directory', () => {
    const { getProjectDir } = require('../src/mcp-server');
    const result = getProjectDir(os.tmpdir());
    expect(result).toBe(os.tmpdir());
  });

  test('ignores explicit project path when directory does not exist', () => {
    const { getProjectDir } = require('../src/mcp-server');
    const result = getProjectDir('/nonexistent/path/that/does/not/exist');
    // Should fall through to cwd or home
    expect(result).not.toBe('/nonexistent/path/that/does/not/exist');
  });

  test('falls back to $HOME when cwd is root /', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/';
    try {
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir();
      expect(result).toBe(os.homedir());
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('uses cwd when it is a valid writable directory', () => {
    const originalCwd = process.cwd;
    process.cwd = () => os.tmpdir();
    try {
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir();
      expect(result).toBe(os.tmpdir());
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('returns $HOME when no explicit project and cwd is root', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/';
    try {
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir(undefined);
      expect(result).toBe(os.homedir());
    } finally {
      process.cwd = originalCwd;
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-project-dir.test.js`
Expected: FAIL — `getProjectDir` is not exported, or does not accept arguments

---

### Task 2: Implement `getProjectDir()` fallback chain

**Files:**
- Modify: `src/mcp-server.js:14` (replace `getProjectDir` function)

**Step 1: Replace the one-liner with fallback chain**

Replace line 14:
```js
function getProjectDir() { return process.cwd(); }
```

With:
```js
/**
 * Resolve the project directory with smart fallback.
 * 1. Explicit path (if provided and exists)
 * 2. process.cwd() (if not "/" and exists)
 * 3. os.homedir() (final fallback)
 * @param {string} [explicitProject] - Optional explicit project path
 * @returns {string} Resolved project directory
 */
function getProjectDir(explicitProject) {
  if (explicitProject && fs.existsSync(explicitProject)) {
    return explicitProject;
  }

  const cwd = process.cwd();
  if (cwd !== '/' && fs.existsSync(cwd)) {
    return cwd;
  }

  if (cwd === '/') {
    logger.warn('process.cwd() is root (/), falling back to $HOME for session storage');
  }
  return os.homedir();
}
```

Also add `os` require at the top of the file (after existing requires):
```js
const os = require('os');
```

And export `getProjectDir` in `module.exports`:
```js
module.exports = { handlers, startMcpServer, getProjectDir };
```

**Step 2: Run tests to verify they pass**

Run: `npm test tests/mcp-project-dir.test.js`
Expected: PASS (all 5 tests)

**Step 3: Run existing MCP tests to verify no regressions**

Run: `npm test tests/mcp-server.test.js`
Expected: PASS (all existing tests unchanged — they pass `project` as 2nd arg to handlers)

**Step 4: Commit**

```bash
git add src/mcp-server.js tests/mcp-project-dir.test.js
git commit -m "feat: smart project directory fallback for MCP server"
```

---

### Task 3: Add `project` parameter to MCP tool schemas

**Files:**
- Modify: `src/mcp-tools.js`

**Step 1: Write failing test for project param in tool schemas**

Add to `tests/mcp-tools.test.js` (or create if needed):

```js
describe('MCP tool schemas include project param', () => {
  const { TOOLS } = require('../src/mcp-tools');
  const toolsWithProject = [
    'sidecar_start', 'sidecar_status', 'sidecar_read',
    'sidecar_list', 'sidecar_resume', 'sidecar_continue', 'sidecar_abort',
  ];

  for (const name of toolsWithProject) {
    test(`${name} has optional project parameter`, () => {
      const tool = TOOLS.find(t => t.name === name);
      expect(tool).toBeDefined();
      expect(tool.inputSchema.project).toBeDefined();
    });
  }

  test('sidecar_setup does NOT have project parameter', () => {
    const tool = TOOLS.find(t => t.name === 'sidecar_setup');
    expect(tool.inputSchema.project).toBeUndefined();
  });

  test('sidecar_guide does NOT have project parameter', () => {
    const tool = TOOLS.find(t => t.name === 'sidecar_guide');
    expect(tool.inputSchema.project).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-tools.test.js`
Expected: FAIL — `project` not yet in schemas

**Step 3: Add project param to tool schemas**

In `src/mcp-tools.js`, add to each of the 7 tools' `inputSchema`:

```js
project: z.string().optional().describe(
  'Optional project directory path. Auto-detected from working directory if omitted.'
),
```

Add to: `sidecar_start`, `sidecar_status`, `sidecar_read`, `sidecar_list`, `sidecar_resume`, `sidecar_continue`, `sidecar_abort`.

Do NOT add to: `sidecar_setup`, `sidecar_guide`.

**Step 4: Run tests to verify they pass**

Run: `npm test tests/mcp-tools.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp-tools.js tests/mcp-tools.test.js
git commit -m "feat: add optional project param to MCP tool schemas"
```

---

### Task 4: Wire `input.project` through MCP handler dispatch

**Files:**
- Modify: `src/mcp-server.js:244-246` (tool registration loop)

**Step 1: Write failing test for project passthrough**

Add to `tests/mcp-project-dir.test.js`:

```js
describe('MCP handler dispatch passes input.project', () => {
  test('sidecar_list uses input.project when provided', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proj-'));
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'test1');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'test1', status: 'complete', model: 'gemini',
      createdAt: new Date().toISOString(),
    }));

    try {
      const { handlers } = require('../src/mcp-server');
      // Pass project via input (simulating MCP tool call)
      const result = await handlers.sidecar_list({ project: tmpDir });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('test1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-project-dir.test.js`
Expected: FAIL — handlers currently use `project || getProjectDir()` but project comes from 2nd positional arg, not `input.project`

**Step 3: Update handlers to use `input.project`**

In `src/mcp-server.js`, update each handler that uses `project`:

For handlers that currently do `const cwd = project || getProjectDir();`, change to:
```js
const cwd = project || getProjectDir(input.project);
```

This affects: `sidecar_start`, `sidecar_status`, `sidecar_read`, `sidecar_list`, `sidecar_resume`, `sidecar_continue`, `sidecar_abort`.

Also update the tool registration dispatch (line ~244) to pass `input.project`:
```js
async (input) => {
  try {
    return await handlers[tool.name](input, getProjectDir(input.project));
  } catch (err) {
    logger.error(`MCP tool error: ${tool.name}`, { error: err.message });
    return textResult(`Error: ${err.message}`, true);
  }
}
```

And update `spawnSidecarProcess` to accept cwd:
```js
function spawnSidecarProcess(args, cwd) {
  const sidecarBin = path.join(__dirname, '..', 'bin', 'sidecar.js');
  const child = spawn('node', [sidecarBin, ...args], {
    cwd: cwd || getProjectDir(), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  child.unref();
  return child;
}
```

**Step 4: Run all tests**

Run: `npm test tests/mcp-project-dir.test.js tests/mcp-server.test.js tests/mcp-tools.test.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/mcp-server.js tests/mcp-project-dir.test.js
git commit -m "feat: wire input.project through MCP handler dispatch"
```

---

### Task 5: Run full test suite and verify

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS, no regressions

**Step 2: Manual smoke test — simulate Cowork environment**

```bash
# Simulate cwd=/ like Cowork does
cd / && node /Users/john_renaldi/claude-code-projects/sidecar/bin/sidecar.js mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"sidecar_list","arguments":{}}}'
```

Expected: Should return "No sidecar sessions found" (not crash with EACCES)

**Step 3: Commit if any fixes needed, then final commit**

```bash
git add -A
git commit -m "test: verify MCP project dir fallback works end-to-end"
```

---

### Task 6: Bump version and publish

**Step 1: Bump patch version**

```bash
npm version patch
```

**Step 2: Push and publish**

```bash
git push origin main --tags
```

The GitHub Actions workflow will publish automatically.
