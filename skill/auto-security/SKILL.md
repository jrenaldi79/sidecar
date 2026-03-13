---
name: sidecar-auto-security
description: >
  Use when the user asks to commit changes, push code, or create a pull request. Offers to
  spawn a sidecar to audit the diff for security vulnerabilities before the commit/push/PR
  proceeds. TRIGGER when: user says "commit", "push", "create a PR", "open a PR", or you are
  about to run git commit, git push, or gh pr create in conversational flow. Does NOT trigger
  on slash commands like /commit or /commit-push-pr (those execute in isolated contexts).
  Complements commit-commands:commit — runs before the commit proceeds.
---

# Auto-Security: Pre-Commit Security Scan via Sidecar

## Purpose

Before committing, pushing, or creating a PR, offer to spawn a headless sidecar to audit the changes for security vulnerabilities. Catches issues like hardcoded secrets, injection flaws, and auth bypass before they reach the repository.

## When This Skill Fires

- The user asks to commit, push, or create a PR in conversation (e.g., "commit my changes", "let's push this", "create a PR")
- You are about to run `git commit`, `git push`, or `gh pr create` in normal conversational flow

**This skill does NOT fire on:**
- Slash commands (`/commit`, `/commit-push-pr`) — those execute in their own isolated context and cannot be intercepted by skills

**Skip this skill when:**
- Changes contain zero executable code (only `*.md` files, only code comments, only whitespace)
- Changes are trivially safe (bumping a version number in `package.json` with no other changes)
- A security sidecar already ran for these exact changes
- An auto-review sidecar already ran for these same changes (its briefing covers security concerns)
- The `mcp__sidecar__sidecar_start` tool is not available in this environment (sidecar not installed)
- The diff is empty (nothing staged or unstaged to commit)

## Procedure

### Step 0: Check if this skill is enabled

Call `mcp__sidecar__sidecar_guide` with the question "Is auto-skill 'security' enabled?" If the guide response indicates the skill is disabled (either master switch off or per-skill disabled), **silently skip this entire skill** — produce no output, no prompt, no side effects. Just stop here.

If `sidecar_guide` is unavailable, proceed (assume enabled by default).

### Step 1: Discover available models and prompt the user

Before presenting the prompt, call `mcp__sidecar__sidecar_guide` to get the configured model alias table. Extract the alias names (e.g., `gemini`, `gpt`, `opus`) from the guide output. If the guide call fails, fall back to: "your configured models (run `sidecar setup` to see them)".

Then present this confirmation prompt:

```text
Sidecar security scan before commit?

  1. Yes → send to: [default model]
     (or specify models: e.g. "1 gemini gpt" for multi-model audit)
  2. No → skip, proceed with commit

Available models: <list aliases from sidecar_guide>
Full provider/model IDs also accepted (e.g., google/gemini-3.1-flash).
```

Wait for the user's response:
- **"1"** or **"yes"**: Proceed with the security scan before committing
- **"1 gemini"** or **"1 gpt opus"**: Proceed with the specified model(s). If multiple models given, spawn one sidecar per model (all headless, in parallel).
- **"2"** or **"no"** or **"skip"**: Skip the scan and proceed directly with the commit/push/PR.
- Any other bypass phrase ("skip sidecar", "no sidecars", "just commit", "no scan", "commit without review", etc.): Skip.

**Do not proceed past this step without the user's explicit choice.** If the user chooses to skip, go straight to the commit flow.

### Step 2: Capture the diff

Choose the right diff for the operation:
- **For commits:** Run `git diff --cached` (staged changes only). This matches what will actually be committed. If the staged diff is empty but `git diff` shows unstaged changes, inform the user that nothing is staged and skip the scan.
- **For PRs/pushes:** Resolve the base branch using this fallback order: (1) `git symbolic-ref refs/remotes/origin/HEAD` to get the remote's default branch, (2) `@{upstream}` if no `origin` remote exists, (3) check if `main` or `master` branches exist locally, (4) ask the user. Then run `git diff $(git merge-base HEAD <base-branch>)...HEAD` to capture the full branch diff, not just the current working tree. This catches security issues from earlier commits on the branch.

**If the diff is empty**, tell the user there are no changes to audit and skip to the commit flow. For commits, this means the staged diff is empty. For PRs/pushes, this means the branch diff against the default branch is empty (no commits to push).

**If the diff exceeds ~500 lines**, prioritize files by security relevance rather than truncating arbitrarily. Include in full: files handling authentication/authorization, user input processing, API route definitions, database queries, cryptographic operations, CI/CD configuration (`.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, etc.), and any files containing secrets-adjacent patterns (environment config, credential setup). Deprioritize: tests, documentation, static assets, generated code. Truncate to ~100,000 characters max. For very large diffs, provide file paths and change summaries instead of raw diff — the Plan agent has `read_file` access and can read the source files directly.

### Step 3: Spawn the sidecar(s) — BEFORE starting the commit

**Important: Run the security scan FIRST, before executing the commit.** Do not start the commit in parallel. Wait for the scan to complete (or timeout) before proceeding. This ensures critical vulnerabilities are caught before they enter the repository.

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
- **agent: "Plan"** — read-only and headless-safe. Do not change to Chat (stalls in headless mode).
- **timeout**: Omitted — sidecar uses its platform default (currently 15 minutes). Only override if the user requests a specific timeout.
- **includeContext: true** — passes the parent conversation history to the sidecar, giving it visibility into prior discussion, error output, and what was implemented. Note: the Plan agent always has `read_file` access to the repository regardless of this flag — `includeContext` controls conversation context, not file access.
- **parentSession**: Pass your Claude Code session UUID if available (e.g., from `session_id` in hook input). This ensures accurate context matching when multiple sessions are active. If unknown, omit this parameter entirely — do not guess from filesystem.

If spawning multiple sidecars, launch them all in parallel. Save each task ID.

Tell the user:

> "Running security scan with [model name(s)]. This usually takes a minute or two."

**Briefing template** — fill in the placeholders:

```text
## Security Audit — Pre-Commit Review

**Objective:** Audit these code changes for security vulnerabilities.

**Changes:**
<paste the git diff output here>

**Check for:**
- Injection vulnerabilities (SQL, command, XSS, template injection)
- Authentication/authorization bypass
- Hardcoded secrets, API keys, tokens, or credentials
- Insecure data handling (PII exposure, missing encryption, logging sensitive data)
- OWASP Top 10 issues
- Unsafe deserialization
- Path traversal
- Missing input validation at trust boundaries
- Insecure cryptographic practices
- SSRF, open redirects
- CI/CD pipeline tampering (modified workflow files, build scripts, or deployment configs)
- New dependencies that look suspicious (typosquatting, unnecessary permissions, unmaintained packages)

**Output format:** List only confirmed or high-confidence issues. For each:
- **Severity:** critical / high / medium
- **File and line:** where the issue is
- **Description:** what's wrong
- **Attack vector:** how an attacker would exploit this (be specific — describe the input, the path through the code, and the impact). If you cannot articulate a concrete attack vector, downgrade or drop the finding.
- **Suggested fix:** how to resolve it

If no security issues found, say: "No security issues identified."
```

### Step 4: Poll for completion, then proceed

After spawning, poll each sidecar's status using `mcp__sidecar__sidecar_status` with the saved task ID, following the polling cadence indicated by `sidecar_status` responses. Continue polling while status is `running`; treat `complete`, `timeout`, `crashed`, `error`, and `aborted` as terminal. Only then read the output using `mcp__sidecar__sidecar_read`. If multiple models were used, label each result (e.g., "Gemini audit:", "GPT audit:"). Then:

- **If critical/high severity issues found:** **Do not proceed with the commit.** Surface the findings: "Security scan found issues that should be addressed before committing:" — then list them and offer to fix.
- **If medium severity issues found:** Surface them as warnings and let the user decide: "Security scan flagged some medium-severity items. Want to address these before committing, or proceed?"
- **If no issues:** Proceed with the commit normally. Briefly note: "Security scan came back clean."
- **If the sidecar timed out:** Tell the user the scan timed out and ask if they want to proceed anyway or wait for a retry.
- **If `mcp__sidecar__sidecar_read` fails:** Sidecar may not be installed. Mention once and proceed with the commit.

After resolving the scan results, proceed with the normal commit/push/PR flow.

## Future: Configurable Settings

The following settings are currently hardcoded in this skill. If sidecar adds an `autoSkills` config namespace, they could be moved to `autoSkills.security.*` in `~/.config/sidecar/config.json`:

| Setting | Current Default | Description |
|---------|----------------|-------------|
| `autoSkills.security.largeDiffThreshold` | 500 lines | Line count above which diff is summarized by security relevance |
| `autoSkills.security.maxBriefingChars` | 100,000 | Upper bound on briefing prompt size |
| `autoSkills.security.blockingMode` | sequential | Whether scan blocks commit (sequential) or runs in parallel |
| `autoSkills.security.timeout` | 15 min | Max time for sidecar to complete scan (currently hardcoded in sidecar platform) |
