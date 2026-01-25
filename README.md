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
- [OpenCode CLI](https://opencode.ai) — the engine that powers sidecars
- API keys configured for your chosen models

## Quick Start

```bash
# Interactive sidecar with Gemini
sidecar start \
  --model google/gemini-2.5-pro \
  --briefing "Debug the auth race condition in TokenManager.ts"

# Headless (autonomous) test generation
sidecar start \
  --model google/gemini-2.5-flash \
  --briefing "Generate Jest tests for src/utils/" \
  --headless
```

## Commands

| Command | Description |
|---------|-------------|
| `sidecar start` | Launch a new sidecar |
| `sidecar list` | Show previous sidecars |
| `sidecar resume <id>` | Reopen a previous sidecar |
| `sidecar continue <id>` | New sidecar building on previous |
| `sidecar read <id>` | Output sidecar summary/conversation |

## Claude Code Integration

On install, a **Skill** is automatically added to `~/.claude/skills/sidecar/`. This teaches Claude Code:

- When to spawn sidecars
- How to write effective briefings
- How to pass session context
- How to act on sidecar results

Claude Code will automatically know how to use sidecars after installation.

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

Any model supported by OpenCode:

- `google/gemini-2.5-pro` — Large context window
- `google/gemini-2.5-flash` — Fast and cost-effective
- `openai/o3` — Complex reasoning
- `openai/gpt-4.1` — General purpose
- `anthropic/claude-sonnet-4` — Balanced
- And [75+ more](https://opencode.ai/docs/models)

## Features

- **Interactive mode**: GUI window, human-in-the-loop
- **Headless mode**: Autonomous execution with timeout
- **Context passing**: Automatically pulls from Claude Code conversation
- **Session persistence**: Resume or continue past sidecars
- **Conflict detection**: Warns when files change during async execution
- **Drift awareness**: Indicates when context may be stale

## Documentation

See [SKILL.md](./skill/SKILL.md) for complete usage instructions.

## License

MIT
