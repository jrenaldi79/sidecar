# Claude Sidecar

> Multi-model subagent tool for Claude Code — spawn parallel conversations with Gemini, GPT-4, o3, and fold results back.

## What is this?

Sidecar extends Claude Code with the ability to delegate tasks to other LLMs. Think of it as "fork & fold" for AI conversations:

1. **Fork**: Spawn a sidecar with a different model (Gemini, GPT-4, o3, etc.)
2. **Work**: The sidecar investigates independently (interactive or headless)
3. **Fold**: Results summarize back into your Claude Code context

## Why?

- **Use the right model for the job**: Gemini for large context, o3 for reasoning, GPT-4 for specific tasks
- **Keep context clean**: Deep explorations stay in the sidecar, only the summary returns
- **Work in parallel**: Background sidecars while you continue with Claude Code

## Installation

```bash
npm install -g claude-sidecar
```

### Prerequisites

- Node.js 18+
- [OpenCode CLI](https://opencode.ai) (`npm install -g opencode-ai`) — the engine that powers sidecars

### Configure API Access

Choose one of these options:

**Option A: OpenRouter (recommended for multi-model access)**

```bash
# Interactive setup
npx opencode-ai
# In the OpenCode UI, type: /connect
# Select "OpenRouter" and paste your API key

# Or create auth file directly
mkdir -p ~/.local/share/opencode
echo '{"openrouter": {"apiKey": "sk-or-v1-YOUR_KEY"}}' > ~/.local/share/opencode/auth.json
```

**Option B: Direct API keys**

```bash
export GEMINI_API_KEY=your-google-api-key    # For Google models
export OPENAI_API_KEY=your-openai-api-key    # For OpenAI models
export ANTHROPIC_API_KEY=your-anthropic-key  # For Anthropic models
```

### Configure Model Defaults

```bash
sidecar setup
```

The setup wizard configures your default model and 21+ short aliases. After setup:
- `sidecar start --prompt "..."` uses your default model
- `sidecar start --model opus --prompt "..."` uses an alias
- Full model strings still work

Add custom aliases anytime:
```bash
sidecar setup --add-alias fast=openrouter/google/gemini-3-flash-preview
```

## Quick Start

```bash
# First time: run setup to configure your default model
sidecar setup

# Start a sidecar (uses your default model)
sidecar start --prompt "Debug the auth race condition in TokenManager.ts"

# Use a specific model alias
sidecar start --model opus --prompt "Deep analysis of the caching layer"

# Headless (autonomous) mode
sidecar start --model gemini --prompt "Generate Jest tests for src/utils/" --no-ui

# Full model strings still work
sidecar start --model openrouter/google/gemini-3-flash-preview --prompt "..."
```

## Model Naming

After running `sidecar setup`, you can use short aliases instead of full model strings:

| Alias | Model |
|-------|-------|
| `gemini` | Gemini 3 Flash (default) |
| `opus` | Claude Opus 4.6 |
| `gpt` | OpenAI GPT-5.2 |
| `deepseek` | DeepSeek v3.2 |
| ...and 17 more | See `~/.config/sidecar/config.json` |

Full model strings continue to work as before:

The model name format determines which authentication is used:

| Access Method | Model Format | Example |
|---------------|--------------|---------|
| OpenRouter | `openrouter/provider/model` | `openrouter/google/gemini-2.5-flash` |
| Direct Google API | `google/model` | `google/gemini-2.5-flash` |
| Direct OpenAI API | `openai/model` | `openai/gpt-4o` |
| Direct Anthropic API | `anthropic/model` | `anthropic/claude-sonnet-4` |

## Commands

| Command | Description |
|---------|-------------|
| `sidecar setup` | Configure default model and aliases |
| `sidecar start` | Launch a new sidecar |
| `sidecar list` | Show previous sidecars |
| `sidecar resume <id>` | Reopen a previous sidecar |
| `sidecar continue <id>` | New sidecar building on previous |
| `sidecar read <id>` | Output sidecar summary/conversation |
| `sidecar mcp` | Start MCP server (stdio transport) |

## Integration

### Claude Code (CLI + Skill)

On install, a **Skill** is automatically added to `~/.claude/skills/sidecar/`. This teaches Claude Code when and how to use sidecars. Claude Code will automatically know how to use sidecars after installation.

### Claude Cowork / Claude Desktop (MCP)

On install, an **MCP server** is auto-registered in both Claude Code and Claude Desktop configs. This provides sidecar tools directly inside Cowork's sandboxed environment:

| MCP Tool | Description |
|----------|-------------|
| `sidecar_start` | Spawn a sidecar (returns task ID immediately) |
| `sidecar_status` | Poll for completion |
| `sidecar_read` | Get results (summary, conversation, or metadata) |
| `sidecar_list` | List sessions |
| `sidecar_resume` | Reopen a session |
| `sidecar_continue` | New session building on previous |
| `sidecar_setup` | Open setup wizard |
| `sidecar_guide` | Get usage instructions |

MCP tools use the async pattern: `sidecar_start` returns a task ID immediately, then poll with `sidecar_status` and read with `sidecar_read`.

To manually register the MCP server:
```bash
claude mcp add-json sidecar '{"command":"sidecar","args":["mcp"]}' --scope user
```

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Claude Code   │────▶│   Sidecar CLI   │────▶│    OpenCode     │
│                 │     │                 │     │   (Gemini/GPT)  │
│  "Debug this"   │     │ • Parse context │     │                 │
│                 │     │ • Build prompt  │     │  [Interactive   │
│                 │◀────│ • Return summary│◀────│   or Headless]  │
│  [Has summary]  │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. Claude Code invokes `sidecar start` with a briefing
2. Sidecar CLI extracts context from Claude Code's conversation
3. Opens OpenCode with the specified model
4. User works interactively (or headless runs autonomously)
5. On "Fold", summary is generated and returned via stdout
6. Claude Code receives the summary and can act on it

## Models Supported

### Via OpenRouter (prefix with `openrouter/`)

| Model | Name | Best For |
|-------|------|----------|
| Gemini 2.5 Pro | `openrouter/google/gemini-2.5-pro` | Large context |
| Gemini 2.5 Flash | `openrouter/google/gemini-2.5-flash` | Fast, cost-effective |
| GPT-4o | `openrouter/openai/gpt-4o` | General purpose |
| o3 | `openrouter/openai/o3` | Complex reasoning |
| Claude Sonnet 4 | `openrouter/anthropic/claude-sonnet-4` | Balanced |

### Via Direct API Keys (no prefix)

| Model | Name | Required Env Var |
|-------|------|------------------|
| Gemini 2.5 Pro | `google/gemini-2.5-pro` | `GEMINI_API_KEY` |
| Gemini 2.5 Flash | `google/gemini-2.5-flash` | `GEMINI_API_KEY` |
| GPT-4o | `openai/gpt-4o` | `OPENAI_API_KEY` |
| o3 | `openai/o3` | `OPENAI_API_KEY` |
| Claude Sonnet 4 | `anthropic/claude-sonnet-4` | `ANTHROPIC_API_KEY` |

## Features

- **Interactive mode**: GUI window, human-in-the-loop
- **Headless mode**: Autonomous execution with timeout (defaults to `build` agent; `chat` agent is interactive-only)
- **Context passing**: Automatically pulls from Claude Code conversation
- **Session persistence**: Resume or continue past sidecars
- **Conflict detection**: Warns when files change during async execution
- **Drift awareness**: Indicates when context may be stale

## Documentation

See [SKILL.md](./skill/SKILL.md) for complete usage instructions.

## License

MIT
