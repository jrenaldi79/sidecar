# BMAD-METHOD Workflow Reference

Reference for the auto-bmad-method-check skill. Captures all workflows, artifacts, dependencies, and checkpoints.

## Phases & Workflows

| Phase | Workflow | Agent | Input Dependencies | Output Artifact | Checkpoint |
|---|---|---|---|---|---|
| **1: Analysis** (optional) | Brainstorming | Mary (Analyst) | None | `brainstorming-report.md` | Human reviews report |
| | Market Research | Mary | None (needs web search) | `research-*.md` | Human reviews findings |
| | Domain Research | Mary | None | `research-*.md` | Human reviews findings |
| | Technical Research | Mary | None | `research-*.md` | Human reviews findings |
| | Create Product Brief | Mary | Brainstorming/research (optional) | `product-brief.md` | Human reviews brief |
| **2: Planning** (required) | Create PRD | John (PM) | Product brief (optional) | `PRD.md` | Human reviews PRD |
| | Validate PRD | John | `PRD.md` | Validation report | Human reviews findings |
| | Edit PRD | John | `PRD.md` | Updated `PRD.md` | Human reviews edits |
| | Create UX Design | Sally (UX) | `PRD.md` | `ux-design-specification.md` | Human reviews UX spec |
| **3: Solutioning** | Create Architecture | Winston (Architect) | `PRD.md` (+ UX spec optional) | `architecture.md` + ADRs | Human reviews arch decisions |
| | Create Epics & Stories | John | `PRD.md` + `architecture.md` | `epics.md` (or sharded) | Human reviews breakdown |
| | Check Implementation Readiness | Winston/John | PRD + Architecture + Epics (+ UX) | PASS / CONCERNS / FAIL | **Gate** — must pass before Phase 4 |
| **4: Implementation** | Sprint Planning | Bob (SM) | Epics files | `sprint-status.yaml` | One-time setup |
| | Sprint Status | Bob | `sprint-status.yaml` | Status summary + risk flags | Informational |
| | Create Story | Bob | Sprint status + Epics + all artifacts | `story-{e}-{s}-{slug}.md` | Human reviews story before dev |
| | Dev Story | Amelia (Dev) | Story file (status: ready-for-dev) | Working code + tests | HALTs on blockers |
| | Code Review | Amelia/Barry | Story file + git changes | Approved or Changes Requested | Human decides on action items |
| | Correct Course | Bob/John | PRD + Epics + sprint context | `sprint-change-proposal-*.md` | Human approves proposal |
| | Retrospective | Bob | All completed stories in epic | `epic-{N}-retro-{date}.md` | Significant Discovery Alert if assumptions shifted |
| **Quick Flow** | Quick Spec | Barry (Solo Dev) | None | `tech-spec.md` | Human reviews spec |
| | Quick Dev | Barry | `tech-spec.md` or direct instructions | Working code + tests | Self-review then human |
| **Cross-cutting** | Generate Project Context | Mary | Codebase scan | `project-context.md` | Used by 7+ workflows |
| | BMad Help | Any | Project state inspection | Next-step guidance | Runs after every workflow |

## Dependency Chain

```text
Brainstorming/Research ──> Product Brief ──> PRD ──> UX Design (optional)
                                               ├──> Architecture
                                               └──> Architecture ──> Epics/Stories
                                                                       │
                                              Implementation Readiness <┘ (GATE)
                                                        │
                                              Sprint Planning (once)
                                                        │
                                              Create Story ──> Dev Story ──> Code Review
                                                   ^                             │
                                                   └─────── (next story) ────────┘
                                                                                 │
                                              Epic complete ──> Retrospective ───┘
```

## Artifact-to-Input Mapping

Used by auto-bmad-method-check to determine which input documents to include in sidecar reviews.

| Output Artifact | Input Documents |
|---|---|
| `brainstorming-report.md` | None (freeform ideation) |
| `research-*.md` | None (primary research) |
| `product-brief.md` | `brainstorming-report.md`, `research-*.md` (if they exist) |
| `PRD.md` | `product-brief.md` (if exists) |
| `ux-design-specification.md` | `PRD.md` |
| `architecture.md` | `PRD.md`, `ux-design-specification.md` (if exists) |
| `epics.md` | `PRD.md`, `architecture.md` |
| Implementation Readiness | `PRD.md`, `architecture.md`, `epics.md`, `ux-design-specification.md` (if exists) |
| `sprint-status.yaml` | `epics.md` |
| `story-*.md` | `epics.md`, `PRD.md`, `architecture.md`, `sprint-status.yaml` |
| `sprint-change-proposal-*.md` | `PRD.md`, `epics.md`, affected `story-*.md` files |
| `epic-*-retro-*.md` | All `story-*.md` in that epic, previous retro (if exists) |
| `tech-spec.md` | None (Quick Flow — standalone) |

## Agents

| Agent | Name | Personality | Primary Workflows |
|---|---|---|---|
| Analyst | Mary | "Excited treasure hunter" | Brainstorming, Research, Product Brief, Project Context |
| Product Manager | John | "Asks WHY relentlessly like a detective" | PRD, Validate/Edit PRD, Epics, Readiness Check, Course Correction |
| Architect | Winston | "Calm, pragmatic tones" | Architecture, Readiness Check |
| Scrum Master | Bob | "Crisp, checklist-driven, zero ambiguity tolerance" | Sprint Planning/Status, Create Story, Retrospective, Course Correction |
| Developer | Amelia | "Ultra-succinct, speaks in file paths" | Dev Story, Code Review |
| UX Designer | Sally | "Paints pictures with words" | UX Design |
| Quick Flow Solo Dev | Barry | "Direct, no fluff, just results" | Quick Spec, Quick Dev, Code Review |
| Tech Writer | Paige | "Patient educator" | Document Project |

## Key Design Principles

- **Micro-file architecture**: Steps loaded one at a time to prevent LLM "lost in middle" issues
- **Human must approve** every step transition — no autonomous progression
- **Fresh conversations** per workflow to keep context clean
- **Scale-adaptive**: Quick Flow (1-15 stories), BMad Method (10-50+), Enterprise (30+)
- **`project-context.md`** acts as the "constitution" for consistent AI agent behavior

## Standard Artifact Locations

```text
_bmad-output/
  planning-artifacts/
    brainstorming-report.md
    product-brief.md
    research-*.md
    PRD.md
    ux-design-specification.md
    architecture.md
    epics.md (or epics/ directory)
    sprint-change-proposal-*.md
  implementation-artifacts/
    sprint-status.yaml
    story-*.md
    epic-*-retro-*.md
  project-context.md
```
