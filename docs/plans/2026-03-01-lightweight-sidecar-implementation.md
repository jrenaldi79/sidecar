# Sidecar v3 Lightweight Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 14K lines of custom Electron UI with a thin OpenCode Web UI wrapper while keeping all core business logic, adding multi-environment support, and renaming CLI args to match the v3 spec.

**Architecture:** Surgical replacement - delete all custom UI modules (`electron/ui/`), rewrite `electron/main.js` as a thin shell that loads OpenCode's Web UI at `localhost:<port>`, inject a fold button. Keep all `src/` core logic intact. Add `src/environment.js` for multi-environment detection and `src/context-compression.js` for large context handling.

**Tech Stack:** Node.js (ESM via CommonJS), Electron (thin shell), OpenCode SDK, tiktoken, Jest

**Design doc:** `docs/plans/2026-03-01-lightweight-sidecar-design.md`

---

## Phase 1: Core Logic Updates (no UI changes yet)

These tasks modify `src/` modules. All existing tests should still pass after each task (with test updates). The Electron UI is untouched until Phase 2.

---

### Task 1: Create `src/environment.js` - Environment Detection

**Files:**
- Create: `src/environment.js`
- Create: `tests/environment.test.js`

**Step 1: Write the failing tests**

```javascript
// tests/environment.test.js
const { detectEnvironment, resolveSessionRoot, CLIENTS } = require('../src/environment');

describe('environment', () => {
  describe('CLIENTS', () => {
    it('should define code-local, code-web, and cowork', () => {
      expect(CLIENTS).toEqual({
        CODE_LOCAL: 'code-local',
        CODE_WEB: 'code-web',
        COWORK: 'cowork'
      });
    });
  });

  describe('detectEnvironment', () => {
    it('should use --client flag when provided', () => {
      const result = detectEnvironment({ client: 'code-web' });
      expect(result.client).toBe('code-web');
    });

    it('should detect code-local on macOS with display', () => {
      const result = detectEnvironment({}, { platform: 'darwin' });
      expect(result.client).toBe('code-local');
      expect(result.hasDisplay).toBe(true);
    });

    it('should detect code-local on linux with DISPLAY env var', () => {
      const result = detectEnvironment({}, { platform: 'linux', env: { DISPLAY: ':0' } });
      expect(result.client).toBe('code-local');
      expect(result.hasDisplay).toBe(true);
    });

    it('should detect code-web on linux without DISPLAY', () => {
      const result = detectEnvironment({}, { platform: 'linux', env: {} });
      expect(result.client).toBe('code-web');
      expect(result.hasDisplay).toBe(false);
    });

    it('should detect code-web on linux with DISPLAY empty string', () => {
      const result = detectEnvironment({}, { platform: 'linux', env: { DISPLAY: '' } });
      expect(result.client).toBe('code-web');
      expect(result.hasDisplay).toBe(false);
    });
  });

  describe('resolveSessionRoot', () => {
    it('should return session-dir when provided', () => {
      const result = resolveSessionRoot({
        client: 'code-web',
        sessionDir: '/sandbox/sessions'
      });
      expect(result).toBe('/sandbox/sessions');
    });

    it('should return claude projects path for code-local', () => {
      const result = resolveSessionRoot({
        client: 'code-local',
        cwd: '/Users/john/myproject'
      }, '/Users/john');
      expect(result).toContain('.claude/projects');
      expect(result).toContain('-Users-john-myproject');
    });

    it('should require session-dir for code-web', () => {
      expect(() => resolveSessionRoot({
        client: 'code-web'
      })).toThrow('--session-dir is required');
    });

    it('should return cowork app data path for cowork on macOS', () => {
      const result = resolveSessionRoot({
        client: 'cowork'
      }, '/Users/john', 'darwin');
      expect(result).toContain('Library/Application Support');
      expect(result).toContain('Claude Cowork');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/environment.test.js`
Expected: FAIL with "Cannot find module '../src/environment'"

**Step 3: Write minimal implementation**

```javascript
// src/environment.js
/**
 * Environment Detection
 *
 * Detects the client environment (code-local, code-web, cowork)
 * and resolves session data paths accordingly.
 */

const path = require('path');
const os = require('os');

const CLIENTS = {
  CODE_LOCAL: 'code-local',
  CODE_WEB: 'code-web',
  COWORK: 'cowork'
};

const VALID_CLIENTS = Object.values(CLIENTS);

/**
 * Detect the current environment
 * @param {object} args - CLI args (may include --client)
 * @param {object} [system] - System overrides for testing
 * @returns {{ client: string, hasDisplay: boolean }}
 */
function detectEnvironment(args = {}, system = {}) {
  // Explicit --client flag takes priority
  if (args.client && VALID_CLIENTS.includes(args.client)) {
    const hasDisplay = args.client !== CLIENTS.CODE_WEB;
    return { client: args.client, hasDisplay };
  }

  const platform = system.platform || os.platform();
  const env = system.env || process.env;

  // macOS always has a display
  if (platform === 'darwin') {
    return { client: CLIENTS.CODE_LOCAL, hasDisplay: true };
  }

  // Linux: check DISPLAY env var
  if (env.DISPLAY && env.DISPLAY.length > 0) {
    return { client: CLIENTS.CODE_LOCAL, hasDisplay: true };
  }

  // No display available - web sandbox
  return { client: CLIENTS.CODE_WEB, hasDisplay: false };
}

/**
 * Resolve the session data root directory
 * @param {object} args - CLI args
 * @param {string} [homeDir] - Home directory override
 * @param {string} [platform] - Platform override
 * @returns {string} Path to session root directory
 */
function resolveSessionRoot(args, homeDir = os.homedir(), platform = os.platform()) {
  // Explicit --session-dir always wins
  if (args.sessionDir) {
    return args.sessionDir;
  }

  const client = args.client;

  switch (client) {
    case CLIENTS.CODE_LOCAL: {
      const cwd = args.cwd || process.cwd();
      const encodedPath = cwd.replace(/[/\\_]/g, '-');
      return path.join(homeDir, '.claude', 'projects', encodedPath);
    }

    case CLIENTS.CODE_WEB:
      throw new Error('--session-dir is required for code-web client');

    case CLIENTS.COWORK: {
      if (platform === 'darwin') {
        return path.join(homeDir, 'Library', 'Application Support', 'Claude Cowork');
      }
      if (platform === 'win32') {
        return path.join(homeDir, 'AppData', 'Roaming', 'Claude Cowork');
      }
      // Linux
      return path.join(homeDir, '.config', 'Claude Cowork');
    }

    default:
      throw new Error(`Unknown client type: ${client}`);
  }
}

module.exports = {
  CLIENTS,
  VALID_CLIENTS,
  detectEnvironment,
  resolveSessionRoot
};
```

**Step 4: Run tests to verify they pass**

Run: `npm test tests/environment.test.js`
Expected: PASS (all 9 tests)

**Step 5: Commit**

```bash
git add src/environment.js tests/environment.test.js
git commit -m "feat: add environment detection for multi-client support"
```

---

### Task 2: Rename CLI Args (`--briefing` -> `--prompt`, etc.)

**Files:**
- Modify: `src/cli.js`
- Modify: `tests/cli.test.js`

**Step 1: Update tests first**

In `tests/cli.test.js`, find and replace all test assertions that reference old arg names. Key changes:

- All tests using `--briefing` -> `--prompt`
- All tests using `--project` -> `--cwd`
- All tests using `--headless` -> `--no-ui`
- All tests using `--session` -> `--session-id`
- Default assertions: `args.project` -> `args.cwd`, `args.session` -> `args['session-id']`, `args.headless` -> `args['no-ui']`
- Validation error messages: `--briefing is required` -> `--prompt is required`

Also add new test cases:

```javascript
describe('new v3 flags', () => {
  it('should parse --client flag', () => {
    const args = parseArgs(['start', '--model', 'google/gemini-2.5', '--prompt', 'test', '--client', 'code-web']);
    expect(args.client).toBe('code-web');
  });

  it('should parse --session-dir flag', () => {
    const args = parseArgs(['start', '--model', 'google/gemini-2.5', '--prompt', 'test', '--session-dir', '/sandbox/data']);
    expect(args['session-dir']).toBe('/sandbox/data');
  });

  it('should parse --cwd flag', () => {
    const args = parseArgs(['start', '--model', 'google/gemini-2.5', '--prompt', 'test', '--cwd', '/my/project']);
    expect(args.cwd).toBe('/my/project');
  });

  it('should parse --no-ui as boolean', () => {
    const args = parseArgs(['start', '--model', 'google/gemini-2.5', '--prompt', 'test', '--no-ui']);
    expect(args['no-ui']).toBe(true);
  });

  it('should parse --fold-shortcut flag', () => {
    const args = parseArgs(['start', '--model', 'google/gemini-2.5', '--prompt', 'test', '--fold-shortcut', 'Ctrl+Shift+F']);
    expect(args['fold-shortcut']).toBe('Ctrl+Shift+F');
  });

  it('should parse --opencode-port as numeric', () => {
    const args = parseArgs(['start', '--model', 'google/gemini-2.5', '--prompt', 'test', '--opencode-port', '4096']);
    expect(args['opencode-port']).toBe(4096);
  });

  it('should parse --setup as boolean', () => {
    const args = parseArgs(['start', '--setup']);
    expect(args.setup).toBe(true);
  });
});

describe('validateStartArgs with new names', () => {
  it('should require --prompt instead of --briefing', () => {
    const result = validateStartArgs({ model: 'google/gemini-2.5', cwd: process.cwd() });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('--prompt is required');
  });

  it('should validate --client values', () => {
    const args = {
      model: 'google/gemini-2.5',
      prompt: 'test',
      cwd: process.cwd(),
      client: 'invalid'
    };
    const result = validateStartArgs(args);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('--client');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/cli.test.js`
Expected: FAIL - old assertions no longer match

**Step 3: Update `src/cli.js`**

Changes needed in `src/cli.js`:

1. **DEFAULTS** (line 23-31): Rename keys
   - `session: 'current'` -> `'session-id': 'current'`
   - `project: process.cwd()` -> `cwd: process.cwd()`
   - `headless: false` -> `'no-ui': false`

2. **isBooleanFlag** (line 75-86): Update list
   - `'headless'` -> `'no-ui'`
   - Add `'setup'`

3. **parseValue** (line 91-109): Add `'opencode-port'` to numeric options

4. **validateStartArgs** (line 116-207): Rename references
   - `args.briefing` -> `args.prompt`
   - `args.project` -> `args.cwd`
   - `args.session` -> `args['session-id']`
   - Error messages: `--briefing` -> `--prompt`
   - Add validation for `--client` (must be one of: code-local, code-web, cowork)

5. **getUsage** (line 293-371): Update help text
   - `--briefing` -> `--prompt`
   - `--project` -> `--cwd`
   - `--headless` -> `--no-ui`
   - `--session` -> `--session-id`
   - Add new flags
   - Remove subagent commands

**Step 4: Run tests to verify they pass**

Run: `npm test tests/cli.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.js tests/cli.test.js
git commit -m "feat: rename CLI args to match v3 spec (--prompt, --cwd, --no-ui, --client)"
```

---

### Task 3: Update `bin/sidecar.js` for New Arg Names

**Files:**
- Modify: `bin/sidecar.js`
- Modify: `tests/e2e.test.js` (arg name references)

**Step 1: Update e2e tests for new arg names**

In `tests/e2e.test.js`, replace all references:
- `--briefing` -> `--prompt`
- `--project` -> `--cwd`
- `--headless` -> `--no-ui`
- `--session` -> `--session-id`
- `args.briefing` -> `args.prompt`
- `args.project` -> `args.cwd`

**Step 2: Run tests to verify they fail**

Run: `npm test tests/e2e.test.js`
Expected: FAIL

**Step 3: Update `bin/sidecar.js`**

In `handleStart()` (line 67-97), rename the options object:

```javascript
await startSidecar({
  model: args.model,
  prompt: args.prompt,              // was: briefing
  sessionId: args['session-id'],    // was: session
  cwd: args.cwd,                    // was: project
  client: args.client,              // new
  sessionDir: args['session-dir'],  // new
  contextTurns: args['context-turns'],
  contextSince: args['context-since'],
  contextMaxTokens: args['context-max-tokens'],
  noUi: args['no-ui'],              // was: headless
  timeout: args.timeout,
  agent,
  mcp: args.mcp,
  mcpConfig: args['mcp-config'],
  thinking: args.thinking,
  summaryLength: args['summary-length'],
  foldShortcut: args['fold-shortcut'],   // new
  opencodePort: args['opencode-port']    // new
});
```

In `handleResume()`, `handleContinue()`, `handleRead()`, `handleList()`:
- Replace `project: args.project` -> `cwd: args.cwd`
- Replace `headless: args.headless` -> `noUi: args['no-ui']`
- Replace `briefing: args.briefing` -> `prompt: args.prompt`

**Step 4: Run tests to verify they pass**

Run: `npm test tests/e2e.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add bin/sidecar.js tests/e2e.test.js
git commit -m "feat: update CLI entry point for v3 arg names"
```

---

### Task 4: Update `src/sidecar/start.js` for New Arg Names

**Files:**
- Modify: `src/sidecar/start.js`
- Modify: `tests/sidecar/start.test.js`

**Step 1: Update tests**

In `tests/sidecar/start.test.js`, rename all option references:
- `briefing:` -> `prompt:`
- `project:` -> `cwd:`
- `headless:` -> `noUi:`
- `session:` -> `sessionId:`
- Add test for new `client` and `sessionDir` options being passed through

**Step 2: Run tests to verify they fail**

Run: `npm test tests/sidecar/start.test.js`
Expected: FAIL

**Step 3: Update `src/sidecar/start.js`**

Rename all internal references to match new option names. The function signature changes from:

```javascript
async function startSidecar({ model, briefing, session, project, ... })
```

to:

```javascript
async function startSidecar({ model, prompt, sessionId, cwd, client, sessionDir, noUi, ... })
```

Update all internal uses of `briefing` -> `prompt`, `project` -> `cwd`, `headless` -> `noUi`, `session` -> `sessionId`.

**Step 4: Run tests to verify they pass**

Run: `npm test tests/sidecar/start.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sidecar/start.js tests/sidecar/start.test.js
git commit -m "feat: update startSidecar for v3 arg names"
```

---

### Task 5: Cascade Arg Renames to Remaining Sidecar Modules

**Files:**
- Modify: `src/sidecar/resume.js`, `src/sidecar/continue.js`, `src/sidecar/read.js`
- Modify: `src/sidecar/context-builder.js`, `src/sidecar/session-utils.js`
- Modify: `src/index.js`
- Modify: corresponding test files

This is a mechanical rename. For each file:

1. Replace `briefing` -> `prompt` in function params, internal usage, and log messages
2. Replace `project` -> `cwd`
3. Replace `headless` -> `noUi`
4. Replace `session` -> `sessionId` (where it refers to the CLI arg, not OpenCode session objects)

**Step 1: Update all test files first**

Files to update:
- `tests/sidecar/resume.test.js`
- `tests/sidecar/continue.test.js`
- `tests/sidecar/read.test.js`
- `tests/sidecar/context-builder.test.js`
- `tests/sidecar/session-utils.test.js`
- `tests/index.test.js`

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: Multiple failures from renamed args

**Step 3: Update all source files**

Apply the same rename pattern across all files listed above.

**Step 4: Run full test suite**

Run: `npm test`
Expected: ALL tests pass

**Step 5: Commit**

```bash
git add src/sidecar/ src/index.js tests/sidecar/ tests/index.test.js
git commit -m "feat: cascade v3 arg renames across all sidecar modules"
```

---

### Task 6: Update Fold Marker `[SIDECAR_COMPLETE]` -> `[SIDECAR_FOLD]`

**Files:**
- Modify: `src/headless.js` (line 27, 371, 373, 439, 440)
- Modify: `src/prompt-builder.js` (lines 245, 260, 294, 303, 310)
- Modify: `tests/headless.test.js`
- Modify: `tests/prompt-builder.test.js`
- Modify: `tests/index.test.js`

**Step 1: Update test assertions**

In all test files, replace `SIDECAR_COMPLETE` with `SIDECAR_FOLD`. Also add assertions for new fold output fields (`Client:`, `CWD:`).

```javascript
// In headless.test.js - add test for new fold format
it('should include Client and CWD in fold output', () => {
  const output = formatFoldOutput({
    model: 'google/gemini-2.5-pro',
    sessionId: 'test-123',
    client: 'code-local',
    cwd: '/Users/john/project',
    mode: 'headless',
    summary: 'Test summary'
  });
  expect(output).toContain('[SIDECAR_FOLD]');
  expect(output).toContain('Client: code-local');
  expect(output).toContain('CWD: /Users/john/project');
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/headless.test.js tests/prompt-builder.test.js`
Expected: FAIL

**Step 3: Update source files**

In `src/headless.js`:
- Line 27: `const FOLD_MARKER = '[SIDECAR_FOLD]';`
- Line 371, 373: Update timeout prompt text
- Line 439-440: Update JSDoc comment
- Add `formatFoldOutput()` function that includes Client and CWD fields
- Export `FOLD_MARKER` instead of `COMPLETE_MARKER`

In `src/prompt-builder.js`:
- Replace all `[SIDECAR_COMPLETE]` with `[SIDECAR_FOLD]`

In `src/index.js`:
- Update import: `COMPLETE_MARKER` -> `FOLD_MARKER`

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/headless.js src/prompt-builder.js src/index.js tests/headless.test.js tests/prompt-builder.test.js tests/index.test.js
git commit -m "feat: rename fold marker to [SIDECAR_FOLD] with Client and CWD fields"
```

---

### Task 7: Create `src/context-compression.js`

**Files:**
- Create: `src/context-compression.js`
- Create: `tests/context-compression.test.js`

**Step 1: Write the failing tests**

```javascript
// tests/context-compression.test.js
const { compressContext, buildPreamble, shouldCompress, TOKEN_THRESHOLD } = require('../src/context-compression');

describe('context-compression', () => {
  describe('TOKEN_THRESHOLD', () => {
    it('should be 30000', () => {
      expect(TOKEN_THRESHOLD).toBe(30000);
    });
  });

  describe('buildPreamble', () => {
    it('should include cwd in preamble', () => {
      const preamble = buildPreamble('/Users/john/project');
      expect(preamble).toContain('/Users/john/project');
      expect(preamble).toContain('You are working in');
    });
  });

  describe('shouldCompress', () => {
    it('should return false for short context', () => {
      const turns = [{ role: 'user', content: 'Hello' }];
      expect(shouldCompress(turns)).toBe(false);
    });

    it('should return true for context over threshold', () => {
      // Create a large context (~40K tokens worth)
      const longContent = 'word '.repeat(10000);
      const turns = [
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent }
      ];
      expect(shouldCompress(turns)).toBe(true);
    });
  });

  describe('compressContext', () => {
    it('should return as-is with preamble for short context', async () => {
      const turns = [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' }
      ];
      const result = await compressContext(turns, { cwd: '/project' });
      expect(result).toContain('You are working in /project');
      expect(result).toContain('What is 2+2?');
      expect(result).toContain('4');
    });

    it('should compress large context with summarizer', async () => {
      const longContent = 'word '.repeat(10000);
      const turns = Array(5).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: longContent
      }));

      const result = await compressContext(turns, {
        cwd: '/project',
        summarize: async (text) => 'Compressed summary of conversation'
      });
      expect(result).toContain('You are working in /project');
      expect(result).toContain('Compressed');
    });

    it('should truncate to recent turns as fallback when no summarizer', async () => {
      const longContent = 'word '.repeat(10000);
      const turns = Array(20).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: longContent
      }));

      const result = await compressContext(turns, { cwd: '/project' });
      expect(result).toContain('Truncated to last');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/context-compression.test.js`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```javascript
// src/context-compression.js
/**
 * Context Compression
 *
 * Handles large conversation contexts by compressing them
 * when they exceed the token threshold.
 */

const { estimateTokens } = require('./context');
const { logger } = require('./utils/logger');

const TOKEN_THRESHOLD = 30000;

/**
 * Build a context preamble
 * @param {string} cwd - Working directory
 * @returns {string} Preamble text
 */
function buildPreamble(cwd) {
  return `You are working in ${cwd}. Here is the conversation:`;
}

/**
 * Check if turns need compression
 * @param {Array} turns - Conversation turns
 * @returns {boolean} Whether compression is needed
 */
function shouldCompress(turns) {
  const text = turns.map(t => t.content || '').join('\n');
  const tokens = estimateTokens(text);
  return tokens > TOKEN_THRESHOLD;
}

/**
 * Compress context if needed, otherwise return as-is with preamble
 * @param {Array} turns - Conversation turns
 * @param {object} options - Options
 * @param {string} options.cwd - Working directory
 * @param {Function} [options.summarize] - Summarization function
 * @returns {Promise<string>} Compressed or raw context with preamble
 */
async function compressContext(turns, options = {}) {
  const { cwd = process.cwd(), summarize } = options;
  const preamble = buildPreamble(cwd);

  const text = turns.map(t => {
    const role = t.role === 'user' ? 'Human' : 'Assistant';
    return `${role}: ${t.content || ''}`;
  }).join('\n\n');

  if (!shouldCompress(turns)) {
    logger.debug('Context within threshold, sending as-is', {
      tokenEstimate: estimateTokens(text)
    });
    return `${preamble}\n\n${text}`;
  }

  logger.info('Context exceeds threshold, compressing', {
    tokenEstimate: estimateTokens(text),
    threshold: TOKEN_THRESHOLD
  });

  if (summarize) {
    const compressed = await summarize(text);
    return `${preamble}\n\n[Compressed from ${turns.length} turns]\n\n${compressed}`;
  }

  // Fallback: truncate to recent turns
  const recentTurns = turns.slice(-10);
  const recentText = recentTurns.map(t => {
    const role = t.role === 'user' ? 'Human' : 'Assistant';
    return `${role}: ${t.content || ''}`;
  }).join('\n\n');

  return `${preamble}\n\n[Truncated to last ${recentTurns.length} turns]\n\n${recentText}`;
}

module.exports = {
  TOKEN_THRESHOLD,
  buildPreamble,
  shouldCompress,
  compressContext
};
```

**Step 4: Run tests to verify they pass**

Run: `npm test tests/context-compression.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/context-compression.js tests/context-compression.test.js
git commit -m "feat: add context compression for large conversations (>30K tokens)"
```

---

### Task 8: Update `src/session.js` for Multi-Environment Paths

**Files:**
- Modify: `src/session.js`
- Modify: `tests/session.test.js`

**Step 1: Add tests for Cowork path resolution**

Add to `tests/session.test.js`:

```javascript
describe('getCoworkSessionDirectory', () => {
  it('should return macOS path on darwin', () => {
    const dir = getCoworkSessionDirectory('/Users/john', 'darwin');
    expect(dir).toBe('/Users/john/Library/Application Support/Claude Cowork');
  });

  it('should return linux path on linux', () => {
    const dir = getCoworkSessionDirectory('/home/john', 'linux');
    expect(dir).toBe('/home/john/.config/Claude Cowork');
  });

  it('should return windows path on win32', () => {
    const dir = getCoworkSessionDirectory('C:\\Users\\john', 'win32');
    expect(dir).toContain('AppData');
    expect(dir).toContain('Claude Cowork');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/session.test.js`
Expected: FAIL - `getCoworkSessionDirectory` not defined

**Step 3: Add `getCoworkSessionDirectory` to `src/session.js`**

Add after `getSessionDirectory()`:

```javascript
/**
 * Get the session directory for Cowork
 * @param {string} homeDir - Home directory
 * @param {string} platform - OS platform
 * @returns {string} Cowork session directory
 */
function getCoworkSessionDirectory(homeDir = os.homedir(), platform = os.platform()) {
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Claude Cowork');
  }
  if (platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'Claude Cowork');
  }
  return path.join(homeDir, '.config', 'Claude Cowork');
}
```

Export it from `module.exports`.

**Step 4: Run tests to verify they pass**

Run: `npm test tests/session.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/session.js tests/session.test.js
git commit -m "feat: add Cowork session path resolution for multi-environment support"
```

---

### Task 9: Wire Environment Detection into Context Builder

**Files:**
- Modify: `src/sidecar/context-builder.js`
- Modify: `tests/sidecar/context-builder.test.js`

**Step 1: Add tests for environment-aware context building**

```javascript
// Add to tests/sidecar/context-builder.test.js
describe('buildContext with client types', () => {
  it('should use session-dir for code-web client', async () => {
    const result = await buildContext({
      client: 'code-web',
      sessionDir: '/sandbox/sessions',
      sessionId: 'test-123',
      contextTurns: 10
    });
    expect(result).toBeDefined();
  });

  it('should use standard path for code-local client', async () => {
    const result = await buildContext({
      client: 'code-local',
      cwd: tmpDir,
      sessionId: 'current',
      contextTurns: 10
    });
    expect(result).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/sidecar/context-builder.test.js`
Expected: FAIL

**Step 3: Update `buildContext()` to accept client and sessionDir**

Import `resolveSessionRoot` from `src/environment.js` and use it to determine the session directory instead of always using the code-local path.

**Step 4: Run tests to verify they pass**

Run: `npm test tests/sidecar/context-builder.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sidecar/context-builder.js tests/sidecar/context-builder.test.js
git commit -m "feat: wire environment detection into context builder"
```

---

### Task 10: Delete Obsolete Modules and Tests

**Files:**
- Delete: `src/subagent-manager.js`
- Delete: `src/utils/model-capabilities.js`
- Delete: `src/utils/agent-model-config.js`
- Delete: `tests/subagent-manager.test.js`
- Delete: `tests/headless-subagent.test.js`
- Delete: `tests/context-panel.test.js`
- Modify: `src/index.js` (remove obsolete imports/exports)
- Modify: `src/cli.js` (remove subagent command validation)

**Step 1: Remove imports from `src/index.js`**

Remove any imports and exports for deleted modules.

**Step 2: Remove subagent validation from `src/cli.js`**

Remove `validateSubagentArgs()` function and subagent references from `getUsage()`.

**Step 3: Delete the files**

```bash
rm src/subagent-manager.js
rm src/utils/model-capabilities.js
rm src/utils/agent-model-config.js
rm tests/subagent-manager.test.js
rm tests/headless-subagent.test.js
rm tests/context-panel.test.js
```

**Step 4: Run full test suite**

Run: `npm test`
Expected: ALL remaining tests pass

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete modules (subagent-manager, model-capabilities, agent-model-config)"
```

---

## Phase 2: Electron UI Replacement

These tasks delete the custom UI and replace it with a thin OpenCode Web UI wrapper.

---

### Task 11: Delete Custom UI Files

**Files:**
- Delete: All files in `electron/ui/` (renderer.js, model-picker.js, model-registry.js, agent-model-config.js, thinking-picker.js, mode-picker.js, context-panel.js, autocomplete.js, file-autocomplete.js, command-autocomplete.js, mcp-manager.js, index.html, styles.css)
- Delete: `electron/preload-v2.js`
- Delete: `electron/main-legacy.js`
- Delete: `electron/theme.js`

**Step 1: Delete all custom UI files**

```bash
rm -rf electron/ui/
rm electron/preload-v2.js
rm electron/main-legacy.js
rm electron/theme.js
```

**Step 2: Run test suite to check for broken imports**

Run: `npm test`
Expected: PASS (no src/ code imports from electron/)

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete 14K lines of custom Electron UI (replaced by OpenCode Web UI)"
```

---

### Task 12: Create Minimal `electron/preload.js`

**Files:**
- Rewrite: `electron/preload.js`

**Step 1: Write the minimal preload**

```javascript
// electron/preload.js
/**
 * Minimal Preload - Fold Signal Only
 *
 * Exposes a single IPC channel for the fold button/shortcut.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sidecar', {
  fold: () => ipcRenderer.send('sidecar:fold'),
  onFoldTriggered: (callback) => ipcRenderer.on('sidecar:fold-triggered', callback)
});
```

**Step 2: Commit**

```bash
git add electron/preload.js
git commit -m "feat: minimal preload with fold-only IPC"
```

---

### Task 13: Create Fold Button CSS

**Files:**
- Create: `electron/fold-button.css`

**Step 1: Write the fold button styles**

```css
/* electron/fold-button.css - Injected floating fold button for OpenCode Web UI */
#sidecar-fold-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 99999;
  padding: 12px 24px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

#sidecar-fold-btn:hover {
  background: #6d28d9;
  box-shadow: 0 6px 16px rgba(124, 58, 237, 0.5);
  transform: translateY(-1px);
}

#sidecar-fold-btn .shortcut {
  font-size: 11px;
  opacity: 0.7;
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
}
```

**Step 2: Commit**

```bash
git add electron/fold-button.css
git commit -m "feat: add fold button CSS for OpenCode Web UI injection"
```

---

### Task 14: Rewrite `electron/main.js` as Thin Shell

**Files:**
- Rewrite: `electron/main.js`

This is the largest single task. The new `main.js` (~150 lines) does:

1. Parse config from process env (SIDECAR_ELECTRON_CONFIG)
2. Open BrowserWindow to OpenCode Web UI URL
3. Inject fold button via safe DOM methods (no innerHTML)
4. Register global shortcut for fold
5. Handle fold: summarize session, write to stdout, quit
6. Handle window close: prompt to fold first

**Step 1: Write the new `electron/main.js`**

```javascript
// electron/main.js
/**
 * Sidecar Electron Shell
 *
 * Thin wrapper that loads OpenCode's Web UI and injects a fold button.
 * All chat UI, model picking, and tool management is handled by OpenCode.
 */

const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { logger } = require('../src/utils/logger');

// Parse config from env var passed by sidecar CLI
const config = JSON.parse(process.env.SIDECAR_ELECTRON_CONFIG || '{}');
const {
  opencodeUrl = 'http://localhost:4096',
  sessionId,
  model,
  cwd,
  client = 'code-local',
  foldShortcut = 'CommandOrControl+Shift+F'
} = config;

let mainWindow = null;
let hasFolded = false;

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `Sidecar - ${model || 'OpenCode'}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load OpenCode Web UI
  const url = sessionId
    ? `${opencodeUrl}/session/${sessionId}`
    : opencodeUrl;

  logger.info('Loading OpenCode Web UI', { url, sessionId, model });
  mainWindow.loadURL(url);

  // Inject fold button after page loads
  mainWindow.webContents.on('did-finish-load', () => {
    injectFoldButton();
  });

  // Register fold shortcut
  globalShortcut.register(foldShortcut, () => {
    triggerFold();
  });

  // Handle fold from injected button via IPC
  ipcMain.on('sidecar:fold', () => {
    triggerFold();
  });

  // Handle window close - prompt to fold first
  mainWindow.on('close', async (e) => {
    if (!hasFolded) {
      e.preventDefault();
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Fold & Close', 'Close Without Folding', 'Cancel'],
        defaultId: 0,
        title: 'Fold Session?',
        message: 'Fold this session back to Claude before closing?'
      });

      if (result.response === 0) {
        await triggerFold();
      } else if (result.response === 1) {
        hasFolded = true;
        mainWindow.close();
      }
    }
  });
});

/**
 * Inject the fold button into OpenCode Web UI using safe DOM methods
 */
function injectFoldButton() {
  const cssPath = path.join(__dirname, 'fold-button.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  const shortcutDisplay = foldShortcut
    .replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl');

  // Use safe DOM construction - no innerHTML
  mainWindow.webContents.executeJavaScript(`
    (function() {
      // Inject CSS via style element
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(css)};
      document.head.appendChild(style);

      // Build fold button using safe DOM methods
      const btn = document.createElement('button');
      btn.id = 'sidecar-fold-btn';

      const label = document.createTextNode('Fold ');
      btn.appendChild(label);

      const shortcutSpan = document.createElement('span');
      shortcutSpan.className = 'shortcut';
      shortcutSpan.textContent = ${JSON.stringify(shortcutDisplay)};
      btn.appendChild(shortcutSpan);

      btn.addEventListener('click', () => {
        window.sidecar && window.sidecar.fold();
      });
      document.body.appendChild(btn);
    })();
  `);
}

/**
 * Trigger fold: summarize and output to stdout
 */
async function triggerFold() {
  if (hasFolded) { return; }
  hasFolded = true;

  try {
    logger.info('Fold triggered', { sessionId, model });

    // TODO: Call OpenCode summarize API here
    const foldOutput = [
      '[SIDECAR_FOLD]',
      `Model: ${model || 'unknown'}`,
      `Session: ${sessionId || 'unknown'}`,
      `Client: ${client}`,
      `CWD: ${cwd || process.cwd()}`,
      'Mode: interactive',
      '---',
      'Session folded. Summary pending implementation.'
    ].join('\n');

    process.stdout.write(foldOutput + '\n');
  } catch (err) {
    logger.error('Fold failed', { error: err.message });
  } finally {
    globalShortcut.unregisterAll();
    app.quit();
  }
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
```

**Step 2: Commit**

```bash
git add electron/main.js
git commit -m "feat: rewrite electron/main.js as thin OpenCode Web UI shell (~150 lines)"
```

---

### Task 15: Update `src/sidecar/start.js` to Launch New Electron

**Files:**
- Modify: `src/sidecar/start.js`
- Modify: `tests/sidecar/start.test.js`

**Step 1: Update tests for new Electron launch pattern**

Update `runInteractive()` tests to verify:
- Electron is spawned with `SIDECAR_ELECTRON_CONFIG` env var
- Config includes `opencodeUrl`, `sessionId`, `model`, `cwd`, `client`, `foldShortcut`

**Step 2: Run tests to verify they fail**

Run: `npm test tests/sidecar/start.test.js`
Expected: FAIL

**Step 3: Update `runInteractive()` in `src/sidecar/start.js`**

Change the Electron spawn to pass config via env var:

```javascript
const electronConfig = {
  opencodeUrl: `http://localhost:${port}`,
  sessionId: openCodeSessionId,
  model: options.model,
  cwd: options.cwd,
  client: options.client || 'code-local',
  foldShortcut: options.foldShortcut || 'CommandOrControl+Shift+F'
};

const electronProcess = spawn(electronPath, [electronMain], {
  env: {
    ...process.env,
    SIDECAR_ELECTRON_CONFIG: JSON.stringify(electronConfig)
  },
  stdio: ['pipe', 'inherit', 'inherit']
});
```

**Step 4: Run tests to verify they pass**

Run: `npm test tests/sidecar/start.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sidecar/start.js tests/sidecar/start.test.js
git commit -m "feat: launch new thin Electron shell with config env var"
```

---

## Phase 3: Cleanup and Documentation

---

### Task 16: Update `src/index.js` Exports

**Files:**
- Modify: `src/index.js`

**Step 1: Update exports**

Add exports for new modules:
- `environment.js`: `detectEnvironment`, `resolveSessionRoot`, `CLIENTS`
- `context-compression.js`: `compressContext`, `shouldCompress`, `TOKEN_THRESHOLD`

Remove exports for deleted modules (subagent-manager, model-capabilities, agent-model-config).

Update renamed exports:
- `COMPLETE_MARKER` -> `FOLD_MARKER`

**Step 2: Run full test suite**

Run: `npm test`
Expected: ALL tests pass

**Step 3: Commit**

```bash
git add src/index.js
git commit -m "chore: update index.js exports for v3 modules"
```

---

### Task 17: Run Full Test Suite and Fix Any Remaining Issues

**Files:** Various (fix as needed)

**Step 1: Run full test suite**

Run: `npm test`

**Step 2: Fix any failures**

Address any remaining test failures from the cascading renames.

**Step 3: Run lint**

Run: `npm run lint`
Fix any lint errors.

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: resolve remaining test and lint issues from v3 migration"
```

---

### Task 18: Update CLAUDE.md and Sync Agent Docs

**Files:**
- Modify: `CLAUDE.md`
- Run: `node scripts/sync-agent-docs.js`

**Step 1: Update CLAUDE.md**

Key sections to update:
- **CLI Usage**: New arg names (`--prompt`, `--cwd`, `--no-ui`, `--client`, etc.)
- **Directory Structure**: Remove deleted files, add new files
- **Key Modules table**: Remove deleted modules, add `environment.js` and `context-compression.js`
- **Architecture diagram**: Simplify Electron description
- **Testing Strategy**: Remove deleted test files, add new ones
- **Fold Protocol**: Update marker and format
- **Test count**: Update to current passing count

**Step 2: Sync agent docs**

Run: `node scripts/sync-agent-docs.js`

**Step 3: Commit**

```bash
git add CLAUDE.md GEMINI.md AGENTS.md
git commit -m "docs: update CLAUDE.md for v3 lightweight architecture"
```

---

### Task 19: Update Skill File

**Files:**
- Modify: `skill/SKILL.md`

**Step 1: Update skill file**

Update CLI examples to use new arg names. Remove references to subagent commands. Add examples with `--client` flag.

**Step 2: Commit**

```bash
git add skill/SKILL.md
git commit -m "docs: update skill file for v3 CLI args"
```

---

## Summary

| Phase | Tasks | Commits | Description |
|---|---|---|---|
| **Phase 1: Core Logic** | Tasks 1-10 | 10 commits | New modules, arg renames, marker update, obsolete cleanup |
| **Phase 2: Electron UI** | Tasks 11-15 | 5 commits | Delete 14K lines, write thin shell |
| **Phase 3: Cleanup** | Tasks 16-19 | 4 commits | Exports, tests, docs |
| **Total** | 19 tasks | 19 commits | — |

**Lines removed:** ~14,000 (custom Electron UI + obsolete modules)
**Lines added:** ~1,300 (environment.js, context-compression.js, new main.js, fold button)
**Net codebase:** ~7,000 lines (down from ~20,000)

**Task dependencies:**
- Tasks 1, 6, 7 can run in parallel (independent new modules)
- Task 2 depends on nothing
- Task 3 depends on Task 2
- Tasks 4-5 depend on Task 3
- Task 8 depends on Task 1
- Task 9 depends on Tasks 1, 5
- Task 10 depends on Tasks 1-9
- Tasks 11-14 can run in parallel after Task 10
- Task 15 depends on Tasks 11-14
- Tasks 16-19 depend on all prior tasks
