# Sidecar: Multi-Model Subagent Tool

Spawn parallel conversations with different LLMs (Gemini, GPT-4, o3, etc.) and fold results back into your context.

## Installation

```bash
npm install -g claude-sidecar
```

Verify installation:
```bash
sidecar --version
```

### Requirements
- Node.js 18+
- API credentials (see Setup below)
- Electron (installed automatically as optional dependency)

### MCP Server (Auto-Registered)

On install, an MCP server is auto-registered for Claude Cowork and Claude Desktop. If you're in an MCP-enabled environment, you can use `sidecar_start`, `sidecar_status`, `sidecar_read`, and other MCP tools directly instead of CLI commands. Call `sidecar_guide` for detailed usage instructions.

---

## Setup: Configuring API Access

Sidecar uses the OpenCode SDK to communicate with LLM providers. You need to configure API credentials for your chosen provider(s).

### Option A: OpenRouter (Recommended for Multi-Model Access)

OpenRouter provides unified access to many models (Gemini, GPT-4, Claude, o3, etc.) with a single API key.

**Step 1: Get an OpenRouter API key**
- Sign up at https://openrouter.ai
- Go to Keys → Create Key
- Copy your key (starts with `sk-or-v1-...`)

**Step 2: Configure credentials**

Create the auth file:
```bash
mkdir -p ~/.local/share/opencode
cat > ~/.local/share/opencode/auth.json << 'EOF'
{
  "openrouter": {
    "apiKey": "sk-or-v1-YOUR_KEY_HERE"
  }
}
EOF
```

**Step 3: Verify setup**
```bash
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "Say hello" --no-ui
```

**Model names with OpenRouter:**
When using OpenRouter, prefix the model with `openrouter/`:
```bash
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "..."
sidecar start --model openrouter/openai/gpt-4o --prompt "..."
sidecar start --model openrouter/anthropic/claude-sonnet-4 --prompt "..."
```

### Option B: Direct API Keys (Provider-Specific)

Use this if you have API keys directly from Google, OpenAI, or Anthropic.

**For Google Gemini:**
```bash
export GEMINI_API_KEY=your-google-api-key
```

**For OpenAI:**
```bash
export OPENAI_API_KEY=your-openai-api-key
```

**For Anthropic:**
```bash
export ANTHROPIC_API_KEY=your-anthropic-api-key
```

Add these to your shell profile (`~/.bashrc`, `~/.zshrc`) for persistence.

**Model names with direct API keys:**
When using direct API keys, use the provider/model format WITHOUT the `openrouter/` prefix:
```bash
sidecar start --model google/gemini-2.5-flash --prompt "..."
sidecar start --model openai/gpt-4o --prompt "..."
sidecar start --model anthropic/claude-sonnet-4 --prompt "..."
```

### Model Naming Summary

| Provider Access | Model Name Format | Example |
|-----------------|-------------------|---------|
| OpenRouter | `openrouter/provider/model` | `openrouter/google/gemini-2.5-flash` |
| Direct Google API | `google/model` | `google/gemini-2.5-flash` |
| Direct OpenAI API | `openai/model` | `openai/gpt-4o` |
| Direct Anthropic API | `anthropic/model` | `anthropic/claude-sonnet-4` |

**Important:** The model name format tells the SDK which authentication to use:
- `openrouter/...` → Uses OpenRouter API key from auth.json
- `google/...` → Uses `GEMINI_API_KEY` environment variable
- `openai/...` → Uses `OPENAI_API_KEY` environment variable
- `anthropic/...` → Uses `ANTHROPIC_API_KEY` environment variable

---

## When to Use Sidecars

**DO spawn a sidecar when:**
- Task benefits from a different model's strengths (Gemini's large context, o3's reasoning)
- Deep exploration that would pollute your main context
- User explicitly requests a different model
- Parallel investigation while you continue other work
- Research/comparison tasks that generate verbose output

**DON'T spawn a sidecar when:**
- Simple task you can handle directly
- User wants to stay in the current conversation
- Task requires your specific context that's hard to transfer

### Agent Selection Guidelines

**Chat mode (default)** — no `--agent` flag needed. Reads are auto-approved, writes and bash commands require user permission in the Electron UI:
```bash
# Default — good for questions, analysis, and guided work
sidecar start --model gemini --prompt "Analyze the auth flow and suggest improvements"
```

**Plan mode** — fully read-only, no file modifications possible:
```bash
# Strict read-only for deep analysis
sidecar start --model gemini --prompt "Review the codebase architecture" --agent Plan
```

**Build mode** — full tool access, all operations auto-approved:
```bash
# Only when offloading development tasks
sidecar start --model gemini --prompt "Implement the login feature" --agent Build
```

**When to use each mode:**

| Mode | Use When |
|------|----------|
| **Chat** (default) | Questions, analysis, guided exploration — you control what gets written |
| **Plan** | Comprehensive read-only analysis where no changes should happen |
| **Build** | Offloading implementation tasks where full autonomy is desired |

---

## Commands

### Start a Sidecar

```bash
sidecar start \
  --model <provider/model> \
  --prompt "<task description>" \
  --session-id <your-session-id>
```

**Required:**
- `--model`: The model to use (see Models below)
- `--prompt`: Detailed task description you generate

**Recommended:**
- `--session`: Your Claude Code session ID for accurate context passing

**Optional:**
- `--no-ui`: Run autonomously without GUI (for bulk tasks)
- `--timeout <min>`: Headless timeout (default: 15)
- `--context-turns <N>`: Max conversation turns to include (default: 50)
- `--context-since <duration>`: Time filter for context (e.g., `2h`, `30m`, `1d`). Overrides `--context-turns`.
- `--context-max-tokens <N>`: Max context size (default: 80000)
- `--thinking <level>`: Model thinking/reasoning effort level:
  - `none` - No extended thinking
  - `minimal` - Minimal thinking (may be adjusted if unsupported by model)
  - `low` - Low thinking effort
  - `medium` - Medium thinking effort (default)
  - `high` - High thinking effort
  - `xhigh` - Extra high thinking effort
  Note: If the model doesn't support the specified level, it will be automatically adjusted.
- `--summary-length <length>`: Summary verbosity:
  - `brief` - Concise summary
  - `normal` - Standard summary (default)
  - `verbose` - Detailed summary
- `--mcp <spec>`: Add MCP server for enhanced tool access. Formats:
  - `name=url` - Remote MCP server (e.g., `--mcp "db=postgresql://localhost:5432/mydb"`)
  - `name=command` - Local MCP server (spawns process)
- `--mcp-config <path>`: Path to opencode.json file with MCP server configuration. Alternative to `--mcp` for complex setups.
- `--agent <agent>`: Agent mode (controls tool permissions). If omitted, defaults to **Chat**.

  **Primary Agents (for `sidecar start`):**
  - `Chat` **(default)**: Reads auto-approved, writes/bash require user permission
  - `Plan`: Read-only mode - no file modifications possible
  - `Build`: Full tool access - all operations auto-approved

  **Subagents (for `sidecar subagent spawn`):**
  - `Explore`: Read-only subagent - for codebase exploration
  - `General`: Full-access subagent - for research requiring file writes

  **Custom Agents:**
  Custom agents defined in `~/.config/opencode/agents/` or `.opencode/agents/` are passed through directly.

### Input Validation

The CLI validates all inputs **before** launching the sidecar. Invalid inputs fail immediately with clear error messages - no Electron window will open.

**Required inputs (will error if invalid):**

| Input | Validation | Error Message |
|-------|------------|---------------|
| `--model` | Must be present, format: `provider/model` | `Error: --model is required` or `Error: --model must be in format provider/model` |
| `--prompt` | Must be present and non-empty | `Error: --prompt is required` or `Error: --prompt cannot be empty or whitespace-only` |
| `--cwd` | If provided, directory must exist | `Error: --cwd path does not exist: <path>` |
| `--session-id` | If explicit ID provided (not 'current'), must exist | `Error: --session-id '<id>' not found. Use 'sidecar list' to see available sessions or omit --session-id for most recent.` |
| `--agent` | If provided, must be non-empty | `Error: --agent cannot be empty` |
| `--timeout` | Must be positive number | `Error: --timeout must be a positive number` |
| `--context-turns` | Must be positive number | `Error: --context-turns must be a positive number` |
| `--context-since` | Must match format: `30m`, `2h`, `1d` | `Error: --context-since must be in format: 30m, 2h, or 1d` |
| API Key | Must be set for model's provider | `Error: <KEY_NAME> environment variable is required for <Provider> models` |

**API Key Requirements by Provider:**

| Model Prefix | Required Env Var | Example |
|--------------|------------------|---------|
| `openrouter/...` | `OPENROUTER_API_KEY` | `export OPENROUTER_API_KEY=sk-or-...` |
| `google/...` | `GEMINI_API_KEY` | `export GEMINI_API_KEY=...` |
| `openai/...` | `OPENAI_API_KEY` | `export OPENAI_API_KEY=sk-...` |
| `anthropic/...` | `ANTHROPIC_API_KEY` | `export ANTHROPIC_API_KEY=sk-ant-...` |
| `deepseek/...` | `DEEPSEEK_API_KEY` | `export DEEPSEEK_API_KEY=...` |

**Handling validation errors:**

If you receive a validation error, fix the input and retry:

```bash
# Error: --session-id 'abc123' not found
# Fix: Use 'current' or omit --session
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "Task" --session-id current

# Error: --agent cannot be empty
# Fix: Use a valid OpenCode agent
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "Task" --agent Build

# Error: --prompt cannot be empty
# Fix: Provide a non-empty briefing
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "Detailed task description"

# Error: OPENROUTER_API_KEY environment variable is required
# Fix: Set the API key for your provider
export OPENROUTER_API_KEY=sk-or-your-key
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "Task"
```

### List Past Sidecars

```bash
sidecar list
sidecar list --status complete
sidecar list --all  # All projects
sidecar list --json # Output as JSON
```

**Optional:**
- `--status <filter>`: Filter by status (`running`, `complete`)
- `--all`: Show sessions from all projects
- `--json`: Output as JSON format (for programmatic use)
- `--cwd <path>`: Project directory (default: current directory)

### Resume a Sidecar

```bash
sidecar resume <task_id>
```

Reopens a previous session with full conversation history. The sidecar continues in the **same** OpenCode session — all previous messages and tool state are preserved.

**Use resume when:** You want to pick up exactly where you left off (e.g., re-examine findings, ask follow-up questions in the same conversation).

**Optional:**
- `--no-ui`: Continue session in autonomous mode
- `--timeout <minutes>`: Timeout for headless mode (default: 15)
- `--cwd <path>`: Project directory (default: current directory)

### Continue from a Sidecar

```bash
sidecar continue <task_id> --prompt "<new task>"
```

Starts a **new** sidecar session that inherits the old session's conversation as context. The previous session's messages become read-only background context for the new task.

**Use continue when:** You want to build on previous findings with a new task or different model (e.g., "Now implement the fix from the previous analysis").

**Required:**
- `--prompt`: New task description for the continuation

**Optional:**
- `--model <model>`: Override model (defaults to original session's model)
- `--context-turns <N>`: Max turns from previous session to include (default: 50)
- `--context-max-tokens <N>`: Max tokens for context (default: 80000)
- `--no-ui`: Run in autonomous mode
- `--timeout <minutes>`: Timeout for headless mode (default: 15)
- `--cwd <path>`: Project directory (default: current directory)

### Read Sidecar Output

```bash
sidecar read <task_id>                 # Show summary
sidecar read <task_id> --conversation  # Show full conversation
sidecar read <task_id> --metadata      # Show session metadata
```

**Optional:**
- `--summary`: Show summary (default if no option specified)
- `--conversation`: Show full conversation history
- `--metadata`: Show session metadata (model, agent, timestamps, etc.)
- `--cwd <path>`: Project directory (default: current directory)

### Subagent Commands

> 🚧 **Planned Feature**: Subagent commands are documented for future reference but are **not yet implemented** in the current CLI. Running these commands will result in "Unknown command: subagent" errors. This section describes the planned API for when the feature is released.

Spawn and manage subagents within a sidecar session. Subagents run in parallel with the main session.

#### Spawn a Subagent

```bash
sidecar subagent spawn \
  --parent <sidecar-task-id> \
  --agent <General|Explore> \
  --prompt "<task description>"
```

**Required:**
- `--parent`: The task ID of the parent sidecar session
- `--agent`: Subagent type - `General` (full access) or `Explore` (read-only)
- `--prompt`: Task description for the subagent

**Example:**
```bash
sidecar subagent spawn --parent abc123 --agent Explore --prompt "Find all API endpoints in src/"
sidecar subagent spawn --parent abc123 --agent General --prompt "Research authentication patterns"
```

#### List Subagents

```bash
sidecar subagent list --parent <sidecar-task-id>
sidecar subagent list --parent abc123 --status running
sidecar subagent list --parent abc123 --status completed
```

#### Read Subagent Results

```bash
sidecar subagent read <subagent-id>                 # Show summary
sidecar subagent read <subagent-id> --conversation  # Show full conversation
```

---

## Models Available

### Model Selection

Use short aliases when a default is configured (`sidecar setup`):
- `--model gemini` -- Google Gemini 3 Flash (fast, 1M context)
- `--model opus` -- Claude Opus 4.6 (deep analysis)
- `--model gpt` -- OpenAI GPT-5.2
- `--model deepseek` -- DeepSeek v3.2
- Omit `--model` entirely to use your configured default

Full model strings still work: `--model openrouter/google/gemini-3-flash-preview`

### Verifying Model Names

**Note:** Model names change frequently as providers release new versions. To verify current model names:

```bash
# List available OpenRouter models
curl https://openrouter.ai/api/v1/models | jq '.data[].id' | grep -i gemini

# Or check the OpenRouter website
# https://openrouter.ai/models
```

Always verify model names before using them in production scripts.

---

## Session ID (Important)

For reliable context passing, provide your session ID:

```bash
sidecar start --session-id "a1b2c3d4-..." --model ... --prompt ...
```

**How to find your session ID:**

Your conversations are stored in:
```
~/.claude/projects/[encoded-project-path]/[session-id].jsonl
```

The encoded path replaces `/`, `\`, and `_` with `-`. For example:
- Project: `/Users/john/myproject`
- Encoded: `-Users-john-myproject`
- Full path: `~/.claude/projects/-Users-john-myproject/`

List session files to find yours:
```bash
ls -lt ~/.claude/projects/-Users-john-myproject/*.jsonl | head -5
```

The most recently modified file is likely your current session. Extract the UUID from the filename.

**Session ID behavior:**
- **Omit `--session`** or use `--session-id current`: Uses the most recently modified session file (less reliable if multiple sessions are active)
- **Explicit session ID** (`--session-id abc123-def456`): Must exist or the command fails immediately with: `Error: --session-id 'abc123-def456' not found`

**If you get a session not found error:**
1. List available sessions: `sidecar list`
2. Use one of the listed session IDs, OR
3. Omit `--session` to use the most recent session

---

## Generating the Briefing

You create the briefing—it should be a comprehensive handoff document:

```markdown
## Task Briefing

**Objective:** [One-line goal]

**Background:** [What led to this task, relevant context]

**What's been tried:** [Previous attempts, if any]

**Files of interest:**
- path/to/relevant/file.ts
- path/to/another/file.ts

**Success criteria:** [How to know when done]

**Constraints:** [Time limits, scope limits, things to avoid]
```

**Example:**

```bash
sidecar start \
  --model openrouter/google/gemini-2.5-pro \
  --session-id "abc123-def456" \
  --prompt "## Task Briefing

**Objective:** Debug the intermittent 401 errors on mobile

**Background:** Users report sporadic auth failures. Server logs show
token refresh race conditions. I suspect TokenManager.ts.

**Files of interest:**
- src/auth/TokenManager.ts (main suspect)
- src/api/client.ts (where tokens are used)
- logs/auth-errors-2025-01-25.txt

**Success criteria:** Identify root cause and propose fix

**Constraints:** Focus on auth flow only, don't refactor unrelated code"
```

---

## Agent Modes

Sidecar uses OpenCode's agent framework with three primary modes and two subagent types:

### Primary Agents (for Main Sessions)

| Agent | Reads | Writes/Edits | Bash | Default |
|-------|-------|-------------|------|---------|
| **Chat** | auto | asks permission | asks permission | Yes |
| **Plan** | auto | denied | denied | No |
| **Build** | auto | auto | auto | No |

#### Chat Agent (Default)

Conversational mode — reads are auto-approved, writes and bash commands prompt for user permission in the UI. This is the default when no `--agent` flag is provided.

```bash
# These are equivalent — Chat is the default
sidecar start --model gemini --prompt "Analyze the auth flow"
sidecar start --model gemini --prompt "Analyze the auth flow" --agent Chat
```

**Use Chat agent when:**
- Asking questions or requesting analysis
- You want to review and approve any file changes
- Interactive exploration where the model might suggest edits
- Any task where you want human-in-the-loop control over writes

#### Plan Agent

Strict read-only mode — file modifications are completely blocked:

```bash
sidecar start --model gemini --prompt "Review the codebase architecture" --agent Plan
```

**Use Plan agent when:**
- Comprehensive analysis where no changes should happen
- Code review and security audits
- Architecture exploration

#### Build Agent

Full autonomous access — all operations auto-approved:

```bash
sidecar start --model gemini --prompt "Implement the login feature" --agent Build
```

**Use Build agent when:**
- Offloading development tasks to the sidecar
- User explicitly requests implementation ("implement", "fix", "write", "create")
- Headless batch operations (test generation, linting, etc.)

### Subagents (Spawned Within Sessions)

These agents are spawned from within a sidecar session using `sidecar subagent spawn`:

#### General Subagent

Full-access subagent for research and parallel tasks:
- Same capabilities as Build agent
- Used for spawning parallel work within a session

```bash
sidecar subagent spawn --parent abc123 --agent General --prompt "Research auth patterns"
```

#### Explore Subagent

Read-only subagent for codebase exploration:
- Optimized for searching and understanding code
- Read-only access (no writes, no bash)

```bash
sidecar subagent spawn --parent abc123 --agent Explore --prompt "Find all API endpoints"
```

**Important:** When using `sidecar start`, use **Chat**, **Plan**, or **Build**. When using `sidecar subagent spawn`, use **General** or **Explore**.

---

## Interactive vs Headless

### Interactive (Default)

- Opens a GUI window
- User can converse with the sidecar
- **Model Picker:** Click the model name in the input area to switch models mid-conversation
- Click **FOLD** when done to generate summary
- Summary returns to your context via stdout

**Use for:** Debugging, exploration, architectural discussions

**Mid-Conversation Model Switching:**
In interactive mode, you can change models without restarting:
1. Click the model dropdown (shows current model name)
2. Select a different model from the categorized list
3. A system message confirms the switch
4. Subsequent messages use the new model

This is useful when you want to:
- Start fast with Flash, then switch to Pro for complex analysis
- Try a different model's perspective on a problem
- Use reasoning models (o3-mini) for specific parts of the task

### Headless (--no-ui)

- Runs autonomously, no GUI
- Agent works until done or timeout
- Summary returns automatically
- **Default agent is `build`** — `chat` agent requires interactive UI and will stall in headless mode

**Agent Headless Compatibility:**

| Agent | Headless Safe | Notes |
|-------|--------------|-------|
| `build` | Yes | Default for `--no-ui` — full autonomous access |
| `plan` | Yes | Read-only analysis |
| `explore` | Yes | Read-only codebase exploration |
| `general` | Yes | Full-access subagent |
| `chat` | **No** | Blocked — requires interactive mode for write permissions |

```bash
# Error: chat + headless
sidecar start --model gemini --prompt "..." --agent chat --no-ui
# → Error: --agent chat requires interactive mode (remove --no-ui or use --agent build)
```

**Use for:** Bulk tasks, test generation, documentation, linting

```bash
sidecar start \
  --model google/gemini-2.5-flash \
  --prompt "Generate unit tests for src/utils/. Use Jest." \
  --no-ui \
  --timeout 20
```

---

## Background Execution (REQUIRED)

**ALWAYS run sidecar commands in the background.** Use the Bash tool's `run_in_background: true` parameter for every `sidecar start`, `sidecar resume`, and `sidecar continue` invocation. This ensures:

- No timeout ceiling — tasks can run for the full 15+ minutes
- You can continue working while the sidecar runs
- You'll be automatically notified when it completes

**Example invocation pattern:**
```
Bash tool:
  command: "sidecar start --model openrouter/google/gemini-2.5-flash --prompt '...' --no-ui"
  run_in_background: true
```

After launching, tell the user:
> "Sidecar is running in the background. I'll share the results when it completes."

**When the background task completes**, you will be automatically notified. Use the `TaskOutput` tool with the task ID to read the sidecar's summary output, then present it to the user. Do NOT poll or sleep — the notification arrives automatically.

**Interactive mode note:** When running without `--no-ui`, the Electron GUI opens in a separate window. Backgrounding frees the terminal but does not prevent the user from interacting with the GUI window.

**Important:** Warn users about potential file conflicts:
> "I recommend committing your current changes before the sidecar completes, in case there are file conflicts."

---

## Understanding Sidecar Output

The summary includes:

```markdown
## Sidecar Results: [Title]

📍 **Context Age:** [How stale the context might be]

⚠️ **FILE CONFLICT WARNING** [If files were modified externally]

**Task:** [What was requested]
**Findings:** [Key discoveries]
**Attempted Approaches:** [What was tried but didn't work]
**Recommendations:** [Suggested actions]
**Code Changes:** [Specific code with paths]
**Files Modified:** [List of files]
**Assumptions Made:** [Things to verify]
**Open Questions:** [Remaining uncertainties]
```

**Act on the summary:**
- Implement recommended fixes
- Verify assumptions listed
- Don't repeat failed approaches
- Review files with conflict warnings carefully

### Handling Config Update Notices

When sidecar emits `[SIDECAR_CONFIG_UPDATE]` on stderr, the user's model aliases have changed (via `sidecar setup`). The message contains a hash comment and a markdown alias table.

**Action required:**
1. Find the "Model Aliases" section in the project's CLAUDE.md
2. Replace that section's content with the block provided in the message
3. If no "Model Aliases" section exists, add one after the title line
4. Do **not** remove the `<!-- sidecar-config-hash: ... -->` comment — it tracks config changes and prevents duplicate notifications

The update is purely informational (alias mappings) and safe to apply without user confirmation.

---

## Checking for Existing Sidecars

Before spawning a new sidecar, check if relevant work exists:

```bash
sidecar list
```

If a relevant sidecar exists:
- Read its findings: `sidecar read <id>`
- Reopen it: `sidecar resume <id>`
- Build on it: `sidecar continue <id> --prompt "..."`

**Ask the user** if you're unsure whether to resume or start fresh.

---

## Examples

### Example 1: Interactive Debugging (Chat Mode - Default)

```bash
# Default Chat mode — can read freely, asks before writing
sidecar start \
  --model openrouter/openai/o3-mini \
  --session-id "$(ls -t ~/.claude/projects/-Users-john-myproject/*.jsonl | head -1 | xargs basename .jsonl)" \
  --prompt "## Debug Memory Leak

**Objective:** Find the source of memory growth in the worker process

**Background:** Memory usage grows 50MB/hour. Heap snapshots show retained
closures but I can't identify the source.

**Files of interest:**
- src/workers/processor.ts
- src/cache/lru.ts

**Success criteria:** Identify the leak and propose fix"
```

### Example 2: Headless Test Generation (Build Mode - Explicit Request)

```bash
# Build mode is appropriate here because user explicitly requested file creation
sidecar start \
  --model gemini \
  --agent Build \
  --prompt "Generate comprehensive Jest tests for all exported functions
in src/utils/. Include edge cases. Write to tests/utils/." \
  --no-ui \
  --timeout 15
```

### Example 3: Code Review (Plan Mode - Read-Only)

```bash
# Plan mode for strict read-only review
sidecar start \
  --model gemini \
  --agent Plan \
  --prompt "Review the authentication flow for security issues.
Focus on: token handling, session management, CSRF protection.
Analyze and report findings."
```

### Example 4: Spawn Subagents for Parallel Work

```bash
# First, start a sidecar (defaults to Chat mode)
sidecar start --model gemini --prompt "Debug auth issues"
# Output: Started sidecar with task ID: abc123

# Spawn an Explore subagent for codebase search
sidecar subagent spawn \
  --parent abc123 \
  --agent Explore \
  --prompt "Find all database queries and list which files they're in"

# Spawn a General subagent for parallel research
sidecar subagent spawn \
  --parent abc123 \
  --agent General \
  --prompt "Research best practices for JWT token refresh"

# Check subagent status
sidecar subagent list --parent abc123
```

### Example 5: Continue Previous Work

```bash
# First, check what exists
sidecar list

# Read what was found
sidecar read abc123

# Continue with a follow-up task
sidecar continue abc123 \
  --model gpt \
  --prompt "Implement the fix recommended in the previous session.
The mutex approach looks correct. Add tests."
```

---

## Troubleshooting

### "No Claude Code conversation history found"

Your project path encoding may not match. Check:
```bash
ls ~/.claude/projects/
```

Find the correct encoded path for your project. Remember that `/`, `\`, and `_` are all converted to `-`.

### "Multiple active sessions detected"

You have multiple Claude Code windows. Pass `--session` explicitly:
```bash
ls -lt ~/.claude/projects/[your-path]/*.jsonl | head -3
# Pick the correct session UUID
```

### Sidecar doesn't start / API errors

**Check API credentials are configured:**

For OpenRouter:
```bash
cat ~/.local/share/opencode/auth.json
# Should contain: {"openrouter": {"apiKey": "sk-or-v1-..."}}
```

For direct API keys:
```bash
echo $GEMINI_API_KEY    # For Google models
echo $OPENAI_API_KEY    # For OpenAI models
echo $ANTHROPIC_API_KEY # For Anthropic models
```

### "401 Unauthorized" or authentication errors

1. Verify you're using the correct model name format:
   - OpenRouter models: `openrouter/provider/model`
   - Direct API models: `provider/model`

2. Check your API key is valid and has credits

3. For OpenRouter, ensure auth.json exists:
   ```bash
   cat ~/.local/share/opencode/auth.json
   ```

### Headless mode times out with no output

1. Increase timeout: `--timeout 30`
2. Enable debug logging: `LOG_LEVEL=debug sidecar start ...`

### Summary is corrupted

Debug output may be leaking to stdout. Check for console.log statements if you've modified the sidecar code. All logging should go to stderr via the structured logger.

### Validation Errors

**"Error: --prompt cannot be empty or whitespace-only"**

The briefing must contain actual content:
```bash
# Wrong
sidecar start --model openrouter/google/gemini-2.5-flash --prompt ""
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "   "

# Right
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "Debug the auth issue in TokenManager.ts"
```

**"Error: --session-id '<id>' not found"**

The explicit session ID doesn't exist. Either:
1. Use `sidecar list` to find valid session IDs
2. Omit `--session` to use the most recent session
3. Use `--session-id current` for automatic resolution

```bash
# Find valid sessions
sidecar list

# Use most recent session
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "Task"
```

**"Error: --cwd path does not exist"**

The specified project directory doesn't exist:
```bash
# Wrong
sidecar start --model ... --prompt "..." --cwd /nonexistent/path

# Right - use current directory
sidecar start --model ... --prompt "..." --cwd .

# Right - use full path
sidecar start --model ... --prompt "..." --cwd /Users/john/myproject
```

**"Error: --agent cannot be empty"**

The agent name cannot be empty. Use an OpenCode native agent or a custom agent:
```bash
# Wrong - empty agent
sidecar start --model ... --prompt "..." --agent ""

# Right - use OpenCode native agent
sidecar start --model ... --prompt "..." --agent Explore

# Right - use custom agent (defined in ~/.config/opencode/agents/)
sidecar start --model ... --prompt "..." --agent MyCustomAgent
```

**"Error: <KEY_NAME> environment variable is required for <Provider> models"**

The API key for the model's provider is not set:
```bash
# For OpenRouter models (openrouter/...)
export OPENROUTER_API_KEY=sk-or-your-key

# For Google models (google/...)
export GEMINI_API_KEY=your-google-key

# For OpenAI models (openai/...)
export OPENAI_API_KEY=sk-your-openai-key

# For Anthropic models (anthropic/...)
export ANTHROPIC_API_KEY=sk-ant-your-key

# For DeepSeek models (deepseek/...)
export DEEPSEEK_API_KEY=your-deepseek-key

# Then retry
sidecar start --model openrouter/google/gemini-2.5-flash --prompt "Task"
```

---

## Quick Start Checklist

1. [ ] Install sidecar: `npm install -g claude-sidecar`
2. [ ] Configure API access (choose one):
   - [ ] OpenRouter: Create `~/.local/share/opencode/auth.json` with your key
   - [ ] Direct API: Set environment variable (`GEMINI_API_KEY`, etc.)
3. [ ] Test sidecar: `sidecar start --model <your-model> --prompt "Hello" --no-ui`
