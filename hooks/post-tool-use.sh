#!/usr/bin/env bash
# PostToolUse hook: event collection + BMAD artifact trigger.
#
# Reads JSON from stdin (Claude Code hook contract).
# 1. Appends a structured event to session JSONL file (for Phase 2 analysis).
# 2. If a Write/Edit/MultiEdit targets _bmad-output/, injects additionalContext.
#
# Phase 1: shell-only, no Node.js dependency.

set -euo pipefail

# Safety guard
[ -f "$0" ] || exit 0

# ── Config check ──────────────────────────────────────────────────────
# Note: jq's // operator treats false as falsy, so we use explicit type checks
CONFIG_PATH="${HOME}/.config/sidecar/config.json"
MONITORING_ON="true"
BMAD_ON="true"
MASTER_ON="true"

if [ -f "$CONFIG_PATH" ] && command -v jq >/dev/null 2>&1; then
  MASTER_ON=$(jq -r '.autoSkills.enabled | if type == "boolean" then . else true end' "$CONFIG_PATH" 2>/dev/null || echo "true")
  BMAD_ON=$(jq -r '.autoSkills.bmadMethodCheck.enabled | if type == "boolean" then . else true end' "$CONFIG_PATH" 2>/dev/null || echo "true")
  MONITORING_ON=$(jq -r '.monitoring.enabled | if type == "boolean" then . else true end' "$CONFIG_PATH" 2>/dev/null || echo "true")
fi

# If master auto-skills switch is off, skip everything
if [ "$MASTER_ON" = "false" ]; then
  exit 0
fi

# ── Read stdin to temp file (avoid ARG_MAX on large payloads) ─────────
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

TMP_JSON=$(mktemp 2>/dev/null) || exit 0
trap 'rm -f "$TMP_JSON"' EXIT
cat > "$TMP_JSON"

TOOL_NAME=$(jq -r '.tool_name // ""' "$TMP_JSON" 2>/dev/null || echo "")
SESSION_ID=$(jq -r '.session_id // ""' "$TMP_JSON" 2>/dev/null || echo "")

# ── Event collection ─────────────────────────────────────────────────
# Append structured event to session-specific JSONL file (controlled by monitoring.enabled)
# Sanitize SESSION_ID to alphanumeric/hyphens only (prevent path traversal)
SAFE_SID=""
if [ "$MONITORING_ON" != "false" ]; then
  SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
fi
if [ -n "$SAFE_SID" ]; then
  EVENT_FILE="${TMPDIR:-/tmp}/sidecar-monitor-${SAFE_SID}.jsonl"

  # Cap event file at 5MB to prevent unbounded growth in long sessions
  MAX_SIZE=5242880
  if [ -f "$EVENT_FILE" ] && [ "$(wc -c < "$EVENT_FILE" 2>/dev/null || echo 0)" -gt "$MAX_SIZE" ]; then
    : # Skip collection — file too large
  else
    EVENT=$(jq -rc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
      {
        ts: $ts,
        tool: (.tool_name // "unknown"),
        file: (if .tool_name == "Bash" then ""
               elif .tool_name == "MultiEdit" then (.tool_input.edits[0].file_path // "")
               else (.tool_input.file_path // "") end),
        success: (if .tool_name == "Bash" then ((.tool_response.exit_code // 0) == 0)
                  else true end),  # non-Bash tools: hook only fires on success
        command: (if .tool_name == "Bash" then ((.tool_input.command // "")[0:200] | gsub("[A-Za-z0-9+/=]{40,}"; "[REDACTED]")) else "" end)
      }' "$TMP_JSON" 2>/dev/null || echo "")

    if [ -n "$EVENT" ]; then
      # Atomically create file with restrictive permissions (noclobber prevents TOCTOU)
      (umask 177 && set -o noclobber && : > "$EVENT_FILE" 2>/dev/null) || true
      # Verify ownership before appending
      FILE_OWNER=$(stat -c '%u' "$EVENT_FILE" 2>/dev/null || stat -f '%u' "$EVENT_FILE" 2>/dev/null || echo "")
      if [ "$FILE_OWNER" = "$(id -u)" ]; then
        echo "$EVENT" >> "$EVENT_FILE"
      fi
    fi
  fi
fi

# ── BMAD artifact trigger ────────────────────────────────────────────
# Only fire if master + bmadMethodCheck are enabled
if [ "$MASTER_ON" = "false" ] || [ "$BMAD_ON" = "false" ]; then
  exit 0
fi

# Check if a Write, Edit, or MultiEdit targeted _bmad-output/
# MultiEdit uses .tool_input.edits[].file_path; Write/Edit use .tool_input.file_path
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ] || [ "$TOOL_NAME" = "MultiEdit" ]; then
  HAS_BMAD=$(jq -r '
    [.tool_input.file_path, (.tool_input.edits[]?.file_path)]
    | map(select(. != null and contains("_bmad-output/")))
    | length > 0' "$TMP_JSON" 2>/dev/null || echo "false")

  if [ "$HAS_BMAD" = "true" ]; then
    BMAD_FILE=$(jq -r '
      [.tool_input.file_path, (.tool_input.edits[]?.file_path)]
      | map(select(. != null and contains("_bmad-output/")))
      | first' "$TMP_JSON" 2>/dev/null || echo "_bmad-output/")
    # Build JSON safely via jq to avoid injection from filenames with quotes/backslashes
    jq -n --arg file "$BMAD_FILE" --arg tool "$TOOL_NAME" --arg sid "$SESSION_ID" \
      '{hookSpecificOutput:{additionalContext:("A BMAD-METHOD artifact was just written or updated at " + $file + " (via " + $tool + "). Consider running the sidecar-auto-bmad-method-check skill to get a second-opinion review from another model before finalizing this artifact. You can invoke it with: use the Skill tool with skill \u0027sidecar-auto-bmad-method-check\u0027. When calling sidecar_start, pass parentSession: \u0027" + $sid + "\u0027 for accurate context matching. If the user has already reviewed this artifact or explicitly declined a check, proceed without one.")}}'
    exit 0
  fi
fi
