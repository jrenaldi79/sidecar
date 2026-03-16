# Codex CLI Subagent Backend

**Date:** 2026-03-16
**Status:** Draft

## Problem

Sidecar has lightweight subagent concepts and storage, but it does not yet have a Sidecar-owned external subagent backend that feels close to OpenCode's native subagent flow.

The current goal is not to make Codex a Sidecar host. The goal is to let Claude Code and Cowork launched Sidecars spawn Codex as a downstream non-interactive worker using the local `codex` CLI, while preserving Sidecar's existing subagent patterns as closely as possible.

For the first slice, this should stay intentionally local and skunk-works:

- rely on a locally working `codex` CLI
- avoid auth translation or token reuse
- normalize Codex output into Sidecar records
- postpone broader docs and product claims until the workflow proves useful

## Goals

- Make Codex feel like another Sidecar subagent backend, not a special one-off command.
- Preserve the current OpenCode-style subagent patterns across invocation, lifecycle, output, and permissions.
- Use the non-interactive `codex exec` surface, not interactive Codex sessions.
- Persist Codex subagents under the existing Sidecar subagent session layout.
- Capture enough streaming state to support progress visibility and debugging without exposing raw Codex JSON everywhere.

## Non-Goals

- Making Codex a first-class Sidecar host.
- Reusing ChatGPT or Codex subscription auth through copied tokens or local auth file import.
- Perfect feature parity with OpenCode child sessions on day one.
- Resume, fork, or session-history parity unless Codex session identifiers prove easy to map cleanly later.
- Storing raw Codex JSONL as a first-class artifact in v1.

## Recommended Approach

Build a small Codex subagent backend around `codex exec --json`.

This backend should:

1. create a subagent session directory under the parent Sidecar task
2. compose a Codex task briefing from the parent Sidecar context
3. spawn `codex exec` as a subprocess in the project directory
4. translate streamed Codex JSONL events into Sidecar conversation and progress records
5. save a normalized final summary into the subagent session
6. mark the subagent with Sidecar-style final status metadata

This is preferred over a final-output-only shim because the event stream gives us a path to preserve lifecycle and progress patterns that already matter for OpenCode-backed Sidecar runs.

## Architecture

### Backend Boundary

Add a small runner boundary so Sidecar can support multiple subagent backends with similar semantics:

- `OpenCodeSubagentRunner`
- `CodexSubagentRunner`

The initial implementation only needs to introduce the Codex runner and a thin selection layer where Sidecar decides which backend to use for a subagent.

### Session Shape

Codex subagents should reuse the existing directory pattern:

`.claude/sidecar_sessions/<parentTaskId>/subagents/<subagentId>/`

With the same core files:

- `metadata.json`
- `conversation.jsonl`
- `summary.md`

V1 may also write stderr to a backend-specific debug file for diagnosis, but should not expose raw Codex JSONL as the primary record.

### Prompting Model

The parent Sidecar should explicitly build the Codex task briefing. We should not try to infer Claude Code or Cowork conversation state from Codex, and we should not pretend Codex has native access to parent-host context.

The briefing should preserve the same high-level subagent semantics as OpenCode:

- clear task statement
- project context
- constraints
- expected deliverable

## Invocation And Permission Mapping

The parent-facing contract should stay aligned with current OpenCode subagent concepts.

Initial mapping:

- `Explore` -> `codex exec --json --sandbox read-only`
- `General` -> `codex exec --json --sandbox workspace-write`

Additional command behavior for v1:

- run in the project cwd
- pass prompt by stdin or argument, whichever is more robust for multiline briefings
- let Codex use its configured default model unless Sidecar explicitly overrides it later
- rely on the user's existing Codex CLI login/config instead of building any auth bridge

This preserves permission shape without claiming that Codex and OpenCode are identical under the hood.

## Lifecycle Design

Codex subagents should follow Sidecar's existing status model as closely as possible:

- `running` when the subprocess starts and the subagent session is created
- `complete` when Codex returns a usable final answer and exits successfully
- `error` when the subprocess exits non-zero, required output is missing, or event parsing fails
- `aborted` when Sidecar explicitly terminates the Codex subprocess

The parent session should be able to observe incremental progress while the subprocess runs.

One current compatibility wrinkle is that persisted status handling is not fully unified across the codebase today. Some modules and docs already refer to statuses like `aborted` and `crashed`, while `src/session-manager.js` still centers a smaller constant set. The Codex backend should align with the statuses Sidecar actually wants to expose, and this work may need to tighten that status model instead of assuming it is already canonical.

## Event Normalization

Use `codex exec --json` and translate the minimum useful event set into backend-agnostic Sidecar records.

V1 normalization priorities:

- assistant text deltas or messages -> append normalized assistant content to `conversation.jsonl`
- tool invocation style events -> record as Sidecar tool-use style entries when possible
- progress/status events -> update Sidecar progress state
- final message/result event -> derive `summary.md`

The important design choice is normalization, not raw event exposure. Sidecar readers and future UI should consume a stable internal model even if the Codex event schema evolves.

If event coverage is incomplete at first, correctness of final status and final summary matters more than perfect fidelity for every intermediate event.

Another current wrinkle is that Sidecar's progress labels are still OpenCode-oriented in places. The Codex backend should either reuse only backend-agnostic progress stages or extend the progress model so Codex-specific execution does not look misleadingly like OpenCode server startup.

## Metadata Additions

`metadata.json` for Codex subagents should include enough backend detail for diagnosis:

- `backend: "codex"`
- `agentType`
- `pid`
- `status`
- `createdAt`
- `completedAt`
- `exitCode`
- `sandboxMode`
- optional error fields such as `reason`

This keeps the file compatible with existing Sidecar subagent listings while giving us enough backend-specific debugging detail.

## Error Handling

- Fail fast if `codex` is not installed or `codex exec --help` cannot run.
- Capture stderr to a file so auth, config, or sandbox failures are inspectable.
- Treat malformed JSONL as a backend error, but preserve enough raw context to debug the failure.
- If Codex emits a useful final message but exits unexpectedly, record that clearly in metadata instead of silently dropping the result.
- Ensure abort logic kills the Codex subprocess and updates subagent status consistently.

## Verification

The first implementation slice should verify:

1. `Explore` maps to read-only Codex sandboxing.
2. `General` maps to writable Codex sandboxing.
3. A Codex subagent creates the expected session files under the parent Sidecar task.
4. Streaming execution produces meaningful normalized Sidecar conversation or progress updates before completion.
5. Final summary output is saved to `summary.md` and final status is correct.
6. Abort behavior terminates the subprocess and leaves a sane final metadata state.

Manual local verification is acceptable for the first slice as long as the implementation also adds unit coverage around process launching, event normalization, and status transitions.

## Implementation Notes

The current codebase already provides useful building blocks:

- subagent session storage helpers in `src/session-manager.js`
- headless conversation and tool-call logging patterns in `src/headless.js`
- subprocess-oriented lifecycle patterns elsewhere in Sidecar's CLI and MCP flows

The repo also contains some subagent-oriented documentation and helper APIs, including OpenCode child-session helpers. What is not yet clearly wired in the current runtime code is a complete Sidecar-owned subagent orchestration path that persists, monitors, and finalizes external subagents end to end. This work should therefore be treated as the first explicit external subagent backend, not as a minor extension of a mature existing system.

## Open Questions

- Where should backend selection live so Codex subagents can be introduced without over-abstracting too early?
- Which Codex JSON event types are sufficient for a useful v1 normalization layer?
- Do we want to store a raw event trace later behind a debug flag if normalized records prove insufficient?

## Recommendation

Proceed with a narrow event-stream adapter:

1. implement `CodexSubagentRunner` around `codex exec --json`
2. map `Explore` and `General` to Codex sandbox modes
3. persist normalized Sidecar records under the existing subagent session layout
4. keep docs and product claims intentionally minimal until the local workflow proves valuable

This gives Sidecar a real external subagent backend while staying close to OpenCode-style subagent behavior and avoiding premature productization.
