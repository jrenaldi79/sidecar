# Testing Guide

Comprehensive guide to sidecar's test infrastructure, covering unit tests, integration tests, E2E tests, and the agentic eval system.

## Test Architecture

Sidecar uses a three-tier testing strategy plus an eval system:

```
Tier 1: Unit Tests (mocked)          ~1200 tests, <2 min
  └─ Business logic, parsing, validation, session management

Tier 2: Integration Tests (source)    ~30 tests, <5 sec
  └─ Source-level verification, module wiring, config checks

Tier 3: E2E Tests (real LLM)         ~15 tests, ~3 min each
  └─ CLI headless, MCP headless, Electron CDP
  └─ Requires OPENROUTER_API_KEY, skipped when missing

Eval System: Agentic Evals           ~3 scenarios, ~5 min each
  └─ Full Claude Code + sidecar interaction grading
  └─ Programmatic checks + LLM-as-judge scoring
```

### Quick Reference

```bash
npm test                                    # All unit + integration tests
npm test tests/context.test.js              # Single file (preferred during dev)
npm test -- --coverage                      # Coverage report
npm test -- -t "should extract"             # Run tests matching pattern

# E2E tests (require OPENROUTER_API_KEY)
npm test tests/cli-headless-e2e.integration.test.js
npm test tests/mcp-headless-e2e.integration.test.js
npm test tests/electron-toolbar-e2e.integration.test.js

# Evals
node evals/run_eval.js --eval-id 1
node evals/run_eval.js --all --dry-run
```

---

## Tier 1: Unit Tests

Unit tests mock all external dependencies (OpenCode SDK, filesystem, network) and run fast. They form the bulk of the test suite.

### What to Unit Test

| Area | Example Files | Focus |
|------|--------------|-------|
| CLI parsing | `cli.test.js` | Command validation, flag handling, error messages |
| Context filtering | `context.test.js` | Turn extraction, token estimation, JSONL parsing |
| Session management | `session-manager.test.js` | CRUD operations, metadata persistence |
| Prompt construction | `prompt-builder.test.js` | Template assembly, mode-specific prompts |
| Conflict detection | `conflict.test.js` | mtime comparison, warning formatting |
| Drift calculation | `drift.test.js` | Staleness scoring, turn counting |
| Headless mode | `headless.test.js` | Polling logic, fold marker detection, timeout |
| MCP tools | `mcp-tools.test.js`, `mcp-server.test.js` | Zod schemas, tool handlers |
| Sidecar operations | `sidecar/*.test.js` | Start, resume, continue, read, context-builder |
| Config/utils | Various `utils/*.test.js` | Agent mapping, config loading, validation |

### What NOT to Unit Test

Do not write unit tests for:
- DOM manipulation in `renderer.js`
- UI picker components (`model-picker.js`, `mode-picker.js`)
- Electron window configuration (`main.js`)
- CSS class assignments and styling

DOM mock tests are ineffective. They test mock behavior, not real rendering. Use CDP E2E tests for UI verification, or the interactive harness for manual testing instead.

### Static Test Harness (Visual QA)

For visual QA of all tool renderers without any API dependency, use the static test harness:

```bash
npm run qa:ui
```

This serves `src/mcp-app/test-harness.html` via Vite, rendering mock messages for every tool type (bash, read, write, edit, glob, grep, question, list, task, webfetch, todowrite, generic fallback) plus error states, running/pending states, and reasoning blocks.

The harness includes:
- Theme toggle (light/dark)
- Width controls (520px/700px) to simulate Claude Desktop panel widths
- Tool coverage panel showing which tools have renderers vs gaps

Question tool has 4 mock states: pending with options, completed with selected option, pending free-form, and completed free-form.

### Manual UI Testing with the Interactive Harness

For rapid visual iteration on MCP App rendering, use the interactive harness (`npm run dev:ui`). It connects to a real LLM and renders messages through the same `renderMessage()` pipeline as production, with Vite HMR for instant CSS/JS reloads. CDP can be used to programmatically inspect the harness DOM in Chrome.

See [docs/interactive-harness.md](interactive-harness.md) for setup and usage.

### Mocking Patterns

The codebase uses Jest's `jest.mock()` for external dependencies:

```javascript
// Mock the OpenCode SDK (used in headless.test.js, e2e.test.js)
jest.mock('../src/opencode-client', () => ({
  startServer: jest.fn(),
  createSession: jest.fn(),
  sendPromptAsync: jest.fn(),
  getMessages: jest.fn(),
  checkHealth: jest.fn(),
}));
```

**Key rule:** The OpenCode SDK uses ESM dynamic imports (`await import()`) which fail under Jest without `--experimental-vm-modules`. Always mock the SDK in unit tests. For E2E tests that need a real server, use `tests/helpers/start-server.js` (runs in a separate Node.js process).

---

## Tier 2: Integration Tests

Integration tests verify source-level invariants without mocking. They read actual source files to assert code structure, ensuring critical patterns aren't accidentally removed.

| Test File | What It Verifies |
|-----------|-----------------|
| `spawn-pipe-deadlock.integration.test.js` | `spawnSidecarProcess()` uses `ignore` (not `pipe`) for stdio, no `detached: true`, uses `child.unref()` |
| `electron-headless-mode.test.js` | `electron/main.js` gates `mainWindow.show()` behind `SIDECAR_HEADLESS_TEST` env var |

These tests catch regressions in critical spawn/process configuration that would be hard to debug in production.

---

## Tier 3: E2E Tests

E2E tests spawn real processes, call real LLMs, and verify end-to-end behavior. They require `OPENROUTER_API_KEY` and are automatically skipped when the key is missing.

### Skip Behavior

All E2E tests use this pattern:

```javascript
const HAS_API_KEY = !!(
  process.env.OPENROUTER_API_KEY ||
  (() => {
    try {
      const envPath = path.join(os.homedir(), '.config', 'sidecar', '.env');
      return fs.readFileSync(envPath, 'utf-8').includes('OPENROUTER_API_KEY=');
    } catch { return false; }
  })()
);
const describeE2E = HAS_API_KEY ? describe : describe.skip;
```

The key can be in the environment or in `~/.config/sidecar/.env`.

### CLI Headless E2E (`cli-headless-e2e.integration.test.js`)

Spawns the real `sidecar` CLI binary with `start --no-ui` and verifies the full headless lifecycle.

**What it tests:**
1. `start --no-ui` runs to completion with real LLM
2. Session files created on disk (metadata.json, summary.md, initial_context.md)
3. `list` command shows the completed session
4. `read` command returns the summary
5. `read --metadata` returns valid JSON metadata

**Architecture:**
```
Test process
  └─ spawn(node, [sidecar.js, start, --no-ui, ...])
       └─ OpenCode server (auto port)
            └─ Real LLM call (gemini-flash)
       └─ Session files written to tmpDir
  └─ spawn(node, [sidecar.js, list, ...])  // verify list
  └─ spawn(node, [sidecar.js, read, ...])  // verify read
```

### MCP Headless E2E (`mcp-headless-e2e.integration.test.js`)

Spawns a real MCP server over stdio, sends JSON-RPC tool calls, and verifies the full MCP lifecycle.

**What it tests:**
1. `sidecar_start` with `noUi: true` launches a headless session
2. `sidecar_status` polling until completion
3. `sidecar_read` returns the summary
4. `sidecar_list` shows the completed session
5. Session files exist on disk with correct metadata

**Architecture:**
```
Test process
  └─ spawn(node, [sidecar.js, mcp])  // MCP server over stdio
       ├─ JSON-RPC: initialize
       ├─ JSON-RPC: tools/call (sidecar_start)
       │    └─ OpenCode server (auto port)
       │         └─ Real LLM call
       ├─ JSON-RPC: tools/call (sidecar_status)  // poll loop
       ├─ JSON-RPC: tools/call (sidecar_read)
       └─ JSON-RPC: tools/call (sidecar_list)
```

### Electron CDP E2E (`electron-toolbar-e2e.integration.test.js`)

Spawns a real Electron window (hidden) with a real OpenCode server, connects via Chrome DevTools Protocol, and asserts toolbar DOM state.

**What it tests:**
1. Brand name renders ("Sidecar")
2. Task ID displayed in toolbar
3. Timer ticks (changes after 2 seconds)
4. Fold button exists with shortcut label
5. Settings gear button exists
6. Update banner hidden by default
7. Update banner visible when `SIDECAR_MOCK_UPDATE=available`
8. Screenshots captured as PNG files

**Architecture:**
```
Test process
  ├─ spawn(node, [start-server.js])     // Real OpenCode server (separate process)
  │    └─ Outputs { port, sessionId }
  ├─ spawn(electron, [main.js])          // Hidden Electron window
  │    ├─ BrowserView → http://localhost:<port>  (OpenCode UI)
  │    └─ Main window → data:text/html (toolbar)
  └─ CdpClient.toolbar(9224)            // CDP WebSocket connection
       ├─ Runtime.evaluate(...)           // DOM assertions
       └─ Page.captureScreenshot(...)     // Screenshot capture
```

---

## CDP Helper (`tests/helpers/cdp-client.js`)

Thin class (~190 lines) wrapping `ws` + `http` for Chrome DevTools Protocol communication. No external dependencies beyond `ws` (already a project dependency).

### API

```javascript
const { CdpClient } = require('./helpers/cdp-client');

// Factory methods (with retry/polling)
const cdp = await CdpClient.toolbar(port, timeoutMs);   // data: URL target
const cdp = await CdpClient.content(port, timeoutMs);   // http://localhost target

// Core methods
const targets = await cdp.getTargets();                  // GET /json
const target = await cdp.findTarget(t => t.url.startsWith('data:'));
await cdp.connect(targetId);                             // WebSocket
const value = await cdp.evaluate('document.title');      // Runtime.evaluate
await cdp.waitForSelector('.brand', 10000);              // Poll until element exists
await cdp.screenshot('/tmp/toolbar.png');                // Page.captureScreenshot
cdp.close();                                             // Cleanup
```

### Electron Debug Targets

Electron creates two CDP targets per window:

| Target | URL Pattern | Contains |
|--------|-------------|----------|
| **Content** | `http://localhost:<port>` | OpenCode web UI (BrowserView) |
| **Toolbar** | `data:text/html,...` | Sidecar toolbar (brand, timer, fold button) |

Use `CdpClient.toolbar()` or `CdpClient.content()` to connect to the right one.

### Server Helper (`tests/helpers/start-server.js`)

Starts a real OpenCode server in a separate Node.js process, working around Jest's inability to handle ESM dynamic imports. Outputs `{ port, sessionId }` as JSON on stdout, then stays alive until killed.

```javascript
const child = spawn(process.execPath, ['tests/helpers/start-server.js']);
// Parse JSON from stdout to get { port, sessionId }
// Kill child when done to stop the server
```

---

## Environment Variables for Testing

### Required for E2E Tests

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | API key for real LLM calls. Without it, E2E tests are skipped. Can also be in `~/.config/sidecar/.env` |

### Test Infrastructure Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SIDECAR_HEADLESS_TEST` | unset | Set to `1` to suppress `mainWindow.show()` in Electron. Window is created but never made visible. CDP screenshots still work (captures off-screen renderer). |
| `SIDECAR_DEBUG_PORT` | `9222` | CDP remote debugging port. Use `9223`+ to avoid conflicts with Chrome browser. E2E tests use `9224`. |
| `SIDECAR_MOCK_UPDATE` | unset | Mock update banner state: `available`, `updating`, `success`, `error`. Used in Electron toolbar E2E tests. |

---

## Cross-Platform: macOS vs Linux

### macOS

No extra dependencies needed. Electron runs natively. The window is created with `show: false` when `SIDECAR_HEADLESS_TEST=1`, so no visible window pops up. CDP screenshots capture the off-screen renderer.

### Linux (VPS / CI)

Electron requires an X server to create a renderer, even with `show: false`. The E2E tests auto-detect headless Linux and manage Xvfb:

```javascript
function ensureDisplay() {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return { display: process.env.DISPLAY, cleanup: () => {} };
  }
  // Auto-launch Xvfb on :99
  const xvfbProcess = spawn('Xvfb', [':99', '-screen', '0', '1280x720x24']);
  return { display: ':99', cleanup: () => xvfbProcess.kill() };
}
```

**Prerequisites for Linux CI:**
```bash
apt-get install -y xvfb libgtk-3-0 libnotify4 libnss3 libxss1 libasound2
```

---

## Screenshots

CDP E2E tests capture screenshots to `tests/screenshots/` (gitignored). Screenshots are PNG files generated via `Page.captureScreenshot`:

| Screenshot | Generated By | Shows |
|------------|-------------|-------|
| `toolbar-default.png` | Toolbar E2E default tests | Default toolbar state |
| `toolbar-update-banner.png` | Toolbar E2E update banner tests | Toolbar with update banner visible |

Screenshots are not committed to git. They're generated fresh on each test run for visual verification. Future work: pixel-diff comparison against committed baselines.

---

## Agentic Eval System

The eval system tests whether an LLM (Claude) can correctly use sidecar as a tool. Each eval spawns a real Claude Code process in an isolated sandbox.

See [evals/README.md](../evals/README.md) for full documentation.

### Quick Start

```bash
node evals/run_eval.js --eval-id 1              # Single eval
node evals/run_eval.js --all                     # All evals
node evals/run_eval.js --eval-id 1 --mode mcp   # MCP mode only
node evals/run_eval.js --eval-id 1 --mode cli   # CLI mode only
```

### Scoring

Two-stage: programmatic checks (gate) then LLM-as-judge (quality). All programmatic checks must pass before the LLM judge runs.

---

## Writing New Tests

### Choosing the Right Tier

| Scenario | Tier | Example |
|----------|------|---------|
| New parsing logic | Unit | Mock inputs, assert outputs |
| New CLI flag | Unit | Test `parseArgs()` with the new flag |
| New MCP tool | Unit | Test Zod schema + handler with mocked SDK |
| Critical spawn config | Integration | Read source, assert pattern present |
| New headless workflow | E2E | Real LLM, verify session files |
| New toolbar UI element | E2E (CDP) | Real Electron, assert DOM via CDP |
| MCP App rendering changes | Manual (harness) | `npm run dev:ui`, visual + CDP inspection |
| LLM decision quality | Eval | Claude + sidecar in sandbox |

### Naming Conventions

```
tests/
  foo.test.js                          # Unit test for src/foo.js
  foo.integration.test.js              # Integration test (source-level)
  foo-e2e.integration.test.js          # E2E test (real processes/LLM)
  sidecar/foo.test.js                  # Unit test for src/sidecar/foo.js
  helpers/                             # Test utilities (not test files)
```

### CDP E2E Test Pattern

When adding a new Electron E2E test:

1. Reuse the `startRealServer()` + `spawnElectron()` + `CdpClient` pattern from `electron-toolbar-e2e.integration.test.js`
2. Use `SIDECAR_HEADLESS_TEST=1` to suppress the window
3. Use a unique `SIDECAR_DEBUG_PORT` (currently `9224` for toolbar tests)
4. Always clean up in `afterAll`: kill Electron, kill server, kill Xvfb
5. Save screenshots to `tests/screenshots/` with descriptive names

```javascript
describeE2E('My New E2E Test', () => {
  let serverInfo, electronProcess, cdp;

  beforeAll(async () => {
    serverInfo = await startRealServer();
    electronProcess = spawnElectron({
      opencodePort: serverInfo.port,
      sessionId: serverInfo.sessionId,
      taskId: 'my-test',
    });
    cdp = await CdpClient.toolbar(CDP_PORT, 20000);
  }, 30000);

  afterAll(async () => {
    cdp?.close();
    electronProcess?.kill('SIGTERM');
    serverInfo?.cleanup();
  });

  it('verifies some DOM state', async () => {
    await cdp.waitForSelector('.my-element');
    const text = await cdp.evaluate(`document.querySelector('.my-element')?.textContent`);
    expect(text).toContain('expected');
  });
});
```

### Test File Location

All test files go in `tests/`. Test helpers go in `tests/helpers/`. The Jest config matches `**/tests/**/*.test.js`.

---

## Jest Configuration

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', 'bin/**/*.js', 'electron/**/*.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  verbose: true
};
```

**Timeouts:** E2E tests set per-test timeouts of 180 seconds (3 minutes) for real LLM calls. Unit tests use Jest's default 5-second timeout.

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| E2E tests skipped | No `OPENROUTER_API_KEY` | Set the key in env or `~/.config/sidecar/.env` |
| CDP connection refused | Wrong port or Chrome conflict | Use `SIDECAR_DEBUG_PORT=9224` (not 9222/9223) |
| Electron E2E skipped | `electron` not installed | `npm install` (it's a devDependency) |
| Linux E2E crash | No X server | Install Xvfb: `apt-get install xvfb` |
| Jest ESM error | Dynamic import in test | Use `tests/helpers/start-server.js` child process |
| `waitForSelector` timeout | Element not rendered yet | Increase timeout or check selector name |
| Screenshot empty/small | Window not created | Verify `SIDECAR_HEADLESS_TEST=1` is set |
| Stale CDP target ID | Electron restarted | Always use `CdpClient.toolbar()` factory (retries) |
