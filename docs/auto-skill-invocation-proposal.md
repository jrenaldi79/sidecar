# Proposal: Improving Auto-Skill Invocation Reliability

## Context

PR #7 (`feat/auto-sidecar-skills`) introduces four auto-skills for sidecar: `auto-review`, `auto-unblock`, `auto-security`, and `auto-bmad-method-check`. These are contextual skills that fire automatically at key workflow moments (post-implementation review, stuck debugging, pre-commit security scan, BMAD artifact checkpoints).

During development of the PR, we researched how Claude Code discovers and invokes skills, and found a significant reliability issue with how skills are installed. This proposal documents the findings and the changes made in the PR to address them, plus suggestions for further improvements that could be made in sidecar independently.

## Summary

Auto-skills need to be reliably discovered and invoked by Claude Code when their trigger conditions are met. The key finding: **Claude Code only scans top-level `~/.claude/skills/*/SKILL.md`** for its available skills list. Skills nested deeper than one level are invisible.

## The Problem

The initial version of the PR installed auto-skills as nested subdirectories under the main sidecar skill:

```text
~/.claude/skills/sidecar/           ← discovered ✅
~/.claude/skills/sidecar/auto-review/    ← NOT discovered ❌
~/.claude/skills/sidecar/auto-unblock/   ← NOT discovered ❌
~/.claude/skills/sidecar/auto-security/  ← NOT discovered ❌
```

Nested skills don't appear in the system reminder Claude evaluates every turn, so Claude has no reason to invoke them unless something else prompts a skill check.

## How Claude Code Skill Discovery Works

Every turn, Claude sees a system reminder listing available skills with their `description` fields from SKILL.md frontmatter. This is the primary mechanism for contextual skill invocation — Claude pattern-matches descriptions against conversation state and invokes matching skills.

The pipeline:
1. Skill tool scans `~/.claude/skills/*/SKILL.md` and plugin skill directories
2. Skill names + descriptions appear in the "available skills" system reminder
3. Claude evaluates descriptions against conversation state each turn
4. If a description matches → Claude reads the full SKILL.md and follows its procedure

Skills not in this list are effectively invisible unless something else (like the Superpowers plugin) forces Claude to do a broader filesystem scan.

## What's Been Addressed in PR #7

The following changes are included in the PR to address the discovery issue.

### 1. Top-level installation

Auto-skills are installed as top-level skill directories:

```text
~/.claude/skills/sidecar-auto-review/       ← discovered ✅
~/.claude/skills/sidecar-auto-unblock/      ← discovered ✅
~/.claude/skills/sidecar-auto-security/     ← discovered ✅
~/.claude/skills/sidecar-auto-bmad-method-check/ ← discovered ✅
```

The `sidecar-` prefix keeps them namespaced. `postinstall.js` handles the installation and cleans up the old nested location on upgrade.

### 2. Dual invocation: auto-fire + manual

Each auto-skill now supports both:
- **Auto-fire** — Claude sees trigger descriptions in the skills list every turn and invokes when conditions match
- **Manual invocation** — users can type `/sidecar-auto-review`, `/sidecar-auto-security`, etc. to force invocation

### 3. Cross-reference in main SKILL.md

The main `skill/SKILL.md` now includes an "Auto-Skills" section with a table listing all four auto-skills and their trigger conditions. This gives Claude a second discovery path when reading the main sidecar skill.

### Verified result

After installing locally with these changes, the system reminder includes all four auto-skills:

```text
- sidecar-auto-review: Use after completing a feature implementation, bug fix, or
  significant code change — before claiming the work is done...
- sidecar-auto-unblock: Use when you have attempted 5 or more different approaches
  to fix a bug, pass a test, or solve a problem and none have worked...
- sidecar-auto-security: Use when the user asks to commit changes, push code, or
  create a pull request...
- sidecar-auto-bmad-method-check: Use when a BMAD-METHOD workflow has just produced
  an output artifact...
```

## Suggestions for Further Improvement

The following are ideas for future work in sidecar — separate from PR #7 — that could further improve auto-skill reliability.

### Proposal A: SessionStart Hook

**What:** Register a lightweight SessionStart hook that injects a compact auto-skills reminder into the system prompt on every session start, resume, clear, and compact.

**Why:** This is the pattern used by the Superpowers plugin to achieve near-100% invocation reliability. Superpowers registers a synchronous SessionStart hook that injects skill-checking instructions into the system prompt. The skills list visibility from PR #7 is good, but a SessionStart hook would add a second independent triggering path — particularly valuable for users who don't have Superpowers installed.

**Sketch:** A `hooks/hooks.json` registered during postinstall, with a SessionStart hook that injects a compact reminder listing the four auto-skills and their trigger conditions. The hook would fire on startup, resume, clear, and compact events.

**Open question:** Does the Claude Code hooks API support system prompt injection for third-party packages, or only for plugins? This would affect the implementation approach.

**Trade-off:** Adds ~200 bytes to the system prompt on every session. Minimal cost for significant reliability improvement.

### Proposal B: Auto-Skills Config Namespace

**What:** Add an `autoSkills` section to `~/.config/sidecar/config.json` for user-configurable enable/disable and defaults.

**Why:** Users may want to disable specific auto-skills (e.g., skip security scans on personal projects) or set default models per skill (e.g., always use `gemini-pro` for code review).

**Example config:**
```json
{
  "autoSkills": {
    "review": { "enabled": true, "model": "gemini" },
    "unblock": { "enabled": true, "attemptThreshold": 5 },
    "security": { "enabled": true },
    "bmadMethodCheck": { "enabled": true, "artifactDir": "_bmad-output/" }
  }
}
```

**How it would work:** Each auto-skill's SKILL.md would check config on invocation (via `sidecar_guide` or a new MCP tool) and skip if disabled. Default models from config would be used when the user doesn't specify one.

**Trade-off:** Higher implementation effort. Probably best deferred until auto-skills have been used in practice and real user preferences emerge.

### Proposal C: Community Auto-Skills

**What:** Document the auto-skill convention so third parties can contribute their own.

**Why:** The infrastructure already supports it — `postinstall.js` uses `fs.readdirSync` to dynamically discover `skill/auto-*` directories, so adding a new auto-skill is just adding a directory with a `SKILL.md`. No hardcoded lists to update.

**Convention:**
1. Create `skill/auto-<name>/SKILL.md` with standard frontmatter
2. Use `name: sidecar-auto-<name>` in frontmatter
3. Include `TRIGGER when:` clause in description
4. Postinstall automatically discovers and installs it as `~/.claude/skills/sidecar-auto-<name>/`

**Trade-off:** Mainly a documentation effort. Could be a section in the README or a `CONTRIBUTING.md` addition.

## Recommended Priority

| Proposal | Effort | Impact | Suggested Timeline |
|----------|--------|--------|-------------------|
| **A: SessionStart hook** | Medium | High — guarantees awareness every session | Next PR |
| **B: Config namespace** | High | Medium — useful once patterns are established | After community feedback |
| **C: Community auto-skills** | Low | Medium — enables ecosystem growth | Anytime (docs only) |

Happy to discuss any of these or help with implementation. The auto-skills PR (#7) is independent of these proposals — they're suggestions for future sidecar development regardless of whether the PR is merged as-is or modified.
