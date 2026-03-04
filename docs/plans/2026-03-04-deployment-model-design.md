# Deployment Model Design

**Date:** 2026-03-04
**Status:** Approved

## Problem Statement

Sidecar has three deployment artifacts (CLI, Skill, Electron app) bundled into a single npm package. This needs to work for:

1. **Claude Code users** — install via npm, use CLI commands
2. **Claude Cowork users** — Cowork runs in a sandboxed VM, can't install CLIs inside the sandbox
3. **Students** — simplicity is key, minimal setup steps

The Cowork sandbox limitation means we can't rely solely on CLI invocation. We need an alternative integration path that bypasses the sandbox.

## Decision

**Phase 1 (Now): MCP Server + npm distribution**
- Add an MCP server entry point (`sidecar mcp`) to the existing npm package
- Auto-register MCP in Claude Code and Claude Desktop/Cowork during postinstall
- Keep the CLI as-is for direct terminal usage

**Phase 2 (Later): Plugin packaging**
- Wrap the same codebase as a Claude Code plugin for one-step marketplace install
- No code changes needed — just manifest and config files

## Architecture

### Dual Interface (CLI + MCP)

```
Claude Code / Cowork / VS Code
    |
    |-- Skill (SKILL.md) --> CLI invocation (Claude Code)
    |
    +-- MCP (sidecar mcp) --> Tool invocation (Cowork / any)
         |
         |-- sidecar_start   --> spawns child process --> Electron GUI on host
         |-- sidecar_status  --> reads session metadata
         |-- sidecar_read    --> reads session summary
         |-- sidecar_list    --> lists sessions
         |-- sidecar_resume  --> reopens session
         |-- sidecar_continue --> new session from previous
         |-- sidecar_setup   --> opens setup wizard
         +-- sidecar_guide   --> returns usage documentation
```

### Why MCP Solves the Cowork Problem

Cowork is a feature inside Claude Desktop, not a separate product. It shares `claude_desktop_config.json` for MCP server configuration. MCP servers run on the host machine (outside the sandbox), so:

- `sidecar mcp` starts as a host process via stdio transport
- Electron GUI launches on the host desktop
- No CLI installation needed inside the sandbox
- Long-running tasks use the async pattern (start returns task ID, poll for results)

### Async Pattern (No Timeout Issues)

MCP tool calls have ~10 minute timeouts. Sidecar tasks can run 15+ minutes. Solution: the same async pattern Desktop Commander uses.

```
sidecar_start(model, prompt) --> returns { taskId: "abc123" } immediately
  |
  +-- Child process runs sidecar in background
  |
sidecar_status(taskId) --> returns { status: "running", elapsed: "3m" }
  |
sidecar_read(taskId) --> returns summary text (when complete)
```

The long-running work happens in a spawned child process, not in the MCP tool call itself.

## MCP Tools

| Tool | Parameters | Returns | Async |
|------|-----------|---------|-------|
| `sidecar_start` | `model`, `prompt`, `agent?`, `noUi?`, `thinking?` | `{ taskId, status: "running" }` | Yes |
| `sidecar_status` | `taskId` | `{ status, elapsed, model }` | No |
| `sidecar_read` | `taskId`, `mode?` (summary/conversation/metadata) | Summary text or conversation | No |
| `sidecar_list` | `status?`, `all?` | Array of sessions | No |
| `sidecar_resume` | `taskId` | `{ taskId, status: "running" }` | Yes |
| `sidecar_continue` | `taskId`, `prompt`, `model?` | `{ taskId, status: "running" }` | Yes |
| `sidecar_setup` | none | Opens Electron setup wizard | Yes |
| `sidecar_guide` | none | Returns usage documentation | No |

### Tool Descriptions as Guidance

MCP tool descriptions are rich enough to serve as built-in guidance for Claude. The `sidecar_guide` helper tool returns detailed usage instructions (when to spawn sidecars, briefing format, agent selection, async workflow pattern).

## Installation & Student Experience

### Install Command

```bash
npm install -g claude-sidecar
```

### What Postinstall Does

1. Copies `skill/SKILL.md` to `~/.claude/skills/sidecar/` (existing behavior)
2. Registers MCP server in Claude Code (`~/.claude.json`)
   - Preferred: `claude mcp add-json sidecar '...' --scope user`
   - Fallback: Direct JSON file edit
3. Registers MCP server in Claude Desktop/Cowork
   - Direct edit of `~/Library/Application Support/Claude/claude_desktop_config.json`

### MCP Config Registered

```json
{
  "mcpServers": {
    "sidecar": {
      "command": "sidecar",
      "args": ["mcp"]
    }
  }
}
```

### Student Setup Flow

```
npm install -g claude-sidecar
  |-- Skill installed to ~/.claude/skills/sidecar/
  |-- MCP registered in Claude Code
  +-- MCP registered in Claude Desktop/Cowork

sidecar setup
  +-- Interactive wizard configures API keys and model aliases
```

### Installation Matrix

| User Type | Install | Integration | GUI |
|-----------|---------|-------------|-----|
| Claude Code student | `npm install -g claude-sidecar` | Skill teaches CLI + MCP tools available | Electron on host |
| Cowork student | Same install | MCP tools auto-discovered | Electron on host |
| Both | Same install | CLI from Code, MCP from Cowork, shared sessions | Same |
| Server/CI | `npm install -g claude-sidecar --ignore-optional` | MCP or CLI, headless only | None |

## Dependency Changes

### Current (Problems)

```json
"dependencies": {
  "@opencode-ai/sdk": "^1.1.36",
  "chrome-remote-interface": "^0.33.3",   // Should be devDep
  "dotenv": "^17.2.3",
  "electron": "^28.0.0",                   // 233MB, should be optional
  "mocha": "^11.7.5",                      // Should be devDep
  "puppeteer": "^24.36.0",                 // Should be devDep
  "tiktoken": "^1.0.0"
}
```

### Proposed

```json
"dependencies": {
  "@opencode-ai/sdk": "^1.1.36",
  "@modelcontextprotocol/sdk": "^1.0.0",   // NEW: MCP server SDK
  "dotenv": "^17.2.3",
  "tiktoken": "^1.0.0"
},
"optionalDependencies": {
  "electron": "^28.0.0"                    // Lazy-loaded for interactive mode
},
"devDependencies": {
  "chrome-remote-interface": "^0.33.3",
  "eslint": "^8.0.0",
  "jest": "^29.0.0",
  "mocha": "^11.7.5",
  "puppeteer": "^24.36.0",
  "ws": "^8.19.0"
}
```

Electron is lazy-loaded: if absent, interactive mode fails with a clear error suggesting `--no-ui` or reinstall without `--ignore-optional`.

## New Files

| File | Purpose | Estimated Size |
|------|---------|---------------|
| `src/mcp-server.js` | MCP server implementation (stdio transport) | ~150-200 lines |
| `src/mcp-tools.js` | Tool definitions with rich descriptions | ~100-150 lines |

## Modified Files

| File | Change |
|------|--------|
| `bin/sidecar.js` | Add `case 'mcp'` to command router |
| `package.json` | Move electron to optional, add MCP SDK, clean up deps |
| `src/sidecar/start.js` | Lazy-load electron with graceful fallback |
| `scripts/postinstall.js` | Add MCP auto-registration for Claude Code + Desktop |

## Phase 2: Plugin Packaging (Future)

When ready, add these files to wrap the same codebase as a plugin:

```
.claude-plugin/
  plugin.json              # Manifest
.mcp.json                  # MCP server definition using ${CLAUDE_PLUGIN_ROOT}
```

Distribution via:
- GitHub marketplace: `claude plugin install sidecar@jrenaldi79/sidecar-marketplace`
- npm source in marketplace
- Official Anthropic marketplace (widest reach)

No code changes needed for Phase 2 — just packaging.

## Alternatives Considered

### Split Packages (Rejected)

Separate `claude-sidecar-core` (lightweight) from `claude-sidecar` (with Electron). Rejected because: two packages to maintain, version coordination, students might install the wrong one.

### Native Installer / DMG (Rejected)

Package as a macOS app with embedded Node.js. Rejected because: significant build infrastructure, platform-specific, harder to iterate.

### Plugin-First (Deferred to Phase 2)

Start with plugin packaging from day one. Deferred because: MCP server is the core value, plugin is distribution convenience. Build the MCP first, add plugin wrapper later.
