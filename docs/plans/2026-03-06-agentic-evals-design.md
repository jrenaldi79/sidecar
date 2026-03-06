# Design: Agentic Eval System for Sidecar

**Date:** 2026-03-06
**Status:** Approved
**Problem:** No tests verify that an LLM can actually use sidecar correctly: choosing the right model, agent mode, writing good briefings, and acting on results. Current tests mock everything.

## Overview

Agentic evals that spawn real Claude Code with the sidecar MCP server connected, run tasks in isolated sandbox projects, and grade both tool usage correctness and decision-making quality.

## Directory Structure

```
evals/
├── eval_tasks.json           # Task definitions (scenarios + criteria)
├── run_eval.js               # Orchestrator (spawn Claude, parse, evaluate)
├── claude_runner.js           # Claude Code process management
├── transcript_parser.js       # Parse stream-json output
├── evaluator.js               # Programmatic checks + LLM-as-judge
├── result_writer.js           # Write results to workspace
├── fixtures/                  # Seed projects per eval scenario
│   ├── buggy-auth-app/       # Small Node app with auth bug
│   ├── todo-api/             # Express API missing tests
│   └── research-task/        # Empty project for web research
└── workspace/                 # Output (gitignored)
    └── eval-{id}-{timestamp}/
        ├── sandbox/          # Copy of fixture + sidecar's changes
        ├── transcript.jsonl  # Raw Claude stream-json
        ├── transcript.md     # Human-readable
        └── result.json       # Scores + criteria results
```

## Eval Task Format

```json
{
  "id": 1,
  "name": "Debug Auth Bug",
  "description": "Claude should use sidecar to find and fix a known auth bug",
  "fixture": "buggy-auth-app",
  "prompt": "There's a bug in this project's auth flow causing intermittent 401 errors. Use sidecar to have a different model analyze the auth code and suggest a fix. Then apply the fix.",
  "max_turns": 30,
  "max_budget_usd": 2.0,
  "model": "sonnet",
  "success_criteria": {
    "programmatic": [
      {"type": "tool_called", "tool": "sidecar_start"},
      {"type": "tool_param", "tool": "sidecar_start", "param": "agent", "expected": "Build"},
      {"type": "tool_called", "tool": "sidecar_read"},
      {"type": "file_changed", "path": "src/auth.js"},
      {"type": "file_contains", "path": "src/auth.js", "pattern": "await.*refresh"}
    ],
    "llm_judge": {
      "rubric": [
        "Did the LLM choose an appropriate model for code analysis? (1-5)",
        "Was the briefing detailed enough? (1-5)",
        "Did the LLM act on the sidecar's findings? (1-5)",
        "Did the LLM choose the right agent mode? (1-5)"
      ],
      "pass_threshold": 3.5
    }
  }
}
```

### Programmatic Criterion Types

| Type | Description |
|------|-------------|
| `tool_called` | Was this MCP tool invoked? |
| `tool_param` | Did a tool call include this param with this value? |
| `tool_param_matches` | Regex match on a param value |
| `file_changed` | Did this file in the sandbox get modified? |
| `file_contains` | Does the file contain this pattern after the run? |
| `file_created` | Was a new file created? |
| `no_errors` | No tool call errors in transcript |

### LLM-as-Judge

After programmatic checks pass, feed the transcript + rubric to claude-haiku-4-5. Returns numeric scores per rubric item. Average must meet pass_threshold. Programmatic gates first to save cost on obvious failures.

## Execution Flow

```
run_eval.js --eval-id 1
  1. Load task from eval_tasks.json
  2. Create sandbox: copy fixtures/{fixture}/ to /tmp/sidecar-eval-{id}-{ts}/sandbox/
  3. Build Claude Code command:
     claude --output-format stream-json --verbose \
       --mcp-config <sidecar-mcp-config> \
       --max-turns {max_turns} --model {model} \
       --cwd <sandbox> --print "{prompt}"
  4. Spawn process, capture stream-json lines (5 min timeout)
  5. Parse transcript: tool calls, params, results, errors, tokens
  6. Run programmatic checks against transcript + sandbox filesystem
  7. If programmatic pass: run LLM-as-judge with transcript + rubric
  8. Write results: transcript.jsonl, transcript.md, result.json
  9. Print summary with scores, tokens, duration
```

### CLI Interface

```bash
node evals/run_eval.js --eval-id 1       # Single eval
node evals/run_eval.js --all             # All evals
node evals/run_eval.js --all --dry-run   # Print commands only
node evals/run_eval.js --eval-id 1 --model opus  # Override model
```

## Initial Eval Scenarios

### Eval 1: Debug Auth Bug (file read/write, code analysis)
- **Fixture:** `buggy-auth-app/` -- Small Express app with token refresh race condition
- **Task:** Find and fix the auth bug using sidecar with a different model
- **Tests:** File read, file write, code reasoning, model selection

### Eval 2: Generate Tests for API (file creation, multi-file analysis)
- **Fixture:** `todo-api/` -- Express CRUD API with no tests
- **Task:** Use sidecar to have another model generate comprehensive tests
- **Tests:** Multi-file read, file creation, headless mode selection

### Eval 3: Research and Document (web search, file creation)
- **Fixture:** `research-task/` -- Empty project with README stub
- **Task:** Use sidecar to research JWT token rotation best practices, create design doc
- **Tests:** Web search capability, file creation, research model selection

## Result Format

### Per-eval result.json

```json
{
  "eval_id": 1,
  "eval_name": "Debug Auth Bug",
  "status": "PASS",
  "score": 0.85,
  "duration_seconds": 92,
  "token_usage": {
    "claude": {"input_tokens": 12500, "output_tokens": 3200},
    "sidecar": {"model": "gemini-2.5-flash", "input_tokens": 45000, "output_tokens": 8100}
  },
  "programmatic_results": [
    {"type": "tool_called", "tool": "sidecar_start", "passed": true, "detail": "Called at turn 3"},
    {"type": "file_changed", "path": "src/auth.js", "passed": true, "detail": "Modified at turn 18"}
  ],
  "judge_results": {
    "scores": [
      {"rubric": "Appropriate model choice", "score": 4},
      {"rubric": "Briefing quality", "score": 3},
      {"rubric": "Acted on findings", "score": 5},
      {"rubric": "Agent mode selection", "score": 4}
    ],
    "average": 4.0,
    "pass_threshold": 3.5,
    "passed": true
  },
  "sidecar_calls": [
    {"tool": "sidecar_start", "turn": 3, "params": {"model": "gemini", "agent": "Build"}},
    {"tool": "sidecar_status", "turn": 8, "params": {"taskId": "abc123"}},
    {"tool": "sidecar_read", "turn": 12, "params": {"taskId": "abc123"}}
  ]
}
```

### Summary Output

```
Sidecar Eval Results
====================
Eval 1: Debug Auth Bug         PASS  0.85  (92s, 15.7k tok, $0.12)
  Sidecar: gemini-2.5-flash, agent=Build, 45k tok
Eval 2: Generate Tests         PASS  0.90  (145s, 22.1k tok, $0.18)
  Sidecar: gemini-2.5-pro, agent=Build, 62k tok
Eval 3: Research & Document    FAIL  0.60  (78s, 11.3k tok, $0.09)
  Sidecar: opus, agent=Chat, 28k tok

Overall: 2/3 passed, avg score: 0.78, total: 49.1k tok, $0.39
```

### Pass/Fail Logic

An eval passes when ALL programmatic checks pass AND LLM-as-judge average meets threshold. Programmatic gates run first; if they fail, judge is skipped (saves cost).

## Sandbox Isolation

Each eval creates `/tmp/sidecar-eval-{id}-{ts}/sandbox/` by copying the fixture. Claude Code runs with `--cwd` pointed there. The sidecar MCP server's project directory resolves to the sandbox. No sidecar source files are at risk.

## Requirements

- Claude Code CLI installed
- Anthropic API key (for Claude + LLM-as-judge)
- OpenRouter API key (for sidecar model calls)
- Node.js 18+
