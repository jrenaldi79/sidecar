# Sidecar v3: Lightweight Redesign

**Date:** 2026-03-01
**Status:** Design (pending implementation plan)
**Approach:** Surgical UI Replacement - keep core logic, replace Electron UI with OpenCode Web UI

## Summary

Replace the 14K-line custom Electron chat UI with a thin Electron shell that loads OpenCode's built-in Web UI. Keep all core business logic (6K lines, 481+ tests). Add multi-environment support (code-local, code-web, cowork), CLI arg rename to match v3 spec, context compression, and updated fold protocol.

**Net result:** ~14,000 lines removed, ~1,300 lines added. Codebase shrinks from ~20K to ~7K.

## Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| UI approach | Load OpenCode's Web UI in Electron | Eliminates 14K lines of custom UI maintenance |
| Environment scope | All three (local + web + cowork) | Full multi-environment from day one |
| Core logic | Keep all existing modules | Solid, tested, no reason to rewrite |
| Extra CLI commands | Keep all 4 (list, resume, continue, read) | Already built and tested |
| Safety features | Keep conflict + drift detection | Lightweight, prevent data loss |
| CLI arg names | Rename to match v3 spec | Clean break, pre-1.0 |
| Fold UX | Both Cmd+Shift+F shortcut + injected button | Power users + discoverability |
| API key config | Use OpenCode's built-in config | No custom setup screen needed |

## What Changes

### Files to DELETE (~14K lines)

| File | Lines | Reason |
|---|---|---|
| `electron/ui/renderer.js` | 8,474 | Replaced by OpenCode Web UI |
| `electron/ui/model-picker.js` | 438 | OpenCode handles model selection |
| `electron/ui/model-registry.js` | 546 | OpenCode handles model data |
| `electron/ui/agent-model-config.js` | 493 | OpenCode handles agent config |
| `electron/ui/thinking-picker.js` | 338 | OpenCode handles thinking UI |
| `electron/ui/mode-picker.js` | 330 | OpenCode handles mode selection |
| `electron/ui/context-panel.js` | 299 | OpenCode handles context display |
| `electron/ui/autocomplete.js` | 498 | OpenCode handles autocomplete |
| `electron/ui/file-autocomplete.js` | 160 | OpenCode handles file picking |
| `electron/ui/command-autocomplete.js` | 228 | OpenCode handles commands |
| `electron/ui/mcp-manager.js` | 226 | OpenCode handles MCP config |
| `electron/ui/index.html` | - | Replaced by OpenCode Web UI |
| `electron/ui/styles.css` | - | Replaced by OpenCode Web UI |
| `electron/preload.js` | 137 | Replaced by minimal preload |
| `electron/preload-v2.js` | 175 | Replaced by minimal preload |
| `electron/main-legacy.js` | 536 | Legacy, no longer needed |
| `electron/theme.js` | 81 | OpenCode handles theming |
| `src/subagent-manager.js` | 404 | Not in v3 scope, partially working |
| `src/utils/model-capabilities.js` | 367 | OpenCode handles model data |
| `src/utils/agent-model-config.js` | 206 | OpenCode handles agent config |

### Files to REWRITE

#### `electron/main.js` (~1,200 lines -> ~250 lines)

New responsibilities:
1. Start OpenCode server at `--cwd` with proper API keys
2. Open BrowserWindow pointing to `http://localhost:<port>`
3. Wait for OpenCode session creation, inject context
4. Navigate to session URL (`http://localhost:<port>/session/<id>`)
5. Inject fold button via `webContents.executeJavaScript()` - floating button in bottom-right corner
6. Register fold shortcut (Cmd+Shift+F, configurable via `--fold-shortcut`)
7. On fold: call OpenCode summarize API, write `[SIDECAR_FOLD]` to stdout, close window
8. On window close without fold: prompt user to fold first

No custom renderer. No pickers. No managers. OpenCode's Web UI handles all interactive features.

#### `electron/preload.js` (~312 lines -> ~50 lines)

Minimal IPC bridge for fold signal only.

#### `electron/inject.css` -> `electron/fold-button.css` (~30 lines)

Styling for the injected fold button overlay.

### Files to UPDATE (minor changes)

#### `src/cli.js` - Arg renames + new flags

| Old Name | New Name |
|---|---|
| `--briefing` | `--prompt` |
| `--project` | `--cwd` |
| `--headless` | `--no-ui` |
| `--session` | `--session-id` |

New flags:
- `--client <code-local|code-web|cowork>` - Client type for path resolution
- `--session-dir <path>` - Explicit session data directory
- `--setup` - Force open configuration
- `--fold-shortcut <key>` - Customize fold shortcut
- `--opencode-port <port>` - Port override

#### `src/headless.js` - Fold marker update

- `[SIDECAR_COMPLETE]` -> `[SIDECAR_FOLD]`
- Add `Client:` and `CWD:` fields to output

#### `src/sidecar/context-builder.js` - Multi-environment resolution

Update `buildContext()` to accept `--client` and `--session-dir` for path resolution.

#### `src/session.js` - Multi-environment paths

Add resolution logic for:
- `code-local`: `~/.claude/projects/<hash>/sessions/` (existing)
- `code-web`: `<session-dir>/...` (new, requires --session-dir)
- `cowork`: `~/Library/Application Support/Claude Cowork/` (new)

#### `src/sidecar/start.js` - Pass new args through

Accept and pass `--client`, `--cwd`, `--session-dir` to session creation.

### Files to CREATE

#### `src/environment.js` (~80 lines)

```
detectEnvironment() -> { client, hasDisplay, sessionRoot }

Resolution:
1. If --client provided, use it
2. Else if DISPLAY env var or macOS -> code-local
3. Else -> code-web (headless)

Session path by client:
- code-local: ~/.claude/projects/<hash>/sessions/
- code-web: --session-dir (required)
- cowork: ~/Library/Application Support/Claude Cowork/
```

#### `src/context-compression.js` (~120 lines)

```
compressContext(turns, options) -> compressedText

1. Estimate tokens via tiktoken
2. If < 30K tokens -> return as-is with preamble
3. If > 30K tokens -> 2-pass compression:
   a. Send to cheap model with "summarize this conversation"
   b. Return compressed summary with preamble

Preamble: "You are working in <cwd>. Here is the conversation:"
```

## What Stays Unchanged

All core business logic modules (~4,500 lines):

| Module | Lines | Purpose |
|---|---|---|
| `src/sidecar/start.js` | 233 | Session starting |
| `src/sidecar/resume.js` | 166 | Session resumption |
| `src/sidecar/continue.js` | 197 | Session continuation |
| `src/sidecar/read.js` | 145 | Session listing/reading |
| `src/sidecar/session-utils.js` | 172 | Shared utilities |
| `src/session-manager.js` | 387 | Session persistence |
| `src/prompt-builder.js` | 331 | System prompt construction |
| `src/context.js` | 199 | Context extraction & filtering |
| `src/conflict.js` | 144 | File conflict detection |
| `src/drift.js` | 144 | Context drift calculation |
| `src/opencode-client.js` | 387 | OpenCode SDK wrapper |
| `src/jsonl-parser.js` | 180 | JSONL parsing |
| `src/utils/logger.js` | 84 | Structured logging |
| `src/utils/validators.js` | 341 | Input validation |
| `src/utils/agent-mapping.js` | 147 | Agent type mapping |
| `src/utils/server-setup.js` | 93 | Port management |
| `src/utils/path-setup.js` | 17 | PATH configuration |
| `src/utils/model-router.js` | 138 | Model routing |
| `src/agent-types.js` | 112 | Agent validation |
| `src/index.js` | 82 | Module re-exports |
| `bin/sidecar.js` | 197 | CLI entry point |

All 5 CLI commands: `start`, `list`, `resume`, `continue`, `read`

## Fold Protocol

### Output Format

```
[SIDECAR_FOLD]
Model: gemini-2.5-pro
Session: <opencode-session-id>
Client: <code-local|code-web|cowork>
CWD: <working-directory>
Mode: <interactive|headless>
---
<summary content>
```

### Interactive Flow

1. User hits Cmd+Shift+F OR clicks injected fold button
2. Electron sends IPC fold signal
3. CLI calls OpenCode summarize API
4. CLI writes `[SIDECAR_FOLD]` block to stdout
5. Electron window closes
6. Claude reads via BashOutput

### Headless Flow

1. CLI sends context + prompt, waits for response
2. CLI writes `[SIDECAR_FOLD]` block to stdout
3. Claude receives as foreground bash output

## API Key Configuration

**Strategy**: Delegate to OpenCode's built-in configuration.

Sidecar checks for keys at startup:
1. Check OpenCode config (`~/.config/opencode/opencode.json`)
2. Check environment variables (`OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, etc.)
3. If no keys found: exit with clear error message and instructions

No custom setup screen. Users configure OpenCode directly.

## Multi-Environment Support

### code-local (Claude Code, local terminal)

- Session path: `~/.claude/projects/<project-hash>/sessions/`
- Display: Yes (Electron interactive mode)
- Config: File-based + env vars
- This is the existing, proven path

### code-web (Claude Code, web browser)

- Session path: Passed via `--session-dir` (required)
- Display: No (headless mode only)
- Config: Env vars only (no persistent filesystem)
- The Skill discovers the session directory in the sandbox and passes it

### cowork (Claude Cowork, desktop app)

- Session path: `~/Library/Application Support/Claude Cowork/` (macOS)
- Display: Yes (Electron interactive mode)
- Config: File-based + env vars
- JSON schema may differ from Code - normalization in parser

## Test Strategy

### Existing Tests to Update

- `tests/cli.test.js` - Update for renamed args and new flags
- `tests/headless.test.js` - Update fold marker
- `tests/e2e.test.js` - Update for new CLI interface
- `tests/sidecar/context-builder.test.js` - Add multi-environment cases
- `tests/session.test.js` - Add Cowork/web path resolution

### New Tests to Write

- `tests/environment.test.js` - Environment detection, client inference
- `tests/context-compression.test.js` - Token estimation, compression trigger, preamble
- `tests/api-key-config.test.js` - Key resolution order, missing key errors

### Tests to DELETE

- `tests/context-panel.test.js` - UI module removed
- `tests/headless-subagent.test.js` - Subagent manager removed
- `tests/subagent-manager.test.js` - Module removed

## Experiments (from v3 spec)

The following experiments should be run to validate unknowns:

| # | Experiment | Priority | Risk |
|---|---|---|---|
| 1a | Claude Code local session paths | Already validated | Low |
| 1b | Claude Code web sandbox paths | High | High - unknown sandbox layout |
| 1c | Claude Cowork session paths | Medium | Medium - untested |
| 2 | OpenCode working directory scoping | Already validated | Low |
| 3 | OpenCode API message injection | Already validated | Low |
| 6 | OpenCode Web UI in Electron | **Critical** | Medium - untested |
| 7 | Background bash (local + web) | Medium | Low - local works |
| 8 | Headless E2E in web sandbox | High | High - untested |

Experiments 1a, 2, 3, 4, 5 are already validated by existing implementation.
**Experiment 6 (OpenCode Web UI in Electron) is the critical new experiment.**

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| OpenCode Web UI doesn't work well in Electron | High | Experiment 6 validates this early |
| OpenCode Web UI missing features we need | Medium | Can inject JS/CSS; OpenCode is actively developed |
| Cowork JSON schema differs significantly | Medium | Build normalizer, test with real Cowork data |
| Web sandbox blocks outbound HTTPS | High | Experiment 8 validates; fallback to direct API calls |
| Fold button injection breaks on OpenCode UI updates | Low | Pin OpenCode version; button uses stable DOM anchoring |

## Reference Documents

- [v3 Spec (full)](../sidecar-spec-v3-lightweight.md) - Complete product spec with experiments
- [OpenCode SDK Reference](../opencode-sdk.md)
- [OpenCode Server Reference](../opencode-server.md)
- [OpenCode Integration Guide](../opencode-integration-guide.md)
