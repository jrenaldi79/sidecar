---
name: sidecar-auto-unblock
description: >
  Use when you have attempted 5 or more different approaches to fix a bug, pass a test, or
  solve a problem and none have worked. Offers to spawn a sidecar brainstorming session with
  a different model to get fresh debugging suggestions via an iterative "have you considered
  trying..." loop. TRIGGER when: you are stuck in a debugging loop, have tried multiple fixes
  that all failed, and are running out of ideas. Complements superpowers:systematic-debugging
  — fires when systematic debugging has been exhausted. A "distinct approach" means a
  meaningfully different strategy, not a minor variation (e.g., changing a type annotation
  is not a distinct approach from the previous attempt). The attempt threshold (default: 5)
  and max brainstorming iterations (default: 20) are configurable.
---

# Auto-Unblock: Escape Debugging Ruts with a Sidecar

## Purpose

When you're stuck — multiple approaches tried, all failing — offer to spawn a sidecar brainstorming session with a different model. Rather than trying to pass the full codebase (which rarely works well), this skill uses an iterative Q&A loop: the sidecar suggests ideas, Claude evaluates them against what it knows, and feeds back which ones won't work and why — prompting the sidecar to dig deeper.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `attempt_threshold` | **5** | Number of distinct failed approaches before this skill offers to fire |
| `max_iterations` | **20** | Maximum brainstorming round-trips before stopping the loop |

## When This Skill Fires

- You have tried **5 or more meaningfully distinct approaches** to fix a bug or pass a test
- Each approach has failed (not just minor variations like tweaking a value)
- You recognize you are going in circles or running out of ideas

**Skip this skill when:**
- You've only tried 4 or fewer approaches (keep debugging first)
- The failure is a simple typo or config issue you just spotted
- A sidecar is already running for this problem
- The `mcp__sidecar__sidecar_start` tool is not available in this environment (sidecar not installed)

## Procedure

### Step 0: Check if this skill is enabled

Call `mcp__sidecar__sidecar_guide` with the question "Is auto-skill 'unblock' enabled?" If the guide response indicates the skill is disabled (either master switch off or per-skill disabled), **silently skip this entire skill** — produce no output, no prompt, no side effects. Just stop here.

If `sidecar_guide` is unavailable, proceed (assume enabled by default).

### Step 1: Discover available models and prompt the user

Before presenting the prompt, call `mcp__sidecar__sidecar_guide` to get the configured model alias table. Extract the alias names (e.g., `gemini`, `gpt`, `opus`) from the guide output. If the guide call fails, fall back to: "your configured models (run `sidecar setup` to see them)".

Acknowledge you're stuck, then present the confirmation prompt:

```text
I've tried [N] approaches and none have resolved this.

Sidecar brainstorming session?

  1. Yes → brainstorm with: [default model]
     (or specify models: e.g. "1 gemini gpt" for multi-model brainstorm)
  2. No → skip (I'll keep debugging)

The sidecar will suggest ideas in an iterative loop. I'll evaluate
each suggestion and feed back why it won't work, prompting deeper
ideas — up to 20 rounds.

Available models: <list aliases from sidecar_guide>
Full provider/model IDs also accepted (e.g., google/gemini-3.1-flash).
```

Wait for the user's response:
- **"1"** or **"yes"**: Proceed with the user's configured default model
- **"1 gemini"** or **"1 gpt opus"**: Proceed with the specified model(s). If multiple models given, spawn one sidecar per model (all headless, in parallel).
- **"2"** or **"no"** or **"skip"**: Skip this skill. Continue debugging or ask the user for direction.
- Any other bypass phrase ("skip sidecar", "no sidecars", "I'll handle it", etc.): Skip.

**Do not proceed past this step without the user's explicit choice.**

### Step 2: Gather context for the initial briefing

Collect:
- **The problem:** Error messages, failing test output, symptoms
- **Approaches tried:** Be concrete — reference actual commands you ran, files you edited, and the exact error output each attempt produced. Do not paraphrase from memory; review your tool history (shell commands, file edits) to provide accurate evidence of what was tried and what happened.
- **Relevant code:** Key file paths and brief descriptions (the sidecar may have limited local context — describe the relevant architecture concisely rather than assuming it can explore the codebase)
- **Your hypothesis:** What you suspect but haven't confirmed
- **Constraints:** Anything the sidecar should know (e.g., "this is a legacy system, can't upgrade dependencies")

**Rubber duck effect:** The discipline of gathering and organizing this context often surfaces the answer. If you solve the problem while writing the briefing, skip the sidecar spawn — tell the user what clicked and proceed with the fix.

**Truncation guidance:** If error output exceeds ~50 lines, include only the first and last 20 lines plus the core error message, and note that output was truncated. Keep the total briefing under ~100,000 characters.

### Step 3: Spawn the sidecar(s) — initial brainstorm

For **each model** the user selected, call `mcp__sidecar__sidecar_start` with:

```text
model: <user's chosen model, or omit for default>
agent: "Plan"
noUi: true
includeContext: true
parentSession: <your Claude Code session UUID, if known>
prompt: <briefing below>
```

Notes on parameters:
- **model**: Use the model(s) the user selected in Step 1. If they just said "1" with no model specified, omit this parameter to use their configured default.
- **agent: "Plan"** — headless-safe, read-only. The sidecar's role is to brainstorm, not to execute.
- **timeout**: Omitted — sidecar uses its platform default (currently 15 minutes). Only override if the user requests a specific timeout.
- **includeContext: true** — passes the parent conversation history to the sidecar, giving it visibility into prior debugging attempts, error output, and tool results. Note: `includeContext` controls conversation context, not file access — the Plan agent always has `read_file` access regardless.
- **parentSession**: Pass your Claude Code session UUID if available (e.g., from `session_id` in hook input). This ensures accurate context matching when multiple sessions are active. If unknown, omit this parameter entirely — do not guess from filesystem.

If spawning multiple sidecars, launch them all in parallel. Save each task ID per model. In subsequent rounds, track each model's task ID independently — each `sidecar_start` returns a new task ID.

**Initial briefing template** — fill in the placeholders:

```text
## Debugging Brainstorm — Fresh Ideas Needed

I'm stuck on a bug and need your help brainstorming. I'll describe the situation and you suggest ideas. I'll tell you which ones won't work and why, and you can refine. You may have limited codebase context, so I'll provide relevant details below.

**Problem:** <describe the error/symptom>

**Tech stack / architecture:** <brief description of relevant tech, frameworks, patterns>

**Approaches already tried** (be specific — include actual commands, edits, and error output):
1. <Approach 1>: <what you changed/ran> — Result: <exact error or outcome>
2. <Approach 2>: <what you changed/ran> — Result: <exact error or outcome>
<list all approaches>

**Error output:**
<paste the latest error — truncate to ~50 lines if longer>

**Key files involved:**
<file paths with brief descriptions of what each does and how they relate>

**What I suspect but haven't confirmed:**
<your current hypothesis>

**Constraints:**
<anything the sidecar should know — e.g., can't upgrade deps, must support X>

**What I need from you:**
1. **Challenge my assumptions.** What am I taking for granted that might be wrong? (e.g., "You assume this library is thread-safe — is it?" or "You assume the config is loaded before this runs — verify that.") List 2-3 hidden assumptions worth testing.
2. **Suggest 3-5 concrete debugging approaches** I haven't tried. For each, explain the reasoning and what it would confirm or rule out. Think laterally — the obvious approaches have failed.
3. **Design a diagnostic probe.** For your most promising suggestion, describe a minimal experiment to isolate the failure — e.g., a specific print/log statement to add, a value to hardcode temporarily, or a minimal reproduction case. Tell me exactly what to do and what the result would confirm or rule out.
4. **Ask me for specifics.** If you need to see a particular code snippet, config file, log output, directory listing, environment variables, or dependency tree to give better suggestions, tell me exactly what to provide in the next round.
```

Tell the user:

> "Sidecar brainstorming session started with [model name(s)]. I'll share the first round of suggestions when it responds."

### Step 4: Iterative brainstorming loop

Poll each sidecar's status using `mcp__sidecar__sidecar_status` with the saved task ID, following the polling cadence indicated by `sidecar_status` responses. Continue polling while status is `running`; treat `complete`, `timeout`, `crashed`, `error`, and `aborted` as terminal. Once terminal, read the output using `mcp__sidecar__sidecar_read`.

**For each suggestion the sidecar returns:**

1. **Evaluate it** against your knowledge of the codebase and prior attempts
2. **If promising:** Present it to the user and try it. If it works, stop the loop. If it fails, continue to step 3.
3. **If already tried or clearly won't work:** Note why in a follow-up briefing
4. **If the sidecar requests code snippets or files:** Provide them in the next follow-up briefing. The sidecar may have limited codebase context — fulfilling its requests for specific code, config, or logs helps it give better-targeted suggestions.
5. **If needs more info:** Note what info would help

**User check-in (every 5 rounds):** At rounds 5, 10, and 15, pause the loop and check in with the user before continuing. Briefly summarize what's been tried, what's been learned, and ask whether to continue, redirect, or stop. This prevents the two agents from spiraling into theoretical territory without human course correction.

**Multi-model narrowing:** If the user selected multiple models, run all of them for round 1. From round 2 onward, continue with only the model that produced the most useful suggestions — this avoids combinatorial fan-out (N models × 20 rounds). Mention which model you're continuing with and why.

**After evaluating all suggestions from a round**, if none solved the problem and you haven't hit the max iterations (20) and it's not a check-in round, spawn a fresh sidecar using `mcp__sidecar__sidecar_start` (not `sidecar_continue`):

```text
model: <same model as initial round>
agent: "Plan"
noUi: true
includeContext: true
parentSession: <same session UUID as initial round>
prompt: <follow-up briefing below>
```

**Why `sidecar_start` instead of `sidecar_continue`:** Each brainstorming round should be an independent read-only session. Using fresh `sidecar_start` with `agent: "Plan"` ensures each round is isolated and read-only, avoiding any risk of the sidecar making unintended changes. The follow-up briefing includes full context from prior rounds, so conversation continuity is preserved in the prompt itself. Save the new task ID returned by each round for status polling.

After spawning, poll status using `mcp__sidecar__sidecar_status` (following the polling cadence indicated by `sidecar_status` responses) while `running`; treat `complete`, `timeout`, `crashed`, `error`, and `aborted` as terminal. Once terminal, read with `mcp__sidecar__sidecar_read`.

**Follow-up briefing template:**

```text
## Round [N] — Here's what happened

**Suggestions that didn't work:**
- <Suggestion A>: Tried it — <what happened, why it failed>
- <Suggestion B>: Can't work because <reason based on codebase knowledge>
- <Suggestion C>: Already tried in approach #3 (see above)

**Code/config you requested:**
<If the sidecar asked to see specific code, config, or logs, paste them here. If it didn't ask, omit this section.>

**New information uncovered:**
<any new error messages, observations, or clues from trying the suggestions>

**What's still unexplained:**
<the core mystery that remains>

**Important:** Be concise in your reasoning — focus on actionable suggestions rather than lengthy analysis. Long responses risk hitting output token limits.

Please suggest 3-5 more approaches, avoiding the ones above. Go deeper — consider less obvious causes like:
- Environment/config issues
- Race conditions or timing
- Upstream dependencies behaving differently than expected
- Incorrect assumptions about how a library/framework works
- Data-related issues (encoding, format, edge cases)
```

**Loop termination conditions** (stop and report to user):
- A suggestion works (problem solved)
- The user says to stop (including during a check-in)
- Max iterations reached (default: 20)
- The sidecar starts repeating suggestions already tried
- The sidecar gives up or says it's out of ideas

### Step 5: Report results

After the loop ends, summarize for the user:

- **If solved:** Report what worked and which round/suggestion cracked it.
- **If max iterations reached:** Summarize the most promising unexplored angles and ask the user for guidance.
- **If sidecar ran out of ideas:** Acknowledge it, list any partially-promising leads, and ask the user what to try next.
- **If the sidecar failed/timed out:** Mention it briefly and continue debugging or ask the user.
- **If `mcp__sidecar__sidecar_read` fails:** Sidecar may not be installed. Mention once and continue.

## Future: Configurable Settings

The following settings are currently hardcoded in this skill. If sidecar adds an `autoSkills` config namespace, they could be moved to `autoSkills.unblock.*` in `~/.config/sidecar/config.json`:

| Setting | Current Default | Description |
|---------|----------------|-------------|
| `autoSkills.unblock.attemptThreshold` | 5 | Failed approaches before skill offers to fire |
| `autoSkills.unblock.maxIterations` | 20 | Maximum brainstorming round-trips |
| `autoSkills.unblock.userCheckinInterval` | 5 | Rounds between mandatory user check-ins |
| `autoSkills.unblock.suggestionsPerRound` | 3-5 | Number of suggestions requested per round |
| `autoSkills.unblock.maxBriefingChars` | 100,000 | Upper bound on briefing prompt size |
| `autoSkills.unblock.errorTruncationLines` | 50 | Max lines of error output in briefing |
| `autoSkills.unblock.timeout` | 15 min | Max time per sidecar round (currently hardcoded in sidecar platform) |
