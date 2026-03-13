---
name: sidecar-auto-bmad-method-check
description: >
  Use when a BMAD-METHOD workflow has just produced an output artifact (PRD, architecture doc,
  epics, story file, etc.) and the user has not yet finalized it or moved to the next workflow
  step. Offers to spawn sidecar(s) for a second-opinion review of the artifact along with its
  input documents, then presents each model's suggestions sequentially for Claude to evaluate
  and the user to approve. TRIGGER when: a BMAD planning or implementation artifact has just
  been written or substantially updated in _bmad-output/, the artifact is substantive (not a
  trivial edit), and the user is at a natural checkpoint before proceeding. Does NOT trigger
  if _bmad/bmm/config.yaml is missing (BMAD-METHOD not installed), if the artifact is a minor
  edit, or if a sidecar review already ran for this artifact version.
---

# Auto-BMAD-Method-Check: Artifact Review via Sidecar

## Purpose

When a BMAD-METHOD workflow produces a key artifact — PRD, architecture doc, epics, story file, or other checkpoint document — offer to send it to one or more sidecar models for a second opinion before the user finalizes and moves to the next workflow step. Claude evaluates each model's suggestions against the artifact and its input documents, presents an informed opinion, and the user decides what to apply. Multiple models are spawned and processed sequentially — each successive model reviews the artifact *after* changes from prior models have been applied, creating a genuine multi-model refinement pipeline.

## Artifact Scope

This skill covers planning and key implementation artifacts where a second opinion catches costly mistakes:

| Artifact | Phase | Input Documents |
|---|---|---|
| `product-brief.md` | Analysis | `brainstorming-report.md`, `research-*.md` (if they exist) |
| `PRD.md` | Planning | `product-brief.md` (if exists) |
| `ux-design-specification.md` | Planning | `PRD.md` |
| `architecture.md` | Solutioning | `PRD.md`, `ux-design-specification.md` (if exists) |
| `epics.md` (or sharded `epics/` dir) | Solutioning | `PRD.md`, `architecture.md` |
| `story-*.md` | Implementation | `epics.md`, `PRD.md`, `architecture.md`, `sprint-status.yaml` |
| `sprint-change-proposal-*.md` | Implementation | `PRD.md`, `epics.md`, affected `story-*.md` files |
| `epic-*-retro-*.md` | Implementation | All `story-*.md` in that epic, previous retro (if exists) |

**Scope rationale:** This table is intentionally selective — it covers high-leverage checkpoint artifacts where a second opinion catches costly mistakes. Lower-leverage artifacts (`brainstorming-report.md`, `research-*.md`, `sprint-status.yaml`, `project-context.md`) and non-persisted gates (Implementation Readiness) are excluded. ADRs produced alongside `architecture.md` are reviewed as part of the architecture artifact, not separately.

## When This Skill Fires

- A BMAD workflow has just written or substantially updated one of the artifacts above
- The user has not yet finalized the artifact or moved to the next workflow step
- The artifact represents a natural BMAD checkpoint where human review is expected

**Skip this skill when:**
- `_bmad/bmm/config.yaml` does not exist in the project root (BMAD-METHOD not installed — this skill is designed specifically for the BMAD-METHOD framework at https://github.com/bmad-code-org/BMAD-METHOD)
- `_bmad-output/` directory does not exist (no artifact output location)
- The artifact change is trivial (typo fix, formatting, comment edit)
- A sidecar review already ran for this artifact version
- The user is in Quick Flow (`tech-spec.md`, `quick-dev`) — those have their own review cycle
- The `mcp__sidecar__sidecar_start` tool is not available in this environment (sidecar not installed)

## Procedure

### Step 0: Check config and verify BMAD-METHOD installation

First, call `mcp__sidecar__sidecar_guide` with the question "Is auto-skill 'bmadMethodCheck' enabled?" If the guide response indicates the skill is disabled (either master switch off or per-skill disabled), **silently skip this entire skill** — produce no output, no prompt, no side effects. Just stop here. If `sidecar_guide` is unavailable, proceed (assume enabled by default).

Then check that the BMAD-METHOD is installed in the current project:

1. Look for `_bmad/bmm/config.yaml` in the project root
2. Look for `_bmad-output/` directory

If either is missing, do not fire this skill. Do not mention it to the user — silently skip.

### Step 1: Discover available models and prompt the user

Before presenting the prompt, call `mcp__sidecar__sidecar_guide` to get the configured model alias table. Extract the alias names (e.g., `gemini`, `gpt`, `opus`) from the guide output. If the guide call fails, fall back to: "your configured models (run `sidecar setup` to see them)".

Identify the artifact that was just produced and present the confirmation prompt:

```text
BMAD artifact review — [artifact name]?

This [artifact type] is ready for second-opinion review before you finalize.

  1. Yes → send to: [default model]
     (or specify models: e.g. "1 gemini gpt" for multi-model sequential review)
  2. No → skip and finalize

If multiple models selected, each reviews sequentially — later models
see improvements from earlier rounds. I'll evaluate each suggestion
and give my opinion before you decide.

Available models: <list aliases from sidecar_guide>
Full provider/model IDs also accepted (e.g., google/gemini-3.1-flash).
```

Wait for the user's response:
- **"1"** or **"yes"**: Proceed with the user's configured default model
- **"1 gemini"** or **"1 gpt opus"**: Proceed with the specified model(s). If multiple models given, spawn and process them sequentially in the order specified — each model reviews the artifact after changes from prior models have been applied.
- **"2"** or **"no"** or **"skip"**: Skip this skill. Proceed with finalization.
- Any other bypass phrase ("skip sidecar", "no review", "finalize", etc.): Skip.

**Do not proceed past this step without the user's explicit choice.**

### Step 2: Gather context

1. **Read the output artifact** in full. This is the primary document under review — never truncate it.

2. **Resolve input documents.** Use this priority order:
   - First, check if the artifact itself references its input documents (many BMAD artifacts cite their sources in headers, metadata, or "References" sections)
   - If no references found, fall back to the Artifact Scope table above
   - Scan `_bmad-output/planning-artifacts/` and `_bmad-output/implementation-artifacts/` for matching files
   - For glob patterns (e.g., `research-*.md`, `story-*.md`), collect all matching files
   - **Large input sets:** If a glob matches many files (e.g., 10+ stories for a retrospective), list all paths in the briefing but mark the most directly relevant ones (e.g., same-epic completed stories, previous retro). The sidecar can read additional files on demand via `read_file`.

3. **Collect input document paths and descriptions.** For each input document, note its file path and a one-line description of what it contains (e.g., "`_bmad-output/planning-artifacts/PRD.md` — functional and non-functional requirements"). Do NOT read or paste their full content into the briefing — the sidecar has `read_file` access and will read them directly. This saves significant context in the parent session.

4. **Sharded artifacts (e.g., `epics/` directory):** If the artifact is a directory of shard files rather than a single file, concatenate all shards into the briefing with clear `--- filename.md ---` headers between each. Apply approved changes to the specific shard file(s) they target, not to a single monolithic file. When listing the artifact in the briefing, note that it spans multiple files so the sidecar references the correct shard in its findings.

5. **Truncation guidance:** The output artifact should always be included in full (it's what's being reviewed). If even the artifact alone exceeds ~80,000 characters, truncate to the most relevant sections and note what was omitted so the sidecar can use `read_file` for the rest.

### Step 3: Spawn the first sidecar

Spawn a sidecar for the **first** (or only) model the user selected. Call `mcp__sidecar__sidecar_start` with:

```text
model: <first model from user's selection, or omit for default>
agent: "Plan"
noUi: true
includeContext: true
parentSession: <your Claude Code session UUID, if known>
prompt: <briefing below>
```

Notes on parameters:
- **model**: Use the first model the user selected. If they just said "1" with no model specified, omit this parameter to use their configured default.
- **agent: "Plan"** — read-only and headless-safe. The sidecar reviews but does not modify files.
- **timeout**: Omitted — sidecar uses its platform default (currently 15 minutes). Only override if the user requests a specific timeout.
- **includeContext: true** — passes the parent conversation history to the sidecar, giving it visibility into the workflow discussion that produced the artifact. The Plan agent also has `read_file` access to the repository for additional context.
- **parentSession**: Pass your Claude Code session UUID if available (e.g., from `session_id` in hook input). This ensures accurate context matching when multiple sessions are active. If unknown, omit this parameter entirely — do not guess from filesystem.

Save the task ID. If the user selected multiple models, subsequent models are spawned in Step 4e **after** the current model's approved changes have been applied to the artifact. This ensures each model reviews the improved version, not the original.

**Briefing template** — fill in the placeholders:

```text
## BMAD Artifact Review — [Artifact Type]

**Objective:** Review this BMAD-METHOD artifact for completeness, internal consistency,
alignment with upstream documents, and quality. This artifact was produced by the
[workflow name] workflow and is at a checkpoint before the user finalizes it.

**Artifact under review:**
<artifact filename and full content>

**Input documents (upstream context) — read these with your file tools:**
<for each input document: file path and one-line description>
Use your read_file tool to examine these documents. They contain the upstream
decisions and requirements that this artifact must align with.

**BMAD-METHOD context:**
This project uses the BMAD-METHOD framework (https://github.com/bmad-code-org/BMAD-METHOD).
The artifact above was produced by the [agent name] agent during the [phase name] phase.
The next workflow step will be [next step description].

**Review this artifact for:**

1. **Completeness** — Are there gaps, missing sections, or requirements from the input
   documents that aren't addressed? Are there implicit assumptions that should be explicit?

2. **Internal consistency** — Does the artifact contradict itself? Are terms used
   consistently? Do sections reference each other correctly?

3. **Upstream alignment** — Does this artifact faithfully reflect decisions made in its
   input documents? Flag any drift, contradiction, or silent omission of upstream
   requirements.

4. **Quality and clarity** — Is the writing clear and unambiguous? Would the next
   agent/workflow in the BMAD pipeline be able to use this artifact effectively?
   Are acceptance criteria testable? Are architecture decisions justified?

5. **Risk and gaps** — What risks or edge cases does this artifact not address?
   What questions should be resolved before moving to the next phase?

**Do NOT flag:** Stylistic preferences, formatting opinions, or suggestions for
scope expansion beyond what the input documents require.

**Output format:** For each finding:
- **Category:** completeness | consistency | alignment | quality | risk
- **Severity:** critical (blocks next phase) | important (should fix) | suggestion (nice to have)
- **Location:** section or line reference in the artifact
- **Finding:** what's wrong or missing
- **Evidence:** quote from input document or artifact that supports this finding
- **Suggested fix:** concrete recommendation

If no issues found, say: "No issues identified — artifact is ready to finalize."
```

Tell the user:

> "Sidecar review started with [model name(s)]. I'll present findings for each model as they complete."

### Step 4: Sequential review loop

Process models in the order the user specified them. For each model:

**4a. Poll and read results**

Run `sleep 25` in your shell before the first and every subsequent `mcp__sidecar__sidecar_status` call — this enforces the mandatory polling interval and prevents token waste. Continue polling while status is `running`; treat `complete`, `timeout`, `crashed`, `error`, and `aborted` as terminal. Once terminal, read the output using `mcp__sidecar__sidecar_read`.

**4b. Claude evaluates each suggestion**

For each finding the sidecar returned, evaluate it against:
- The artifact content — is the finding accurate?
- The input documents — does the suggestion align with upstream decisions?
- BMAD method conventions — does it follow the framework's patterns and expectations?
- Prior models' changes (if this is Model 2+) — does it conflict with already-applied changes?

**4c. Present to user with Claude's opinion**

Format the presentation as:

```text
Review from [Model Name]:

Finding 1: [summary]
  Sidecar says: [the suggestion]
  My assessment: [Agree / Disagree / Partially agree] — [reasoning]
  Recommendation: [Apply / Skip / Modify to...]

Finding 2: ...
  ...

Summary: [N] findings — I recommend applying [X], skipping [Y].
Which changes would you like to apply? (all / none / list numbers, e.g. "1 3 5")
```

**4d. Apply approved changes**

For each change the user approves:
- Update the artifact in place
- If a suggestion needs modification (user or Claude adjusted it), apply the modified version

**4e. Spawn next model (if any)**

If there are more models to process:
- Re-read the now-updated artifact (with all approved changes applied)
- Spawn the next model's sidecar using `mcp__sidecar__sidecar_start` with the same parameters as Step 3, but with the **updated artifact content** in the briefing
- This ensures the next model reviews the improved version, not the original
- Poll, read, and evaluate the next model's results the same way (repeat 4a–4d)
- When presenting: flag explicitly if this model raised something the previous model missed, or contradicts a change already applied
- **If a model fails or times out mid-pipeline:** Preserve all changes already applied from prior models. Inform the user briefly (e.g., "[model] timed out after 15 minutes"). Continue to the next model in the queue using the current artifact state. The user can choose to retry the failed model later or proceed without it.

### Step 5: Consolidation check

After all models have been processed and changes applied:

**If changes were minor (1-3 small edits):** Perform a quick internal coherence check yourself — re-read the updated artifact and verify the edits flow naturally. Report briefly: "Applied changes look coherent. Ready to finalize."

**If changes were substantial (4+ edits, or structural changes across multiple sections):** Re-read the full updated artifact and check for:
- New contradictions or redundancies introduced by the edits
- Sections that no longer flow coherently after patching in changes
- Content that was inadvertently weakened or removed

If you spot issues, fix them and note what you adjusted. If the artifact needs deeper review after heavy edits, offer a sidecar consolidation round:

```text
This artifact had substantial edits from [N] reviews. Want a final
consolidation review with [model] to check coherence, or finalize as-is?
```

If the user wants a sidecar round, spawn one with the updated artifact only (no input documents) focused on internal consistency. Process results the same way: evaluate, present, user approves.

### Step 6: Completion

After the review process (with or without consolidation):

> "Artifact review complete. [Summarize: N changes applied from M models, or no changes needed.] Ready to proceed with the next BMAD workflow step."

**If all models failed/timed out:** Mention briefly and let the user decide whether to retry or finalize as-is.

**If `mcp__sidecar__sidecar_read` fails:** Sidecar may not be installed or configured. Mention once and proceed.

## Future: Configurable Settings

The following settings are currently hardcoded in this skill. If sidecar adds an `autoSkills` config namespace, they could be moved to `autoSkills.bmadMethodCheck.*` in `~/.config/sidecar/config.json`:

| Setting | Current Default | Description |
|---------|----------------|-------------|
| `autoSkills.bmadMethodCheck.maxBriefingChars` | 80,000 | Upper bound on total briefing content before summarizing inputs |
| `autoSkills.bmadMethodCheck.agent` | Plan | Agent mode for review sidecar |
| `autoSkills.bmadMethodCheck.timeout` | 15 min | Max time per sidecar round (currently hardcoded in sidecar platform) |
| `autoSkills.bmadMethodCheck.artifactDir` | `_bmad-output/` | Root directory for BMAD artifacts |
| `autoSkills.bmadMethodCheck.skipQuickFlow` | true | Whether to skip Quick Flow artifacts |
