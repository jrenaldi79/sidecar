# CLAUDE.md
<!-- Last updated: 2026-03-05 -->

This file provides guidance to Claude Code when working with code in this repository.

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
sidecar setup                    # Configure default model and aliases
sidecar setup --add-alias name=model  # Add a custom alias
sidecar mcp                      # Start MCP server (stdio transport)
sidecar update                       # Update to latest version
```

### MCP Server (for Cowork / Claude Desktop)
```bash
# Auto-registered during npm install. Manual registration:
claude mcp add-json sidecar '{"command":"sidecar","args":["mcp"]}' --scope user
```

MCP tools: `sidecar_start`, `sidecar_status`, `sidecar_read`, `sidecar_list`, `sidecar_resume`, `sidecar_continue`, `sidecar_setup`, `sidecar_guide`

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
│                  sidecar CLI / MCP Server                    │
│      ┌──────────────┬────────┴────────────────────┐         │
│      │              │                             │         │
│      ▼              ▼                             ▼         │
│  Interactive    Headless Mode      MCP (sidecar mcp)        │
│  (Electron)    (OpenCode API)     (stdio transport)         │
│      │              │              Cowork / Desktop          │
│      └──────────────┴──────────────┘                        │
│                     │                                        │
│        Summary returned to Claude Code                       │
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
buildPrompts() creates system prompt + user message
  Interactive: context in system prompt (hidden from UI)
  Headless: context in user message (no UI)
       ↓
startOpenCodeServer() → createSession() → sendPromptAsync()
       ↓
[Interactive]                    [Headless]
Electron BrowserView opens       OpenCode async API (promptAsync)
User converses with model        Agent works autonomously
FOLD clicked →                   Polls for [SIDECAR_FOLD] marker
  Model generates summary            ↓
  (SUMMARY_TEMPLATE prompt)     extractSummary() captures output
       ↓                              ↓
Summary output to stdout → Claude Code receives in context
```

### Fold Mechanism

When the user clicks **Fold** (or presses `Cmd+Shift+F`) in interactive mode:

1. UI shows overlay with spinner ("Generating summary...")
2. `SUMMARY_TEMPLATE` is sent to the model via OpenCode HTTP API (`prompt_async`)
3. Electron polls `/session/:id/message` for the model's response
4. Model generates a structured summary with: Task, Findings, Attempted Approaches, Recommendations, Code Changes, Files Modified, Assumptions, Open Questions
5. Summary is written to stdout with `[SIDECAR_FOLD]` metadata header
6. Electron window closes, `start.js` captures stdout and finalizes session

In headless mode, the agent outputs `[SIDECAR_FOLD]` autonomously when done, and `headless.js` extracts everything before the marker.

### Electron BrowserView Architecture

The Electron shell (`electron/main.js`) uses a **BrowserView** to avoid CSS conflicts between the OpenCode SPA and the sidecar toolbar:

- **BrowserView** (top): Loads the OpenCode web UI at `http://localhost:<port>`. Gets its own physical viewport — no CSS interference with the host window.
- **Main window** (bottom 40px): Renders the sidecar toolbar (branding, task ID, timer, Fold button) via a `data:` URL.
- On resize, `updateContentBounds()` adjusts the BrowserView to fill `height - 40px`.

This replaced earlier CSS-based approaches (`padding-bottom`, `calc(100dvh - 40px)`) which failed because OpenCode's Tailwind `h-dvh` class resolves to the actual browser viewport and ignores parent element overrides.

---

## Directory Structure

```
sidecar/
├── bin/
│   └── sidecar.js               # CLI entry point
├── src/
│   ├── index.js                 # Main API re-exports (thin module ~82 lines)
│   ├── cli.js                   # Command-line argument parsing
│   ├── mcp-server.js            # MCP server (stdio transport, tool handlers)
│   ├── mcp-tools.js             # MCP tool definitions (Zod schemas)
│   ├── sidecar/                 # Core sidecar operations (modular)
│   │   ├── start.js             # startSidecar(), runInteractive(), generateTaskId()
│   │   ├── resume.js            # resumeSidecar(), checkFileDrift()
│   │   ├── continue.js          # continueSidecar(), loadPreviousSession()
│   │   ├── read.js              # readSidecar(), listSidecars(), formatAge()
│   │   ├── context-builder.js   # buildContext(), parseDuration()
│   │   ├── session-utils.js     # Shared utilities (SessionPaths, finalizeSession, etc.)
│   │   └── setup.js             # addAlias(), createDefaultConfig(), runInteractiveSetup()
│   ├── context.js               # Context extraction & filtering
│   ├── session-manager.js       # Session persistence & metadata
│   ├── prompt-builder.js        # System prompt construction
│   ├── headless.js              # Headless mode runner (OpenCode HTTP API)
│   ├── conflict.js              # File conflict detection
│   ├── drift.js                 # Context drift calculation
│   ├── session.js               # Session file resolution
│   ├── jsonl-parser.js          # JSONL parsing & formatting
│   ├── prompts/                 # Prompt modules
│   │   └── cowork-agent-prompt.js  # Cowork client agent prompt (replaces SE base)
│   └── utils/                   # Utility modules
│       ├── agent-mapping.js     # OpenCode agent mapping & validation
│       ├── config.js            # Config loading, alias resolution, hash detection
│       ├── validators.js        # CLI input validation helpers
│       ├── logger.js            # Structured logging
│       ├── path-setup.js        # PATH configuration for OpenCode
│       └── server-setup.js      # Server port management
├── electron/
│   ├── main.js                  # BrowserView shell (OpenCode UI + toolbar)
│   ├── main-legacy.js           # Old custom UI version (kept for reference)
│   ├── preload.js               # IPC bridge (fold action)
│   ├── preload-v2.js            # IPC bridge for legacy custom UI
│   ├── inject.css               # Legacy styling overrides
│   └── ui/                      # Legacy custom chat UI (unused in v3)
│       ├── index.html           # Main HTML
│       ├── renderer.js          # Chat logic + model picker integration
│       ├── model-picker.js      # Model selection module
│       └── styles.css           # UI styles
├── tests/                       # Jest test suite (927 tests, 36 suites)
│   ├── cli.test.js
│   ├── context.test.js
│   ├── session-manager.test.js
│   ├── conflict.test.js
│   ├── drift.test.js
│   ├── headless.test.js
│   ├── prompt-builder.test.js
│   ├── e2e.test.js
│   ├── mcp-tools.test.js
│   ├── mcp-server.test.js
│   ├── mcp-integration.test.js
│   ├── postinstall.test.js
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
│   ├── postinstall.js           # Auto-install skill + MCP registration
│   ├── integration-test.sh      # E2E integration tests
│   └── sync-agent-docs.js       # Sync CLAUDE.md → GEMINI.md, AGENTS.md
├── package.json
├── jest.config.js
├── .eslintrc.js
├── CLAUDE.md                    # This file (primary)
├── GEMINI.md                    # Symlink → CLAUDE.md
└── AGENTS.md                    # Symlink → CLAUDE.md
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
| `sidecar/setup.js` | Interactive setup wizard | `addAlias()`, `createDefaultConfig()`, `runInteractiveSetup()` |

### Supporting Modules (`src/`)

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `index.js` | Re-exports all public APIs | Thin module (~82 lines) |
| `mcp-server.js` | MCP server (Cowork/Desktop) | `startMcpServer()`, `handlers` (8 tool handlers) |
| `mcp-tools.js` | MCP tool definitions | `TOOLS` (Zod schemas), `getGuideText()` |
| `cli.js` | Argument parsing & validation | `parseArgs()`, `validateStartArgs()`, `validateSubagentArgs()` |
| `context.js` | Context filtering | `filterContext()`, `takeLastNTurns()`, `estimateTokens()` |
| `session-manager.js` | Session persistence | `createSession()`, `updateSession()`, `saveConversation()`, `saveSummary()` |
| `prompt-builder.js` | Prompt construction | `buildPrompts()` (system=instructions, user=context+briefing) |
| `headless.js` | Autonomous execution | Uses async API (`promptAsync`), polls `getMessages` for `[SIDECAR_FOLD]` |
| `conflict.js` | File conflict detection | Compares mtimes against session start, formats warnings |
| `drift.js` | Context staleness | `calculateDrift()`, `isDriftSignificant()`, `countTurnsSince()` |
| `session.js` | Session resolution | Primary (explicit ID) / Fallback (most recent mtime) |
| `utils/agent-mapping.js` | OpenCode agent mapping | `mapAgentToOpenCode()`, `isValidAgent()`, `OPENCODE_AGENTS` |
| `utils/config.js` | Config loading, alias resolution, hash detection | `loadConfig()`, `saveConfig()`, `resolveModel()`, `computeConfigHash()` |
| `utils/model-router.js` | Subagent model routing | `resolveModel()`, `getConfiguredCheapModel()`, `isRoutingEnabled()` |
| `utils/agent-model-config.js` | Model config persistence | `loadConfig()`, `saveConfig()`, `getModelForAgent()`, `setAgentModel()` |
| `utils/validators.js` | CLI input validation | `validateBriefingContent()`, `validateProjectPath()`, `validateApiKey()` |
| `utils/logger.js` | Structured logging | `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()` |
| `prompts/cowork-agent-prompt.js` | Cowork agent prompt | `buildCoworkAgentPrompt()` — replaces SE-focused OpenCode base prompt when `client === 'cowork'` |
| `utils/updater.js` | Update check & execute | `initUpdateCheck()`, `getUpdateInfo()`, `notifyUpdate()`, `performUpdate()` |

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

## Structured Logging

Use `src/utils/logger.js` (levels: error/warn/info/debug). Logs go to stderr to avoid polluting stdout (used for sidecar summary output). See global CLAUDE.md for general logging guidelines.

---

## Testing Strategy

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
| `updater.test.js` | Update checker | Mock states, performUpdate spawn, CLI integration |

### What NOT to Unit Test (UI Code)

**Do NOT write unit tests for:**
- DOM manipulation in `renderer.js`
- UI picker components (`model-picker.js`, `mode-picker.js`, `thinking-picker.js`)
- Electron window configuration (`main.js`)
- CSS class assignments and styling

**Why:** DOM mock tests are ineffective - they test mock behavior, not real rendering. These tests create false confidence and are expensive to maintain.

### UI Testing Approach (Autonomous Verification Required)

**MANDATORY: Any UI feature change MUST be visually verified before considering it complete.** Do not rely solely on unit tests for UI work — launch the Electron app, inspect via CDP, and take a screenshot.

For UI changes, follow this autonomous verification process:

1. **Launch the app** with appropriate mock env vars (e.g., `SIDECAR_MOCK_UPDATE=available`)
2. **Use `SIDECAR_DEBUG_PORT=9223`** to avoid port conflicts with Chrome
3. **Inspect via Chrome DevTools Protocol**: Connect to `http://127.0.0.1:9223/json`, find the target page, query DOM state via WebSocket
4. **Take a screenshot**: `screencapture -x /tmp/sidecar-<feature>.png` and visually verify
5. **Check both targets**: The Electron window has two pages — the OpenCode content (`http://localhost:...`) and the toolbar (`data:text/html`). Test each as needed.

**Key gotcha:** `contextBridge` does not work with `data:` URLs. The toolbar (`data:text/html`) cannot use `window.sidecar` IPC. Use `executeJavaScript()` polling from the main process instead.

See [docs/electron-testing.md](docs/electron-testing.md) for full CDP patterns, toolbar-specific testing, and known limitations.

### Update Banner Mock Testing

Use `SIDECAR_MOCK_UPDATE` to test update UI states without real npm operations:

```bash
SIDECAR_MOCK_UPDATE=available sidecar start --model gemini --prompt "test"  # Shows banner
SIDECAR_MOCK_UPDATE=success sidecar start --model gemini --prompt "test"    # Update succeeds
SIDECAR_MOCK_UPDATE=error sidecar start --model gemini --prompt "test"      # Update fails
```

### Test Commands

```bash
npm test                           # All tests
npm test tests/context.test.js     # Single file (faster during dev)
npm test -- --watch                # Watch mode
npm test -- --coverage             # Coverage report
```

---

## Electron UI Testing

See [docs/electron-testing.md](docs/electron-testing.md) for Chrome DevTools Protocol testing patterns, WebSocket recipes, CI integration, and visual screenshot testing.

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

See [docs/jsdoc-setup.md](docs/jsdoc-setup.md) for JSDoc patterns, `.d.ts` generation, and pre-publish workflow.

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
SIDECAR_MOCK_UPDATE=                    # Mock update state for UI testing: available, updating, success, error
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

**Common Model IDs** (as of 2026-03):
| Model | OpenRouter ID |
|-------|---------------|
| Gemini 3 Flash | `openrouter/google/gemini-3-flash-preview` |
| Gemini 3 Pro | `openrouter/google/gemini-3-pro-preview` |
| Gemini 3.1 Pro | `openrouter/google/gemini-3.1-pro-preview` |

**Note**: Model names change frequently. Always verify current names via the API or `opencode models openrouter`.

### Model Aliases

Sidecar supports model aliases configured via `sidecar setup`. Config is stored at `~/.config/sidecar/config.json`.

```bash
sidecar setup                              # Interactive wizard
sidecar start --prompt "Review auth"       # Uses config default model
sidecar start --model opus --prompt "..."  # Uses alias
sidecar start --model openrouter/google/gemini-3-flash-preview --prompt "..."  # Full string
```

Run `sidecar setup --add-alias name=model` to add custom aliases.

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
| **Client-aware prompt** | Cowork needs general-purpose, not SE-focused | `prompts/cowork-agent-prompt.js` sets `chat` agent `prompt` field |

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

**Headless mode defaults:** When `--no-ui` is set, the default agent is `build` (not `chat`).
The `chat` agent requires user interaction for write/bash permissions and stalls in headless mode.
`isHeadlessSafe(agent)` returns `true` (safe), `false` (chat), or `null` (custom/unknown).

### Key Integration Files

| File | OpenCode Integration |
|------|---------------------|
| `src/opencode-client.js` | SDK wrapper - `createSession()`, `sendPrompt()`, `getSessionStatus()` |
| `src/headless.js` | Uses `session.status()` for completion detection |
| `src/utils/agent-mapping.js` | Maps sidecar modes to OpenCode agents |
| `electron/main.js` | Creates child sessions for subagents |

---

## OpenCode SDK & HTTP API Reference

Full documentation in `/docs/`: [opencode-sdk.md](docs/opencode-sdk.md), [opencode-server.md](docs/opencode-server.md), [opencode-integration-guide.md](docs/opencode-integration-guide.md).

**Critical: Model Format** — Models MUST be objects, not strings:

```javascript
// ❌ WRONG - causes 400 Bad Request
{ model: "google/gemini-2.5-flash" }

// ✅ CORRECT
{ model: { providerID: "openrouter", modelID: "google/gemini-2.5-flash" } }
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
- [ ] **If UI changed**: Launch Electron with `SIDECAR_DEBUG_PORT=9223`, inspect via CDP, take screenshot to verify
- [ ] Update CLAUDE.md if architecture changed

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
| Headless stalls silently | `chat` agent in `--no-ui` mode | Use `--agent build` or remove `--no-ui` |
| Headless timeout | Task too complex | Increase `SIDECAR_TIMEOUT` |
| Context too large | Too many turns | Use `--turns` or `--tokens` filter |
| API key errors | Missing env var | Set `OPENROUTER_API_KEY` in .env |
| Summary not captured | Fold not clicked | Click FOLD button or wait for [SIDECAR_FOLD] |
| Question tool fails after answer | Using sync API | Ensure `sendToAPIStreaming()` is used, not `sendToAPI()`. See "Async-Only Architecture" section. |

---

## Code Review Checklist

- [ ] Tests written first (TDD) and passing
- [ ] No file >300 lines
- [ ] No function >50 lines
- [ ] Structured logging (not console.log)
- [ ] JSDoc comments on public APIs
- [ ] Documentation updated if architecture changed

---

## Agent Documentation

GEMINI.md and AGENTS.md are symlinks to CLAUDE.md -- no sync needed.

---

## Related Documentation

- [claude-sidecar-spec-v2.6.md](claude-sidecar-spec-v2.6.md) - Complete specification (2200+ lines)
- [README.md](README.md) - User-facing documentation
- [skill/SKILL.md](skill/SKILL.md) - Claude Code skill integration
- [docs/opencode-sdk.md](docs/opencode-sdk.md) - OpenCode SDK reference
- [docs/opencode-server.md](docs/opencode-server.md) - OpenCode HTTP API reference
- [docs/opencode-integration-guide.md](docs/opencode-integration-guide.md) - Integration patterns
- [docs/electron-testing.md](docs/electron-testing.md) - Electron UI testing (Chrome DevTools Protocol)
- [docs/jsdoc-setup.md](docs/jsdoc-setup.md) - JSDoc patterns and type declarations

---

## Maintaining This Documentation

**CRITICAL**: Keep CLAUDE.md in sync with the codebase. Outdated docs lead to incorrect AI assistance.

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
- [ ] **Test count** matches `npm test` output (currently 927 tests, 36 suites)
- [ ] **Dependencies table** matches `package.json`

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

