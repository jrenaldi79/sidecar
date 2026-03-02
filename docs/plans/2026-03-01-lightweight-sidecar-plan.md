# Sidecar v3 Lightweight Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 14K-line custom Electron UI with a thin OpenCode Web UI wrapper, rename CLI args to match v3 spec, add multi-environment support (code-local/code-web/cowork), add context compression, and update the fold protocol.

**Architecture:** Surgical replacement - keep all tested core business logic in src/, delete electron/ui/ entirely, rewrite electron/main.js as a thin BrowserWindow shell loading OpenCode's web UI. New modules for environment detection and context compression.

**Tech Stack:** Node.js, Electron, @opencode-ai/sdk, tiktoken, Jest

**Design Doc:** `docs/plans/2026-03-01-lightweight-sidecar-design.md`
**V3 Spec:** `docs/sidecar-spec-v3-lightweight.md`

---

## Task Dependency Order

```
Task 1: CLI arg renames (foundation - everything depends on this)
  ├── Task 2: Environment detection module (new)
  ├── Task 3: Multi-environment session resolution (depends on 2)
  ├── Task 4: Fold marker update (independent)
  ├── Task 5: Context compression module (new, independent)
  ├── Task 6: Delete old UI files (independent)
  ├── Task 7: Rewrite electron/main.js (depends on 6)
  └── Task 8: Update index.js exports + e2e tests (depends on all)
```

---

### Task 1: Rename CLI Args to Match v3 Spec

This is the foundation task. All subsequent tasks depend on the new arg names.

**Files:**
- Modify: `src/cli.js:23-31` (DEFAULTS), `src/cli.js:75-86` (isBooleanFlag), `src/cli.js:116-207` (validateStartArgs)
- Modify: `src/utils/validators.js:35-40` (validateBriefingContent), `src/utils/validators.js:47-67` (validateProjectPath)
- Modify: `bin/sidecar.js:67-97` (handleStart arg mapping)
- Modify: `src/sidecar/start.js:165-171` (option destructuring)
- Modify: `src/sidecar/context-builder.js:95-149` (buildContext params)
- Test: `tests/cli.test.js`

**Step 1: Update test expectations for renamed args**

In `tests/cli.test.js`, find all tests that reference `briefing`, `project`, `headless`, `session` as CLI arg names and update them to `prompt`, `cwd`, `no-ui`, `session-id`. Also add tests for new flags `--client`, `--session-dir`, `--setup`, `--fold-shortcut`, `--opencode-port`.

Key test changes:
```javascript
// Old:
it('should parse --briefing flag', () => {
  const result = parseArgs(['start', '--briefing', 'Review auth']);
  expect(result.briefing).toBe('Review auth');
});

// New:
it('should parse --prompt flag', () => {
  const result = parseArgs(['start', '--prompt', 'Review auth']);
  expect(result.prompt).toBe('Review auth');
});

// New tests to add:
it('should parse --client flag', () => {
  const result = parseArgs(['start', '--client', 'code-local']);
  expect(result.client).toBe('code-local');
});

it('should parse --session-dir flag', () => {
  const result = parseArgs(['start', '--session-dir', '/tmp/sessions']);
  expect(result['session-dir']).toBe('/tmp/sessions');
});

it('should parse --no-ui as boolean flag', () => {
  const result = parseArgs(['start', '--no-ui']);
  expect(result['no-ui']).toBe(true);
});

it('should parse --opencode-port as numeric', () => {
  const result = parseArgs(['start', '--opencode-port', '4096']);
  expect(result['opencode-port']).toBe(4096);
});

it('should default no-ui to false', () => {
  const result = parseArgs(['start']);
  expect(result['no-ui']).toBe(false);
});
```

Also update `validateStartArgs` tests:
```javascript
// Old:
it('should require --briefing', () => {
  const result = validateStartArgs({ model: 'google/gemini' });
  expect(result.valid).toBe(false);
  expect(result.error).toContain('--briefing');
});

// New:
it('should require --prompt', () => {
  const result = validateStartArgs({ model: 'google/gemini' });
  expect(result.valid).toBe(false);
  expect(result.error).toContain('--prompt');
});

// New validation tests:
it('should validate --client values', () => {
  const result = validateStartArgs({
    model: 'google/gemini', prompt: 'test', client: 'invalid'
  });
  expect(result.valid).toBe(false);
  expect(result.error).toContain('--client');
});

it('should accept valid --client values', () => {
  for (const client of ['code-local', 'code-web', 'cowork']) {
    const result = validateStartArgs({
      model: 'google/gemini', prompt: 'test', client
    });
    expect(result.valid).toBe(true);
  }
});

it('should require --session-dir for code-web client', () => {
  const result = validateStartArgs({
    model: 'google/gemini', prompt: 'test', client: 'code-web'
  });
  expect(result.valid).toBe(false);
  expect(result.error).toContain('--session-dir');
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/cli.test.js`
Expected: Multiple failures - tests reference new arg names that don't exist yet

**Step 3: Update DEFAULTS in cli.js**

In `src/cli.js:23-31`, change:
```javascript
// Old:
const DEFAULTS = {
  session: 'current',
  project: process.cwd(),
  'context-turns': 50,
  'context-max-tokens': 80000,
  timeout: 15,
  headless: false,
  'summary-length': 'normal'
};

// New:
const DEFAULTS = {
  'session-id': 'current',
  cwd: process.cwd(),
  'context-turns': 50,
  'context-max-tokens': 80000,
  timeout: 15,
  'no-ui': false,
  'summary-length': 'normal'
};
```

**Step 4: Update isBooleanFlag in cli.js**

In `src/cli.js:75-86`, change:
```javascript
// Old:
const booleanFlags = ['headless', 'all', 'conversation', 'json', 'version', 'help'];

// New:
const booleanFlags = ['no-ui', 'all', 'conversation', 'json', 'version', 'help', 'setup'];
```

**Step 5: Add opencode-port to numeric options**

In `src/cli.js:92-96`, add `'opencode-port'` to `numericOptions` array.

**Step 6: Update validateStartArgs in cli.js**

In `src/cli.js:116-207`:
- Line 123: `args.briefing` → `args.prompt`
- Line 128: `validateBriefingContent(args.briefing)` → `validatePromptContent(args.prompt)`
- Line 139: `validateProjectPath(args.project)` → `validateCwdPath(args.cwd)`
- Line 145: `validateExplicitSession(args.session, args.project)` → `validateExplicitSession(args['session-id'], args.cwd)`
- Add new validation after existing checks:

```javascript
// Validate --client if provided
if (args.client) {
  const validClients = ['code-local', 'code-web', 'cowork'];
  if (!validClients.includes(args.client)) {
    return { valid: false, error: `Error: --client must be one of: ${validClients.join(', ')}` };
  }
}

// Require --session-dir for code-web
if (args.client === 'code-web' && !args['session-dir']) {
  return { valid: false, error: 'Error: --session-dir is required when --client is code-web' };
}

// Validate --session-dir exists if provided
if (args['session-dir']) {
  const sdCheck = validateCwdPath(args['session-dir']);
  if (!sdCheck.valid) {
    return { valid: false, error: sdCheck.error.replace('--cwd', '--session-dir') };
  }
}
```

**Step 7: Rename validators in validators.js**

In `src/utils/validators.js`:
- Line 35: Rename `validateBriefingContent` → `validatePromptContent`, update error message from `--briefing` to `--prompt`
- Line 47: Rename `validateProjectPath` → `validateCwdPath`, update error messages from `--project` to `--cwd`
- Keep old names as aliases for backward compat during transition:
```javascript
// Aliases for backward compatibility
const validateBriefingContent = validatePromptContent;
const validateProjectPath = validateCwdPath;
```

**Step 8: Update imports in cli.js**

In `src/cli.js:8-17`, update import names to match renamed validators.

**Step 9: Update bin/sidecar.js handleStart()**

In `bin/sidecar.js:67-97`, update the arg mapping:
```javascript
// Old:
await startSidecar({
  model: args.model,
  briefing: args.briefing,
  session: args.session,
  project: args.project,
  headless: args.headless,
  ...
});

// New:
await startSidecar({
  model: args.model,
  prompt: args.prompt,
  sessionId: args['session-id'],
  cwd: args.cwd,
  noUi: args['no-ui'],
  client: args.client,
  sessionDir: args['session-dir'],
  foldShortcut: args['fold-shortcut'],
  opencodePort: args['opencode-port'],
  ...
});
```

**Step 10: Update startSidecar() option destructuring**

In `src/sidecar/start.js:165-171`:
```javascript
// Old:
const { model, briefing, session = 'current', project = process.cwd(), ... headless = false, ... } = options;

// New:
const { model, prompt, sessionId = 'current', cwd = process.cwd(), ... noUi = false, client, sessionDir, foldShortcut, opencodePort, ... } = options;
```

Update all internal references from `briefing` → `prompt`, `session` → `sessionId`, `project` → `cwd`, `headless` → `noUi`.

**Step 11: Update buildContext() params**

In `src/sidecar/context-builder.js:95-149`, update `buildContext()` to accept new param names and pass them through to `getSessionDirectory()` and `resolveSessionFile()`.

**Step 12: Run tests to verify they pass**

Run: `npm test tests/cli.test.js`
Expected: All updated tests PASS

**Step 13: Run full test suite to check for cascading breakage**

Run: `npm test`
Expected: Some tests in other files may fail due to renamed params. Note failures for fixing in subsequent steps.

**Step 14: Fix cascading test failures**

Update any other test files that reference old arg names (`briefing`, `project`, `headless`, `session`):
- `tests/sidecar/start.test.js` - update option names in startSidecar() calls
- `tests/sidecar/context-builder.test.js` - update buildContext() calls
- `tests/e2e.test.js` - update CLI invocations
- `tests/index.test.js` - update re-export references
- `tests/headless.test.js` - update param names
- `tests/session-manager.test.js` - check for project references
- `tests/prompt-builder.test.js` - check for briefing references

**Step 15: Run full test suite**

Run: `npm test`
Expected: All tests PASS (except the 1 pre-existing failure in headless-subagent)

**Step 16: Commit**

```bash
git add src/cli.js src/utils/validators.js bin/sidecar.js src/sidecar/start.js src/sidecar/context-builder.js tests/
git commit -m "feat: rename CLI args to match v3 spec (--prompt, --cwd, --no-ui, --client)"
```

---

### Task 2: Create Environment Detection Module

**Files:**
- Create: `src/environment.js`
- Test: `tests/environment.test.js`

**Step 1: Write failing tests**

Create `tests/environment.test.js`:
```javascript
const { detectEnvironment, inferClient, getSessionRoot } = require('../src/environment');
const os = require('os');
const path = require('path');

describe('environment detection', () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('inferClient', () => {
    it('should return explicit --client value when provided', () => {
      expect(inferClient({ client: 'cowork' })).toBe('cowork');
    });

    it('should detect code-local on macOS without explicit client', () => {
      expect(inferClient({}, 'darwin')).toBe('code-local');
    });

    it('should detect code-local when DISPLAY is set', () => {
      process.env.DISPLAY = ':0';
      expect(inferClient({}, 'linux')).toBe('code-local');
    });

    it('should detect code-web when no display on linux', () => {
      delete process.env.DISPLAY;
      expect(inferClient({}, 'linux')).toBe('code-web');
    });
  });

  describe('getSessionRoot', () => {
    it('should return --session-dir when provided', () => {
      expect(getSessionRoot({ sessionDir: '/tmp/sessions', client: 'code-web' }))
        .toBe('/tmp/sessions');
    });

    it('should return Claude Code path for code-local', () => {
      const result = getSessionRoot({ client: 'code-local', cwd: '/projects/myapp' });
      expect(result).toContain('.claude/projects');
    });

    it('should throw for code-web without --session-dir', () => {
      expect(() => getSessionRoot({ client: 'code-web' }))
        .toThrow('--session-dir is required');
    });

    it('should return Cowork path for cowork on macOS', () => {
      const result = getSessionRoot({ client: 'cowork' }, 'darwin');
      expect(result).toContain('Application Support');
      expect(result).toContain('Claude Cowork');
    });
  });

  describe('detectEnvironment', () => {
    it('should return client, hasDisplay, and sessionRoot', () => {
      const env = detectEnvironment({ client: 'code-local', cwd: '/projects/myapp' });
      expect(env).toHaveProperty('client');
      expect(env).toHaveProperty('hasDisplay');
      expect(env).toHaveProperty('sessionRoot');
    });

    it('should set hasDisplay=false for code-web', () => {
      const env = detectEnvironment({
        client: 'code-web', sessionDir: '/tmp/sessions'
      });
      expect(env.hasDisplay).toBe(false);
    });

    it('should set hasDisplay=true for cowork', () => {
      const env = detectEnvironment({ client: 'cowork' }, 'darwin');
      expect(env.hasDisplay).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/environment.test.js`
Expected: FAIL - module not found

**Step 3: Implement src/environment.js**

```javascript
/**
 * Environment Detection
 *
 * Detects the runtime environment (code-local, code-web, cowork)
 * and resolves session data paths accordingly.
 *
 * Spec Reference: §2.3 Environment Detection, §4.2 Session Path Resolution
 */

const os = require('os');
const path = require('path');
const { logger } = require('./utils/logger');

/** @type {string[]} */
const VALID_CLIENTS = ['code-local', 'code-web', 'cowork'];

/**
 * Infer the client type from args and environment
 * @param {object} args - Parsed CLI args
 * @param {string} [platform] - Override platform for testing
 * @returns {string} Client type
 */
function inferClient(args, platform = process.platform) {
  if (args.client && VALID_CLIENTS.includes(args.client)) {
    return args.client;
  }

  // macOS always has a display
  if (platform === 'darwin') {
    return 'code-local';
  }

  // Linux: check for display server
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    return 'code-local';
  }

  // No display -> web sandbox (headless)
  return 'code-web';
}

/**
 * Get the session data root directory for the given client type
 * @param {object} args - Parsed CLI args with client, cwd, sessionDir
 * @param {string} [platform] - Override platform for testing
 * @returns {string} Session root directory path
 */
function getSessionRoot(args, platform = process.platform) {
  // Explicit session-dir always wins
  if (args.sessionDir) {
    return args.sessionDir;
  }

  const client = args.client || inferClient(args, platform);

  switch (client) {
    case 'code-local': {
      // Standard Claude Code local path
      const cwd = args.cwd || process.cwd();
      const encodedPath = cwd.replace(/[/\\_]/g, '-');
      return path.join(os.homedir(), '.claude', 'projects', encodedPath);
    }
    case 'code-web': {
      throw new Error('--session-dir is required when --client is code-web');
    }
    case 'cowork': {
      if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Claude Cowork');
      }
      if (platform === 'win32') {
        return path.join(process.env.APPDATA || '', 'Claude Cowork');
      }
      // Linux
      return path.join(os.homedir(), '.config', 'claude-cowork');
    }
    default:
      throw new Error(`Unknown client type: ${client}`);
  }
}

/**
 * Detect the full runtime environment
 * @param {object} args - Parsed CLI args
 * @param {string} [platform] - Override platform for testing
 * @returns {{ client: string, hasDisplay: boolean, sessionRoot: string }}
 */
function detectEnvironment(args, platform = process.platform) {
  const client = args.client || inferClient(args, platform);
  const hasDisplay = client !== 'code-web';
  const sessionRoot = getSessionRoot({ ...args, client }, platform);

  logger.debug('Environment detected', { client, hasDisplay, sessionRoot });

  return { client, hasDisplay, sessionRoot };
}

module.exports = { detectEnvironment, inferClient, getSessionRoot, VALID_CLIENTS };
```

**Step 4: Run tests to verify they pass**

Run: `npm test tests/environment.test.js`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/environment.js tests/environment.test.js
git commit -m "feat: add environment detection module for multi-client support"
```

---

### Task 3: Update Session Resolution for Multi-Environment

**Files:**
- Modify: `src/session.js:51-54` (getSessionDirectory), `src/session.js:87-118` (resolveSession)
- Modify: `src/sidecar/context-builder.js:95-149` (buildContext)
- Test: `tests/session.test.js`, `tests/sidecar/context-builder.test.js`

**Step 1: Write failing tests for multi-environment session resolution**

Add to `tests/session.test.js`:
```javascript
describe('multi-environment session resolution', () => {
  it('should resolve session from explicit session-dir', () => {
    // Create temp dir with a .jsonl file, pass as sessionDir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-test-'));
    const sessionFile = path.join(tmpDir, 'test-session.jsonl');
    fs.writeFileSync(sessionFile, '{"type":"human","text":"hello"}\n');

    const result = resolveSession(tmpDir, 'test-session');
    expect(result.path).toBe(sessionFile);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should use getSessionDirectory with environment args', () => {
    const dir = getSessionDirectory('/projects/myapp');
    expect(dir).toContain('.claude/projects');
  });
});
```

Add to `tests/sidecar/context-builder.test.js`:
```javascript
describe('buildContext with multi-environment', () => {
  it('should accept sessionDir option for code-web', () => {
    // Test that buildContext passes sessionDir through to resolution
  });

  it('should accept client option', () => {
    // Test that buildContext uses client for path resolution
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/session.test.js tests/sidecar/context-builder.test.js`
Expected: New tests FAIL

**Step 3: Update session.js to accept sessionDir**

In `src/session.js`, update `resolveSession()` to accept an optional `sessionDir` parameter that overrides the default directory:

```javascript
// Updated signature:
function resolveSession(sessionDirOrProject, sessionArg, options = {}) {
  const { sessionDir } = options;
  const dir = sessionDir || sessionDirOrProject;
  // ... rest of resolution logic using dir
}
```

**Step 4: Update context-builder.js to pass through environment args**

In `src/sidecar/context-builder.js:95-149`, update `buildContext()`:

```javascript
async function buildContext(options) {
  const {
    contextTurns = 50, contextSince, contextMaxTokens = 80000,
    cwd, sessionId, client, sessionDir  // new params
  } = options;

  // Use environment detection for session directory
  let sessionDirPath;
  if (sessionDir) {
    sessionDirPath = sessionDir;
  } else {
    const { getSessionRoot } = require('../environment');
    sessionDirPath = getSessionRoot({ client, cwd, sessionDir });
  }

  const resolution = resolveSessionFile(sessionDirPath, sessionId);
  // ... rest of function
}
```

**Step 5: Run tests to verify they pass**

Run: `npm test tests/session.test.js tests/sidecar/context-builder.test.js`
Expected: All PASS

**Step 6: Run full suite**

Run: `npm test`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/session.js src/sidecar/context-builder.js tests/session.test.js tests/sidecar/context-builder.test.js
git commit -m "feat: multi-environment session resolution (code-local, code-web, cowork)"
```

---

### Task 4: Update Fold Marker and Output Format

**Files:**
- Modify: `src/headless.js:27` (COMPLETE_MARKER), `src/headless.js:439-452` (extractSummary)
- Modify: `src/sidecar/session-utils.js` (outputSummary)
- Test: `tests/headless.test.js`

**Step 1: Update test expectations for new fold marker**

In `tests/headless.test.js`, find all references to `[SIDECAR_COMPLETE]` and update to `[SIDECAR_FOLD]`. Also add tests for new output fields:

```javascript
it('should use [SIDECAR_FOLD] marker', () => {
  expect(FOLD_MARKER).toBe('[SIDECAR_FOLD]');
});

it('should include Client and CWD fields in output', () => {
  const output = formatFoldOutput({
    model: 'google/gemini-2.5-pro',
    sessionId: 'abc123',
    client: 'code-local',
    cwd: '/projects/myapp',
    mode: 'interactive',
    summary: 'Test summary'
  });
  expect(output).toContain('Client: code-local');
  expect(output).toContain('CWD: /projects/myapp');
  expect(output).toContain('[SIDECAR_FOLD]');
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/headless.test.js`
Expected: FAIL - marker name mismatch

**Step 3: Update the marker constant**

In `src/headless.js:27`:
```javascript
// Old:
const COMPLETE_MARKER = '[SIDECAR_COMPLETE]';

// New:
const FOLD_MARKER = '[SIDECAR_FOLD]';
// Backward compat alias
const COMPLETE_MARKER = FOLD_MARKER;
```

**Step 4: Add formatFoldOutput() function**

In `src/headless.js` or `src/sidecar/session-utils.js`, add:
```javascript
function formatFoldOutput({ model, sessionId, client, cwd, mode, summary }) {
  return [
    '[SIDECAR_FOLD]',
    `Model: ${model}`,
    `Session: ${sessionId}`,
    `Client: ${client || 'code-local'}`,
    `CWD: ${cwd || process.cwd()}`,
    `Mode: ${mode || 'headless'}`,
    '---',
    summary
  ].join('\n');
}
```

**Step 5: Update all references from COMPLETE_MARKER to FOLD_MARKER**

Update lines 244, 343, 371-380, 399, 439-452 in `src/headless.js`.

**Step 6: Run tests to verify they pass**

Run: `npm test tests/headless.test.js`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/headless.js src/sidecar/session-utils.js tests/headless.test.js
git commit -m "feat: update fold marker to [SIDECAR_FOLD] with Client and CWD fields"
```

---

### Task 5: Create Context Compression Module

**Files:**
- Create: `src/context-compression.js`
- Test: `tests/context-compression.test.js`

**Step 1: Write failing tests**

Create `tests/context-compression.test.js`:
```javascript
const { compressContext, estimateTokenCount, buildPreamble } = require('../src/context-compression');

describe('context compression', () => {
  describe('estimateTokenCount', () => {
    it('should estimate tokens for short text', () => {
      const count = estimateTokenCount('Hello world');
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });

    it('should estimate tokens for empty text', () => {
      expect(estimateTokenCount('')).toBe(0);
    });
  });

  describe('buildPreamble', () => {
    it('should include cwd in preamble', () => {
      const preamble = buildPreamble('/projects/myapp');
      expect(preamble).toContain('/projects/myapp');
      expect(preamble).toContain('You are working in');
    });
  });

  describe('compressContext', () => {
    it('should return as-is with preamble when under 30K tokens', () => {
      const result = compressContext('Short conversation', {
        cwd: '/projects/myapp',
        tokenLimit: 30000
      });
      expect(result.compressed).toBe(false);
      expect(result.text).toContain('You are working in /projects/myapp');
      expect(result.text).toContain('Short conversation');
    });

    it('should flag for compression when over 30K tokens', () => {
      // Create a string that would be >30K tokens (~120K chars)
      const longText = 'x '.repeat(60000);
      const result = compressContext(longText, {
        cwd: '/projects/myapp',
        tokenLimit: 30000
      });
      expect(result.compressed).toBe(true);
      expect(result.needsModelCompression).toBe(true);
    });

    it('should accept custom token limit', () => {
      const text = 'x '.repeat(100);
      const result = compressContext(text, {
        cwd: '/projects/myapp',
        tokenLimit: 10  // very low limit
      });
      expect(result.compressed).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test tests/context-compression.test.js`
Expected: FAIL - module not found

**Step 3: Implement src/context-compression.js**

```javascript
/**
 * Context Compression
 *
 * Handles context size management for sidecar sessions.
 * Under 30K tokens: pass through with preamble.
 * Over 30K tokens: flag for 2-pass compression via cheap model.
 *
 * Spec Reference: §4.6 Context Compression
 */

const { logger } = require('./utils/logger');

/** Default token limit before compression kicks in */
const DEFAULT_TOKEN_LIMIT = 30000;

/** Approximate chars per token (conservative estimate) */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for text.
 * Uses simple heuristic (chars/4). For precise counting, use tiktoken.
 * @param {string} text
 * @returns {number}
 */
function estimateTokenCount(text) {
  if (!text) { return 0; }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Build the context preamble with working directory
 * @param {string} cwd - Working directory
 * @returns {string}
 */
function buildPreamble(cwd) {
  return `You are working in ${cwd}. Here is the conversation:\n\n`;
}

/**
 * Compress or pass-through context based on token count.
 *
 * If under tokenLimit: returns text with preamble, compressed=false.
 * If over tokenLimit: returns text with preamble + flag for model compression.
 *
 * The actual 2-pass model compression is handled by the caller
 * (typically headless.js or start.js) since it requires an API call.
 *
 * @param {string} contextText - The conversation context
 * @param {object} options
 * @param {string} options.cwd - Working directory for preamble
 * @param {number} [options.tokenLimit=30000] - Token threshold for compression
 * @returns {{ text: string, compressed: boolean, needsModelCompression: boolean, estimatedTokens: number }}
 */
function compressContext(contextText, options = {}) {
  const { cwd = process.cwd(), tokenLimit = DEFAULT_TOKEN_LIMIT } = options;
  const preamble = buildPreamble(cwd);
  const estimatedTokens = estimateTokenCount(contextText);

  if (estimatedTokens <= tokenLimit) {
    logger.debug('Context within token limit', { estimatedTokens, tokenLimit });
    return {
      text: preamble + contextText,
      compressed: false,
      needsModelCompression: false,
      estimatedTokens
    };
  }

  logger.info('Context exceeds token limit, flagging for compression', {
    estimatedTokens, tokenLimit
  });

  return {
    text: preamble + contextText,
    compressed: true,
    needsModelCompression: true,
    estimatedTokens
  };
}

module.exports = {
  compressContext,
  estimateTokenCount,
  buildPreamble,
  DEFAULT_TOKEN_LIMIT
};
```

**Step 4: Run tests to verify they pass**

Run: `npm test tests/context-compression.test.js`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/context-compression.js tests/context-compression.test.js
git commit -m "feat: add context compression module with token estimation"
```

---

### Task 6: Delete Old UI Files

This is a pure deletion task. No tests to write - we're removing code.

**Step 1: Delete all custom UI files**

```bash
# Custom Electron UI (replaced by OpenCode Web UI)
rm electron/ui/renderer.js
rm electron/ui/model-picker.js
rm electron/ui/model-registry.js
rm electron/ui/agent-model-config.js
rm electron/ui/thinking-picker.js
rm electron/ui/mode-picker.js
rm electron/ui/context-panel.js
rm electron/ui/autocomplete.js
rm electron/ui/file-autocomplete.js
rm electron/ui/command-autocomplete.js
rm electron/ui/mcp-manager.js
rm electron/ui/index.html
rm electron/ui/styles.css

# Old preloads and legacy
rm electron/preload.js
rm electron/preload-v2.js
rm electron/main-legacy.js
rm electron/theme.js
rm electron/inject.css

# Removed src modules
rm src/subagent-manager.js
rm src/utils/model-capabilities.js
rm src/utils/agent-model-config.js

# Remove the now-empty ui directory
rmdir electron/ui
```

**Step 2: Delete corresponding test files**

```bash
rm tests/context-panel.test.js
rm tests/headless-subagent.test.js
rm tests/subagent-manager.test.js
```

**Step 3: Update src/index.js to remove deleted exports**

Remove any exports referencing `subagent-manager`, `model-capabilities`, `agent-model-config`.

**Step 4: Run tests to check for broken imports**

Run: `npm test`
Expected: Some tests may reference deleted modules. Fix any import errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete 14K lines of custom UI, subagent manager, and model capabilities

Removed:
- electron/ui/ (12 files, ~12K lines) - replaced by OpenCode Web UI
- electron/preload.js, preload-v2.js, main-legacy.js, theme.js
- src/subagent-manager.js, src/utils/model-capabilities.js, src/utils/agent-model-config.js
- tests/context-panel.test.js, tests/headless-subagent.test.js, tests/subagent-manager.test.js"
```

---

### Task 7: Rewrite electron/main.js as Thin OpenCode Web UI Shell

**Files:**
- Rewrite: `electron/main.js` (~1,200 lines -> ~250 lines)
- Create: `electron/preload.js` (new, minimal ~50 lines)
- Create: `electron/fold-button.css` (~30 lines)

**Step 1: Verify OpenCode Web UI works in Electron (Experiment 6)**

Before writing code, manually test that Electron can load OpenCode's web UI:

```bash
# Start OpenCode server manually
npx opencode-ai &

# Check what URL it serves on
curl http://localhost:4096

# If it returns HTML, we're good
kill %1
```

If this fails, stop and reassess. This is a critical validation step.

**Step 2: Write the new electron/main.js**

```javascript
/**
 * Sidecar Electron Shell - v3 Lightweight
 *
 * Thin wrapper that loads OpenCode's built-in Web UI.
 * Only adds: fold button injection + fold keyboard shortcut.
 *
 * Spec Reference: §4.4 Electron Wrapper
 */

const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron');
const path = require('path');
const { logger } = require('../src/utils/logger');

// Config from environment (set by src/sidecar/start.js)
const TASK_ID = process.env.SIDECAR_TASK_ID || 'unknown';
const MODEL = process.env.SIDECAR_MODEL || 'unknown';
const CWD = process.env.SIDECAR_CWD || process.cwd();
const CLIENT = process.env.SIDECAR_CLIENT || 'code-local';
const OPENCODE_PORT = process.env.SIDECAR_OPENCODE_PORT || '4096';
const OPENCODE_SESSION_ID = process.env.SIDECAR_SESSION_ID;
const FOLD_SHORTCUT = process.env.SIDECAR_FOLD_SHORTCUT || 'CommandOrControl+Shift+F';
const SYSTEM_PROMPT = process.env.SIDECAR_SYSTEM_PROMPT || '';
const USER_MESSAGE = process.env.SIDECAR_USER_MESSAGE || '';

const OPENCODE_URL = `http://localhost:${OPENCODE_PORT}`;
const WINDOW_CONFIG = {
  width: 720,
  height: 850,
  minWidth: 550,
  minHeight: 600,
  frame: true,
  backgroundColor: '#1a1a2e',
  title: `Sidecar: ${MODEL}`,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  }
};

let mainWindow = null;
let hasFolded = false;

function createWindow() {
  mainWindow = new BrowserWindow(WINDOW_CONFIG);

  // Load OpenCode Web UI
  const sessionUrl = OPENCODE_SESSION_ID
    ? `${OPENCODE_URL}/session/${OPENCODE_SESSION_ID}`
    : OPENCODE_URL;

  logger.info('Loading OpenCode Web UI', { url: sessionUrl, taskId: TASK_ID });
  mainWindow.loadURL(sessionUrl);

  // Inject fold button after page loads
  mainWindow.webContents.on('did-finish-load', () => {
    injectFoldButton();
  });

  // Register fold shortcut
  globalShortcut.register(FOLD_SHORTCUT, () => {
    triggerFold();
  });

  // Prompt on close without fold
  mainWindow.on('close', (event) => {
    if (!hasFolded) {
      event.preventDefault();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['Fold & Close', 'Close Without Folding', 'Cancel'],
        defaultId: 0,
        title: 'Fold Session?',
        message: 'Fold this session back to Claude before closing?',
      });

      if (choice === 0) {
        triggerFold().then(() => mainWindow.destroy());
      } else if (choice === 1) {
        mainWindow.destroy();
      }
      // choice === 2 (Cancel): do nothing
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    globalShortcut.unregisterAll();
    app.quit();
  });
}

/**
 * Inject a floating fold button into the OpenCode Web UI
 */
function injectFoldButton() {
  const css = `
    #sidecar-fold-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      padding: 10px 20px;
      background: #6366f1;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
      transition: all 0.2s;
    }
    #sidecar-fold-btn:hover {
      background: #4f46e5;
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
    }
  `;

  const js = `
    (function() {
      if (document.getElementById('sidecar-fold-btn')) return;
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(css)};
      document.head.appendChild(style);

      const btn = document.createElement('button');
      btn.id = 'sidecar-fold-btn';
      btn.textContent = 'Fold (${FOLD_SHORTCUT.replace('CommandOrControl', 'Cmd')})';
      btn.onclick = () => window.sidecar?.fold();
      document.body.appendChild(btn);
    })();
  `;

  mainWindow.webContents.executeJavaScript(js).catch(err => {
    logger.warn('Failed to inject fold button', { error: err.message });
  });
}

/**
 * Trigger fold: summarize session, output to stdout, close
 */
async function triggerFold() {
  if (hasFolded) { return; }
  hasFolded = true;

  try {
    // TODO: Call OpenCode summarize API to get session summary
    const summary = 'Session summary will be captured here';

    const output = [
      '[SIDECAR_FOLD]',
      `Model: ${MODEL}`,
      `Session: ${OPENCODE_SESSION_ID || TASK_ID}`,
      `Client: ${CLIENT}`,
      `CWD: ${CWD}`,
      `Mode: interactive`,
      '---',
      summary
    ].join('\n');

    process.stdout.write(output + '\n');
    logger.info('Fold completed', { taskId: TASK_ID });
  } catch (err) {
    logger.error('Fold failed', { error: err.message });
    hasFolded = false; // Allow retry
  }
}

// IPC handler for fold from preload
ipcMain.handle('sidecar:fold', () => triggerFold());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});
```

**Step 3: Write the new minimal electron/preload.js**

```javascript
/**
 * Sidecar Preload - v3 Minimal
 *
 * Exposes only the fold IPC bridge to the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sidecar', {
  fold: () => ipcRenderer.invoke('sidecar:fold'),
});
```

**Step 4: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All tests PASS (UI tests were already deleted in Task 6)

**Step 5: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat: rewrite Electron as thin OpenCode Web UI shell with fold injection

Electron now loads OpenCode's built-in Web UI instead of custom renderer.
Adds floating fold button + Cmd+Shift+F shortcut.
~250 lines replacing ~1,200 lines."
```

---

### Task 8: Update Exports, Skill, and Integration Tests

**Files:**
- Modify: `src/index.js` - Add new module exports
- Modify: `skill/SKILL.md` - Update CLI arg names
- Modify: `tests/e2e.test.js` - Update for new arg names
- Modify: `CLAUDE.md` - Update architecture docs

**Step 1: Update src/index.js exports**

Add exports for new modules:
```javascript
// Environment detection
const { detectEnvironment, inferClient, getSessionRoot } = require('./environment');

// Context compression
const { compressContext, estimateTokenCount, buildPreamble } = require('./context-compression');
```

Remove exports for deleted modules (subagent-manager, model-capabilities, agent-model-config).

**Step 2: Update e2e test args**

In `tests/e2e.test.js`, update CLI invocations from old arg names to new:
- `--briefing` → `--prompt`
- `--project` → `--cwd`
- `--headless` → `--no-ui`

**Step 3: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 4: Update skill/SKILL.md**

Update the skill's CLI examples to use new arg names.

**Step 5: Run lint**

Run: `npm run lint`
Expected: Clean (no warnings)

**Step 6: Commit**

```bash
git add src/index.js skill/SKILL.md tests/e2e.test.js
git commit -m "feat: update exports, skill docs, and e2e tests for v3 arg names"
```

**Step 7: Sync agent docs**

```bash
node scripts/sync-agent-docs.js
git add CLAUDE.md GEMINI.md AGENTS.md
git commit -m "docs: sync agent documentation after v3 redesign"
```

---

## Post-Implementation Checklist

After all tasks are complete:

- [ ] `npm test` - All tests passing
- [ ] `npm run lint` - No lint errors
- [ ] Verify codebase is ~7K lines (down from ~20K)
- [ ] Manually test: `node bin/sidecar.js start --model openrouter/google/gemini-3-flash-preview --prompt "Hello" --no-ui`
- [ ] Manually test Electron: `node bin/sidecar.js start --model openrouter/google/gemini-3-flash-preview --prompt "Hello"`
- [ ] Verify fold output includes new `[SIDECAR_FOLD]` format with Client and CWD fields
- [ ] Run Experiment 6: Verify OpenCode Web UI loads in Electron window
- [ ] Update CLAUDE.md with new architecture (if not already done)
