# CLAUDE.md
<!-- Last updated: 2026-03-13 -->

This file provides guidance to Claude Code when working with code in this repository.
Global guidance in `../CLAUDE.md` applies here; this file only documents sidecar-specific details and repo indexing.

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
npm start
npm test
npm run lint
npm run dev:ui -- --model <alias> --prompt "<text>"  # Interactive harness (Vite + real LLM)
npm run qa:ui                                        # Static test harness (no API needed)
```

### CLI (Common)
```bash
node bin/sidecar.js start --model <model> --prompt "<task>"
node bin/sidecar.js list --all
node bin/sidecar.js read <task_id> --summary
```

### MCP (Manual Registration)
```bash
claude mcp add-json sidecar '{"command":"npx","args":["-y","claude-sidecar@latest","mcp"]}' --scope user
```

Full CLI usage, MCP tools, and eval commands live in `README.md`, `src/mcp-tools.js`, and `docs/testing.md`.

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
│   ├── cli.js                   # Command-line argument parsing
│   ├── cli-handlers.js          # CLI command handlers
│   ├── context.js               # Context extraction & filtering
│   ├── context-compression.js   # Context compaction helpers
│   ├── conflict.js              # File conflict detection
│   ├── drift.js                 # Context drift calculation
│   ├── environment.js           # Environment setup helpers
│   ├── headless.js              # Headless mode runner
│   ├── index.js                 # Main API re-exports
│   ├── jsonl-parser.js          # JSONL parsing & formatting
│   ├── mcp-server.js            # MCP server (stdio transport, tool handlers)
│   ├── mcp-tools.js             # MCP tool definitions (Zod schemas)
│   ├── opencode-client.js       # OpenCode SDK wrapper
│   ├── prompt-builder.js        # System prompt construction
│   ├── session-manager.js       # Session persistence & metadata
│   ├── session.js               # Session file resolution
│   ├── sidecar/                 # Core sidecar operations (modular)
│   │   ├── start.js             # startSidecar(), runInteractive(), generateTaskId()
│   │   ├── resume.js            # resumeSidecar(), checkFileDrift()
│   │   ├── continue.js          # continueSidecar(), loadPreviousSession()
│   │   ├── read.js              # readSidecar(), listSidecars(), formatAge()
│   │   ├── context-builder.js   # buildContext(), parseDuration()
│   │   ├── session-utils.js     # Shared utilities (SessionPaths, finalizeSession, etc.)
│   │   ├── interactive.js       # Interactive mode (Electron GUI session)
│   │   ├── progress.js          # Session progress reader
│   │   ├── crash-handler.js     # Crash recovery handler
│   │   └── setup.js             # Setup wizard
│   ├── mcp-app/                 # MCP App (Claude Desktop inline UI, Vite-bundled)
│   │   ├── mcp-app.html         # Entry HTML (links to styles.css, Vite input)
│   │   ├── mcp-app.js           # App lifecycle, polling, send/fold (ESM)
│   │   ├── question-handler.js  # Question interaction: option clicks, submit, skip (ESM)
│   │   ├── styles.css           # Shared CSS (extracted from mcp-app.html)
│   │   ├── renderers.js         # Message rendering, DOMParser integration (ESM)
│   │   ├── auto-scroll.js       # Auto-scroll with user override (CJS)
│   │   ├── chat-resource.js     # HTML for ui://sidecar/chat
│   │   ├── icons.js             # Tool and file extension icon registry (CJS)
│   │   ├── logos.js             # Model logo SVG registry
│   │   ├── tool-output.js       # Tool output dispatcher, TOOL_HANDLERS map (CJS)
│   │   ├── utils.js             # escapeHtml + shared SVG constants (CJS)
│   │   ├── test-harness.html    # Static test harness HTML (Vite-served)
│   │   ├── test-harness.js      # Mock data for all tool types (ESM)
│   │   ├── highlight.js         # Syntax highlighting (CJS)
│   │   ├── markdown.js          # Markdown renderer, marked + highlightCode (CJS)
│   │   ├── interactive-harness.html  # Interactive test harness HTML (dev-only)
│   │   ├── interactive-harness.js    # Harness client, direct fetch to OpenCode API (ESM)
│   │   ├── dev-server.mjs       # Dev server: OpenCode + Vite orchestrator (ESM)
│   │   └── tools/               # Per-tool HTML formatters (CJS)
│   │       ├── generic.js       # Fallback (formatGenericOutput)
│   │       ├── bash.js          # Bash (formatBashOutput)
│   │       ├── edit.js          # Edit diff (formatEditDiff)
│   │       ├── read.js          # File content (formatFileOutput)
│   │       ├── write.js         # Write (formatWriteOutput)
│   │       ├── grep.js          # Grep results (formatGrepOutput)
│   │       ├── glob.js          # Glob results (formatGlobOutput)
│   │       ├── question.js      # Question: interactive options + free-form (formatQuestionOutput)
│   │       ├── list.js          # LS/List (formatListOutput)
│   │       ├── todo.js          # Todo (formatTodoOutput)
│   │       ├── webfetch.js      # WebFetch (formatWebfetchOutput)
│   │       └── task.js          # Task (formatTaskOutput)
│   ├── prompts/                 # Prompt modules
│   │   └── cowork-agent-prompt.js
│   └── utils/                   # Helpers (see src/utils/ for full list)
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
├── tests/                       # Jest tests (see docs/testing.md for inventory)
│   ├── helpers/
│   ├── mcp-app/
│   ├── scripts/
│   ├── sidecar/
│   ├── fixtures/                # Generated test data (gitignored)
│   └── screenshots/             # CDP screenshots (gitignored)
├── skill/
│   └── SKILL.md                 # Claude Code skill integration
├── evals/                       # Agentic eval system (see evals/README.md)
│   ├── run_eval.js              # CLI orchestrator
│   ├── claude_runner.js         # Sandbox creation, Claude process spawning
│   ├── transcript_parser.js     # Parse stream-json output
│   ├── evaluator.js             # Programmatic checks + LLM-as-judge
│   ├── result_writer.js         # Write results, format summary
│   ├── eval_tasks.json          # Eval task definitions (3 scenarios)
│   ├── fixtures/                # Seed projects per eval scenario
│   ├── tests/                   # Eval unit tests (25 tests, 4 suites)
│   └── workspace/               # Output (gitignored)
├── scripts/
│   ├── check-secrets.js         # Pre-commit secret detection
│   ├── check-file-sizes.js      # Pre-commit file size enforcement
│   ├── validate-docs.js         # CLAUDE.md drift detection
│   ├── postinstall.js           # Auto-install skill + MCP registration
│   ├── integration-test.sh      # E2E integration tests
│   └── test-tools.sh            # Tooling smoke tests
├── .husky/
│   ├── pre-commit               # lint-staged + secrets + file size + doc drift
│   └── pre-push                 # Full test suite (cached by SHA) + npm audit
├── docs/
│   ├── opencode.md              # OpenCode SDK + integration reference
│   ├── testing.md               # Comprehensive testing guide
│   ├── scaffolding/             # Portable enforcement kit (copy to new projects)
│   └── plans/                   # Design and implementation plans
├── package.json
├── jest.config.js
├── .eslintrc.js
├── CLAUDE.md                    # This file (primary)
├── GEMINI.md                    # Symlink → CLAUDE.md
└── AGENTS.md                    # Symlink → CLAUDE.md
```

---

## Key Modules

This is a short index of the most important entrypoints. See `src/`, `src/sidecar/`, and `src/utils/` for the full inventory.

| Area | File | Purpose |
|------|------|---------|
| CLI | `src/cli.js`, `src/cli-handlers.js` | Argument parsing and command dispatch |
| Context | `src/context.js`, `src/context-compression.js` | Context extraction and compaction |
| Sidecar core | `src/sidecar/start.js` | Session startup and task ID generation |
| Sidecar core | `src/sidecar/resume.js` | Resume + drift detection |
| Sidecar core | `src/sidecar/continue.js` | Continuation + context building |
| Sidecar core | `src/sidecar/read.js` | Listing and reading sessions |
| Sidecar core | `src/sidecar/session-utils.js` | Session paths, finalization, heartbeat |
| Headless | `src/headless.js` | Headless runner (OpenCode async API) |
| MCP | `src/mcp-server.js`, `src/mcp-tools.js` | MCP server and tool schemas |
| MCP App | `src/mcp-app/*` | UI resource for `ui://sidecar/chat` |
| OpenCode | `src/opencode-client.js`, `src/utils/opencode-api.js` | SDK wrapper and HTTP helpers |
| Sessions | `src/session-manager.js`, `src/session.js` | Session persistence and resolution |
| Prompts | `src/prompt-builder.js`, `src/prompts/cowork-agent-prompt.js` | System/user prompt construction |
| Safety | `src/conflict.js`, `src/drift.js` | File conflict + drift detection |
| Config | `src/utils/config.js` | Config loading and alias resolution |
| Logging | `src/utils/logger.js` | Structured logging |
| Models | `src/utils/model-fetcher.js`, `src/utils/model-validator.js` | Provider model lists and validation |
| Updates | `src/utils/updater.js` | Update check + execution |

---

## Code Quality Rules

Project-specific additions to the global rules in `../CLAUDE.md`.

### Documentation Sync (HARD RULE)

Any commit that adds, removes, or renames a file in `src/`, `bin/`, or `scripts/` MUST include a CLAUDE.md update in the same commit. This is not optional. The pre-commit hook will warn if CLAUDE.md is not staged alongside tracked file changes.

---

## Git Hooks

Managed by [husky](https://typicode.github.io/husky/). Hooks run automatically on commit and push.

### pre-commit (fast, <2s)

Runs on every `git commit`. Blocks the commit if any check fails.

| Step | Script | What It Does |
|------|--------|-------------|
| 1. lint-staged | `npx lint-staged` | ESLint `--fix` on staged `.js` files |
| 2. Secret scan | `node scripts/check-secrets.js` | Blocks commits containing API keys, tokens, or private keys |
| 3. File size check | `node scripts/check-file-sizes.js` | Blocks files over 300 lines |
| 4. Doc drift warning | `node scripts/validate-docs.js` | Warns (non-blocking) if `src/`/`bin/`/`scripts/` changed without staging CLAUDE.md |

### pre-push (thorough, ~3min)

Runs on every `git push`. Blocks the push if tests fail.

| Step | What It Does |
|------|-------------|
| 1. Test suite | `npm test` (all Jest tests) -- **skipped if cached** (see below) |
| 2. Audit | `npm audit` (warn-only, does not block push) |

### Test Caching (SHA-based)

To avoid re-running the full test suite on push when you just ran `npm test`, the hooks use SHA-based caching:

1. `npm test` succeeds -> `posttest` script writes `HEAD` SHA to `.test-passed`
2. `pre-push` hook compares current `HEAD` SHA against `.test-passed`
3. If they match, tests are skipped with "Tests already passed for \<sha\>"
4. If they differ (new commit since last test run), tests run normally

The cache is invalidated automatically by any new commit. `.test-passed` is gitignored.

---

## Structured Logging

Use `src/utils/logger.js` (levels: error/warn/info/debug). Logs go to stderr to avoid polluting stdout (used for sidecar summary output). See global CLAUDE.md for general logging guidelines.

---

## Testing

See `docs/testing.md` for the full test inventory, UI verification requirements, and tiered strategy. Use `npm test` for the default suite.

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
OPENROUTER_API_KEY=sk-or-...              # Multi-model API access

# Optional
OPENCODE_COMMAND=opencode                 # Override OpenCode command path
SIDECAR_DEFAULT_MODEL=openrouter/google/gemini-2.5-flash
SIDECAR_TIMEOUT=15                        # Headless timeout in minutes
LOG_LEVEL=error                           # debug | info | warn | error

# Model Routing
SIDECAR_DISABLE_MODEL_ROUTING=true        # Disable auto-routing for subagent tasks
SIDECAR_EXPLORE_MODEL=openrouter/...      # Override model for Explore subagents

# Advanced / Debug
SIDECAR_CONFIG_DIR=/path/to/config        # Override config directory (~/.config/sidecar)
SIDECAR_ENV_DIR=/path/to/env              # Override .env file directory
SIDECAR_DEBUG_PORT=9223                   # CDP debug port (default: 9222)
SIDECAR_MOCK_UPDATE=available             # Mock update UI state for testing
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^28.0.0 | Interactive sidecar window |
| `tiktoken` | ^1.0.0 | Token estimation |
| `jest` | ^29.0.0 | Testing framework |
| `eslint` | ^8.0.0 | Code linting |
| `husky` | ^9.1.7 | Git hook management |
| `lint-staged` | ^16.3.2 | Run linters on staged files |

### Bundled Dependencies

- `opencode-ai` (>=1.0.0) - LLM conversation engine (installed automatically, no separate install needed)

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

## OpenCode Integration

See `docs/opencode.md` for SDK requirements, model formatting, and integration principles.

---

## npm Publishing

**Package**: `claude-sidecar` on npm (public)
**Publishing method**: GitHub Actions with OIDC trusted publishing + provenance

### How to Publish a New Version

```bash
npm version patch   # or minor/major (bumps version + creates git tag)
git push origin main --tags
```

The `.github/workflows/publish.yml` workflow triggers on `v*` tags and publishes automatically.

### Publishing Setup

- **Trusted Publisher**: Configured on npm for `jrenaldi79/sidecar` + `publish.yml` (OIDC-based, no manual token management)
- **NPM_TOKEN**: Granular access token stored as GitHub secret (bypass 2FA enabled, scoped to `claude-sidecar`)
- **OIDC provenance**: `--provenance` flag adds Sigstore attestation (requires `id-token: write` permission)
- **Trusted publisher config**: https://www.npmjs.com/package/claude-sidecar/access (Settings tab)

---

## Development Workflow Checklists

Quick project-specific reminders:
- Before starting: review this file for architecture changes; run `node scripts/validate-docs.js --full` if you touch `src/`, `bin/`, or `scripts/`.
- During: keep functions small, use `src/utils/logger.js`, and update docs when architecture shifts.
- Before committing: run `npm test`, `npm run lint`, and complete UI verification for UI changes (see `docs/testing.md`).

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `command not found: opencode` | OpenCode binary not found | Reinstall: `npm install -g claude-sidecar` (opencode-ai is bundled) |
| `spawn opencode ENOENT` | CLI not in PATH | Verify `path-setup.js` runs before server start; check `node_modules/.bin/opencode` exists |
| API 400 Bad Request | Model format wrong | Use `{providerID, modelID}` object, not string. See `formatModelForAPI()` |
| Jest ESM mock fails | Dynamic import | Skip test with `it.skip()` or use `--experimental-vm-modules` |
| Session resolution fails | No recent session | Pass explicit `--session` flag |
| Electron window blank | Assets not built | Run from project root |
| Headless stalls silently | `chat` agent in `--no-ui` mode | Use `--agent build` or remove `--no-ui` |
| Headless timeout | Task too complex | Increase `SIDECAR_TIMEOUT` |
| Context too large | Too many turns | Use `--turns` or `--tokens` filter |
| API key errors | Missing env var | Set `OPENROUTER_API_KEY` in .env |
| Summary not captured | Fold not clicked | Click FOLD button or wait for [SIDECAR_FOLD] |
| Question tool fails after answer | Using sync API | Ensure `sendToAPIStreaming()` is used, not `sendToAPI()`. See `docs/opencode.md`. |

---

## Code Review Checklist

- [ ] Documentation updated if architecture/CLI/config changed
- [ ] UI verification completed for UI changes (see `docs/testing.md`)
- [ ] OpenCode integration docs updated if SDK/API behavior changed

---

## Agent Documentation

GEMINI.md and AGENTS.md are symlinks to CLAUDE.md -- no sync needed.

---

## Documentation Index

- [README.md](README.md) - User-facing documentation
- [docs/testing.md](docs/testing.md) - Comprehensive testing guide (all tiers, CDP, cross-platform)
- [docs/opencode.md](docs/opencode.md) - OpenCode SDK + integration reference
- [docs/interactive-harness.md](docs/interactive-harness.md) - Interactive harness dev tool for MCP App UI iteration
- [docs/electron-testing.md](docs/electron-testing.md) - Manual CDP WebSocket recipes and debugging
- [docs/jsdoc-setup.md](docs/jsdoc-setup.md) - JSDoc patterns and type declarations
- [evals/README.md](evals/README.md) - Agentic eval system (end-to-end LLM interaction testing)
- [docs/tool-coverage.md](docs/tool-coverage.md) - Tool coverage matrix and renderer build guide
- [skill/SKILL.md](skill/SKILL.md) - Claude Code skill integration
- [OpenCode docs](https://opencode.ai/docs/) - SDK and server API reference (upstream)
- [Husky docs](https://typicode.github.io/husky/) - Git hooks and config reference

---

## Maintaining This Documentation

Keep CLAUDE.md in sync with project-specific behavior and the repo index.

Update this file when:
- Files are added/removed/renamed in `src/`, `bin/`, or `scripts/` (Directory Structure, Key Modules).
- CLI commands or env vars change (Essential Commands, Configuration).
- Architecture changes (Architecture section).
- OpenCode integration changes (`docs/opencode.md`).
- Testing strategy or UI verification changes (`docs/testing.md`).

Run `node scripts/validate-docs.js --full` to catch doc drift, and update the top comment date when you make significant edits.
