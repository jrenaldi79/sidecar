---
name: sidecar-auto-review
description: >
  Use after completing a feature implementation, bug fix, or significant code change — before
  claiming the work is done. Offers to spawn a sidecar with a different model to review the
  changes for bugs, missed edge cases, and quality issues. TRIGGER when: you have finished
  implementing changes, tests pass (or no tests to run), and you are about to tell the user
  "done" or summarize the completed work. Do NOT trigger for trivial one-line changes, config
  edits, or documentation-only changes.
---

# Auto-Review: Post-Implementation Sidecar Review

## Purpose

Before claiming work is complete, offer to spawn a headless sidecar to get a second opinion on the changes from a different model. This catches bugs, missed edge cases, and quality issues that you may have overlooked.

## When This Skill Fires

- You have finished implementing a feature, bug fix, or significant refactor
- Tests pass (or there are no relevant tests)
- You are about to tell the user the work is done

**Skip this skill when:**
- Changes are trivial (single-line fix, config change, docs-only)
- You are in the middle of iterating and not yet done
- A sidecar review is already running or was just completed for these changes
- An auto-security sidecar is about to run for the same changes (avoid duplicate scans)
- The `mcp__sidecar__sidecar_start` tool is not available in this environment (sidecar not installed)
- The diff is empty (all changes already committed, nothing to review)

## Procedure

### Step 1: Discover available models and prompt the user

Before presenting the prompt, call `mcp__sidecar__sidecar_guide` to get the configured model alias table. Extract the alias names (e.g., `gemini`, `gpt`, `opus`) from the guide output. If the guide call fails, fall back to: "your configured models (run `sidecar setup` to see them)".

Then present this confirmation prompt:

```text
Sidecar code review?

  1. Yes → send to: [default model]
     (or specify models: e.g. "1 gemini gpt" for multi-model review)
  2. No → skip

Available models: <list aliases from sidecar_guide>
Full provider/model IDs also accepted (e.g., google/gemini-3.1-flash).
```

Wait for the user's response:
- **"1"** or **"yes"**: Proceed with the user's configured default model
- **"1 gemini"** or **"1 gpt opus"**: Proceed with the specified model(s). If multiple models given, spawn one sidecar per model (all headless, in parallel).
- **"2"** or **"no"** or **"skip"**: Skip this skill entirely. Deliver your completion message and stop.
- Any other bypass phrase ("skip sidecar", "no sidecars", "we're good", etc.): Skip.

**Do not proceed past this step without the user's explicit choice.**

### Step 2: Capture the diff

Run both `git diff` (unstaged changes) and `git diff --cached` (staged changes). Combine them into a single diff block before checking whether the review diff is empty.

**If the combined diff is empty**, tell the user there is nothing to review and skip.

**If the diff exceeds ~500 lines**, do not paste the raw diff. Instead:
- Run `git diff --stat` and include the output — this gives the reviewer a compact map of the blast radius (which files changed and by how much) before it dives into specifics
- Set `includeContext: true` in the sidecar call to pass conversation context (what was implemented and why)
- Provide a summary of what changed in each file
- The sidecar in Plan mode has full `read_file` access to the repository, so this is sufficient

**If the diff is under ~500 lines**, paste it directly into the briefing.

### Step 3: Spawn the sidecar(s)

For **each model** the user selected, call `mcp__sidecar__sidecar_start` with:

```text
model: <user's chosen model, or omit for default>
agent: "Plan"
noUi: true
includeContext: false
prompt: <briefing below>
```

Notes on parameters:
- **model**: Use the model(s) the user selected in Step 1. If they just said "1" with no model specified, omit this parameter to use their configured default.
- **agent: "Plan"** — read-only and headless-safe. Do not change to Chat (stalls in headless mode).
- **timeout**: Omitted — sidecar uses its platform default (currently 15 minutes). Only override if the user requests a specific timeout.
- **includeContext: false** — briefing is self-contained. Override to `true` for large diffs (see Step 2) to pass conversation context about what was implemented. Note: the Plan agent always has `read_file` access to the repository regardless of this flag — `includeContext` controls conversation context, not file access.

If spawning multiple sidecars, launch them all in parallel. Save each task ID.

**Briefing template** — fill in the placeholders:

```text
## Code Review Request

**Objective:** Review these code changes for bugs, logic errors, missed edge cases, and code quality issues.

**Changes:**
<paste the git diff output here, OR for large diffs: include `git diff --stat` output, list file paths, and summarize changes. Note: you have full read_file access to the repository — use it to read surrounding code, imports, and tests when you need broader context.>

**Context:** These changes were made to <brief description of what was implemented/fixed>.

**Validation performed:**
<List tests that were run and their results, e.g., "npm test — 47/47 passing", "manual test of endpoint X — returned expected response". If no tests exist, say so. This tells you what's already verified so you can focus on gaps.>

**Focus on:**
- Logic errors and off-by-one mistakes
- Missing error handling at trust boundaries
- Edge cases not covered
- Security concerns (injection, auth bypass, data exposure)
- Race conditions or concurrency issues
- Test adequacy: are new/modified tests happy-path only, or do they exercise edge cases and error paths?
- Hardcoded values that should be configurable, dynamic, or derived (magic numbers, hardcoded lists, environment-specific paths)
- Dependency changes: if package.json, Cargo.toml, requirements.txt, or similar manifests are in the diff, check for unnecessary new dependencies, version conflicts, or overly broad version ranges
- Anything that looks wrong or fragile

**Do NOT flag:** Style preferences, naming opinions, minor nits, or suggestions for additional features. Only report issues you're confident about.

**Output format:** If issues found, list each with: severity (critical/high/medium), file and location, description, proof of failure (a concrete scenario — e.g., "if input X is null, line Y will throw TypeError" — that demonstrates how the bug manifests; if you cannot construct one, downgrade or drop the finding), and suggested fix. If no issues found, say "No issues identified."
```

### Step 4: Continue with your completion message

Do NOT block on the sidecar. Tell the user the work is done and mention the review is running:

> "I've completed the implementation. Sidecar review running — I'll share findings when it completes."

### Step 5: When the sidecar(s) complete

Poll each sidecar's status using `mcp__sidecar__sidecar_status` with the saved task ID, following the polling cadence indicated by `sidecar_status` responses. Continue polling while status is `running`; treat `complete`, `timeout`, `crashed`, `error`, and `aborted` as terminal. Once terminal, read the output using `mcp__sidecar__sidecar_read`. If multiple models were used, label each result (e.g., "Gemini review:", "GPT review:"). Then:

- **If substantive issues found:** Surface them as "Second opinion from review sidecar:" and offer to fix.
- **If no issues:** Briefly note: "Sidecar review came back clean — no issues found."
- **If the sidecar failed/timed out:** Mention it briefly and move on. Don't retry.
- **If `mcp__sidecar__sidecar_read` fails:** The sidecar may not be installed or configured. Mention once and move on.

## Future: Configurable Settings

The following settings are currently hardcoded in this skill. If sidecar adds an `autoSkills` config namespace, they could be moved to `autoSkills.review.*` in `~/.config/sidecar/config.json`:

| Setting | Current Default | Description |
|---------|----------------|-------------|
| `autoSkills.review.largeDiffThreshold` | 500 lines | Line count above which diff is summarized instead of pasted |
| `autoSkills.review.maxBriefingChars` | 100,000 | Upper bound on briefing prompt size |
| `autoSkills.review.agent` | Plan | Agent mode for review sidecar (Plan vs Build) |
| `autoSkills.review.timeout` | 15 min | Max time for sidecar to complete review (currently hardcoded in sidecar platform) |
