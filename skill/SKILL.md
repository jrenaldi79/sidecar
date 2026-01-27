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
- Electron (installed automatically as dependency)

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
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "Say hello" --headless
```

**Model names with OpenRouter:**
When using OpenRouter, prefix the model with `openrouter/`:
```bash
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "..."
sidecar start --model openrouter/openai/gpt-4o --briefing "..."
sidecar start --model openrouter/anthropic/claude-sonnet-4 --briefing "..."
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
sidecar start --model google/gemini-2.5-flash --briefing "..."
sidecar start --model openai/gpt-4o --briefing "..."
sidecar start --model anthropic/claude-sonnet-4 --briefing "..."
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

**Default to Plan mode** for most sidecar tasks:
```bash
sidecar start --model ... --briefing "..." --agent Plan
```

Plan mode prevents unintended changes and is ideal for:
- Code review and analysis
- Architecture exploration
- Bug investigation
- Documentation research
- Understanding existing patterns

**Use Build mode only when:**
- User explicitly requests code changes ("implement", "fix", "write", "create")
- The task specifically requires file modifications
- You've already analyzed in Plan mode and are ready to implement

```bash
# Only after confirming implementation is needed:
sidecar start --model ... --briefing "Implement the login feature" --agent Build
```

---

## Commands

### Start a Sidecar

```bash
sidecar start \
  --model <provider/model> \
  --briefing "<task description>" \
  --session <your-session-id>
```

**Required:**
- `--model`: The model to use (see Models below)
- `--briefing`: Detailed task description you generate

**Recommended:**
- `--session`: Your Claude Code session ID for accurate context passing

**Optional:**
- `--headless`: Run autonomously without GUI (for bulk tasks)
- `--timeout <min>`: Headless timeout (default: 15)
- `--context-turns <N>`: Max conversation turns to include (default: 50)
- `--context-max-tokens <N>`: Max context size (default: 80000)
- `--agent <agent>`: OpenCode agent type (controls tool access via native framework):

  **Primary Agents (for `sidecar start`):**
  - `Plan` **(recommended default)**: Read-only mode - for analysis, exploration, and planning
  - `Build`: Full tool access - for implementation when changes are explicitly requested

  **Subagents (for `sidecar subagent spawn`):**
  - `Explore`: Read-only subagent - for codebase exploration
  - `General`: Full-access subagent - for research requiring file writes

  **Custom Agents:**
  You can also use custom agents defined in `~/.config/opencode/agents/` or
  `.opencode/agents/` - they will be passed directly to OpenCode.

  **Best Practice:** Always start with `--agent Plan` unless the user explicitly requests code changes or implementation. This prevents unintended modifications and allows thorough analysis before taking action. Switch to Build mode only when ready to implement.

### Input Validation

The CLI validates all inputs **before** launching the sidecar. Invalid inputs fail immediately with clear error messages - no Electron window will open.

**Required inputs (will error if invalid):**

| Input | Validation | Error Message |
|-------|------------|---------------|
| `--model` | Must be present, format: `provider/model` | `Error: --model is required` or `Error: --model must be in format provider/model` |
| `--briefing` | Must be present and non-empty | `Error: --briefing is required` or `Error: --briefing cannot be empty or whitespace-only` |
| `--project` | If provided, directory must exist | `Error: --project path does not exist: <path>` |
| `--session` | If explicit ID provided (not 'current'), must exist | `Error: --session '<id>' not found. Use 'sidecar list' to see available sessions or omit --session for most recent.` |
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
# Error: --session 'abc123' not found
# Fix: Use 'current' or omit --session
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "Task" --session current

# Error: --agent cannot be empty
# Fix: Use a valid OpenCode agent
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "Task" --agent Build

# Error: --briefing cannot be empty
# Fix: Provide a non-empty briefing
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "Detailed task description"

# Error: OPENROUTER_API_KEY environment variable is required
# Fix: Set the API key for your provider
export OPENROUTER_API_KEY=sk-or-your-key
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "Task"
```

### List Past Sidecars

```bash
sidecar list
sidecar list --status complete
sidecar list --all  # All projects
```

### Resume a Sidecar

```bash
sidecar resume <task_id>
```

Reopens a previous session with full conversation history.

### Continue from a Sidecar

```bash
sidecar continue <task_id> --model <model> --briefing "<new task>"
```

Starts a NEW sidecar that inherits the old sidecar's conversation as context.

### Read Sidecar Output

```bash
sidecar read <task_id>                 # Show summary
sidecar read <task_id> --conversation  # Show full conversation
```

### Subagent Commands

Spawn and manage subagents within a sidecar session. Subagents run in parallel with the main session.

#### Spawn a Subagent

```bash
sidecar subagent spawn \
  --parent <sidecar-task-id> \
  --agent <General|Explore> \
  --briefing "<task description>"
```

**Required:**
- `--parent`: The task ID of the parent sidecar session
- `--agent`: Subagent type - `General` (full access) or `Explore` (read-only)
- `--briefing`: Task description for the subagent

**Example:**
```bash
sidecar subagent spawn --parent abc123 --agent Explore --briefing "Find all API endpoints in src/"
sidecar subagent spawn --parent abc123 --agent General --briefing "Research authentication patterns"
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

### Via OpenRouter (prefix with `openrouter/`)

| Model | Full Name | Best For |
|-------|-----------|----------|
| Gemini 2.5 Pro | `openrouter/google/gemini-2.5-pro` | Large context (1M), long documents |
| Gemini 2.5 Flash | `openrouter/google/gemini-2.5-flash` | Fast, cost-effective (1M context) |
| GPT-4o | `openrouter/openai/gpt-4o` | General tasks, coding (128K) |
| o3-mini | `openrouter/openai/o3-mini` | Complex reasoning, math (128K) |
| Claude Sonnet 4 | `openrouter/anthropic/claude-sonnet-4` | Balanced performance (200K) |
| DeepSeek Chat | `openrouter/deepseek/deepseek-chat` | Coding, cost-effective (64K) |

### Via Direct API Keys (no prefix)

| Model | Full Name | Required Env Var |
|-------|-----------|------------------|
| Gemini 2.5 Pro | `google/gemini-2.5-pro` | `GEMINI_API_KEY` |
| Gemini 2.5 Flash | `google/gemini-2.5-flash` | `GEMINI_API_KEY` |
| GPT-4o | `openai/gpt-4o` | `OPENAI_API_KEY` |
| o3-mini | `openai/o3-mini` | `OPENAI_API_KEY` |
| Claude Sonnet 4 | `anthropic/claude-sonnet-4` | `ANTHROPIC_API_KEY` |
| DeepSeek Chat | `deepseek/deepseek-chat` | `DEEPSEEK_API_KEY` |

### Interactive Mode Model Picker

In interactive mode, these 6 models are available in the dropdown for quick switching:
- **Google:** Gemini 2.5 Flash, Gemini 2.5 Pro
- **OpenAI:** GPT-4o, o3-mini
- **Anthropic:** Claude Sonnet 4
- **DeepSeek:** DeepSeek Chat

---

## Session ID (Important)

For reliable context passing, provide your session ID:

```bash
sidecar start --session "a1b2c3d4-..." --model ... --briefing ...
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
- **Omit `--session`** or use `--session current`: Uses the most recently modified session file (less reliable if multiple sessions are active)
- **Explicit session ID** (`--session abc123-def456`): Must exist or the command fails immediately with: `Error: --session 'abc123-def456' not found`

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
  --session "abc123-def456" \
  --briefing "## Task Briefing

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

Sidecar uses OpenCode's native agent framework with two distinct categories:

### Primary Agents (for Main Sessions)

These agents are used when starting a sidecar session with `sidecar start`:

#### Plan Agent (Recommended Default)

Read-only mode for analysis and planning without modifying files:
- **read**: Read file contents
- **glob/grep**: Search files
- **list**: Directory listings
- **webfetch**: Fetch web content
- **todowrite/todoread**: Task tracking
- **Disabled**: write, edit, patch, bash (no modifications)

```bash
# RECOMMENDED: Start most sidecars in Plan mode
sidecar start --model gemini-2.5-flash --briefing "Analyze the auth flow" --agent Plan

# This is the safest approach - analyze first, implement later
```

**Use Plan agent when:**
- Reviewing code without making changes
- Investigating bugs or issues
- Creating implementation plans
- Analyzing architecture
- Any task where you're not 100% sure changes are needed

#### Build Agent

Full tool access for implementation work. **Only use when implementation is explicitly requested.**

- **read**: Read file contents
- **write**: Create new files
- **edit**: Modify existing files
- **bash**: Execute shell commands
- **glob/grep**: Search files
- **webfetch**: Fetch web content
- **todowrite/todoread**: Task tracking

```bash
# Only use when user explicitly requests changes:
sidecar start --model gemini-2.5-flash --briefing "Implement the login feature" --agent Build
```

#### Plan Agent

Read-only mode for analysis and planning without modifying files:
- **Enabled**: read, glob, grep, list, webfetch, todowrite, todoread
- **Disabled**: write, edit, patch, bash

```bash
sidecar start --model gemini-2.5-flash --briefing "Review the auth implementation and suggest improvements" --agent Plan
```

**Use Plan agent when:**
- Reviewing code without making changes
- Creating implementation plans
- Analyzing architecture
- Safety-first exploration of unfamiliar code

### Subagents (Spawned Within Sessions)

These agents are spawned from within a sidecar session using `sidecar subagent spawn`:

#### General Subagent

Full-access subagent for research and parallel tasks:
- Same capabilities as Build agent
- Used for spawning parallel work within a session

```bash
sidecar subagent spawn --parent abc123 --agent General --briefing "Research auth patterns"
```

#### Explore Subagent

Read-only subagent for codebase exploration:
- Optimized for searching and understanding code
- Read-only access (no writes, no bash)
- Best for quick codebase questions

```bash
sidecar subagent spawn --parent abc123 --agent Explore --briefing "Find all API endpoints"
```

**Important:** When using `sidecar start`, use **Build** or **Plan**. When using `sidecar subagent spawn`, use **General** or **Explore**. Tool permissions are enforced by OpenCode's native agent framework.

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

### Headless (--headless)

- Runs autonomously, no GUI
- Agent works until done or timeout
- Summary returns automatically

**Use for:** Bulk tasks, test generation, documentation, linting

```bash
sidecar start \
  --model google/gemini-2.5-flash \
  --briefing "Generate unit tests for src/utils/. Use Jest." \
  --headless \
  --timeout 20
```

---

## Async Execution

The sidecar command **blocks** until complete. If the user wants to continue working:

1. They can press **Ctrl+B** to background the task (Claude Code native feature)
2. You continue working on other things
3. When the sidecar folds, the summary appears in your context

**When user backgrounds a sidecar, warn them:**
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

---

## Checking for Existing Sidecars

Before spawning a new sidecar, check if relevant work exists:

```bash
sidecar list
```

If a relevant sidecar exists:
- Read its findings: `sidecar read <id>`
- Reopen it: `sidecar resume <id>`
- Build on it: `sidecar continue <id> --briefing "..."`

**Ask the user** if you're unsure whether to resume or start fresh.

---

## Examples

### Example 1: Interactive Debugging (Plan Mode - Recommended)

```bash
# Start in Plan mode to investigate without making changes
sidecar start \
  --model openrouter/openai/o3-mini \
  --agent Plan \
  --session "$(ls -t ~/.claude/projects/-Users-john-myproject/*.jsonl | head -1 | xargs basename .jsonl)" \
  --briefing "## Debug Memory Leak

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
# Requires: export GEMINI_API_KEY=your-key
sidecar start \
  --model google/gemini-2.5-flash \
  --agent Build \
  --briefing "Generate comprehensive Jest tests for all exported functions
in src/utils/. Include edge cases. Write to tests/utils/." \
  --headless \
  --timeout 15
```

### Example 3: Code Review (Plan Mode)

```bash
# Plan mode is ideal for code review - read-only analysis
sidecar start \
  --model openrouter/google/gemini-2.5-pro \
  --agent Plan \
  --briefing "Review the authentication flow for security issues.
Focus on: token handling, session management, CSRF protection.
Analyze and report findings."
```

### Example 4: Spawn Subagents for Parallel Work

```bash
# First, start a sidecar in Plan mode (recommended default)
sidecar start --model openrouter/google/gemini-2.5-flash --agent Plan --briefing "Debug auth issues"
# Output: Started sidecar with task ID: abc123

# Spawn an Explore subagent for codebase search
sidecar subagent spawn \
  --parent abc123 \
  --agent Explore \
  --briefing "Find all database queries and list which files they're in"

# Spawn a General subagent for parallel research
sidecar subagent spawn \
  --parent abc123 \
  --agent General \
  --briefing "Research best practices for JWT token refresh"

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
  --model openrouter/openai/gpt-4o \
  --briefing "Implement the fix recommended in the previous session.
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

**"Error: --briefing cannot be empty or whitespace-only"**

The briefing must contain actual content:
```bash
# Wrong
sidecar start --model openrouter/google/gemini-2.5-flash --briefing ""
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "   "

# Right
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "Debug the auth issue in TokenManager.ts"
```

**"Error: --session '<id>' not found"**

The explicit session ID doesn't exist. Either:
1. Use `sidecar list` to find valid session IDs
2. Omit `--session` to use the most recent session
3. Use `--session current` for automatic resolution

```bash
# Find valid sessions
sidecar list

# Use most recent session
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "Task"
```

**"Error: --project path does not exist"**

The specified project directory doesn't exist:
```bash
# Wrong
sidecar start --model ... --briefing "..." --project /nonexistent/path

# Right - use current directory
sidecar start --model ... --briefing "..." --project .

# Right - use full path
sidecar start --model ... --briefing "..." --project /Users/john/myproject
```

**"Error: --agent cannot be empty"**

The agent name cannot be empty. Use an OpenCode native agent or a custom agent:
```bash
# Wrong - empty agent
sidecar start --model ... --briefing "..." --agent ""

# Right - use OpenCode native agent
sidecar start --model ... --briefing "..." --agent Explore

# Right - use custom agent (defined in ~/.config/opencode/agents/)
sidecar start --model ... --briefing "..." --agent MyCustomAgent
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
sidecar start --model openrouter/google/gemini-2.5-flash --briefing "Task"
```

---

## Quick Start Checklist

1. [ ] Install sidecar: `npm install -g claude-sidecar`
2. [ ] Configure API access (choose one):
   - [ ] OpenRouter: Create `~/.local/share/opencode/auth.json` with your key
   - [ ] Direct API: Set environment variable (`GEMINI_API_KEY`, etc.)
3. [ ] Test sidecar: `sidecar start --model <your-model> --briefing "Hello" --headless`
