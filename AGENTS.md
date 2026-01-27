# AGENTS.md
<!-- AUTO-SYNCED from CLAUDE.md - Do not edit directly -->
<!-- Run: node scripts/sync-agent-docs.js to update -->

<!-- Last updated: 2026-01-26 -->

This file provides guidance to AI agents when working with code in this repository.

## Project Overview

**Claude Sidecar** is a multi-model subagent tool that extends Claude Code with the ability to spawn parallel conversations with different LLMs (Gemini, GPT-4, o3, etc.) and fold the results back into the main context.

### Core Features

- **Fork & Fold Workflow**: Spawn specialized models for deep exploration, fold summaries back
- **Multi-Model Routing**: Use the right model for the job (Gemini's large context, o3's reasoning, GPT-4's coding)
- **Clean Context**: Isolate deep explorations to sidecars, keep main conversation focused
- **Async-Safe Operations**: File conflict detection and context drift warnings
- **Session Persistence**: Resume, continue, or read previous sidecar sessions

### Key Value Proposition

1. **Right model for the job** - Route tasks to specialized models
2. **Keep context clean** - Isolate deep explorations
3. **Work in parallel** - Background execution with Ctrl+B
4. **Safe async** - Conflict and drift detection

---

## Essential Commands

### Development
```bash
npm start                    # Run sidecar CLI
npm test                     # Run all tests (Jest)
npm run lint                 # Run ESLint
```

### CLI Usage
```bash
node bin/sidecar.js start --model <model> --briefing "<task>" [--agent <agent>]
node bin/sidecar.js list [--status <filter>] [--all]
node bin/sidecar.js resume <task_id>
node bin/sidecar.js continue <task_id> --briefing "..."
node bin/sidecar.js read <task_id> [--summary|--conversation]
```

### OpenCode Agent Types

The `--agent` option specifies which OpenCode native agent to use:

| Agent | Description | Tool Access |
|-------|-------------|-------------|
| **Build** | Default primary agent | Full (read, write, bash, task) |
| **Plan** | Read-only analysis | Read-only |
| **General** | Full-access subagent | Full |
| **Explore** | Read-only subagent | Read-only |

Custom agents defined in `~/.config/opencode/agents/` or `.opencode/agents/` are also supported.

### Testing
```bash
npm test                           # All tests
npm test tests/context.test.js     # Single file (preferred during dev)
npm test -- --coverage             # Coverage report
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude Code                            │
│                            │                                 │
│                       sidecar CLI                            │
│      ┌─────────────────────┴─────────────────────┐          │
│      │                                           │          │
│      ▼                                           ▼          │
│  Interactive Mode                    Headless Mode          │
│  (Electron + OpenCode)              (OpenCode HTTP API)     │
│      │                                           │          │
│      └─────────────────────┬─────────────────────┘          │
│                            │                                 │
│               Summary returned to Claude Code                │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User: sidecar start --model google/gemini-2.5 --briefing "Debug auth issue"
       ↓
CLI parses args (cli.js)
       ↓
buildContext() extracts from ~/.claude/projects/[project]/[session].jsonl
       ↓
buildSystemPrompt() combines briefing + context + mode instructions
       ↓
createSession() initializes .claude/sidecar_sessions/<taskId>/
       ↓
[Interactive]                    [Headless]
Electron window opens            OpenCode HTTP API spawned
User converses                   Agent works autonomously
FOLD clicked                     [SIDECAR_COMPLETE] marker
       ↓                              ↓
Summary captured to conversation.jsonl
       ↓
Summary output to stdout → Claude Code receives in context
```

---

## Directory Structure

```
sidecar/
├── bin/
│   └── sidecar.js               # CLI entry point
├── src/
│   ├── index.js                 # Main API re-exports (thin module ~82 lines)
│   ├── cli.js                   # Command-line argument parsing
│   ├── sidecar/                 # Core sidecar operations (modular)
│   │   ├── start.js             # startSidecar(), runInteractive(), generateTaskId()
│   │   ├── resume.js            # resumeSidecar(), checkFileDrift()
│   │   ├── continue.js          # continueSidecar(), loadPreviousSession()
│   │   ├── read.js              # readSidecar(), listSidecars(), formatAge()
│   │   ├── context-builder.js   # buildContext(), parseDuration()
│   │   └── session-utils.js     # Shared utilities (SessionPaths, finalizeSession, etc.)
│   ├── context.js               # Context extraction & filtering
│   ├── session-manager.js       # Session persistence & metadata
│   ├── prompt-builder.js        # System prompt construction
│   ├── headless.js              # Headless mode runner (OpenCode HTTP API)
│   ├── conflict.js              # File conflict detection
│   ├── drift.js                 # Context drift calculation
│   ├── session.js               # Session file resolution
│   ├── jsonl-parser.js          # JSONL parsing & formatting
│   └── utils/                   # Utility modules
│       ├── agent-mapping.js     # OpenCode agent mapping & validation
│       ├── validators.js        # CLI input validation helpers
│       ├── logger.js            # Structured logging
│       ├── path-setup.js        # PATH configuration for OpenCode
│       └── server-setup.js      # Server port management
├── electron/
│   ├── main.js                  # Electron window (SDK-based, custom UI)
│   ├── main-legacy.js           # Old CLI-based version (kept for reference)
│   ├── preload.js               # IPC bridge to renderer
│   ├── preload-v2.js            # IPC bridge for custom UI
│   ├── inject.css               # Styling overrides
│   └── ui/                      # Custom chat UI
│       ├── index.html           # Main HTML
│       ├── renderer.js          # Chat logic + model picker integration
│       ├── model-picker.js      # Model selection module
│       └── styles.css           # UI styles
├── tests/                       # Jest test suite (567 tests, 24 suites)
│   ├── cli.test.js
│   ├── context.test.js
│   ├── session-manager.test.js
│   ├── conflict.test.js
│   ├── drift.test.js
│   ├── headless.test.js
│   ├── prompt-builder.test.js
│   ├── e2e.test.js
│   ├── sidecar/                 # Tests for modular sidecar operations
│   │   ├── start.test.js
│   │   ├── resume.test.js
│   │   ├── continue.test.js
│   │   ├── read.test.js
│   │   ├── context-builder.test.js
│   │   └── session-utils.test.js
│   └── ...
├── skill/
│   └── SKILL.md                 # Claude Code skill integration
├── scripts/
│   ├── postinstall.js           # Auto-install skill to ~/.claude/skills/
│   ├── integration-test.sh      # E2E integration tests
│   └── sync-agent-docs.js       # Sync CLAUDE.md → GEMINI.md, AGENTS.md
├── package.json
├── jest.config.js
├── .eslintrc.js
├── CLAUDE.md                    # This file (primary)
├── GEMINI.md                    # Synced from CLAUDE.md
└── AGENTS.md                    # Synced from CLAUDE.md
```

---

## Key Modules

### Core Sidecar Operations (`src/sidecar/`)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `sidecar/start.js` | Session starting | `startSidecar()`, `runInteractive()`, `generateTaskId()`, `buildMcpConfig()` |
| `sidecar/resume.js` | Session resumption | `resumeSidecar()`, `checkFileDrift()`, `buildDriftWarning()` |
| `sidecar/continue.js` | Session continuation | `continueSidecar()`, `loadPreviousSession()`, `buildContinuationContext()` |
| `sidecar/read.js` | Session listing/reading | `readSidecar()`, `listSidecars()`, `formatAge()` |
| `sidecar/context-builder.js` | Context from Claude Code | `buildContext()`, `parseDuration()` |
| `sidecar/session-utils.js` | Shared utilities | `SessionPaths`, `finalizeSession()`, `saveInitialContext()`, `createHeartbeat()` |

### Supporting Modules (`src/`)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `index.js` | Re-exports all public APIs | Thin module (~82 lines) |
| `cli.js` | Argument parsing & validation | `parseArgs()`, `validateStartArgs()`, `validateSubagentArgs()` |
| `context.js` | Context filtering | `filterContext()`, `takeLastNTurns()`, `estimateTokens()` |
| `session-manager.js` | Session persistence | `createSession()`, `updateSession()`, `saveConversation()`, `saveSummary()` |
| `prompt-builder.js` | System prompt construction | `buildSystemPrompt()`, `buildPrompts()`, `getSummaryTemplate()` |
| `headless.js` | Autonomous execution | Spawns OpenCode HTTP API, polls for `[SIDECAR_COMPLETE]` |
| `conflict.js` | File conflict detection | Compares mtimes against session start, formats warnings |
| `drift.js` | Context staleness | `calculateDrift()`, `isDriftSignificant()`, `countTurnsSince()` |
| `session.js` | Session resolution | Primary (explicit ID) / Fallback (most recent mtime) |
| `utils/agent-mapping.js` | OpenCode agent mapping | `mapAgentToOpenCode()`, `isValidAgent()`, `OPENCODE_AGENTS` |
| `utils/model-router.js` | Subagent model routing | `resolveModel()`, `getConfiguredCheapModel()`, `isRoutingEnabled()` |
| `utils/agent-model-config.js` | Model config persistence | `loadConfig()`, `saveConfig()`, `getModelForAgent()`, `setAgentModel()` |
| `utils/validators.js` | CLI input validation | `validateBriefingContent()`, `validateProjectPath()`, `validateApiKey()` |
| `utils/logger.js` | Structured logging | `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()` |

### Shared Session Utilities (`src/sidecar/session-utils.js`)

This module consolidates functionality shared between interactive and headless modes:

| Utility | Purpose |
|---------|---------|
| `SessionPaths` | Path constants for session files (eliminates magic strings) |
| `saveInitialContext()` | Save system prompt + user message to `initial_context.md` |
| `finalizeSession()` | Unified session completion (conflict detection, summary save, metadata update) |
| `outputSummary()` | Standardized summary output to stdout |
| `createHeartbeat()` | Encapsulated heartbeat with proper cleanup |
| `executeMode()` | Abstract headless/interactive execution pattern |

---

## Code Quality Rules

### File Size Limits (HARD LIMITS)

| Entity | Max Lines | Action If Exceeded |
|--------|-----------|-------------------|
| **Any file** | 300 lines | MUST refactor immediately |
| **Any function** | 50 lines | MUST break into smaller functions |

### Complexity Red Flags

**STOP and refactor immediately if you see:**

- **>5 nested if/else statements** → Extract to separate functions
- **>3 try/catch blocks in one function** → Split error handling
- **>10 imports** → Consider splitting the module
- **Duplicate logic** → Extract to shared utilities

### Code Quality Monitoring

```bash
# Check line counts (monitor file sizes - target <300 lines)
find src -name "*.js" -exec wc -l {} + | sort -n

# Find large files (>300 lines need refactoring)
find src -name "*.js" -exec wc -l {} + | awk '$1 > 300'
```

---

## Structured Logging Guidelines

**CRITICAL**: Use structured logging for debugging and observability.

```javascript
// ❌ BAD - No context, hard to debug
console.log('Session started');

// ✅ GOOD - Structured with context
logger.info('Session started', { taskId, model, mode });
```

### Log Level Usage

| Level | When to Use | Example |
|-------|-------------|---------|
| `debug` | Verbose development info | `Parsing JSONL file at path...` |
| `info` | Important events | `Sidecar started`, `Summary captured` |
| `warn` | Recoverable issues | `Context drift detected`, `File conflict warning` |
| `error` | Failures requiring attention | `OpenCode spawn failed`, `Parse error` |

### Logger Implementation

Create `src/utils/logger.js`:

```javascript
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

export const logger = {
  error: (msg, ctx = {}) => currentLevel >= 0 && console.error(JSON.stringify({ level: 'error', msg, ...ctx, ts: new Date().toISOString() })),
  warn:  (msg, ctx = {}) => currentLevel >= 1 && console.error(JSON.stringify({ level: 'warn', msg, ...ctx, ts: new Date().toISOString() })),
  info:  (msg, ctx = {}) => currentLevel >= 2 && console.error(JSON.stringify({ level: 'info', msg, ...ctx, ts: new Date().toISOString() })),
  debug: (msg, ctx = {}) => currentLevel >= 3 && console.error(JSON.stringify({ level: 'debug', msg, ...ctx, ts: new Date().toISOString() })),
};
```

**Note**: Logs go to stderr to avoid polluting stdout (used for sidecar summary output).

---

## Testing Strategy

### TDD Process (REQUIRED for Business Logic)

1. **Red Phase**: Write failing tests first
2. **Green Phase**: Implement minimal code to pass
3. **Refactor Phase**: Clean up while keeping tests green

### What to Unit Test (Core Business Logic)

| Test File | Target Module | Focus |
|-----------|--------------|-------|
| `cli.test.js` | Argument parsing | Command validation, flag handling |
| `context.test.js` | Context filtering | Turn extraction, token estimation |
| `session.test.js` | Session resolution | Primary/fallback paths |
| `session-manager.test.js` | Persistence layer | CRUD operations, metadata |
| `conflict.test.js` | File conflicts | mtime comparison, warning format |
| `drift.test.js` | Drift calculation | Age, turn count, significance |
| `headless.test.js` | OpenCode HTTP API | Spawn, polling, timeout |
| `prompt-builder.test.js` | System prompts | Template construction |
| `index.test.js` | Main API | Integration |
| `e2e.test.js` | End-to-end | Full workflow |
| `sidecar/start.test.js` | Session starting | Task ID generation, metadata creation, MCP config |
| `sidecar/resume.test.js` | Session resumption | Drift detection, metadata loading |
| `sidecar/continue.test.js` | Session continuation | Previous session loading, context building |
| `sidecar/read.test.js` | Session reading | Listing, age formatting, output modes |
| `sidecar/context-builder.test.js` | Context building | Session resolution, message filtering |
| `sidecar/session-utils.test.js` | Shared utilities | Session paths, finalization, heartbeat |

### What NOT to Unit Test (UI Code)

**Do NOT write unit tests for:**
- DOM manipulation in `renderer.js`
- UI picker components (`model-picker.js`, `mode-picker.js`, `thinking-picker.js`)
- Electron window configuration (`main.js`)
- CSS class assignments and styling

**Why:** DOM mock tests are ineffective - they test mock behavior, not real rendering. These tests create false confidence and are expensive to maintain.

### UI Testing Approach (Manual + Screenshots)

For UI changes, verify via manual testing:

1. **Run the app**: `node bin/sidecar.js start --model <model> --briefing "test"`
2. **Screenshot verification**: Use Chrome DevTools Protocol on port 9222 (see below)
3. **Manual click-through**: Verify interactions work as expected
4. **E2E tests**: Use `tests/e2e.test.js` for critical user flows

### Test Commands

```bash
npm test                           # All tests
npm test tests/context.test.js     # Single file (faster during dev)
npm test -- --watch                # Watch mode
npm test -- --coverage             # Coverage report
```

---

## Electron UI Testing (Chrome DevTools Protocol)

The Electron sidecar window runs with remote debugging enabled on port 9222. This allows programmatic inspection and testing of the UI state via the Chrome DevTools Protocol.

### Prerequisites

The Electron app automatically enables remote debugging when launched. Verify it's accessible:

```bash
curl -s http://127.0.0.1:9222/json | python3 -m json.tool
```

### Testing UI State with Node.js

Use the WebSocket API to execute JavaScript in the Electron renderer and inspect UI state:

```javascript
// test-electron-ui.js
const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/<PAGE_ID>');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (function() {
          const messages = document.querySelectorAll('.message');
          const toolCalls = document.querySelectorAll('.tool-call');
          return {
            sessionId: window.sessionId,
            messagesCount: messages.length,
            toolCallsCount: toolCalls.length,
            messages: Array.from(messages).map(m => ({
              class: m.className,
              text: m.textContent.slice(0, 200)
            }))
          };
        })()
      `,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const response = JSON.parse(data);
  if (response.id === 1) {
    console.log(JSON.stringify(response.result?.result?.value, null, 2));
    ws.close();
  }
});
```

### Common UI Test Queries

**Get page ID first:**
```bash
curl -s http://127.0.0.1:9222/json | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])"
```

**Check UI state (inline):**
```bash
node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/<PAGE_ID>');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `({
        hasConfig: !!window.sidecarConfig,
        model: window.sidecarConfig?.model,
        messagesCount: document.querySelectorAll('.message').length,
        toolCallsCount: document.querySelectorAll('.tool-call').length,
        errorMessages: Array.from(document.querySelectorAll('.error-message')).map(e => e.textContent)
      })`,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const r = JSON.parse(data);
  if (r.id === 1) { console.log(JSON.stringify(r.result?.result?.value, null, 2)); ws.close(); }
});

setTimeout(() => { ws.close(); process.exit(0); }, 5000);
EOF
```

**Get tool call details:**
```bash
node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/<PAGE_ID>');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        Array.from(document.querySelectorAll('.tool-call')).map(t => ({
          class: t.className,
          html: t.innerHTML.slice(0, 500)
        }))
      `,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const r = JSON.parse(data);
  if (r.id === 1) { console.log(JSON.stringify(r.result?.result?.value, null, 2)); ws.close(); }
});

setTimeout(() => { ws.close(); process.exit(0); }, 5000);
EOF
```

### Expected UI Elements

When testing the sidecar UI, verify these elements:

| Selector | Description | Expected Content |
|----------|-------------|------------------|
| `.message.system` | Task briefing | "Task: {briefing}" |
| `.message.assistant` | Model response | Response text |
| `.message.user` | User input | User's message |
| `.tool-call` | Tool execution | Tool name, input, output |
| `.tool-call.completed` | Completed tool | Has ✓ status |
| `.tool-call.running` | Running tool | Has ... status |
| `.tool-status-panel` | Tool summary | "Tools: X/Y completed" |
| `.reasoning` | Model reasoning | Collapsible thinking |
| `.error-message` | Error display | Error text |

### Debugging Tips

1. **Get WebSocket URL**: `curl -s http://127.0.0.1:9222/json | jq '.[0].webSocketDebuggerUrl'`
2. **Enable console capture**: Send `{"method": "Console.enable"}` first
3. **Screenshot**: Use `Page.captureScreenshot` method
4. **Timeout**: Always add a timeout to prevent hanging scripts

### Integration with CI

For automated testing, launch the sidecar with a known task and verify UI state:

```bash
# Launch sidecar in background
node bin/sidecar.js start --model "openrouter/google/gemini-2.5-pro" \
  --briefing "Echo hello" &
SIDECAR_PID=$!

# Wait for window to open
sleep 5

# Get page ID and test UI
PAGE_ID=$(curl -s http://127.0.0.1:9222/json | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# Run UI verification script
node scripts/verify-ui-state.js "$PAGE_ID"

# Cleanup
kill $SIDECAR_PID
```

### Visual UI Testing with Screenshots (macOS)

**Launch and position Electron window:**
```bash
# Start sidecar in background
node bin/sidecar.js start --model "openrouter/google/gemini-3-flash-preview" --briefing "Test task" &
sleep 8

# Bring window to front and position it (window may open off-screen)
osascript << 'EOF'
tell application "System Events"
    tell process "Electron"
        set frontmost to true
        set position of window 1 to {100, 100}
    end tell
end tell
EOF
```

**Take screenshot:**
```bash
screencapture -x /tmp/sidecar-screenshot.png
```

**Dynamic page ID retrieval (required - ID changes each session):**
```bash
PAGE_ID=$(curl -s http://127.0.0.1:9222/json | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d)[0].id)")
```

**Click UI elements and inspect state (run from sidecar directory for `ws` module):**
```bash
cd /Users/john_renaldi/claude-code-projects/sidecar
cat << EOF > test-ui.js
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/${PAGE_ID}');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`
        (function() {
          // Click model selector
          document.getElementById('model-selector-display')?.click();

          // Or force dropdown visible
          document.getElementById('model-selector-dropdown')?.classList.add('visible');

          // Return state
          return Array.from(document.querySelectorAll('.model-option'))
            .map(opt => ({
              name: opt.querySelector('.model-name-display')?.textContent,
              selected: opt.classList.contains('selected')
            }));
        })()
      \`,
      returnByValue: true
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.id === 1) {
    console.log(JSON.stringify(msg.result?.result?.value, null, 2));
    ws.close();
    process.exit(0);
  }
});

setTimeout(() => { ws.close(); process.exit(0); }, 3000);
EOF
node test-ui.js
```

**Common gotchas:**
- Window may open off-screen (negative Y coordinate) - use AppleScript to reposition
- Page ID changes on each Electron launch - always fetch dynamically
- Run Node.js scripts from sidecar directory to access `ws` module
- Add `setTimeout` to prevent hanging on WebSocket errors

---

## JavaScript Standards

- **ES2022+** features (top-level await, private fields)
- **ESM modules** (`"type": "module"` in package.json)
- **ESLint strict mode** (no var, eqeqeq: always, curly: all, semi: always)
- **JSDoc comments** for all public APIs

### ESLint Configuration

```javascript
// .eslintrc.js
module.exports = {
  env: { node: true, es2022: true, jest: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'semi': ['error', 'always'],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

### JSDoc + TypeScript Declarations

This project uses **JSDoc comments** to provide TypeScript type information without converting to TypeScript. This gives npm consumers autocomplete and type checking.

#### JSDoc Pattern for Public APIs

```javascript
/**
 * Start a new sidecar session
 * @param {Object} options - Sidecar configuration
 * @param {string} options.model - LLM model identifier (e.g., 'google/gemini-2.5-flash')
 * @param {string} options.briefing - Task description for the sidecar
 * @param {string} [options.sessionId] - Optional Claude Code session ID
 * @param {boolean} [options.headless=false] - Run without GUI
 * @param {number} [options.timeout=15] - Headless timeout in minutes
 * @returns {Promise<SidecarResult>} Session result with summary
 */
async function startSidecar(options) {
  // ...
}

/**
 * @typedef {Object} SidecarResult
 * @property {string} taskId - Unique session identifier
 * @property {string} summary - Fold summary from sidecar
 * @property {string} status - Session status (completed|timeout|error)
 * @property {string[]} [conflicts] - Files with potential conflicts
 */
```

#### Generating .d.ts Files

Add to `package.json`:

```json
{
  "scripts": {
    "build:types": "tsc --declaration --emitDeclarationOnly --allowJs --outDir types"
  },
  "types": "types/index.d.ts",
  "files": ["bin/", "src/", "electron/", "types/"]
}
```

Create `jsconfig.json`:

```json
{
  "compilerOptions": {
    "checkJs": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "allowJs": true,
    "outDir": "types",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "target": "ES2022"
  },
  "include": ["src/**/*.js", "bin/**/*.js"],
  "exclude": ["node_modules", "tests"]
}
```

#### Pre-publish Workflow

```bash
# Generate types before publishing
npm run build:types

# Verify types are generated
ls types/

# Publish with types
npm publish
```

---

## Configuration

### Environment Variables (.env)

```bash
# Required
OPENROUTER_API_KEY=sk-or-...        # Multi-model API access

# Optional
OPENCODE_COMMAND=opencode           # Override OpenCode command path
SIDECAR_DEFAULT_MODEL=openrouter/google/gemini-2.5-flash
SIDECAR_TIMEOUT=15                  # Headless timeout in minutes
LOG_LEVEL=info                      # debug | info | warn | error
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^28.0.0 | Interactive sidecar window |
| `tiktoken` | ^1.0.0 | Token estimation |
| `jest` | ^29.0.0 | Testing framework |
| `eslint` | ^8.0.0 | Code linting |

### Peer Dependencies

- `opencode-ai` (>=1.0.0) - LLM conversation engine

### Model Names Reference

**IMPORTANT**: Always fetch current model names from the OpenRouter API before using them.

**API Endpoint**: `https://openrouter.ai/api/v1/models`

```bash
# Fetch available models
curl https://openrouter.ai/api/v1/models | jq '.data[].id' | grep -i gemini
```

**Common Model IDs** (as of 2026-01):
| Model | OpenRouter ID |
|-------|---------------|
| Gemini 3 Pro | `openrouter/google/gemini-3-pro-preview` |
| Gemini 3 Flash | `openrouter/google/gemini-3-flash-preview` |

**Note**: Model names change frequently. Always verify current names via the API.

---

## SDK & API Notes

### OpenCode SDK Requirements

- SDK's `createOpencodeServer()` spawns `opencode` CLI internally - CLI must be installed
- Workaround: Create wrapper script at `node_modules/.bin/opencode` that calls `npx opencode-ai`
- SDK is ESM-only; use dynamic `import()` not `require()` in CommonJS projects
- Jest can't mock dynamic imports without `--experimental-vm-modules` - skip those tests

### OpenCode API Format

- Model must be object: `{ providerID: 'openrouter', modelID: 'google/gemini-2.5-flash' }`
- Sending model as string causes 400 Bad Request
- Use `formatModelForAPI()` from `electron/ui/model-picker.js` for conversion

---

## OpenCode Integration Principles

This section documents how sidecar integrates with OpenCode's native capabilities and avoids redundant implementations.

### What OpenCode Provides (Use Native APIs)

| Feature | OpenCode API | How We Use It |
|---------|-------------|---------------|
| **Agent Types** | Native `Build`, `Plan`, `Explore`, `General` | Pass `agent` parameter to `sendPrompt()` |
| **Tool Permissions** | Enforced by agent framework | NO custom prompt-based restrictions |
| **Session Status** | `session.status()` | Used in `headless.js` for completion detection |
| **Session Messages** | `session.messages()` | Used for polling and conversation capture |
| **Child Sessions** | `session.create({ parentID })` | Used for subagent spawning |
| **Health Check** | `config.get()` | Used to verify server ready state |

### What We Built (Unique Value)

| Feature | Why We Need It | Implementation |
|---------|----------------|----------------|
| **Context Extraction** | Bridge Claude Code sessions to OpenCode | `context.js` reads `.jsonl` files |
| **File Conflict Detection** | Safety feature - OpenCode doesn't track this | `conflict.js` compares mtimes |
| **Context Drift Detection** | Safety feature - detect stale context | `drift.js` calculates staleness |
| **Session Persistence** | Custom metadata (briefing, agent, thinking) | `session-manager.js` |
| **MCP Config Merging** | CLI overrides + file config | `opencode-client.js` |

### Removed Redundancies

The following custom implementations were **removed** because OpenCode handles them natively:

| Removed | Reason | Native Replacement |
|---------|--------|-------------------|
| ~~`buildCodeModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `Build` agent |
| ~~`buildPlanModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `Plan` agent |
| ~~`buildAskModeEnvironment()`~~ | Tool restrictions in prompts | OpenCode `Build` with `permissions` |
| ~~Custom heartbeat polling~~ | Basic sleep loop | `session.status()` API |

### Agent Type Mapping

```javascript
// src/utils/agent-mapping.js
mapAgentToOpenCode('build')    // → { agent: 'Build' }
mapAgentToOpenCode('plan')     // → { agent: 'Plan' }
mapAgentToOpenCode('explore')  // → { agent: 'Explore' }
mapAgentToOpenCode('general')  // → { agent: 'General' }
mapAgentToOpenCode('custom')   // → { agent: 'custom' } // passed through
```

### Key Integration Files

| File | OpenCode Integration |
|------|---------------------|
| `src/opencode-client.js` | SDK wrapper - `createSession()`, `sendPrompt()`, `getSessionStatus()` |
| `src/headless.js` | Uses `session.status()` for completion detection |
| `src/utils/agent-mapping.js` | Maps sidecar modes to OpenCode agents |
| `electron/main.js` | Creates child sessions for subagents |

---

## OpenCode SDK & HTTP API Reference

Full documentation available in `/docs/`:
- `opencode-sdk.md` - SDK client reference
- `opencode-server.md` - HTTP API reference
- `opencode-integration-guide.md` - Integration patterns

### Critical: Model Format

Models MUST be objects, not strings:

```javascript
// ❌ WRONG - causes 400 Bad Request
{ model: "google/gemini-2.5-flash" }

// ✅ CORRECT
{ model: { providerID: "openrouter", modelID: "google/gemini-2.5-flash" } }
```

### SDK Quick Reference

```javascript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

// Health check
await client.global.health()

// Session lifecycle
const session = await client.session.create({ title: "Task" })
const response = await client.session.prompt(session.id, { content: "..." })
await client.session.delete(session.id)

// Context injection (no AI response)
await client.session.prompt(session.id, { content: "Context...", noReply: true })

// Async operation (returns immediately)
await client.session.promptAsync(session.id, { content: "Long task..." })

// Monitor via events
client.event.subscribe((event) => {
  if (event.type === "session.complete") { /* done */ }
})
```

### HTTP API Quick Reference

```bash
# Health check
GET /global/health

# Session lifecycle
POST /session                        # Create
GET  /session/:id                    # Get details
POST /session/:id/message            # Send (sync, blocks)
POST /session/:id/prompt_async       # Send (async, returns immediately)
DELETE /session/:id                  # Delete

# File operations
GET /find?pattern=X                  # Search contents
GET /find/file?query=X               # Find by name
GET /file/content?path=X             # Read file

# Events (SSE stream)
GET /global/event
```

### Sync vs Async Operations

| Mode | Endpoint | Use When |
|------|----------|----------|
| **Sync** | `POST /session/:id/message` | Quick queries, need immediate result |
| **Async** | `POST /session/:id/prompt_async` | Long tasks, background processing |

For async, monitor progress via SSE at `/global/event`.

### Headless Mode Integration Pattern

```
1. Create Session    → POST /session { title, model, agent }
2. Inject Context    → POST /session/:id/message { content, noReply: true }
3. Send Briefing     → POST /session/:id/prompt_async { content }
4. Poll Status       → GET /session/:id (check status)
5. Check Messages    → GET /session/:id/message (look for [SIDECAR_COMPLETE])
6. Capture Summary   → Extract text after completion marker
```

---

## Development Workflow Checklists

### Before Starting New Work

- [ ] Check file sizes: `find src -name "*.js" -exec wc -l {} + | sort -n`
- [ ] Review CLAUDE.md for current architecture
- [ ] Check test coverage: `npm test -- --coverage`

### During Development

- [ ] Write tests first (TDD)
- [ ] Monitor file growth (<300 lines)
- [ ] Use structured logging (not console.log)
- [ ] Single responsibility per function

### Before Committing

- [ ] Run `npm test` - all tests passing
- [ ] Run `npm run lint` - no lint errors
- [ ] Update CLAUDE.md if architecture changed
- [ ] Sync docs: `node scripts/sync-agent-docs.js`

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `command not found: opencode` | OpenCode not installed | `npm install -g opencode-ai` |
| `spawn opencode ENOENT` | CLI not in PATH | Create wrapper: `echo '#!/bin/bash\nexec npx opencode-ai "$@"' > node_modules/.bin/opencode && chmod +x node_modules/.bin/opencode` |
| API 400 Bad Request | Model format wrong | Use `{providerID, modelID}` object, not string. See `formatModelForAPI()` |
| Jest ESM mock fails | Dynamic import | Skip test with `it.skip()` or use `--experimental-vm-modules` |
| Session resolution fails | No recent session | Pass explicit `--session` flag |
| Electron window blank | Assets not built | Run from project root |
| Headless timeout | Task too complex | Increase `SIDECAR_TIMEOUT` |
| Context too large | Too many turns | Use `--turns` or `--tokens` filter |
| API key errors | Missing env var | Set `OPENROUTER_API_KEY` in .env |
| Summary not captured | Fold not clicked | Click FOLD button or wait for [SIDECAR_COMPLETE] |

---

## Code Review Checklist

- [ ] Tests written first (TDD) and passing
- [ ] No file >300 lines
- [ ] No function >50 lines
- [ ] Structured logging (not console.log)
- [ ] JSDoc comments on public APIs
- [ ] Documentation updated if architecture changed
- [ ] Agent docs synced (`node scripts/sync-agent-docs.js`)

---

## Agent Documentation Sync

This project maintains synced documentation for multiple AI agents:
- **CLAUDE.md** (primary) - Claude Code instructions
- **GEMINI.md** - Gemini instructions (synced)
- **AGENTS.md** - Generic agent instructions (synced)

### Sync Command

```bash
node scripts/sync-agent-docs.js
```

This script copies CLAUDE.md content to GEMINI.md and AGENTS.md, updating the title line appropriately.

---

## Related Documentation

- [claude-sidecar-spec-v2.6.md](claude-sidecar-spec-v2.6.md) - Complete specification (2200+ lines)
- [README.md](README.md) - User-facing documentation
- [skill/SKILL.md](skill/SKILL.md) - Claude Code skill integration
- [docs/opencode-sdk.md](docs/opencode-sdk.md) - OpenCode SDK reference
- [docs/opencode-server.md](docs/opencode-server.md) - OpenCode HTTP API reference
- [docs/opencode-integration-guide.md](docs/opencode-integration-guide.md) - Integration patterns

---

## Maintaining This Documentation

**CRITICAL**: Keep CLAUDE.md in sync with the codebase. Outdated docs lead to incorrect AI assistance.

**IMPORTANT**: After ANY edit to CLAUDE.md, immediately run:
```bash
node scripts/sync-agent-docs.js
```
This syncs changes to GEMINI.md and AGENTS.md. Do not wait until commit time.

### When to Update CLAUDE.md

| Change Type | Sections to Update |
|-------------|-------------------|
| **New module added** | Directory Structure, Key Modules table |
| **Module renamed/removed** | Directory Structure, Key Modules table |
| **New public API function** | Key Modules table, add JSDoc example if complex |
| **New CLI command** | Essential Commands section |
| **New environment variable** | Configuration section |
| **New test file** | Testing Strategy (Test Files table) |
| **New npm script** | Essential Commands section |
| **Architecture change** | Architecture diagram, Data Flow |
| **New dependency** | Dependencies table in Configuration |
| **Bug fix pattern discovered** | Troubleshooting table |

### Update Checklist

After making significant changes, verify:

- [ ] **Directory Structure** matches actual `ls -la` output
- [ ] **Key Modules table** lists all files in `src/`
- [ ] **Essential Commands** match `package.json` scripts
- [ ] **Test count** matches `npm test` output (currently 297 tests, 12 suites)
- [ ] **Dependencies table** matches `package.json`
- [ ] Run `node scripts/sync-agent-docs.js` to sync GEMINI.md and AGENTS.md

### Quick Validation Commands

```bash
# Verify directory structure
ls -la src/ bin/ electron/ tests/ scripts/

# Count tests (update if changed)
npm test 2>&1 | grep "Tests:"

# Check file count
find src -name "*.js" | wc -l

# Verify module count matches docs
grep -c "| \`" CLAUDE.md  # Should match module count
```

### Versioning This File

When making major updates to CLAUDE.md:
1. Add a comment at the top with the date: `<!-- Last updated: 2026-01-25 -->`
2. If the spec version changes, update the "Related Documentation" link

---

## Response Constraints

- Do not remove existing code unless necessary
- Do not remove comments or commented-out code unless necessary
- Do not change code formatting unless important for new functionality
- Maintain structured logging patterns
- Follow TDD for all new features
