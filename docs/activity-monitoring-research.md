# Activity-Monitoring Auto-Skill Triggers: Research

## Problem Statement

Sidecar's four auto-skills (`auto-unblock`, `auto-review`, `auto-security`, `auto-bmad-check`) currently rely on a single triggering mechanism: Claude pattern-matching skill descriptions against conversation state every turn. Each skill's `description` field in its SKILL.md frontmatter contains trigger conditions (e.g., "5 or more different approaches"), and Claude evaluates these against its perception of the conversation.

This mechanism has three fundamental weaknesses:

1. **Self-assessment is unreliable.** Claude must count its own failed attempts, judge when "implementation is complete," or recognize it's looping — but it often doesn't count accurately, misses the threshold, or rationalizes that it's making progress when it isn't.

2. **Description-matching is probabilistic.** Whether Claude invokes a skill depends on how well it pattern-matches the description against the current conversational state. This varies with context window pressure, conversation length, and model behavior. There's no guarantee a skill fires at the right moment.

3. **No objective evidence.** The trigger decision is entirely internal to Claude's reasoning. There is no external signal — like "Bash has failed 5 times in a row on the same file" — feeding into the decision. The skill description says "5 or more approaches" but nothing actually counts them.

**The consequence:** Auto-skills fire inconsistently. `auto-unblock` might never trigger despite 10 failed attempts. `auto-security` might miss a `git commit` because Claude was focused on the commit message, not the security scan. `auto-review` might not fire because Claude doesn't consider its work "significant enough."

**The goal:** Add a second, objective triggering path that uses behavioral evidence from tool call patterns to recommend skill invocation — working alongside the existing description-matching mechanism, not replacing it.

---

## Hook System Capabilities

Claude Code's [hooks system](https://code.claude.com/docs/en/hooks) provides lifecycle event handlers that can observe and influence Claude's behavior. This section documents the capabilities relevant to activity monitoring.

### Hook Events Available

The table below lists hook events relevant to activity monitoring. Claude Code supports 17 hook events total — see the [full reference](https://code.claude.com/docs/en/hooks) for the complete list including `PermissionRequest`, `Notification`, `SubagentStart/Stop`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate/Remove`, `PreCompact`, `InstructionsLoaded`, and `SessionEnd`.

| Event | When It Fires | Matcher Support | Can Block? |
|-------|--------------|-----------------|------------|
| `PreToolUse` | Before a tool call executes | Tool name regex | Yes — deny/allow/ask |
| `PostToolUse` | After a tool call succeeds | Tool name regex | Feedback only (`decision: "block"` shows reason to Claude, but tool already ran) |
| `PostToolUseFailure` | After a tool call fails | Tool name regex | Feedback only (tool already failed) |
| `Stop` | When Claude finishes responding | No matcher (always fires) | Yes — force continuation |
| `SessionStart` | When a session begins/resumes | Source type | No |
| `SessionEnd` | When a session terminates | Session end reason | No (side effects only) |
| `UserPromptSubmit` | When the user submits a prompt | No matcher (always fires) | Yes — block prompt |

### Hook Input Contract

All hooks receive JSON via stdin with these common fields:

| Field | Description |
|-------|-------------|
| `session_id` | Current session identifier |
| `transcript_path` | Path to conversation JSONL file |
| `cwd` | Current working directory |
| `permission_mode` | Current permission mode |
| `hook_event_name` | Name of the event that fired |

**Tool events** (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`) additionally include:

| Field | Description |
|-------|-------------|
| `tool_name` | Name of the tool (e.g., `Bash`, `Edit`, `Write`) |
| `tool_input` | Tool-specific input object |
| `tool_response` | (PostToolUse only) Result from the tool |
| `tool_use_id` | Unique ID for the tool call |
| `error` | (PostToolUseFailure only) Error description |
| `is_interrupt` | (PostToolUseFailure only) Whether the failure was caused by user interruption |

**Stop** hooks additionally include:

| Field | Description |
|-------|-------------|
| `stop_hook_active` | Whether Claude is already continuing from a stop hook |
| `last_assistant_message` | Text of Claude's final response |

### Hook Output Contract

Hooks communicate back via exit codes and JSON stdout:

**Exit codes:**
- `0` — success; stdout parsed for JSON output
- `2` — blocking error (PreToolUse blocks the tool, Stop forces continuation)
- Other — non-blocking error, execution continues

**JSON output fields** (on exit 0):

| Field | Description |
|-------|-------------|
| `systemMessage` | Warning message shown to the user |
| `decision` | `"block"` to prevent the action (Stop, PostToolUse) |
| `reason` | Explanation when decision is "block" |
| `continue` | `false` to stop Claude entirely |
| `hookSpecificOutput` | Event-specific structured output |

**Key capability for auto-skills:** The `Stop` hook can return `{ "decision": "block", "reason": "..." }` to prevent Claude from stopping and force it to continue with the reason as context. This is the primary mechanism for injecting auto-skill recommendations — the `reason` field tells Claude what skill to invoke and why.

### Hook Registration

Hooks are defined in JSON settings files at multiple scopes:

| Location | Scope |
|----------|-------|
| `~/.claude/settings.json` | All projects (user-level) |
| `.claude/settings.json` | Single project |
| `.claude/settings.local.json` | Single project, gitignored |
| Plugin `hooks/hooks.json` | When plugin is enabled |
| Skill/agent frontmatter | While component is active |

### Constraints

- **Synchronous execution:** Command hooks run synchronously; Claude waits for the result before proceeding. Must be fast.
- **Default timeout:** 600 seconds for command hooks.
- **`async: true`:** Hooks can run in the background without blocking, but then they cannot return decisions.
- **Environment variables:** `$CLAUDE_PROJECT_DIR` for project root, `$CLAUDE_PLUGIN_ROOT` for plugin root.
- **Transcript access:** All hooks receive `transcript_path` — the full conversation JSONL, which can be parsed for historical analysis.
- **Hook types beyond shell:** Claude Code also supports `type: "prompt"` (single-turn LLM evaluation returning yes/no) and `type: "agent"` (subagent with tool access) hooks. These could theoretically replace custom Node.js analysis — e.g., a Stop prompt hook asking "Is Claude stuck in a loop?" However, they add per-turn LLM API costs and latency, making them better suited as a future refinement than as the primary mechanism. See [Future Extensions](#future-extensions) in the design spec.
- **Exit code 2 varies by event:** Exit code 2 means different things for different hooks — e.g., PreToolUse blocks the tool call, Stop forces continuation, UserPromptSubmit blocks and erases the prompt. Not all events support blocking via exit code 2.

---

## Three Approaches

### Approach A: Pure Hook Accumulator (Shell-based)

**Architecture:** Shell scripts handle all logic — event collection, pattern detection, and decision output.

```
PostToolUse → post-tool-use.sh → append event to JSONL + inline checks
PostToolUseFailure → post-failure.sh → append event to JSONL + inline checks
Stop → stop-hook.sh → read accumulated JSONL + pattern analysis via jq/awk
PreToolUse(Bash) → pre-bash.sh → check for git commit/push patterns
```

**How it works:**
1. `PostToolUse` and `PostToolUseFailure` hooks append structured events to `$TMPDIR/sidecar-monitor-$SESSION_ID.jsonl` using `jq` one-liners
2. Same hooks do inline pattern checks for immediate triggers (e.g., BMAD artifact writes)
3. `Stop` hook reads the accumulated event file, counts patterns with `jq`/`awk`, and decides whether to block stopping
4. `PreToolUse` hook on Bash checks if the command matches `git commit|push|gh pr create`

**Example PostToolUse hook:**
```bash
#!/bin/bash
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
SESSION=$(echo "$INPUT" | jq -r '.session_id')
EVENTS="$TMPDIR/sidecar-monitor-$SESSION.jsonl"

# Append event
echo "$INPUT" | jq -c "{ts: now | todate, tool: .tool_name, file: (.tool_input.file_path // null), success: true}" >> "$EVENTS"

# Quick check: BMAD artifact write
if [ "$TOOL" = "Write" ] || [ "$TOOL" = "Edit" ]; then
  if echo "$FILE" | grep -q '_bmad-output/'; then
    jq -n '{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "IMPORTANT: A BMAD artifact was just written. Consider invoking sidecar-auto-bmad-method-check." } }'
  fi
fi
exit 0
```

**Pros:**
- Zero dependencies beyond `jq` (standard on most systems)
- Self-contained — no Node.js subprocess, no daemon
- Uses existing hook infrastructure directly
- Fast for simple immediate triggers

**Cons:**
- Complex pattern detection (stuck loops, revert-like edits) is extremely fragile in shell/jq
- String comparison for error deduplication requires careful escaping
- No access to structured transcript parsing — would need to parse JSONL with jq
- Maintenance burden: shell scripts with complex logic are hard to test and debug
- Runs synchronously on every tool call — must stay fast

**Best for:** Simple, immediate triggers where the pattern is a single event (git commit → auto-security, BMAD write → auto-bmad-check).

---

### Approach B: Hook Collector + Node.js Analyzer (Recommended)

**Architecture:** Lightweight shell hooks for event collection and immediate triggers; Node.js module for complex analysis at natural decision points (Stop, PreToolUse).

```
PostToolUse → post-tool-use.sh → fast event append + quick BMAD check
PostToolUseFailure → post-failure.sh → fast event append
Stop → stop-hook.sh → node hooks/analyze-patterns.js → block/allow
PreToolUse(Bash) → pre-bash.sh → check for git commit/push/pr
```

**How it works:**
1. `PostToolUse` / `PostToolUseFailure` hooks: fast shell scripts that append a structured event to the session's event file. Also handle immediate triggers (BMAD artifact writes) with quick regex checks.
2. `Stop` hook: shell script invokes `node hooks/analyze-patterns.js` with the transcript path and event file. The Node.js analyzer reads both files, runs pattern detection functions, and outputs a JSON decision.
3. `PreToolUse` (Bash): shell script checks if the command matches commit/push/PR patterns. Pure shell — no Node.js needed for this fast path.

**Why analysis at Stop, not on every tool call:**
- The Stop hook fires when Claude finishes responding — the natural decision point for "should Claude do something else before it stops?"
- Analysis happens once per Claude turn, not once per tool call, so a ~200ms Node.js startup is acceptable
- The Stop hook has access to `last_assistant_message` (Claude's final response) which provides additional signal
- For patterns like "stuck loop" and "implementation complete," the relevant question is always "should Claude stop now, or should it invoke a skill first?"

**Example Stop hook:**
```bash
#!/bin/bash
INPUT=$(cat)
SESSION=$(echo "$INPUT" | jq -r '.session_id')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path')
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active')
EVENTS="$TMPDIR/sidecar-monitor-$SESSION.jsonl"

# Prevent infinite loops: if we already forced continuation, don't do it again
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# Run Node.js analyzer
node "$(dirname "$0")/analyze-patterns.js" "$TRANSCRIPT" "$EVENTS" "$SESSION"
```

**Node.js analyzer outputs:**
```json
{
  "decision": "block",
  "reason": "IMPORTANT: You appear to be stuck in a debugging loop (5 edit→fail cycles on src/auth.js). Consider invoking the sidecar-auto-unblock skill to get fresh ideas from a different model."
}
```

**Pros:**
- Rich analysis: Node.js can parse JSONL transcripts, do fuzzy string matching, detect edit/revert cycles
- Runs at natural decision points (Stop = "should Claude keep going?")
- Shell hooks for fast-path triggers stay lightweight (<10ms per tool call)
- Testable: Node.js module with unit tests, mock transcripts
- Extensible: adding a new pattern is adding a function, not rewriting shell logic

**Cons:**
- ~200ms Node.js startup for the analyzer (acceptable at Stop, not on every tool call)
- Requires Node.js on the system (safe assumption for sidecar users)
- Analysis only at Stop/PreToolUse points — not continuous
- Two languages (shell + Node.js) to maintain

**Best for:** The full spectrum of auto-skill triggers. Simple patterns (git commit, BMAD writes) are handled by fast shell hooks. Complex patterns (stuck loops, implementation completion) are handled by the Node.js analyzer at Stop.

---

### Approach C: Background Watcher Daemon

**Architecture:** A persistent Node.js process runs alongside Claude Code, tailing the transcript file and maintaining real-time behavioral models.

```
SessionStart → start-watcher.sh → spawn background Node.js process
PostToolUse → post-tool-use.sh → append event (watcher also reads transcript)
Stop → stop-hook.sh → read watcher's recommendation file
SessionEnd → cleanup-watcher.sh → kill the daemon
```

**How it works:**
1. `SessionStart` hook spawns a background Node.js process that watches the transcript file (`fs.watch` on `transcript_path`)
2. The watcher maintains in-memory models: edit history per file, error frequency, tool call sequences
3. When patterns are detected, the watcher writes recommendations to `$TMPDIR/sidecar-recommendations-$SESSION_ID.json`
4. `Stop` hook reads the recommendations file and returns decisions
5. `SessionEnd` hook cleans up the daemon process

**Pros:**
- Real-time detection — patterns are identified as they happen, not only at Stop
- Stateful models — can track complex sequences across many turns
- No startup cost at Stop — analysis is pre-computed
- Could enable cross-session learning (persist models between sessions)
- Future potential: proactive mid-turn coaching

**Cons:**
- Daemon lifecycle management: must handle crashes, restarts, orphaned processes
- Still needs hooks for delivery — the daemon can't inject messages directly
- Most complex to implement and debug
- Resource usage: persistent Node.js process per session
- `fs.watch` behavior varies across OS/filesystem
- Overkill for the current set of patterns

**Best for:** A hypothetical future with real-time coaching, proactive mid-turn suggestions, and cross-session pattern learning. Not justified for the current four auto-skills.

---

## Pattern Catalog

Specific detection patterns for each auto-skill, mapping to hook events and signal types.

### auto-unblock

| Hook | Pattern | Signal | Detection Method |
|------|---------|--------|-----------------|
| Stop | Edit→Bash(fail) cycles | 3+ cycles editing the same files followed by failing Bash commands | Parse transcript for interleaved Edit/Write→Bash sequences where Bash exits non-zero. Group by target file. |
| Stop | Same error repeated | Error string appears 3+ times in Bash results | Extract error strings from PostToolUseFailure events and Bash tool responses. Fuzzy-match for repeated patterns (strip line numbers, paths). |
| Stop | Revert-like edits | Edit `new_string` ≈ earlier `old_string` on same file | Compare accumulated Edit events: if a later edit's `new_string` closely matches an earlier edit's `old_string` on the same file, Claude is reverting. |
| Stop | Growing transcript without progress | Many tool calls, few new files/changes | Count unique file paths in Edit/Write events vs. total tool call count. High ratio = thrashing. |

### auto-review

| Hook | Pattern | Signal | Detection Method |
|------|---------|--------|-----------------|
| Stop | Implementation complete | Test pass after 5+ Edit/Write calls, Claude about to stop | Count Edit/Write calls in transcript. Check last Bash results for test-passing patterns (`passing`, `✓`, exit 0 after `npm test`/`pytest`). Claude's `last_assistant_message` contains completion language ("done", "implemented", "complete"). |
| Stop | Large change set | Many Edit/Write calls, shift from writes to reads | Track the ratio of write-tools to read-tools over recent turns. A shift from predominantly Edit/Write to Read/Grep suggests implementation is winding down. |
| Stop | Branch with uncommitted changes | `git status` shows modified files, Claude stopping | Check if recent Bash results contain `git status` output with modified files. |

### auto-security

| Hook | Pattern | Signal | Detection Method |
|------|---------|--------|-----------------|
| PreToolUse | Pre-commit gate | Bash command matches `git commit`, `git push`, `gh pr create` | Regex on `tool_input.command`: `/^\s*(git\s+(commit|push)|gh\s+pr\s+create)/`. Fast shell check. |
| PostToolUse | Staged files | `git add` detected | Regex on Bash `tool_input.command` for `git add`. Set a flag in the event file so the Stop hook knows files were staged. |

### auto-bmad-check

| Hook | Pattern | Signal | Detection Method |
|------|---------|--------|-----------------|
| PostToolUse | Artifact written | Write/Edit to `_bmad-output/` path | Check `tool_input.file_path` against `_bmad-output/` prefix. Immediate `additionalContext` trigger — no need to wait for Stop. |
| PostToolUse | Substantial artifact update | Edit with large `new_string` to `_bmad-output/` | Same path check, plus heuristic on content size (>500 chars of new content suggests substantive change, not a typo fix). |

---

## Comparison Matrix

| Dimension | A: Pure Shell | B: Hook + Node.js (Rec.) | C: Background Daemon |
|-----------|--------------|--------------------------|---------------------|
| **Implementation complexity** | Low | Medium | High |
| **Pattern detection reliability** | Low for complex patterns | High — full Node.js capabilities | Highest — stateful models |
| **Latency impact** | <10ms per hook (fast) | <10ms per tool hook; ~200ms at Stop | <10ms per hook (pre-computed) |
| **Maintenance burden** | High (shell complexity grows) | Medium (two languages, but testable) | High (daemon lifecycle) |
| **Extensibility** | Hard to add complex patterns | Easy — add a function | Easy — add a model |
| **Testability** | Hard (shell scripts) | Good (Node.js unit tests) | Good but integration is complex |
| **Dependencies** | `jq` only | Node.js + `jq` | Node.js + `jq` + process management |
| **Failure mode** | Silent (no output = allow) | Silent (analyzer crash = allow) | Daemon crash = no recommendations |
| **Resource usage** | Negligible | Negligible (Node.js only at Stop) | Persistent process per session |
| **Transcript analysis** | Fragile (jq on JSONL) | Native (Node.js JSONL parsing) | Native + real-time |
| **Cross-session learning** | Not feasible | Possible with state files | Natural fit |
| **Current auto-skill coverage** | 2/4 reliable (security, bmad) | 4/4 reliable | 4/4 reliable |

---

## Recommendation: Approach B

**Approach B (Hook Collector + Node.js Analyzer)** is recommended for the following reasons:

1. **Right tool for the job.** Simple triggers (git commit, BMAD writes) use fast shell hooks. Complex triggers (stuck loops, implementation completion) use Node.js at the Stop hook — where a 200ms startup is negligible compared to Claude's response time.

2. **Natural decision point.** The Stop hook answers exactly the right question: "Should Claude stop, or should it invoke an auto-skill first?" This is when all four auto-skills need to be evaluated.

3. **Testable and maintainable.** The Node.js analyzer can be unit-tested with mock transcripts. Each pattern detector is an independent function. Adding a new pattern means adding a function and a test, not rewriting shell logic.

4. **Incremental deployment.** Start with `PreToolUse` (auto-security) and `PostToolUse` (auto-bmad-check) — these are pure shell, zero risk. Then add the Stop hook with the Node.js analyzer for auto-unblock and auto-review.

5. **Avoids daemon complexity.** Approach C's benefits (real-time detection, stateful models) aren't needed for the current four auto-skills. The Stop hook fires frequently enough — every time Claude finishes responding — to catch patterns in time.

6. **Builds toward Approach C.** If future auto-skills need real-time detection, the event file and analyzer module from Approach B are directly reusable as the foundation for a daemon.

### Migration path

- **Phase 1:** Shell hooks for PreToolUse (security) and PostToolUse (BMAD) — immediate, no Node.js
- **Phase 2:** Stop hook with Node.js analyzer for unblock and review patterns
- **Phase 3 (future):** If needed, promote the analyzer to a persistent daemon (Approach C)

---

## Phase 1 Must-Haves

Beyond hook scripts and pattern detection, Phase 1 requires user-facing controls, configuration, and clear communication about what gets installed. This section covers the five must-haves that ship alongside the hooks themselves.

### 1. Disabling Auto-Skills

Two trigger paths exist, and both need disable controls:

**Description-matching path** (SKILL.md-based): Each SKILL.md gains a Step 0 that checks `autoSkills.<name>.enabled` in sidecar config before doing anything. If the skill is disabled, it silently skips — no output, no side effects.

**Activity monitoring path** (shell hooks): The hooks themselves check `monitoring.enabled` and per-pattern `enabled` flags in config before collecting events or making decisions. A disabled hook exits immediately with code 0.

**Master kill switch:** Setting `autoSkills.enabled: false` disables both paths entirely — no SKILL.md Step 0 proceeds, no shell hook collects events or fires triggers.

**Per-project override (future):** A `.sidecar.json` in the project root could override user-level config (e.g., disable auto-security for a trusted internal repo). Not in Phase 1, but the config namespace is designed to support it.

**In-session:** Users can say "don't use auto-skills" in conversation. This works today — all auto-skills already ask for confirmation before proceeding, so Claude simply won't invoke them if told not to. No config change needed for this path.

### 2. Config Namespace

All auto-skill configuration lives under `autoSkills` in `~/.config/sidecar/config.json`:

```json
{
  "autoSkills": {
    "enabled": true,
    "review": { "enabled": true },
    "unblock": { "enabled": true },
    "security": { "enabled": true },
    "bmadMethodCheck": { "enabled": true }
  },
  "monitoring": { "enabled": true, "patterns": { "..." : "..." } }
}
```

Each SKILL.md's Step 0 reads this config via `sidecar_guide` or a dedicated config-check mechanism to determine whether to proceed. Shell hooks read the same config at the shell level (parsed with `jq` from the JSON file) to decide whether to collect events or fire triggers.

The `monitoring` key controls the activity-monitoring path independently — it can be enabled while individual skills under `autoSkills` are disabled, or vice versa. This separation allows event collection to continue (for debugging or future analysis) even when specific skill triggers are turned off.

### 3. CLI Command (`sidecar auto-skills`)

A new CLI command provides the primary interface for managing auto-skill state:

| Command | Effect |
|---------|--------|
| `sidecar auto-skills` | Lists status of all auto-skills (enabled/disabled) |
| `sidecar auto-skills --off` | Disables all auto-skills |
| `sidecar auto-skills --on` | Enables all auto-skills |
| `sidecar auto-skills --off review security` | Disables specific skills by name |
| `sidecar auto-skills --on unblock` | Enables a specific skill by name |

All commands read and write `~/.config/sidecar/config.json`. The status display shows both the master switch and per-skill state, so users can see at a glance what's active. Invalid skill names produce a clear error listing valid options.

### 4. First-Run Notice

When `scripts/postinstall.js` registers hooks during installation, it prints a clear message to the terminal:

- **What was installed:** Which hooks were added and where (e.g., "Registered PreToolUse and PostToolUse hooks in `~/.claude/settings.json`")
- **What they do:** One-sentence summary of the auto-skill system ("Auto-skills monitor tool usage patterns and suggest security scans, code reviews, and unblock assistance")
- **How to disable:** The exact command to turn everything off (`sidecar auto-skills --off`)
- **Where config lives:** The path to `~/.config/sidecar/config.json`

This notice fires once — postinstall only runs on `npm install`. Users who install via global npm (`npm install -g claude-sidecar`) see it in their terminal. Users who clone and `npm install` locally see it there.

### 5. Phase 1 vs Phase 2 Scope

**Phase 1 (this PR):** The minimal viable set of hooks, config, and controls:

- Shell hooks for `PreToolUse` (auto-security gate on git commit/push/PR creation)
- Shell hooks for `PostToolUse` (BMAD artifact trigger + event collection to session JSONL)
- `autoSkills` config namespace in `~/.config/sidecar/config.json`
- `sidecar auto-skills` CLI command for enable/disable management
- SKILL.md Step 0 checks in each auto-skill's frontmatter
- First-run notice in `postinstall.js`

**Phase 2 (future PR):** The Node.js analyzer and complex pattern detection:

- `Stop` hook invoking `node hooks/analyze-patterns.js` for decision-point analysis
- Auto-unblock pattern detection (edit→fail cycles, repeated errors, revert detection)
- Auto-review pattern detection (implementation completion, large change sets, test passing)
- Transcript parsing and fuzzy matching in the Node.js analyzer module
- Unit tests with mock transcripts for each pattern detector

This split follows the recommendation in [Approach B](#approach-b-hook-collector--nodejs-analyzer-recommended): start with the fast shell hooks that carry zero risk, then layer in the sophisticated analysis once the foundation is proven.

---

## References

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — official hooks API documentation
- [docs/auto-skill-invocation-proposal.md](auto-skill-invocation-proposal.md) — existing proposal (Proposals A/B/C for skill discovery)
- `skill/auto-*/SKILL.md` — current trigger descriptions and thresholds
- `scripts/postinstall.js` — hook registration would be added here
- `src/mcp-tools.js` — MCP tool definitions for context
