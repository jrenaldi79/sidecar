# Product Specification: Claude Sidecar System v2.6

**Version:** 2.6  
**Status:** Draft  
**Core Concept:** "Fork & Fold" Subagent Workflow  
**Target Architecture:** Claude Code (CLI) + OpenCode (Engine) + Electron Shell

---

## 1. Executive Summary

The Claude Sidecar is a **subagent tool** that extends Claude Code's capabilities. It spawns a separate conversation with a different model (Gemini, GPT-4, etc.) and returns a summary when complete.

### Core Principle: Simple Blocking CLI

```
Claude Code runs command → Sidecar runs → Summary returns via stdout
```

- **Blocking by default** — Claude Code waits for completion
- **Async via Ctrl+B** — User can background it using Claude Code's native async
- **Summary via stdout** — No files, no clipboard, just clean output
- **Conflict aware** — Warns when sidecar and main session touch same files
- **Drift aware** — Indicates when context may be stale

### Operation Modes

| Mode | Trigger | User Interaction | Completion |
|------|---------|------------------|------------|
| **Interactive** | Default | GUI window, human conversation | User clicks Fold |
| **Headless** | `--headless` flag | None | Agent decides done (or timeout) |

### What We Build vs What Claude Code Provides

| Capability | Provider |
|------------|----------|
| Spawn sidecar with different model | **Sidecar CLI** |
| Pass context from Claude Code session | **Sidecar CLI** |
| Interactive GUI window | **Sidecar CLI + Electron** |
| Headless autonomous execution | **Sidecar CLI + OpenCode** |
| Summary generation | **OpenCode LLM** |
| Blocking execution with heartbeat | **Sidecar CLI** |
| Async/background execution | **Claude Code native (Ctrl+B)** |
| Resume/continue past sessions | **Sidecar CLI** |
| File conflict detection | **Sidecar CLI** |
| Context drift warnings | **Sidecar CLI** |

---

## 2. User Experience

### 2.1 Interactive Mode (Default)

```
User: "Spawn a sidecar with Gemini to help debug this auth issue"

Claude Code: I'll spawn a sidecar with Gemini to investigate.

> sidecar start --model google/gemini-2.5 --briefing "Debug the auth 
  race condition. Focus on TokenManager.ts. User reports sporadic 
  401 errors on mobile."

[Sidecar window opens]
[User has full conversation with Gemini]
[User clicks FOLD when done]

## Sidecar Results: Auth Race Condition Found

**Task:** Debug authentication race condition

**Findings:**
- Race condition in TokenManager.ts line 52
- The `isRefreshing` boolean check is not atomic
- Two simultaneous requests can both pass the check

**Recommended Fix:**
Use a mutex or promise-based lock:
```typescript
private refreshPromise: Promise<void> | null = null;

async refreshToken() {
  if (this.refreshPromise) return this.refreshPromise;
  this.refreshPromise = this._doRefresh();
  await this.refreshPromise;
  this.refreshPromise = null;
}
```

**Files to Modify:**
- src/auth/TokenManager.ts (lines 45-67)

Claude Code: I see the sidecar found a race condition. The fix is to use 
a promise-based lock instead of a boolean flag. Want me to implement this?
```

### 2.2 Headless Mode (YOLO)

```
User: "Run a headless sidecar to generate unit tests for src/utils/"

Claude Code: I'll spawn a headless sidecar to generate the tests.

> sidecar start --model google/gemini-2.5 --headless --briefing 
  "Generate comprehensive unit tests for all files in src/utils/. 
  Write tests to tests/utils/. Use Jest. Aim for 80% coverage."

.......................................

## Sidecar Results: Unit Tests Generated

**Task:** Generate unit tests for src/utils/

**Actions Taken:**
- Analyzed 8 files in src/utils/
- Generated Jest test suites for all public functions
- Created test fixtures for complex inputs

**Files Created:**
- tests/utils/validation.test.ts (18 tests)
- tests/utils/formatting.test.ts (12 tests)
- tests/utils/api-helpers.test.ts (15 tests)
- tests/utils/fixtures/mock-data.ts

**Test Results:**
All 45 tests passing. Estimated coverage: 82%

**Notes:**
- Skipped private helper functions
- Added edge case tests for date parsing

Claude Code: The sidecar generated 45 tests across 3 test files. All 
passing with 82% coverage. Want me to review any of the test files?
```

### 2.3 Async Mode (User Backgrounds)

```
User: "Spawn a sidecar with Gemini for deep research on this codebase"

Claude Code: I'll spawn a sidecar for research.

> sidecar start --model google/gemini-2.5 --briefing "..."

[Sidecar starts, shows heartbeat]
.....

User: [Presses Ctrl+B to background]

Claude Code: Sidecar backgrounded. I'll continue working. You can 
interact with the sidecar window, and I'll receive the results when 
you fold.

User: "While that runs, can you review the API routes?"

Claude Code: Sure, let me look at the routes...

[Later, user clicks Fold in sidecar window]

[Summary appears in Claude Code context automatically]

Claude Code: The sidecar research completed. Key findings: ...
```

---

## 3. System Architecture

### 3.1 Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE                                  │
│                                                                      │
│  > sidecar start --model X --briefing "..." [--headless]            │
│                                                                      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SIDECAR CLI                                  │
│                                                                      │
│  1. Parse arguments                                                  │
│  2. Resolve Claude Code session → read JSONL                        │
│  3. Filter context (turns/tokens/time)                              │
│  4. Build system prompt (briefing + context)                        │
│  5. Spawn OpenCode (GUI or headless)                                │
│  6. Output heartbeat to stdout while waiting                        │
│  7. Wait for completion signal                                       │
│  8. Output summary to stdout                                        │
│  9. Exit                                                            │
│                                                                      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
                ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────────┐
│     INTERACTIVE MODE      │   │         HEADLESS MODE             │
│                           │   │                                   │
│  Electron Window          │   │  OpenCode CLI                     │
│  - OpenCode web UI        │   │  - Runs autonomously              │
│  - User converses         │   │  - No user interaction            │
│  - FOLD button            │   │  - Self-terminates when done      │
│                           │   │  - Or timeout (default 15min)     │
│  [Fold clicked]           │   │  [Agent outputs completion]       │
│       │                   │   │       │                           │
│       ▼                   │   │       ▼                           │
│  Agent generates          │   │  Agent generates                  │
│  summary                  │   │  summary                          │
│       │                   │   │       │                           │
└───────┼───────────────────┘   └───────┼───────────────────────────┘
        │                               │
        └───────────────┬───────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SIDECAR CLI                                  │
│                                                                      │
│  Receives summary → prints to stdout → exits                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE                                  │
│                                                                      │
│  Summary appears in context. Claude can act on findings.            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Responsibilities

| Component | Responsibilities |
|-----------|------------------|
| **Claude Code** | Invoke sidecar, provide briefing, receive summary |
| **Sidecar CLI** | Context parsing, process management, heartbeat, stdout |
| **Electron Shell** | GUI wrapper, Fold button, conversation capture |
| **OpenCode** | LLM conversation, file access, summary generation |

---

## 4. CLI Interface

### 4.1 Command: `sidecar start`

```bash
sidecar start [OPTIONS]
```

**Required:**

| Option | Description |
|--------|-------------|
| `--model <provider/model>` | Model for sidecar (e.g., `google/gemini-2.5`) |
| `--briefing <text>` | Task briefing from Claude Code |

**Context Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--session <id\|"current">` | `current` | Session ID to pull context from. Pass explicit UUID for reliability, or `current` to use most recent. |
| `--project <path>` | cwd | Project directory |
| `--context-turns <N>` | 50 | Max conversation turns to include |
| `--context-since <duration>` | — | Time filter (e.g., "2h"). Overrides turns. |
| `--context-max-tokens <N>` | 80000 | Hard cap on context tokens |

**Mode Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--headless` | false | Run without GUI (autonomous) |
| `--timeout <minutes>` | 15 | Hard timeout for headless mode |

**Examples:**

```bash
# Interactive with Gemini
sidecar start \
  --model google/gemini-2.5 \
  --briefing "Debug the auth race condition"

# Headless test generation
sidecar start \
  --model google/gemini-2.5 \
  --briefing "Generate unit tests for src/utils/" \
  --headless \
  --timeout 20

# With context filtering
sidecar start \
  --model openai/o3 \
  --briefing "Review architecture decisions" \
  --context-turns 100 \
  --context-max-tokens 120000
```

### 4.2 Command: `sidecar list`

```bash
sidecar list [--all] [--status <filter>]
```

Lists previous sidecar sessions for the project.

```
ID        MODEL               STATUS    AGE       NAME
abc123    google/gemini-2.5   complete  2h ago    Debug auth
def456    openai/o3           complete  1d ago    Code review
```

### 4.3 Command: `sidecar resume`

```bash
sidecar resume <task_id>
```

Reopens a previous session with full conversation history. Blocks until Fold, outputs summary to stdout.

### 4.4 Command: `sidecar continue`

```bash
sidecar continue <task_id> --briefing "Follow up task..."
```

Starts a NEW sidecar that includes the previous sidecar's conversation as additional context.

### 4.5 Command: `sidecar read`

```bash
sidecar read <task_id> [--summary|--conversation]
```

Outputs previous session data to stdout (for inspection/debugging).

---

## 5. Context Passing

### 5.1 Session Resolution (Primary + Fallback)

The sidecar needs to find the correct Claude Code conversation to pull context from.

**Primary: Explicit Session ID**

Claude Code passes its session ID directly:

```bash
sidecar start \
  --model google/gemini-2.5 \
  --briefing "Debug auth issue" \
  --session "a]bc123-def456-789..."
```

The sidecar then reads:
```
~/.claude/projects/[encoded-path]/[session-id].jsonl
```

**Fallback: Most Recent File**

If `--session` is not provided (or set to `current`), the sidecar finds the most recently modified `.jsonl` file:

```javascript
function resolveSession(projectDir, sessionArg) {
  // Primary: explicit session ID
  if (sessionArg && sessionArg !== 'current') {
    const sessionPath = path.join(projectDir, `${sessionArg}.jsonl`);
    if (fs.existsSync(sessionPath)) {
      return sessionPath;
    }
    console.error(`Warning: Session ${sessionArg} not found, falling back to most recent`);
  }
  
  // Fallback: most recently modified
  const sessions = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      path: path.join(projectDir, f),
      mtime: fs.statSync(path.join(projectDir, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  if (sessions.length === 0) {
    return null;
  }
  
  // Warn if multiple recent sessions (potential ambiguity)
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const recentSessions = sessions.filter(s => s.mtime > fiveMinutesAgo);
  if (recentSessions.length > 1) {
    console.error(`Warning: Multiple active sessions detected. Using most recent. ` +
      `For accuracy, pass --session <id> explicitly.`);
  }
  
  return sessions[0].path;
}
```

**Why This Design:**

| Approach | Reliability | Requires |
|----------|-------------|----------|
| Explicit `--session` | ✅ Deterministic | Claude Code to know its session ID |
| Most recent mtime | ⚠️ Heuristic | Nothing (works automatically) |

Claude Code can discover its session ID by examining `~/.claude/projects/` or from its internal state. The CLAUDE.md instructions tell it to pass this when possible.

### 5.2 Claude Code Conversation Storage

Location: `~/.claude/projects/[encoded-path]/[session-uuid].jsonl`

**Path Encoding:**
```
/Users/john/myproject → -Users-john-myproject
```

**Example:**
```
~/.claude/projects/-Users-john-myproject/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl
```

### 5.3 Context Filtering Algorithm

```javascript
function filterContext(sessionPath, { turns, since, maxTokens }) {
  let lines = readJSONL(sessionPath);
  
  // Time filter (if specified)
  if (since) {
    const cutoff = Date.now() - parseDuration(since);
    lines = lines.filter(l => new Date(l.timestamp) >= cutoff);
  }
  // Turn filter (otherwise)
  else if (turns) {
    lines = takeLastNTurns(lines, turns);
  }
  
  // Format as readable text
  let context = formatAsReadable(lines);
  
  // Truncate to token limit
  if (estimateTokens(context) > maxTokens) {
    context = truncateFromStart(context, maxTokens);
  }
  
  return context;
}
```

### 5.3 Context Format

```
## CONVERSATION CONTEXT (from Claude Code session)

[User @ 10:30] Can you look at the auth service?
[Assistant @ 10:31] I'll examine the authentication flow...
[Tool: Read src/auth/TokenManager.ts]
[Assistant @ 10:32] I see a potential race condition...
```

---

## 6. The Fold Mechanism

### 6.1 Interactive Mode

When user clicks **[FOLD]**:

1. Sidecar injects summary prompt into OpenCode
2. OpenCode generates structured summary
3. Summary sent back to Sidecar CLI via IPC
4. Sidecar CLI prints summary to stdout
5. Window closes
6. CLI exits

**Summary Prompt (injected on Fold):**

```
Generate a handoff summary of our conversation. Format as:

## Sidecar Results: [Brief Title]

**Task:** [What was requested]

**Findings:**
[Key discoveries, root causes, insights]

**Attempted Approaches:**
[What was tried that didn't work, and why — this is valuable to prevent 
the main session from repeating failed attempts]

**Recommendations:**
[Suggested actions, fixes, next steps]

**Code Changes:** (if applicable)
```typescript
// Specific code with file paths
```

**Files Modified/Created:** (if applicable)
- path/to/file.ts (description)

**Assumptions Made:**
[Things you assumed to be true that should be verified]

**Open Questions:** (if any)
[Things still unclear]

Be concise but complete enough to act on immediately.
```

### 6.2 Headless Mode

Agent is instructed to self-terminate and output summary:

**System Prompt Addition:**

```
## HEADLESS MODE

You are running autonomously. When your task is complete:

1. Write your summary in the format below
2. End with the marker: [SIDECAR_COMPLETE]

Do not ask questions. Make reasonable assumptions and document them.

If you get stuck, document the blocker and output [SIDECAR_COMPLETE].

## Summary Format
[Same format as interactive]
```

**Timeout Handling:**

- Default: 15 minutes
- At timeout: Force inject summary prompt, wait 30s, then kill
- Partial results still output to stdout

---

## 7. Conflict & Drift Awareness

### 7.1 The Problem

When sidecars run asynchronously (user presses Ctrl+B), two risks emerge:

| Risk | Scenario |
|------|----------|
| **File Conflict** | Sidecar modifies `auth.ts`. User also edits `auth.ts` in main session. Sidecar's changes overwrite user's. |
| **Context Drift** | Sidecar starts at T=0 with snapshot of codebase. User continues working. By T=10, sidecar's context is stale. |

### 7.2 File Conflict Detection

The sidecar tracks which files it reads and writes. On fold, it compares against files modified in the main session.

**Detection Logic:**

```javascript
function detectConflicts(sidecarFiles, projectDir, sessionStartTime) {
  const conflicts = [];
  
  for (const file of sidecarFiles.written) {
    const filePath = path.join(projectDir, file);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      // File was modified after sidecar started (by someone else)
      if (stat.mtime > sessionStartTime) {
        conflicts.push({
          file,
          sidecarAction: 'write',
          externalMtime: stat.mtime
        });
      }
    }
  }
  
  return conflicts;
}
```

**Conflict Warning in Summary:**

```markdown
## Sidecar Results: Auth Refactor

⚠️ **FILE CONFLICT WARNING**
The following files were modified by both this sidecar AND externally:
- src/auth/TokenManager.ts (external change: 5 min ago)
- src/api/client.ts (external change: 2 min ago)

**Review these changes carefully before accepting.**

**Findings:** ...
```

### 7.3 Context Drift Indicator

Every fold summary includes a staleness indicator:

```markdown
## Sidecar Results: Auth Fix

📍 **Context Age:** 23 minutes (15 conversation turns in main session)

[If significant drift detected:]
⚠️ **Drift Warning:** Main session has continued significantly since this 
sidecar started. Verify recommendations against current project state.

**Findings:** ...
```

**Drift Calculation:**

```javascript
function calculateDrift(sessionStartTime, mainSessionPath) {
  const ageMinutes = (Date.now() - sessionStartTime) / 60000;
  
  // Count turns in main session since sidecar started
  const mainTurns = countTurnsSince(mainSessionPath, sessionStartTime);
  
  return {
    ageMinutes: Math.round(ageMinutes),
    mainTurns,
    isSignificant: ageMinutes > 10 || mainTurns > 5
  };
}
```

### 7.4 Metadata Tracking

The sidecar tracks file interactions for conflict detection:

**metadata.json (extended):**

```json
{
  "taskId": "abc123",
  "model": "google/gemini-2.5",
  "project": "/path/to/project",
  "status": "complete",
  "createdAt": "2025-01-25T10:30:00Z",
  "completedAt": "2025-01-25T11:45:00Z",
  "filesRead": [
    "src/auth/TokenManager.ts",
    "src/api/client.ts"
  ],
  "filesWritten": [
    "src/auth/TokenManager.ts"
  ],
  "conflicts": [
    {
      "file": "src/auth/TokenManager.ts",
      "sidecarAction": "write",
      "externalMtime": "2025-01-25T11:40:00Z"
    }
  ],
  "contextDrift": {
    "ageMinutes": 23,
    "mainTurns": 15,
    "isSignificant": true
  }
}
```

### 7.5 Recommended User Workflow for Async

To minimize conflict risk:

1. **Before backgrounding:** Commit or stash current changes
2. **While sidecar runs:** Avoid editing files the sidecar might touch
3. **On fold:** Review conflict warnings before accepting changes
4. **If conflicts:** Use `git diff` to reconcile manually

**CLAUDE.md guidance:**

```markdown
## Async Sidecar Best Practices

When user backgrounds a sidecar (Ctrl+B), warn them:
"I recommend committing your current changes before the sidecar 
completes, in case there are file conflicts."

When sidecar folds with conflicts, say:
"The sidecar modified files that were also changed externally. 
Let me show you the conflicts so we can reconcile them."
```

---

## 8. Persistence & Resume

### 8.1 What Gets Persisted

Every sidecar session saves:

```
.claude/
└── sidecar_sessions/
    └── <task_id>/
        ├── conversation.jsonl   # Full conversation (captured in real-time)
        ├── metadata.json        # Task info, model, status, timestamps
        ├── initial_context.md   # The system prompt that was used
        └── summary.md           # Final summary (after Fold)
```

### 8.2 Conversation Capture

**Interactive Mode:** Electron shell intercepts all messages and writes to `conversation.jsonl` in real-time.

**Headless Mode:** CLI wrapper captures OpenCode stdout and parses into conversation format.

**Format:**
```json
{"role":"system","content":"[system prompt]","timestamp":"2025-01-25T10:30:00Z"}
{"role":"user","content":"Let's look at TokenManager","timestamp":"2025-01-25T10:30:15Z"}
{"role":"assistant","content":"I'll examine that file...","timestamp":"2025-01-25T10:30:45Z"}
```

### 8.3 Resume Flow

`sidecar resume <task_id>` reopens a previous session:

1. Load conversation from `.claude/sidecar_sessions/<task_id>/`
2. Load original system prompt from `initial_context.md`
3. **Check for file drift** (files discussed may have changed)
4. Open Electron window with full history pre-loaded
5. **Inject drift warning if files changed**
6. User continues conversation
7. On Fold → new summary appended, returned via stdout

```
┌─────────────────────────────────────────────────────────────────┐
│  sidecar resume abc123                                          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Sidecar CLI                                                    │
│  1. Load .claude/sidecar_sessions/abc123/conversation.jsonl    │
│  2. Load .claude/sidecar_sessions/abc123/initial_context.md    │
│  3. Check file drift (compare mtimes vs session end time)      │
│  4. Launch Electron with SIDECAR_RESUME=true + drift info      │
│  5. Start heartbeat                                             │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Electron Window                                                │
│  - Drift warning banner (if files changed)                     │
│  - Full conversation history displayed                          │
│  - User can scroll up to see previous messages                 │
│  - User can continue typing                                     │
│  - FOLD button available                                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ [User clicks Fold]
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Summary generated → stdout → Claude Code receives it          │
└─────────────────────────────────────────────────────────────────┘
```

### 8.4 Resume File Drift Detection

When resuming a session, the sidecar checks if files discussed have changed:

**Detection Logic:**

```javascript
function detectFileDrift(sessionDir, projectDir) {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(sessionDir, 'metadata.json'))
  );
  const sessionEndTime = new Date(metadata.completedAt || metadata.createdAt);
  
  // Get files that were read/written in the session
  const filesDiscussed = [
    ...(metadata.filesRead || []),
    ...(metadata.filesWritten || [])
  ];
  
  const driftedFiles = [];
  
  for (const file of filesDiscussed) {
    const filePath = path.join(projectDir, file);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.mtime > sessionEndTime) {
        driftedFiles.push({
          file,
          lastSessionTime: sessionEndTime,
          currentMtime: stat.mtime,
          hoursSinceDrift: Math.round((stat.mtime - sessionEndTime) / 3600000)
        });
      }
    } else {
      // File was deleted
      driftedFiles.push({
        file,
        deleted: true
      });
    }
  }
  
  return driftedFiles;
}
```

**Drift Warning (injected into resumed session):**

```markdown
## ⚠️ RESUME NOTICE

This session is being resumed after a pause. **The file system has changed 
since your last message.**

**Time since last activity:** 18 hours

**Files discussed that have changed:**
- src/auth/TokenManager.ts (modified 2 hours ago)
- src/api/client.ts (modified 6 hours ago)

**Files discussed that no longer exist:**
- src/utils/deprecated.ts (deleted)

**IMPORTANT:** Re-read any files before making assumptions about their 
contents. Your memory of the code may not match the current state.
```

This warning is:
1. Displayed as a banner in the Electron UI
2. Injected as a system message so the LLM is aware

### 8.5 Continue Flow

`sidecar continue <task_id>` starts a NEW sidecar with the OLD conversation as additional context:

1. Load previous session's conversation
2. Load previous session's summary (if exists)
3. Build NEW system prompt that includes:
   - New briefing
   - Previous sidecar conversation (as context)
   - Previous summary
   - Current Claude Code conversation
4. Launch as new sidecar (new task_id)
5. On Fold → returns new summary

**Context Structure for Continue:**

```markdown
## TASK BRIEFING

[New briefing from Claude Code]

## PREVIOUS SIDECAR SESSION (abc123)

The following conversation is from a previous sidecar that provides 
relevant context:

[User @ 10:30] Can you debug the auth issue?
[Assistant @ 10:31] I found a race condition...
[User @ 10:45] How should we fix it?
[Assistant @ 10:46] Use a mutex...

## PREVIOUS SIDECAR SUMMARY

[Summary from abc123]

## CURRENT CLAUDE CODE CONTEXT

[Filtered conversation from Claude Code]

## ENVIRONMENT

Project: /path/to/project
```

### 8.6 Difference: Resume vs Continue

| Aspect | Resume | Continue |
|--------|--------|----------|
| Task ID | Same (abc123) | New (def456) |
| Conversation file | Appends to existing | New file |
| System prompt | Original | New (includes old as context) |
| Model | Same | Can be different |
| Use case | "Pick up where I left off" | "Build on previous findings" |

---

## 9. Implementation

### 8.1 Sidecar CLI (Node.js)

```javascript
#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ELECTRON_APP = path.join(__dirname, '../claude-sidecar-ui');
const HEARTBEAT_INTERVAL = 5000;
const DEFAULT_TIMEOUT = 15 * 60 * 1000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  
  switch (command) {
    case 'start': return startSidecar(args);
    case 'list': return listSidecars(args);
    case 'resume': return resumeSidecar(args._[1]);
    case 'continue': return continueSidecar(args._[1], args);
    case 'read': return readSidecar(args._[1], args);
    default: printUsage();
  }
}

async function startSidecar(args) {
  const {
    model,
    briefing,
    session = 'current',
    project = process.cwd(),
    'context-turns': turns = 50,
    'context-since': since,
    'context-max-tokens': maxTokens = 80000,
    headless = false,
    timeout = 15
  } = args;
  
  if (!model || !briefing) {
    console.error('Error: --model and --briefing are required');
    process.exit(1);
  }
  
  const taskId = crypto.randomBytes(4).toString('hex');
  
  // Build context from Claude Code session (primary: explicit session, fallback: most recent)
  const context = buildContext(project, session, { turns, since, maxTokens });
  
  // Build system prompt
  const systemPrompt = buildSystemPrompt(briefing, context, project, headless);
  
  // Save session metadata
  saveSessionMetadata(taskId, { model, project, briefing, mode: headless ? 'headless' : 'interactive' });
  
  // Save initial context (system prompt) for potential resume
  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);
  fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), systemPrompt);
  
  // Start heartbeat
  const heartbeat = setInterval(() => process.stdout.write('.'), HEARTBEAT_INTERVAL);
  
  let summary;
  
  if (headless) {
    summary = await runHeadless(model, systemPrompt, taskId, project, timeout * 60 * 1000);
  } else {
    summary = await runInteractive(model, systemPrompt, taskId, project);
  }
  
  clearInterval(heartbeat);
  process.stdout.write('\n\n');
  
  // Output summary to stdout
  console.log(summary);
  
  // Save summary
  saveSessionSummary(taskId, summary);
  
  process.exit(0);
}

async function runInteractive(model, systemPrompt, taskId, project) {
  return new Promise((resolve) => {
    const child = spawn('electron', [ELECTRON_APP], {
      env: {
        ...process.env,
        SIDECAR_TASK_ID: taskId,
        SIDECAR_MODEL: model,
        SIDECAR_SYSTEM_PROMPT: systemPrompt,
        SIDECAR_PROJECT: project
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let summary = '';
    
    // Electron will output summary to stdout when Fold is clicked
    child.stdout.on('data', (data) => {
      summary += data.toString();
    });
    
    child.on('close', () => {
      resolve(summary.trim() || 'Sidecar session ended without summary.');
    });
  });
}

async function runHeadless(model, systemPrompt, taskId, project, timeoutMs) {
  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');

  // Log system prompt as first message
  fs.appendFileSync(conversationPath, JSON.stringify({
    role: 'system',
    content: systemPrompt,
    timestamp: new Date().toISOString()
  }) + '\n');

  // Find available port for OpenCode server
  const port = await findAvailablePort(14440);

  // Start OpenCode server (HTTP API mode)
  // See: https://opencode.ai/docs/cli/#serve
  const serverProcess = spawn('npx', ['opencode-ai', 'serve', '--port', String(port)], {
    cwd: project,
    env: { ...process.env, OPENCODE_MODEL: model },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  try {
    // Wait for server to be ready
    await waitForServer(port);

    // Create a session via HTTP API
    const sessionResp = await httpRequest('POST', `http://127.0.0.1:${port}/session`, {});
    const sessionId = sessionResp.id;

    // Send the system prompt as a message
    const msgResp = await httpRequest('POST', `http://127.0.0.1:${port}/session/${sessionId}/message`, {
      parts: [{ type: 'text', text: systemPrompt }]
    });

    let output = '';

    // Process response parts
    if (msgResp.parts) {
      for (const part of msgResp.parts) {
        if (part.type === 'text' && part.text) {
          output += part.text;
          fs.appendFileSync(conversationPath, JSON.stringify({
            role: 'assistant',
            content: part.text,
            timestamp: new Date().toISOString()
          }) + '\n');
        }
      }
    }

    // Poll for completion or timeout
    const startTime = Date.now();
    while (!output.includes('[SIDECAR_COMPLETE]') && (Date.now() - startTime) < timeoutMs) {
      await sleep(2000);
      const messages = await httpRequest('GET', `http://127.0.0.1:${port}/session/${sessionId}/message`);
      // Process any new messages...
    }

    serverProcess.kill();

    // Extract summary (everything before [SIDECAR_COMPLETE])
    const summary = output.split('[SIDECAR_COMPLETE]')[0].trim();
    return summary || 'Sidecar completed without summary.';

  } catch (error) {
    serverProcess.kill();
    throw error;
  }
}

function buildSystemPrompt(briefing, context, project, headless) {
  let prompt = `# SIDECAR SESSION

You are a sidecar agent helping with a task from Claude Code.

## TASK BRIEFING

${briefing}

## CONVERSATION CONTEXT (from Claude Code)

${context}

## ENVIRONMENT

Project: ${project}
You have full read/write access to this directory.
`;

  if (headless) {
    prompt += `
## HEADLESS MODE INSTRUCTIONS

You are running autonomously without human interaction.

1. Execute the task completely
2. Make reasonable assumptions (document them)
3. When done, output your summary followed by [SIDECAR_COMPLETE]

Do NOT ask questions. Work independently.

If you encounter a blocker you cannot resolve:
1. Document what you tried
2. Output partial results
3. End with [SIDECAR_COMPLETE]
`;
  } else {
    prompt += `
## INTERACTIVE MODE

The user will work with you in a conversation.
When they click "Fold", you'll be asked to generate a summary.
Keep track of key findings as you work.
`;
  }

  return prompt;
}

function buildContext(project, session, options) {
  // Find Claude Code session for this project
  const claudeDir = path.join(os.homedir(), '.claude');
  const encodedPath = project.replace(/\//g, '-').replace(/^-/, '');
  const projectDir = path.join(claudeDir, 'projects', encodedPath);
  
  if (!fs.existsSync(projectDir)) {
    return '[No Claude Code conversation history found]';
  }
  
  // Resolve session using primary/fallback approach
  const sessionPath = resolveSession(projectDir, session);
  
  if (!sessionPath) {
    return '[No Claude Code conversation history found]';
  }
  
  return filterContext(sessionPath, options);
}

// Primary: explicit session ID, Fallback: most recent mtime
function resolveSession(projectDir, sessionArg) {
  // Primary: explicit session ID passed via --session
  if (sessionArg && sessionArg !== 'current') {
    // Handle both full filename and just the UUID
    const filename = sessionArg.endsWith('.jsonl') ? sessionArg : `${sessionArg}.jsonl`;
    const sessionPath = path.join(projectDir, filename);
    
    if (fs.existsSync(sessionPath)) {
      console.error(`[Sidecar] Using explicit session: ${sessionArg}`);
      return sessionPath;
    }
    
    console.error(`[Sidecar] Warning: Session ${sessionArg} not found, falling back to most recent`);
  }
  
  // Fallback: most recently modified .jsonl file
  const sessions = fs.readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      name: f,
      path: path.join(projectDir, f),
      mtime: fs.statSync(path.join(projectDir, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  if (sessions.length === 0) {
    return null;
  }
  
  // Warn if multiple sessions modified in last 5 minutes (ambiguity)
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const recentSessions = sessions.filter(s => s.mtime > fiveMinutesAgo);
  
  if (recentSessions.length > 1) {
    console.error(`[Sidecar] Warning: ${recentSessions.length} active sessions detected. ` +
      `Using most recent. For reliability, pass --session <id> explicitly.`);
  }
  
  console.error(`[Sidecar] Using session (fallback): ${sessions[0].name}`);
  return sessions[0].path;
}

function filterContext(sessionPath, { turns, since, maxTokens }) {
  let lines = fs.readFileSync(sessionPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  
  // Time filter
  if (since) {
    const cutoffMs = parseDuration(since);
    const cutoff = Date.now() - cutoffMs;
    lines = lines.filter(l => new Date(l.timestamp) >= cutoff);
  }
  // Turn filter
  else if (turns) {
    const userIndices = lines.map((l, i) => l.type === 'user' ? i : -1).filter(i => i >= 0);
    if (userIndices.length > turns) {
      const startIdx = userIndices[userIndices.length - turns];
      lines = lines.slice(startIdx);
    }
  }
  
  // Format
  const formatted = lines.map(formatLine).filter(Boolean).join('\n\n');
  
  // Truncate (simple char-based, ~4 chars per token)
  const maxChars = maxTokens * 4;
  if (formatted.length > maxChars) {
    return '[Earlier context truncated...]\n\n' + formatted.slice(-maxChars);
  }
  
  return formatted;
}

function formatLine(line) {
  const time = new Date(line.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  switch (line.type) {
    case 'user':
      return `[User @ ${time}] ${line.message?.content || ''}`;
    case 'assistant':
      const text = Array.isArray(line.message?.content)
        ? line.message.content.map(c => c.text || '').join('')
        : line.message?.content || '';
      return `[Assistant @ ${time}] ${text}`;
    case 'tool_use':
      return `[Tool: ${line.tool} ${line.input?.path || ''}]`;
    default:
      return '';
  }
}

function parseDuration(str) {
  const match = str.match(/^(\d+)(m|h|d)$/);
  if (!match) return 0;
  const multipliers = { m: 60000, h: 3600000, d: 86400000 };
  return parseInt(match[1]) * multipliers[match[2]];
}

function saveSessionMetadata(taskId, data) {
  const project = data.project || process.cwd();
  const dir = path.join(project, '.claude', 'sidecar_sessions', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'metadata.json'),
    JSON.stringify({ taskId, ...data, status: 'running', createdAt: new Date().toISOString() }, null, 2)
  );
}

function saveSessionSummary(taskId, summary) {
  const dir = path.join(process.cwd(), '.claude', 'sidecar_sessions', taskId);
  fs.writeFileSync(path.join(dir, 'summary.md'), summary);
  
  // Update metadata
  const metaPath = path.join(dir, 'metadata.json');
  const meta = JSON.parse(fs.readFileSync(metaPath));
  meta.status = 'complete';
  meta.completedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

// ============ RESUME ============

async function resumeSidecar(taskId) {
  const sessionDir = path.join(process.cwd(), '.claude', 'sidecar_sessions', taskId);
  
  if (!fs.existsSync(sessionDir)) {
    console.error(`Error: Session ${taskId} not found`);
    process.exit(1);
  }
  
  // Load metadata
  const metadata = JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json')));
  
  // Load conversation
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');
  const conversation = fs.existsSync(conversationPath)
    ? fs.readFileSync(conversationPath, 'utf-8')
    : '';
  
  // Load original system prompt
  let systemPrompt = fs.readFileSync(path.join(sessionDir, 'initial_context.md'), 'utf-8');
  
  // ===== FILE DRIFT DETECTION =====
  const lastActivity = new Date(metadata.completedAt || metadata.createdAt);
  const timeSinceMs = Date.now() - lastActivity.getTime();
  const timeSinceHours = Math.round(timeSinceMs / 3600000);
  
  // Check if files discussed in conversation have changed
  const filesDiscussed = metadata.filesRead || [];
  const changedFiles = [];
  
  for (const file of filesDiscussed) {
    const filePath = path.join(metadata.project, file);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.mtime > lastActivity) {
        changedFiles.push({
          file,
          modifiedAgo: formatAge(stat.mtime.toISOString())
        });
      }
    }
  }
  
  // Inject drift warning if needed
  if (timeSinceHours > 1 || changedFiles.length > 0) {
    const driftWarning = `
## ⚠️ RESUME NOTICE

This session is being resumed after a pause.

**Time since last activity:** ${timeSinceHours > 0 ? timeSinceHours + ' hours' : 'Less than an hour'}

${changedFiles.length > 0 ? `**Files discussed that have changed since:**
${changedFiles.map(f => `- ${f.file} (modified ${f.modifiedAgo})`).join('\n')}

**Important:** Re-read any files before making assumptions about their current contents.
` : ''}
---

`;
    systemPrompt = driftWarning + systemPrompt;
  }
  // ===== END DRIFT DETECTION =====
  
  // Start heartbeat
  const heartbeat = setInterval(() => process.stdout.write('.'), HEARTBEAT_INTERVAL);
  
  // Launch with resume flag
  const summary = await new Promise((resolve) => {
    const child = spawn('electron', [ELECTRON_APP], {
      env: {
        ...process.env,
        SIDECAR_TASK_ID: taskId,
        SIDECAR_MODEL: metadata.model,
        SIDECAR_SYSTEM_PROMPT: systemPrompt,
        SIDECAR_PROJECT: metadata.project,
        SIDECAR_RESUME: 'true',
        SIDECAR_CONVERSATION: conversation
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.on('close', () => resolve(output.trim() || 'Session ended without summary.'));
  });
  
  clearInterval(heartbeat);
  process.stdout.write('\n\n');
  console.log(summary);
  
  // Update summary
  saveSessionSummary(taskId, summary);
  
  process.exit(0);
}

// ============ CONTINUE ============

async function continueSidecar(oldTaskId, args) {
  const oldSessionDir = path.join(process.cwd(), '.claude', 'sidecar_sessions', oldTaskId);
  
  if (!fs.existsSync(oldSessionDir)) {
    console.error(`Error: Session ${oldTaskId} not found`);
    process.exit(1);
  }
  
  const {
    model,
    briefing,
    project = process.cwd(),
    'context-turns': turns = 50,
    'context-max-tokens': maxTokens = 80000
  } = args;
  
  if (!briefing) {
    console.error('Error: --briefing is required for continue');
    process.exit(1);
  }
  
  // Load old session data
  const oldMeta = JSON.parse(fs.readFileSync(path.join(oldSessionDir, 'metadata.json')));
  const oldConversation = fs.existsSync(path.join(oldSessionDir, 'conversation.jsonl'))
    ? fs.readFileSync(path.join(oldSessionDir, 'conversation.jsonl'), 'utf-8')
    : '';
  const oldSummary = fs.existsSync(path.join(oldSessionDir, 'summary.md'))
    ? fs.readFileSync(path.join(oldSessionDir, 'summary.md'), 'utf-8')
    : '';
  
  // Format old conversation for context
  const oldConversationFormatted = oldConversation
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        const msg = JSON.parse(line);
        if (msg.role === 'user') return `[User] ${msg.content}`;
        if (msg.role === 'assistant') return `[Assistant] ${msg.content}`;
        return '';
      } catch { return ''; }
    })
    .filter(Boolean)
    .join('\n\n');
  
  // Get current Claude Code context
  const currentContext = buildContext(project, { turns, maxTokens });
  
  // Build combined system prompt
  const systemPrompt = `# SIDECAR SESSION (Continue)

## TASK BRIEFING

${briefing}

## PREVIOUS SIDECAR SESSION (${oldTaskId})

This conversation is from a previous sidecar session that provides relevant context:

${oldConversationFormatted}

${oldSummary ? `## PREVIOUS SIDECAR SUMMARY\n\n${oldSummary}` : ''}

## CURRENT CLAUDE CODE CONTEXT

${currentContext}

## ENVIRONMENT

Project: ${project}
You have full read/write access to this directory.

## INSTRUCTIONS

Build on the previous sidecar's findings. The user wants to continue or extend that work.
`;

  // New task ID
  const newTaskId = crypto.randomBytes(4).toString('hex');
  const useModel = model || oldMeta.model;
  
  // Save new session metadata
  saveSessionMetadata(newTaskId, { 
    model: useModel, 
    project, 
    briefing,
    mode: 'interactive',
    continuesFrom: oldTaskId
  });
  
  // Save system prompt
  const newSessionDir = path.join(process.cwd(), '.claude', 'sidecar_sessions', newTaskId);
  fs.writeFileSync(path.join(newSessionDir, 'initial_context.md'), systemPrompt);
  
  // Start heartbeat
  const heartbeat = setInterval(() => process.stdout.write('.'), HEARTBEAT_INTERVAL);
  
  // Launch
  const summary = await runInteractive(useModel, systemPrompt, newTaskId, project);
  
  clearInterval(heartbeat);
  process.stdout.write('\n\n');
  console.log(summary);
  
  saveSessionSummary(newTaskId, summary);
  process.exit(0);
}

// ============ LIST ============

async function listSidecars(args) {
  const sessionsDir = path.join(process.cwd(), '.claude', 'sidecar_sessions');
  
  if (!fs.existsSync(sessionsDir)) {
    console.log('No sidecar sessions found.');
    return;
  }
  
  const sessions = fs.readdirSync(sessionsDir)
    .filter(d => fs.existsSync(path.join(sessionsDir, d, 'metadata.json')))
    .map(d => {
      const meta = JSON.parse(fs.readFileSync(path.join(sessionsDir, d, 'metadata.json')));
      return { ...meta, id: d };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (sessions.length === 0) {
    console.log('No sidecar sessions found.');
    return;
  }
  
  // Filter by status if specified
  const statusFilter = args.status;
  const filtered = statusFilter && statusFilter !== 'all'
    ? sessions.filter(s => s.status === statusFilter)
    : sessions;
  
  // Output
  if (args.json) {
    console.log(JSON.stringify(filtered, null, 2));
  } else {
    console.log('ID        MODEL                  STATUS     AGE         BRIEFING');
    console.log('─'.repeat(80));
    filtered.forEach(s => {
      const age = formatAge(s.createdAt);
      const briefingShort = (s.briefing || '').slice(0, 30) + ((s.briefing?.length > 30) ? '...' : '');
      console.log(
        `${s.id.padEnd(10)}${(s.model || '').padEnd(23)}${(s.status || 'unknown').padEnd(11)}${age.padEnd(12)}${briefingShort}`
      );
    });
  }
}

function formatAge(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============ READ ============

async function readSidecar(taskId, args) {
  const sessionDir = path.join(process.cwd(), '.claude', 'sidecar_sessions', taskId);
  
  if (!fs.existsSync(sessionDir)) {
    console.error(`Error: Session ${taskId} not found`);
    process.exit(1);
  }
  
  if (args.conversation) {
    const convPath = path.join(sessionDir, 'conversation.jsonl');
    if (fs.existsSync(convPath)) {
      // Format conversation for readability
      const lines = fs.readFileSync(convPath, 'utf-8').split('\n').filter(Boolean);
      lines.forEach(line => {
        try {
          const msg = JSON.parse(line);
          const time = new Date(msg.timestamp).toLocaleTimeString();
          console.log(`[${msg.role} @ ${time}] ${msg.content}\n`);
        } catch {}
      });
    } else {
      console.log('No conversation recorded.');
    }
  } else if (args.metadata) {
    const metaPath = path.join(sessionDir, 'metadata.json');
    console.log(fs.readFileSync(metaPath, 'utf-8'));
  } else {
    // Default: show summary
    const summaryPath = path.join(sessionDir, 'summary.md');
    if (fs.existsSync(summaryPath)) {
      console.log(fs.readFileSync(summaryPath, 'utf-8'));
    } else {
      console.log('No summary available (session may not have been folded).');
    }
  }
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._.push(argv[i]);
    }
  }
  return result;
}

function printUsage() {
  console.log(`
Usage: sidecar <command> [options]

Commands:
  start       Launch a new sidecar
  list        Show previous sidecars
  resume      Reopen a previous sidecar
  continue    New sidecar building on previous
  read        Output previous sidecar data

Options for 'start':
  --model <provider/model>     Required. Model to use
  --briefing <text>            Required. Task description
  --headless                   Run without GUI
  --timeout <minutes>          Headless timeout (default: 15)
  --context-turns <N>          Max conversation turns (default: 50)
  --context-max-tokens <N>     Max context tokens (default: 80000)
`);
}

main().catch(console.error);
```

### 8.2 Electron Shell (with Conversation Capture)

```javascript
// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const taskId = process.env.SIDECAR_TASK_ID;
const model = process.env.SIDECAR_MODEL;
const systemPrompt = process.env.SIDECAR_SYSTEM_PROMPT;
const project = process.env.SIDECAR_PROJECT;
const isResume = process.env.SIDECAR_RESUME === 'true';
const existingConversation = process.env.SIDECAR_CONVERSATION || '';

let mainWindow;
let serverProcess;
let conversationLog = [];

// Session directory for this sidecar
const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);

async function createWindow() {
  const port = await findAvailablePort(4440);
  
  // Ensure session directory exists
  fs.mkdirSync(sessionDir, { recursive: true });
  
  // Save initial context (system prompt)
  if (!isResume) {
    fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), systemPrompt);
  }
  
  // Load existing conversation if resuming
  if (isResume && existingConversation) {
    conversationLog = existingConversation.split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  }
  
  // Start OpenCode server
  serverProcess = spawn('opencode', ['serve', '--port', String(port)], {
    cwd: project,
    env: { ...process.env, OPENCODE_MODEL: model }
  });
  
  mainWindow = new BrowserWindow({
    width: 500,
    height: 900,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  await waitForServer(`http://localhost:${port}`);
  mainWindow.loadURL(`http://localhost:${port}`);
  
  mainWindow.webContents.on('did-finish-load', () => {
    injectUI();
    
    // If resuming, inject previous conversation display
    if (isResume && conversationLog.length > 0) {
      injectPreviousConversation();
    }
    
    // Set up message observer for conversation capture
    setupMessageObserver();
  });
}

function injectUI() {
  // TODO: Replace hardcoded colors with values extracted from Claude Code Desktop
  // See Section 14.3 for investigation plan
  // These values should come from electron/theme.js after extraction
  
  // Title bar
  mainWindow.webContents.insertCSS(`
    body::before {
      content: 'Sidecar ${taskId.slice(0,6)} | ${model}';
      position: fixed; top: 0; left: 0; right: 60px; height: 28px;
      background: #1a1a1a; color: #888; font-size: 11px;
      line-height: 28px; padding-left: 12px;
      -webkit-app-region: drag; z-index: 10000;
    }
    aside, header, nav, footer { display: none !important; }
    main { padding-top: 32px !important; }
  `);
  
  // Fold button
  mainWindow.webContents.executeJavaScript(`
    const btn = document.createElement('button');
    btn.id = 'fold-btn';
    btn.textContent = 'FOLD';
    btn.style.cssText = 'position:fixed;top:4px;right:8px;padding:4px 14px;background:#2d5a27;color:white;border:none;border-radius:4px;cursor:pointer;z-index:10001;font-weight:bold;font-size:12px;';
    btn.onmouseenter = () => btn.style.background = '#3d7a37';
    btn.onmouseleave = () => btn.style.background = '#2d5a27';
    btn.onclick = () => window.electronAPI.fold();
    document.body.appendChild(btn);
  `);
}

function setupMessageObserver() {
  // Observe DOM for new messages and capture them
  mainWindow.webContents.executeJavaScript(`
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            const role = node.getAttribute?.('data-role');
            const content = node.textContent?.trim();
            if (role && content) {
              window.electronAPI.logMessage({ role, content, timestamp: new Date().toISOString() });
            }
          }
        });
      });
    });
    
    // Start observing (adjust selector based on OpenCode's DOM structure)
    const chatContainer = document.querySelector('main') || document.body;
    observer.observe(chatContainer, { childList: true, subtree: true });
  `);
}

function injectPreviousConversation() {
  // Visual indicator that this is a resumed session
  mainWindow.webContents.executeJavaScript(`
    const notice = document.createElement('div');
    notice.style.cssText = 'background:#2a2a2a;color:#888;padding:8px 12px;font-size:12px;border-bottom:1px solid #333;';
    notice.textContent = '↩ Resumed session with ${conversationLog.length} previous messages';
    document.body.insertBefore(notice, document.body.firstChild);
  `);
}

// Capture messages from renderer
ipcMain.handle('log-message', (event, msg) => {
  conversationLog.push(msg);
  
  // Write to file in real-time
  fs.appendFileSync(
    path.join(sessionDir, 'conversation.jsonl'),
    JSON.stringify(msg) + '\n'
  );
});

// Handle Fold
ipcMain.handle('fold', async () => {
  // Inject summary request
  await mainWindow.webContents.executeJavaScript(`
    const input = document.querySelector('textarea');
    if (input) {
      input.value = \`Generate a handoff summary of our conversation. Format as:

## Sidecar Results: [Brief Title]

**Task:** [What was requested]
**Findings:** [Key discoveries]
**Recommendations:** [Suggested actions]
**Code Changes:** (if any with file paths)
**Files Modified/Created:** (if any)
**Open Questions:** (if any)

Be concise but complete enough to act on immediately.\`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const form = input.closest('form');
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
    }
  `);
  
  // Wait for response
  await new Promise(r => setTimeout(r, 6000));
  
  // Extract summary
  const summary = await mainWindow.webContents.executeJavaScript(`
    const msgs = document.querySelectorAll('[data-role="assistant"]');
    msgs[msgs.length - 1]?.textContent || '';
  `);
  
  // Output to stdout (parent CLI process receives this)
  process.stdout.write(summary);
  
  // Cleanup and exit
  if (serverProcess) serverProcess.kill();
  app.quit();
});

async function findAvailablePort(start) {
  const net = require('net');
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(start, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findAvailablePort(start + 1)));
  });
}

async function waitForServer(url, retries = 30, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, res => resolve(res.statusCode));
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(); });
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Server failed to start');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
```

**preload.js:**

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  fold: () => ipcRenderer.invoke('fold'),
  logMessage: (msg) => ipcRenderer.invoke('log-message', msg)
});
```

---

## 10. Claude Code Integration

### 10.1 CLAUDE.md Instructions

```markdown
## Sidecar Tool

You can spawn sidecar agents with different models for specialized tasks.

### When to use:
- Task benefits from a different model (Gemini for large context, etc.)
- Deep exploration that would pollute main context
- User explicitly requests a sidecar

### Command format:
```bash
sidecar start \
  --model <provider/model> \
  --briefing "<detailed task description>" \
  --session <your-session-id>   # Recommended for reliability
```

### Session ID (Important):
To ensure the sidecar gets the correct conversation context, pass your 
session ID using `--session`. You can find your session ID by checking 
which `.jsonl` file in `~/.claude/projects/[project-path]/` corresponds 
to this conversation. 

If you cannot determine your session ID, omit `--session` and the sidecar 
will use the most recently modified conversation file (less reliable if 
multiple sessions are active).

### Models available:
- google/gemini-2.5 (large context)
- openai/o3 (reasoning)
- openai/gpt-4.1 (general)
- anthropic/claude-sonnet-4 (balanced)

### For autonomous tasks:
```bash
sidecar start --model X --briefing "..." --headless
```

### The command blocks until complete. Output is the summary.

### If user wants to continue working while sidecar runs:
They can press Ctrl+B to background it (Claude Code native feature).

### Checking past sidecars:
```bash
sidecar list                    # Show previous sessions
sidecar read <id> --summary     # Read a summary
sidecar resume <id>             # Reopen session
```
```

---

## 11. Safety & Limitations

### 11.1 Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Long-running blocks | User can Ctrl+B to background |
| Headless runaway | Default 15min timeout |
| File system access | Inherits project scope |
| Context overflow | Token limits on context passing |
| **File conflicts (async)** | Conflict detection + warning in fold summary |
| **Context drift (async)** | Staleness indicator in fold summary |
| **Resume file drift** | Drift warning injected on resume |

### 11.2 Stdout Discipline

Since the summary is returned via stdout, we must be rigorous about what gets written there.

**Rules:**

```javascript
// ✅ CORRECT: Debug output to stderr
console.error('[Sidecar] Starting...');
console.error('[Sidecar] Loading context...');
console.error('[Sidecar] Spawning OpenCode...');

// ✅ CORRECT: Only final summary to stdout
console.log(summary);

// ❌ WRONG: Debug output to stdout (corrupts summary)
console.log('[Debug] Loading...');

// ❌ WRONG: Progress messages to stdout
console.log('Processing...');
```

**Suppressing External Noise:**

```javascript
// Suppress OpenCode/npm stderr noise
spawn('opencode', [...], {
  stdio: ['ignore', 'pipe', 'ignore']  // stdout only
});

// Or capture and filter
child.stderr.on('data', (data) => {
  // Log to our stderr, not stdout
  console.error(`[OpenCode] ${data}`);
});
```

**Heartbeat Exception:**

The heartbeat dots (`.....`) go to stdout but are followed by `\n\n` before the summary, making them visually separate and easy to strip if needed.

### 11.3 Known Limitations

| Limitation | Impact |
|------------|--------|
| CSS injection for UI | Brittle; breaks on OpenCode updates |
| No true file locking | Conflicts possible in async mode |
| Token estimation | ~90% accurate (uses char count heuristic) |
| Conversation capture | Depends on OpenCode DOM structure |

---

## 12. Summary

The sidecar is a **simple blocking tool** that:

1. Takes a model + briefing + context
2. Runs a conversation (interactive or headless)
3. Returns a summary via stdout

**Async is handled by Claude Code's native Ctrl+B**, not by us.

**Session resolution:**
- Primary: Claude Code passes `--session <id>` explicitly
- Fallback: Most recently modified `.jsonl` file

**v2.5 additions:**
- File conflict detection and warnings
- Context drift indicators
- Resume file drift checks
- Enhanced summary format (includes failed attempts)
- Stdout discipline for clean output
- Session resolution with primary/fallback

This design is:
- Simple to implement
- Easy to debug (just a CLI)
- Clean integration (stdout)
- Conflict-aware
- Leverages existing Claude Code features

---

## 13. Distribution

### 13.1 npm Package

The sidecar is distributed as an npm package:

```bash
npm install -g claude-sidecar
```

**Package structure:**

```
claude-sidecar/
├── bin/
│   └── sidecar.js          # CLI entry point
├── src/
│   ├── index.js            # Main module
│   ├── context.js          # Context extraction & filtering
│   ├── session.js          # Session resolution
│   └── conflict.js         # Conflict/drift detection
├── electron/
│   ├── main.js             # Electron shell
│   └── preload.js          # IPC bridge
├── skill/
│   └── SKILL.md            # Claude Code skill file
├── scripts/
│   └── postinstall.js      # Installs skill automatically
├── package.json
└── README.md
```

### 13.2 Claude Code Skill

On `npm install`, the postinstall script copies `SKILL.md` to:

```
~/.claude/skills/sidecar/SKILL.md
```

This teaches Claude Code:
- When to spawn sidecars
- How to generate effective briefings
- How to pass session IDs
- How to act on sidecar results
- How to check for existing sidecars before spawning new ones

**The skill is the primary integration point** — no changes to Claude Code source required.

### 13.3 Prerequisites

Users must have:
- Node.js 18+
- OpenCode CLI (`npm install -g opencode`)
- API keys configured for chosen models (Gemini, OpenAI, etc.)

---

## 14. Implementation Tasks

### 14.1 Completed (in spec)

- [x] Core architecture design
- [x] CLI interface specification
- [x] Context passing and session resolution
- [x] Fold mechanism and summary format
- [x] Conflict and drift detection
- [x] Persistence and resume/continue
- [x] Headless mode with timeout
- [x] Claude Code Skill (SKILL.md)
- [x] npm distribution model

### 14.2 Pending Implementation

| Task | Priority | Status |
|------|----------|--------|
| Extract CLI to `bin/sidecar.js` | High | Not started |
| Extract Electron shell to `electron/` | High | Not started |
| **Investigate Claude Code Desktop styling** | High | Not started |
| Test with OpenCode CLI | High | Not started |
| npm package testing | Medium | Not started |
| End-to-end integration test | Medium | Not started |

### 14.3 Task: Investigate Claude Code Desktop Styling

**Objective:** Make the sidecar Electron window visually match Claude Code Desktop.

**Approach:**

1. **Unpack Claude Code Desktop's .asar archive:**

```bash
# macOS
CLAUDE_APP="/Applications/Claude.app"
ASAR_PATH="$CLAUDE_APP/Contents/Resources/app.asar"
OUTPUT_DIR="./claude-desktop-unpacked"

# Windows
# ASAR_PATH="C:/Users/<user>/AppData/Local/Programs/Claude/resources/app.asar"

# Extract
npm install -g asar
asar extract "$ASAR_PATH" "$OUTPUT_DIR"

# Find styling files
find "$OUTPUT_DIR" -name "*.css" -o -name "*theme*" -o -name "*style*" -o -name "*color*"
```

2. **Identify key design tokens:**

```css
/* Expected variables to extract */
--bg-primary:      /* Main background */
--bg-secondary:    /* Panels, cards */
--bg-tertiary:     /* Hover states */
--text-primary:    /* Main text */
--text-secondary:  /* Muted text */
--accent:          /* Brand color (orange?) */
--border:          /* Border color */
--font-family:     /* System font stack */
--border-radius:   /* Corner rounding */
```

3. **Alternative: DevTools inspection:**

```bash
# Launch with remote debugging
/Applications/Claude.app/Contents/MacOS/Claude --remote-debugging-port=9222

# Or try keyboard shortcuts in the app:
# Cmd+Option+I (Mac) / Ctrl+Shift+I (Windows)
```

4. **Create theme file for sidecar:**

```javascript
// electron/theme.js
module.exports = {
  colors: {
    bgPrimary: '#0d0d0d',
    bgSecondary: '#1a1a1a',
    // ... extracted values
  },
  fonts: {
    family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    // ...
  }
};
```

5. **Apply to Electron shell:**

```javascript
// In main.js, inject CSS to match Claude Code
mainWindow.webContents.insertCSS(`
  :root {
    --bg-primary: ${theme.colors.bgPrimary};
    /* ... */
  }
  body {
    background: var(--bg-primary);
    font-family: ${theme.fonts.family};
  }
`);
```

6. **Override OpenCode's default styling:**

OpenCode has its own theme. We need to inject CSS that overrides it to match Claude Code's look.

**Deliverables:**
- `electron/theme.js` — Design tokens extracted from Claude Code
- `electron/inject.css` — CSS overrides for OpenCode
- Updated `electron/main.js` — Applies theme on window load

**Notes:**
- CSS injection is brittle (breaks if OpenCode changes DOM structure)
- Consider this a "best effort" visual match
- May need updates when either Claude Code or OpenCode updates

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | — | Initial spec |
| 2.1 | 2025-01-25 | Corrected OpenCode CLI |
| 2.2 | 2025-01-25 | Added async model, context passing |
| 2.3 | 2025-01-25 | Added persistence, resume, headless mode |
| 2.4 | 2025-01-25 | Simplified to blocking CLI with stdout return |
| 2.5 | 2025-01-25 | Added conflict detection, drift warnings, session resolution |
| 2.6 | 2025-01-25 | Full spec consolidation |
| 2.7 | 2026-01-25 | Headless mode uses `opencode serve` HTTP API instead of `opencode run` |
| 2.6 | 2025-01-25 | Added Claude Code Skill, npm distribution, implementation task tracking, Claude Desktop styling investigation plan |
