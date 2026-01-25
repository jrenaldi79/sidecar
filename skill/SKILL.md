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
- OpenCode CLI (`npm install -g opencode`)
- Electron (installed automatically as dependency)

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

---

## Models Available

| Model | Provider | Best For |
|-------|----------|----------|
| `google/gemini-2.5-pro` | Google | Large context, long documents |
| `google/gemini-2.5-flash` | Google | Fast, cost-effective |
| `openai/o3` | OpenAI | Complex reasoning, math |
| `openai/gpt-4.1` | OpenAI | General tasks, coding |
| `anthropic/claude-sonnet-4` | Anthropic | Balanced performance |

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

The encoded path replaces `/` with `-`. For example:
- Project: `/Users/john/myproject`
- Encoded: `-Users-john-myproject`
- Full path: `~/.claude/projects/-Users-john-myproject/`

List session files to find yours:
```bash
ls -lt ~/.claude/projects/-Users-john-myproject/*.jsonl | head -5
```

The most recently modified file is likely your current session. Extract the UUID from the filename.

**If you cannot determine your session ID:** Omit `--session` and the sidecar will use the most recently modified file (less reliable if multiple sessions are active).

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
  --model google/gemini-2.5-pro \
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

## Interactive vs Headless

### Interactive (Default)

- Opens a GUI window
- User can converse with the sidecar
- Click **FOLD** when done to generate summary
- Summary returns to your context via stdout

**Use for:** Debugging, exploration, architectural discussions

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

### Example 1: Interactive Debugging

```bash
sidecar start \
  --model openai/o3 \
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

### Example 2: Headless Test Generation

```bash
sidecar start \
  --model google/gemini-2.5-flash \
  --briefing "Generate comprehensive Jest tests for all exported functions 
in src/utils/. Include edge cases. Write to tests/utils/." \
  --headless \
  --timeout 15
```

### Example 3: Continue Previous Work

```bash
# First, check what exists
sidecar list

# Read what was found
sidecar read abc123

# Continue with a follow-up task
sidecar continue abc123 \
  --model openai/gpt-4.1 \
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

Find the correct encoded path for your project.

### "Multiple active sessions detected"

You have multiple Claude Code windows. Pass `--session` explicitly:
```bash
ls -lt ~/.claude/projects/[your-path]/*.jsonl | head -3
# Pick the correct session UUID
```

### Sidecar window doesn't open

Check OpenCode is installed:
```bash
opencode --version
```

If not: `npm install -g opencode`

### Summary is corrupted

Debug output may be leaking to stdout. Check for console.log statements if you've modified the sidecar code.
