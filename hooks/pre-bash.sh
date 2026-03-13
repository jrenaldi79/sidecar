#!/usr/bin/env bash
# PreToolUse hook: intercept git commit/push/PR creation for auto-security.
#
# Reads JSON from stdin (Claude Code hook contract).
# If the Bash command is a git commit, git push, or gh pr create,
# injects additionalContext recommending auto-security scan.
#
# Phase 1: shell-only, no Node.js dependency.

set -euo pipefail

# Safety guard: exit if this script was removed but hook still registered
[ -f "$0" ] || exit 0

# ── Config check ──────────────────────────────────────────────────────
# Note: jq's // operator treats false as falsy, so we use explicit type checks
CONFIG_PATH="${HOME}/.config/sidecar/config.json"
if [ -f "$CONFIG_PATH" ] && command -v jq >/dev/null 2>&1; then
  MASTER=$(jq -r '.autoSkills.enabled | if type == "boolean" then . else true end' "$CONFIG_PATH" 2>/dev/null || echo "true")
  SECURITY=$(jq -r '.autoSkills.security.enabled | if type == "boolean" then . else true end' "$CONFIG_PATH" 2>/dev/null || echo "true")
  if [ "$MASTER" = "false" ] || [ "$SECURITY" = "false" ]; then
    exit 0
  fi
fi

# ── Read stdin to temp file (avoid ARG_MAX on large payloads) ─────────
# If mktemp fails (disk full, permissions), allow the command through
# rather than blocking git operations with a non-zero exit.
TMP_JSON=$(mktemp 2>/dev/null) || exit 0
trap 'rm -f "$TMP_JSON"' EXIT
cat > "$TMP_JSON"

# Extract the Bash command from tool_input.command
COMMAND=""
if command -v jq >/dev/null 2>&1; then
  COMMAND=$(jq -r '.tool_input.command // ""' "$TMP_JSON" 2>/dev/null || echo "")
fi

# If jq not available or command empty, allow through
if [ -z "$COMMAND" ]; then
  exit 0
fi

# ── Pattern match ─────────────────────────────────────────────────────
# Check for git commit, git push, gh pr create
# Uses printf (not echo) to avoid flag injection with commands starting with -n/-e
# Includes semicolons in boundary pattern to catch "git add .; git commit"
IS_COMMIT=false
if printf '%s\n' "$COMMAND" | grep -qE '(^|[;&|]+[[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
  IS_COMMIT=true
fi
if printf '%s\n' "$COMMAND" | grep -qE '(^|[;&|]+[[:space:]]*)git[[:space:]]+push([[:space:]]|$)'; then
  IS_COMMIT=true
fi
if printf '%s\n' "$COMMAND" | grep -qE '(^|[;&|]+[[:space:]]*)gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'; then
  IS_COMMIT=true
fi

if [ "$IS_COMMIT" = "false" ]; then
  exit 0
fi

# ── Extract session ID for context passing ──────────────────────────
SESSION_ID=""
if command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(jq -r '.session_id // ""' "$TMP_JSON" 2>/dev/null || echo "")
fi

# ── Output recommendation ────────────────────────────────────────────
# Use hookSpecificOutput.additionalContext to reach Claude's context
# Build JSON safely via jq to include trigger data
if command -v jq >/dev/null 2>&1; then
  # Determine git operation type from command (don't echo raw command — may contain credentials)
  GIT_OP="git commit, push, or PR creation"
  if printf '%s\n' "$COMMAND" | grep -qE 'git[[:space:]]+commit'; then GIT_OP="git commit"
  elif printf '%s\n' "$COMMAND" | grep -qE 'git[[:space:]]+push'; then GIT_OP="git push"
  elif printf '%s\n' "$COMMAND" | grep -qE 'gh[[:space:]]+pr[[:space:]]+create'; then GIT_OP="gh pr create"
  fi

  if [ -n "$SESSION_ID" ]; then
    jq -n --arg op "$GIT_OP" --arg sid "$SESSION_ID" \
      '{hookSpecificOutput:{additionalContext:("IMPORTANT: A " + $op + " was detected. Before proceeding, consider running the sidecar-auto-security skill to scan these changes for security vulnerabilities (hardcoded secrets, injection flaws, auth bypass). You can invoke it with: use the Skill tool with skill \u0027sidecar-auto-security\u0027. When calling sidecar_start, pass parentSession: \u0027" + $sid + "\u0027 for accurate context matching. If the user has explicitly declined a security scan for these changes, proceed without one.")}}'
  else
    jq -n --arg op "$GIT_OP" \
      '{hookSpecificOutput:{additionalContext:("IMPORTANT: A " + $op + " was detected. Before proceeding, consider running the sidecar-auto-security skill to scan these changes for security vulnerabilities (hardcoded secrets, injection flaws, auth bypass). You can invoke it with: use the Skill tool with skill \u0027sidecar-auto-security\u0027. If the user has explicitly declined a security scan for these changes, proceed without one.")}}'
  fi
else
  cat <<'HOOK_OUTPUT'
{
  "hookSpecificOutput": {
    "additionalContext": "IMPORTANT: A git commit, push, or PR creation was detected. Before proceeding, consider running the sidecar-auto-security skill to scan these changes for security vulnerabilities (hardcoded secrets, injection flaws, auth bypass). You can invoke it with: use the Skill tool with skill 'sidecar-auto-security'. If the user has explicitly declined a security scan for these changes, proceed without one. Note: parentSession could not be determined — the sidecar will use the most recent session."
  }
}
HOOK_OUTPUT
fi
