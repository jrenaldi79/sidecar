# CLAUDE.md
<!-- Last updated: 2026-03-10 -->

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
npm run lint                 # Run ESLint
```

### Testing
```bash
npm test                           # Unit tests (excludes *.integration.test.js)
npm run test:integration           # Integration tests only (real LLM, costs tokens)
npm run test:all                   # Unit + integration (used by pre-push)
npm test tests/context.test.js     # Single file (preferred during dev)
npm test -- --coverage             # Coverage report
```

### Enforcement
```bash
node scripts/check-secrets.js        # Scan staged files for secrets
node scripts/check-file-sizes.js     # Check staged files against 300-line limit
node scripts/generate-docs.js        # Regenerate auto sections in CLAUDE.md
node scripts/generate-docs.js --check # Verify auto sections are current (CI mode)
node scripts/validate-docs.js        # Pre-commit: warn if CLAUDE.md may need update
node scripts/validate-docs.js --full # Full: compare CLAUDE.md against codebase
npm run validate-docs                # Alias for --full mode
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

For detailed data flow, fold mechanism, and Electron BrowserView architecture, see [docs/architecture.md](docs/architecture.md).

---

## Directory Structure

<!-- AUTO:tree -->
bin/
└── sidecar.js  # Sidecar CLI Entry Point
src/
├── prompts/
│   └── cowork-agent-prompt.js  # Cowork Agent Prompt
├── sidecar/
│   ├── context-builder.js  # Context Builder Module
│   ├── continue.js  # Load previous session data (metadata, summary, conversation)
│   ├── crash-handler.js  # Crash Handler - Updates metadata to 'error' on uncaught exceptions
│   ├── interactive.js  # Check if Electron is available (lazy loading guard)
│   ├── progress.js  # Lifecycle stage labels
│   ├── read.js  # Sidecar Read Operations Module
│   ├── resume.js  # Load session metadata from session directory
│   ├── session-utils.js  # Standard heartbeat interval in milliseconds
│   ├── setup-window.js  # Setup Window Launcher
│   ├── setup.js  # Sidecar Setup Wizard
│   └── start.js  # Generate a unique 8-character hex task ID
├── utils/
│   ├── agent-mapping.js  # * All OpenCode native agent names (lowercase)
│   ├── alias-resolver.js  # Alias Resolver Utilities
│   ├── api-key-store.js  # Maps provider IDs to environment variable names
│   ├── api-key-validation.js  # Validation endpoints per provider
│   ├── auth-json.js  # Known provider IDs that map to sidecar's PROVIDER_ENV_MAP
│   ├── config.js  # Default model alias map — short names to full OpenRouter model identifiers
│   ├── env-loader.js  # Credential Loader
│   ├── idle-watchdog.js  # @type {Object.<string, number>} Default timeouts per mode in milliseconds
│   ├── input-validators.js  # MCP input validation with structured error responses.
│   ├── logger.js  # Structured Logger Module
│   ├── mcp-discovery.js  # MCP Discovery - Discovers MCP servers from parent LLM configuration
│   ├── mcp-validators.js  # MCP Validators
│   ├── model-fetcher.js  # Hardcoded Anthropic models (no public listing endpoint)
│   ├── model-validator.js  # Alias-to-search-term mapping for filtering provider model lists
│   ├── path-setup.js  # Ensures that the project's node_modules/.bin directory is included in the PATH.
│   ├── server-setup.js  # Server Setup Utilities
│   ├── session-lock.js  # Atomic session lock files to prevent concurrent resume/continue.
│   ├── shared-server.js  # Manages a single shared OpenCode server for MCP sessions.
│   ├── start-helpers.js  # Start Command Helpers
│   ├── thinking-validators.js  # Thinking Level Validators
│   ├── updater.js  # @type {import('update-notifier').UpdateNotifier|null}
│   └── validators.js  # * Provider to API key mapping
├── cli-handlers.js  # CLI Command Handlers
├── cli.js  # * Default values per spec §4.1
├── conflict.js  # File Conflict Detection Module
├── context-compression.js  # Context Compression Module
├── context.js  # Context Filtering Module
├── drift.js  # Context Drift Detection Module
├── environment.js  # Environment Detection Module
├── headless.js  # * Default timeout: 15 minutes per spec §6.2
├── index.js  # Claude Sidecar - Main Module
├── jsonl-parser.js  # JSONL Parser
├── mcp-server.js  # @module mcp-server — Sidecar MCP Server (stdio transport)
├── mcp-tools.js  # Zod pattern for safe task IDs (alphanumeric, hyphens, underscores only)
├── opencode-client.js  # OpenCode SDK Client Wrapper
├── prompt-builder.js  # System Prompt Builder
├── session-manager.js  # * Session status constants
└── session.js  # Session Resolver
electron/
├── assets/
│   ├── icon.png
│   └── icon.svg
├── fold.js  # Fold Logic
├── ipc-setup.js  # IPC Setup Handlers
├── main.js  # Sidecar Electron Shell - v3
├── preload-setup.js  # Sidecar Preload - Setup Mode
├── preload.js  # Sidecar Preload - v3 Minimal
├── setup-ui-alias-script.js  # Setup UI - Alias Editor Script
├── setup-ui-aliases.js  # Grouping metadata for the 20 default aliases
├── setup-ui-keys-script.js  # Setup UI - Step 1 Key Management Script
├── setup-ui-keys.js  # Provider metadata for the setup form
├── setup-ui-model.js  # @type {Array<{alias: string, label: string, routes: Object<string,string>}>}
├── setup-ui-styles.js  # Setup UI - Shared CSS Styles
├── setup-ui.js  # Setup UI - Wizard Orchestrator: API Keys → Models → Aliases → Review
├── summary.js  # Summary Generation via OpenCode API
├── toolbar.js  # Sidecar Toolbar HTML Builder
└── window-position.js  # Window Position Calculator
scripts/
├── benchmark-api-direct.js  # Direct OpenRouter API Benchmark for Thinking Levels
├── benchmark-thinking.js  # * Run a single test with specified model and thinking level
├── check-file-sizes.js  # File size enforcement script for pre-commit hook.
├── check-html.js
├── check-secrets.js  # Secret detection script for pre-commit hook.
├── check-ui.js
├── debug-cdp.js
├── eval-with-monitoring.sh
├── generate-docs-helpers.js  # Helper functions for generate-docs.js.
├── generate-docs.js  # @param {string} dirPath @returns {string[]} Sorted .md filenames
├── generate-icon.js  # Generate app icon PNG from SVG source.
├── integration-test.sh
├── list-models.js
├── postinstall.js  # Install skill file to ~/.claude/skills/sidecar/
├── test-tools.sh
├── validate-docs.js  # * Main entry point.
├── validate-thinking.js
└── validate-ui.js
evals/
├── tests/
│   ├── claude_runner.test.js
│   ├── evaluator.test.js
│   ├── result_writer.test.js
│   └── transcript_parser.test.js
├── claude_runner.js  # Recursively copy a directory
├── eval_tasks.json
├── evaluator.js  # Recursively find all files relative to baseDir
├── README.md
├── result_writer.js  # Format token count as human-readable string (e.g., "15.7k tok").
├── run_eval.js  # Load eval tasks
└── transcript_parser.js  # Extract text from tool result content (string, array, or object)
<!-- /AUTO:tree -->

---

## Key Modules

<!-- AUTO:modules -->
| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `cli-handlers.js` | CLI Command Handlers | `handleSetup()`, `handleAbort()`, `handleUpdate()`, `handleMcp()` |
| `cli.js` | * Default values per spec §4.1 | `parseArgs()`, `validateStartArgs()`, `getUsage()`, `DEFAULTS()` |
| `conflict.js` | File Conflict Detection Module | `detectConflicts()`, `formatConflictWarning()` |
| `context-compression.js` | Context Compression Module | `compressContext()`, `estimateTokenCount()`, `buildPreamble()`, `DEFAULT_TOKEN_LIMIT()` |
| `context.js` | Context Filtering Module | `filterContext()`, `parseDuration()`, `estimateTokens()`, `takeLastNTurns()` |
| `drift.js` | Context Drift Detection Module | `calculateDrift()`, `formatDriftWarning()`, `countTurnsSince()`, `isDriftSignificant()` |
| `environment.js` | Environment Detection Module | `inferClient()`, `getSessionRoot()`, `detectEnvironment()`, `VALID_CLIENTS()` |
| `headless.js` | * Default timeout: 15 minutes per spec §6.2 | `runHeadless()`, `waitForServer()`, `extractSummary()`, `formatFoldOutput()`, `DEFAULT_TIMEOUT()` |
| `index.js` | Claude Sidecar - Main Module | `APIs()`, `startSidecar()`, `listSidecars()`, `resumeSidecar()`, `continueSidecar()` |
| `jsonl-parser.js` | JSONL Parser | `parseJSONLLine()`, `readJSONL()`, `extractTimestamp()`, `formatMessage()`, `formatContext()` |
| `mcp-server.js` | @module mcp-server — Sidecar MCP Server (stdio transport) | `handlers()`, `startMcpServer()`, `getProjectDir()` |
| `mcp-tools.js` | Zod pattern for safe task IDs (alphanumeric, hyphens, underscores only) | `getTools()`, `getGuideText()`, `safeTaskId()`, `safeModel()` |
| `opencode-client.js` | OpenCode SDK Client Wrapper | `parseModelString()`, `createClient()`, `createSession()`, `createChildSession()`, `sendPrompt()` |
| `prompt-builder.js` | System Prompt Builder | `buildSystemPrompt()`, `buildPrompts()`, `buildEnvironmentSection()`, `getSummaryTemplate()`, `SUMMARY_TEMPLATE()` |
| `session-manager.js` | * Session status constants | `createSession()`, `updateSession()`, `getSession()`, `saveConversation()`, `saveSummary()` |
| `session.js` | Session Resolver | `encodeProjectPath()`, `decodeProjectPath()`, `getSessionDirectory()`, `getSessionId()`, `resolveSession()` |
| `prompts/cowork-agent-prompt.js` | Cowork Agent Prompt | `buildCoworkAgentPrompt()` |
| `sidecar/context-builder.js` | Context Builder Module | `buildContext()`, `parseDuration()`, `resolveSessionFile()`, `applyContextFilters()`, `findCoworkSession()` |
| `sidecar/continue.js` | Load previous session data (metadata, summary, conversation) | `loadPreviousSession()`, `buildContinuationContext()`, `createContinueSessionMetadata()`, `continueSidecar()` |
| `sidecar/crash-handler.js` | Crash Handler - Updates metadata to 'error' on uncaught exceptions | `installCrashHandler()` |
| `sidecar/interactive.js` | Check if Electron is available (lazy loading guard) | `getElectronPath()`, `checkElectronAvailable()`, `buildElectronEnv()`, `handleElectronProcess()`, `runInteractive()` |
| `sidecar/progress.js` | Lifecycle stage labels | `readProgress()`, `writeProgress()`, `extractLatest()`, `computeLastActivity()`, `STAGE_LABELS()` |
| `sidecar/read.js` | Sidecar Read Operations Module | `formatAge()`, `listSidecars()`, `readSidecar()` |
| `sidecar/resume.js` | Load session metadata from session directory | `loadSessionMetadata()`, `loadInitialContext()`, `checkFileDrift()`, `buildDriftWarning()`, `buildResumeUserMessage()` |
| `sidecar/session-utils.js` | Standard heartbeat interval in milliseconds | `HEARTBEAT_INTERVAL()`, `SessionPaths()`, `saveInitialContext()`, `finalizeSession()`, `outputSummary()` |
| `sidecar/setup-window.js` | Setup Window Launcher | `launchSetupWindow()` |
| `sidecar/setup.js` | Sidecar Setup Wizard | `addAlias()`, `createDefaultConfig()`, `detectApiKeys()`, `runInteractiveSetup()`, `runReadlineSetup()` |
| `sidecar/start.js` | Generate a unique 8-character hex task ID | `generateTaskId()`, `createSessionMetadata()`, `buildMcpConfig()`, `checkElectronAvailable()`, `runInteractive()` |
| `utils/agent-mapping.js` | * All OpenCode native agent names (lowercase) | `PRIMARY_AGENTS()`, `OPENCODE_AGENTS()`, `HEADLESS_SAFE_AGENTS()`, `mapAgentToOpenCode()`, `isValidAgent()` |
| `utils/alias-resolver.js` | Alias Resolver Utilities | `applyDirectApiFallback()`, `autoRepairAlias()` |
| `utils/api-key-store.js` | Maps provider IDs to environment variable names | `getEnvPath()`, `loadEnvEntries()`, `readApiKeys()`, `readApiKeyHints()`, `readApiKeyValues()` |
| `utils/api-key-validation.js` | Validation endpoints per provider | `validateApiKey()`, `validateOpenRouterKey()`, `VALIDATION_ENDPOINTS()` |
| `utils/auth-json.js` | Known provider IDs that map to sidecar's PROVIDER_ENV_MAP | `readAuthJsonKeys()`, `importFromAuthJson()`, `checkAuthJson()`, `removeFromAuthJson()`, `AUTH_JSON_PATH()` |
| `utils/config.js` | Default model alias map — short names to full OpenRouter model identifiers | `getConfigDir()`, `getConfigPath()`, `loadConfig()`, `saveConfig()`, `getDefaultAliases()` |
| `utils/env-loader.js` | Credential Loader | `loadCredentials()` |
| `utils/idle-watchdog.js` | @type {Object.<string, number>} Default timeouts per mode in milliseconds | `IdleWatchdog()`, `resolveTimeout()` |
| `utils/input-validators.js` | MCP input validation with structured error responses. | `validateStartInputs()`, `findSimilar()` |
| `utils/logger.js` | Structured Logger Module | `logger()`, `LOG_LEVELS()` |
| `utils/mcp-discovery.js` | MCP Discovery - Discovers MCP servers from parent LLM configuration | `discoverParentMcps()`, `discoverClaudeCodeMcps()`, `discoverCoworkMcps()`, `normalizeMcpJson()` |
| `utils/mcp-validators.js` | MCP Validators | `validateMcpSpec()`, `validateMcpConfigFile()` |
| `utils/model-fetcher.js` | Hardcoded Anthropic models (no public listing endpoint) | `fetchModelsFromProvider()`, `fetchAllModels()`, `groupModelsByFamily()`, `ANTHROPIC_MODELS()`, `PROVIDER_FAMILY_NAMES()` |
| `utils/model-validator.js` | Alias-to-search-term mapping for filtering provider model lists | `validateDirectModel()`, `filterRelevantModels()`, `normalizeModelId()` |
| `utils/path-setup.js` | Ensures that the project's node_modules/.bin directory is included in the PATH. | `ensureNodeModulesBinInPath()` |
| `utils/server-setup.js` | Server Setup Utilities | `DEFAULT_PORT()`, `isPortInUse()`, `getPortPid()`, `killPortProcess()`, `ensurePortAvailable()` |
| `utils/session-lock.js` | Atomic session lock files to prevent concurrent resume/continue. | `acquireLock()`, `releaseLock()`, `isLockStale()`, `isPidAlive()` |
| `utils/shared-server.js` | Manages a single shared OpenCode server for MCP sessions. | `SharedServerManager()` |
| `utils/start-helpers.js` | Start Command Helpers | `resolveModelFromArgs()`, `validateFallbackModel()` |
| `utils/thinking-validators.js` | Thinking Level Validators | `MODEL_THINKING_SUPPORT()`, `getSupportedThinkingLevels()`, `validateThinkingLevel()` |
| `utils/updater.js` | @type {import('update-notifier').UpdateNotifier|null} | `initUpdateCheck()`, `getUpdateInfo()`, `notifyUpdate()`, `performUpdate()` |
| `utils/validators.js` | * Provider to API key mapping | `VALID_AGENT_MODES()`, `PROVIDER_KEY_MAP()`, `MODEL_THINKING_SUPPORT()`, `TASK_ID_PATTERN()`, `validateTaskId()` |
<!-- /AUTO:modules -->

---

## Code Quality Rules

File size limits (300 lines/file, 50 lines/function) and complexity red flags are defined in the global CLAUDE.md.

### Documentation Sync (HARD RULE)

Any commit that adds, removes, or renames a file in `src/`, `bin/`, or `scripts/` MUST include a CLAUDE.md update in the same commit. The pre-commit hook will warn if CLAUDE.md is not staged alongside tracked file changes.

---

## Git Hooks

Managed by [husky](https://typicode.github.io/husky/).

**pre-commit (<2s):** lint-staged -> check-secrets (block) -> check-file-sizes (block) -> generate-docs (auto-stage) -> validate-docs (warn)

**pre-push:** `npm run test:all` (skipped if SHA-cached via `.test-passed`) -> `npm audit` (warn-only)

**SHA caching:** `posttest` writes HEAD SHA to `.test-passed`. Pre-push skips tests if SHA matches. Invalidated by any new commit. File is gitignored.

---

## Structured Logging

Use `src/utils/logger.js` (levels: error/warn/info/debug). Logs go to stderr to avoid polluting stdout (used for sidecar summary output). See global CLAUDE.md for general logging guidelines.

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

## Code Review Checklist

- [ ] Tests written first (TDD) and passing
- [ ] No file >300 lines
- [ ] No function >50 lines
- [ ] Structured logging (not console.log)
- [ ] JSDoc comments on public APIs
- [ ] Documentation updated if architecture changed

---

## Auto-Generated Sections

Sections between `<!-- AUTO:name -->` markers are maintained by `scripts/generate-docs.js`.
Do NOT edit these by hand. To update: `node scripts/generate-docs.js`.
The pre-commit hook runs this automatically. See [docs/doc-system.md](docs/doc-system.md) for details.

---

## Critical Gotchas

- **Model format**: Must be `{ providerID, modelID }` object, not string. String causes 400.
- **ESM**: SDK is ESM-only. Use dynamic `import()`, not `require()`.
- **Headless agent**: Default agent in `--no-ui` mode is `build` (not `chat`). `chat` stalls.
- **Jest + ESM**: Can't mock dynamic imports without `--experimental-vm-modules`. Use child process.
- **contextBridge**: Does not work with `data:` URLs. Toolbar uses `executeJavaScript()` polling.

---

## Process Lifecycle Management

Sidecar processes self-terminate after inactivity via IdleWatchdog. MCP sessions use a shared multiplexed server instead of per-session processes.

### Environment Variables

| Env Var | Default | Description |
|---------|---------|-------------|
| `SIDECAR_IDLE_TIMEOUT` | (mode-dependent) | Blanket override for idle timeout in minutes (all modes). 0 = disabled (Infinity). |
| `SIDECAR_IDLE_TIMEOUT_HEADLESS` | 15 | Headless mode idle timeout in minutes |
| `SIDECAR_IDLE_TIMEOUT_INTERACTIVE` | 60 | Interactive mode idle timeout in minutes |
| `SIDECAR_IDLE_TIMEOUT_SERVER` | 30 | Shared server "no sessions" timeout in minutes |
| `SIDECAR_MAX_SESSIONS` | 20 | Max concurrent sessions on shared server |
| `SIDECAR_REQUEST_TIMEOUT` | 5 | Stuck-stream timeout in minutes |
| `SIDECAR_SHARED_SERVER` | 1 | Set to 0 to disable shared server (fall back to per-process) |

### Gotchas

- `SIDECAR_IDLE_TIMEOUT=0` means `Infinity` (timer never set), not zero-ms timeout
- Session lock files live at `<session_dir>/session.lock`. Delete manually if stuck with "session already active" error
- `SIDECAR_SHARED_SERVER=0` disables shared server and falls back to per-process spawning

---

## Agent Documentation

GEMINI.md and AGENTS.md are symlinks to CLAUDE.md -- no sync needed.

---

## Docs Map

- [docs/usage.md](docs/usage.md) - CLI, MCP tools, agent types, evals
- [docs/architecture.md](docs/architecture.md) - Data flow, fold mechanism, Electron BrowserView
- [docs/testing.md](docs/testing.md) - Testing strategy, tiers, CDP, UI testing
- [docs/doc-system.md](docs/doc-system.md) - Auto-generation markers, cross-links
- [docs/opencode-integration.md](docs/opencode-integration.md) - OpenCode SDK, agent mapping
- [docs/configuration.md](docs/configuration.md) - Env vars, dependencies, model names
- [docs/publishing.md](docs/publishing.md) - npm publishing
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/electron-testing.md](docs/electron-testing.md) - CDP patterns
- [docs/jsdoc-setup.md](docs/jsdoc-setup.md) - JSDoc, `.d.ts` generation
- [evals/README.md](evals/README.md) - Agentic eval system
- [docs/plans/index.md](docs/plans/index.md) - Design plans
