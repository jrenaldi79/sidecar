# Sidecar: Multi-Agent Panel for Claude Code/Cowork
## Product Spec & Design of Experiments

**Author:** John Renaldi
**Date:** March 2026
**Status:** Architecture & Feasibility

## 1. Overview

Sidecar is a CLI tool and Electron wrapper that enables Claude Code and Claude Cowork users to invoke a second AI agent (via OpenCode) as a parallel work panel. The user triggers Sidecar from within a Claude session, which opens an interactive OpenCode Web UI running Gemini (or another model). When the user is satisfied with the second agent's output, they issue a "fold" command that summarizes the OpenCode session and pipes it back into Claude's context.

The core insight: Claude Code and Cowork both write their conversation logs to local JSON files with known session IDs, whether running locally or in a web-hosted sandbox. OpenCode exposes a full HTTP API and JS/TS SDK. Claude Code's bash tool supports background execution with `run_in_background: true`, meaning Sidecar runs non-blocking and Claude continues working while the user interacts with the second agent.

Sidecar operates in two modes depending on the runtime environment:
- **Interactive mode** (local environments with a display server, where an Electron window shows the OpenCode Web UI)
- **Headless mode** (web-hosted sandboxes or environments without a display, where the second agent runs a single prompt-response cycle and returns the result directly)

## 2. User Flow

### 2.1 Interactive Mode (Local)

**Step 1 -- Invoke.** The user is working in Claude Code (local terminal) or Claude Cowork. They type: "Ask Gemini to review your work."

**Step 2 -- Background Launch.** The Skill runs the Sidecar CLI via bash with `run_in_background: true`. Claude continues the conversation. The CLI reads the Claude conversation JSON, creates an OpenCode session, injects the context, and opens the Electron window.

**Step 3 -- First Run Setup (if needed).** If no API keys are configured, the Electron window shows a setup screen. The user enters their key and saves. This only happens once.

**Step 4 -- Interactive Panel.** The Electron window opens with the OpenCode Web UI. Gemini has the full context and is already responding. The user interacts freely. Claude remains available.

**Step 5 -- Fold.** The user hits Cmd+Shift+F. Sidecar summarizes the session, writes the summary to stdout, and closes the Electron window. The user tells Claude to pull in the results.

### 2.2 Headless Mode (Web or No Display)

**Step 1 -- Invoke.** The user is working in Claude Code on the web. They type: "Ask Gemini to review your work."

**Step 2 -- Foreground Execution.** The Skill detects the web environment and runs Sidecar with `--no-ui` in the foreground. It passes the sandbox working directory so Sidecar can find the session data. The CLI reads the conversation JSON, creates an OpenCode session, injects the context, waits for the response, and returns it.

**Step 3 -- Immediate Result.** Claude receives the response and presents it to the user.

### 2.3 Environment Detection

| Environment | Client flag | Display | Mode |
|---|---|---|---|
| Claude Code, local terminal | `--client code-local` | Yes | Interactive |
| Claude Cowork, desktop app | `--client cowork` | Yes | Interactive |
| Claude Code, web browser | `--client code-web` | No | Headless |

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              Claude Code / Cowork (any environment)           │
│                                                              │
│  Skill: "ask gemini to review"                               │
│  ├─ Detect environment (local vs web)                        │
│  ├─ Resolve session-dir and cwd for client type              │
│  │                                                           │
│  ├─ LOCAL: bash (run_in_background: true)                    │
│  │  sidecar --session <id> --client code-local               │
│  │    --cwd /path/to/project                                 │
│  │    --prompt "review error handling"                        │
│  │                                                           │
│  └─ WEB: bash (foreground)                                   │
│     sidecar --session <id> --client code-web                 │
│       --session-dir /path/to/sandbox                         │
│       --cwd /path/to/project                                 │
│       --no-ui                                                │
│       --prompt "review error handling"                        │
└──────────────────────────────────────────────────────────────┘
          │                                    ▲
          │ launches                           │ stdout
          ▼                                    │
┌──────────────────────────────────────────────────────────────┐
│                    Sidecar CLI (Node.js)                      │
│                                                              │
│  1. Resolve session file                                     │
│  2. Read Claude JSON log                                     │
│  3. Check API key config                                     │
│  4. Start OpenCode server at --cwd                           │
│  5. Create session, inject context                           │
│  6a. INTERACTIVE: Electron + fold                            │
│  6b. HEADLESS: Wait for response                             │
│  7. Write output to stdout, exit                             │
└──────────────────────────────────────────────────────────────┘
```

## 4. Key Components

### 4.1 Sidecar CLI (`sidecar`)

Arguments:
- `--session-id <id>` -- The Claude session ID
- `--client <code-local|code-web|cowork>` -- Client type
- `--cwd <path>` -- Working directory for OpenCode
- `--session-dir <path>` -- Directory where Claude's session data lives
- `--prompt <text>` -- Task prompt for the second agent
- `--model <model>` -- Model override (e.g., gemini-2.5-pro)
- `--no-ui` -- Headless mode
- `--fold-shortcut <key>` -- Fold shortcut (default: Cmd+Shift+F)
- `--opencode-port <port>` -- Port for the OpenCode server
- `--setup` -- Force open the configuration UI

### 4.2 Session Path Resolution

The CLI resolves the session file using a combination of `--client`, `--session-id`, and optionally `--session-dir`.

Resolution order:
1. If `--session-dir` is provided, look for the session file under that directory.
2. If `--session-dir` is not provided, use the `--client` flag to determine the default path:

| Client | Default session root | Notes |
|---|---|---|
| `code-local` | `~/.claude/projects/<project-hash>/sessions/` | Standard Claude Code local path |
| `code-web` | Determined by experiment | Must be passed via `--session-dir` |
| `cowork` | OS app data directory | `~/Library/Application Support/Claude Cowork/` on macOS |

### 4.3 Working Directory

- `--cwd`: The project root. OpenCode's file tools scope to this directory.
- `--session-dir`: Where Claude's session JSON lives. Only needed when the CLI can't infer it from `--client` alone.

### 4.4 Electron Wrapper (Interactive Mode Only)

- Normal mode: BrowserWindow loading `http://localhost:<port>/session/<id>`
- Fold shortcut (Cmd+Shift+F)
- IPC fold signal to main process
- On close: prompt to fold first
- Setup mode: Provider selection, API key input, test connection, save

### 4.5 API Key Configuration

Three-layer resolution:
1. **Layer 1**: Sidecar config (`~/.config/sidecar/config.json`)
2. **Layer 2**: Environment variables (`GOOGLE_API_KEY`, `OPENAI_API_KEY`, etc.)
3. **Layer 3**: OpenCode's config

### 4.6 Context Compression

- Under 30k tokens: send as-is with preamble
- Over 30k tokens: two-pass compression via cheap model
- Preamble includes cwd

### 4.7 Fold Protocol

**Interactive mode:**
1. User hits Cmd+Shift+F
2. Electron sends IPC fold signal
3. CLI sends summarization prompt to OpenCode API
4. CLI writes `[SIDECAR_FOLD]` to stdout, closes Electron, exits
5. Claude reads via BashOutput

**Headless mode:**
1. CLI sends context + prompt, waits for response
2. CLI writes `[SIDECAR_FOLD]` to stdout, exits

Output format:
```
[SIDECAR_FOLD]
Model: gemini-2.5-pro
Session: <opencode-session-id>
Client: <code-local|code-web|cowork>
CWD: <working-directory>
Mode: <interactive|headless>
---
<summary or response content>
```

## 5. OpenCode API Surface (Confirmed)

| What we need | OpenCode API | Notes |
|---|---|---|
| Create a session | `POST /session` | Body: `{ title? }` |
| Send a message | `POST /session/:id/message` | Body: `{ parts, model?, system? }` |
| Send async | `POST /session/:id/prompt_async` | Returns 204 |
| List messages | `GET /session/:id/message` | Query: `limit?` |
| Summarize | SDK: `session.summarize()` | Built-in |
| Execute command | `POST /session/:id/command` | Slash commands |
| Session status | `GET /session/status` | Check busy/idle |

## 6. Claude Code Background Bash (Confirmed)

- Background execution: `run_in_background: true` returns shell ID immediately.
- Output retrieval: `BashOutput(shell_id)` returns new output since last check.
- Timeout config (`~/.claude/settings.json`):
```json
{
  "env": {
    "BASH_DEFAULT_TIMEOUT_MS": "7200000",
    "BASH_MAX_TIMEOUT_MS": "7200000"
  }
}
```

## 7. Data Paths

| Data | Local | Web sandbox | Format |
|---|---|---|---|
| Claude Code sessions | `~/.claude/projects/<hash>/sessions/` | TBD | JSON |
| Claude Cowork sessions | OS app data dir | N/A | JSON |
| OpenCode state | `~/.local/share/opencode/` | Same relative path | SQLite + JSON |
| Sidecar config | `~/.config/sidecar/config.json` | Env vars | JSON |

## 8. Design of Experiments

### Experiment 1: Claude Session Data Discovery

**Experiment 1a: Claude Code Local Session Paths**
- Hypothesis: Claude Code local stores session JSON at a known, deterministic path
- Method: Start multiple sessions, find JSON files, document paths and schema
- Pass criteria: Deterministic path resolution from (session ID + project directory) to JSON file

**Experiment 1b: Claude Code Web Sandbox Session Paths**
- Hypothesis: Claude Code web stores session JSON somewhere in the sandbox
- Method: Use bash to explore sandbox filesystem
- Pass criteria: Reliable strategy for Skill to discover session directory

**Experiment 1c: Claude Cowork Session Paths**
- Hypothesis: Claude Cowork stores session JSON in standard OS app data location
- Method: Start Cowork session, find JSON, compare schemas
- Pass criteria: Known paths for all target platforms

### Experiment 2: OpenCode Working Directory Scoping
- Hypothesis: We can start an OpenCode session scoped to a specific project directory
- Pass criteria: OpenCode operates on the correct project files
- Estimated effort: 2-3 hours

### Experiment 3: OpenCode API Message Injection
- Hypothesis: We can create a session, inject large context, and get a response
- Pass criteria: Session creation + context injection + model response
- Estimated effort: 2-3 hours

### Experiment 4: API Key Passthrough
- Hypothesis: We can start OpenCode with API keys via env vars
- Pass criteria: Sidecar starts OpenCode with keys and model responds
- Estimated effort: 1-2 hours

### Experiment 5: OpenCode Session Summarization
- Hypothesis: We can trigger summarization and capture structured output
- Pass criteria: Structured summary via API
- Estimated effort: 1-2 hours

### Experiment 6: Electron + OpenCode Web UI
- Hypothesis: OpenCode Web UI works inside Electron
- Pass criteria: Working interactive session with fold
- Estimated effort: 3-4 hours

### Experiment 7: Background Bash (Local and Web)
- Hypothesis: BashOutput retrieves Sidecar's stdout reliably
- Pass criteria: Output retrieval works in both environments
- Estimated effort: 2-3 hours

### Experiment 8: Headless End-to-End in Web Sandbox
- Hypothesis: Full headless pipeline works within the web sandbox
- Pass criteria: Full headless round trip in sandbox
- Estimated effort: 3-4 hours

### Experiment 9: End-to-End Full Loop (All Environments)
- Method: Wire experiments 1-8 together
- Pass criteria: Round trip in each environment
- Estimated effort: 4-6 hours

## 9. Open Questions

### Architecture
- OpenCode server lifecycle: per-invocation vs long-running
- Multiple concurrent Sidecars: port management
- OpenCode in sandbox: npm install too slow? Direct API calls?

### Product
- Fold granularity: partial vs full session
- Bidirectional flow: mid-session push from OpenCode to Claude
- Model agnosticism: multi-provider support
- Web UX messaging: headless-only communication

### Technical
- Sandbox filesystem stability
- Sandbox networking (outbound HTTPS)
- Sandbox persistence (no config files)
- Session-dir discovery heuristics
- Config file permissions (600 for keys)

## 10. Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| CLI | Node.js + Commander.js | Same runtime as Electron |
| OpenCode interaction | @opencode/sdk | Official SDK, type-safe |
| Electron wrapper | Electron (latest) | Interactive mode, local only |
| Setup UI | Bundled HTML/CSS/JS | Simple form |
| Context parsing | Custom JSON parser | Normalization |
| Config storage | JSON file + env var fallback | Persistent locally |
| Build/packaging | electron-builder | Single binary for local |
