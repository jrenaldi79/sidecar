# Shell-Independent API Key Resolution

**Issue:** [#11](https://github.com/jrenaldi79/sidecar/issues/11) - Sidecar fails with 'Missing Authentication header' in non-interactive shells
**Date:** 2026-03-14
**Status:** Draft

## Problem

Sidecar CLI fails when API keys are exported in `~/.zshrc` but not `~/.zshenv`. Non-interactive shells (Claude Code's Bash tool, CI/CD, cron) don't source `~/.zshrc`, so `process.env` lacks the keys.

The irony: sidecar already has two shell-independent key stores (`~/.config/sidecar/.env` and `~/.local/share/opencode/auth.json`), but doesn't load them into `process.env` early enough. The validator checks `process.env` first and fails before reaching fallback logic.

## Design

### New Module: `src/utils/env-loader.js`

Single exported function `loadCredentials()` that projects all credential sources into `process.env` with deterministic priority:

```
1. process.env (already set)     <- highest, never overwritten
2. ~/.config/sidecar/.env        <- user-configured via `sidecar setup`
3. ~/.local/share/opencode/auth.json  <- OpenCode SDK fallback
```

Behavior:
- Per-provider, first source wins. Existing `process.env` values are never overwritten.
- Respects `SIDECAR_ENV_DIR` override for `.env` path (via `getEnvPath()` from `api-key-store.js`).
- Uses existing `parseEnvContent()` from `api-key-store.js` for `.env` parsing (no separate `dotenv` dependency needed).
- Handles `LEGACY_KEY_NAMES` migration (e.g., `GEMINI_API_KEY` to `GOOGLE_GENERATIVE_AI_API_KEY`), consolidating the migration that currently lives in both `bin/sidecar.js` and `api-key-store.js`.
- Auth.json keys are loaded in-memory only (no writes back to `.env`).
- Info-level logging when a key is loaded: `"Loaded GOOGLE_GENERATIVE_AI_API_KEY from sidecar .env"` (key values are never logged). Info-level is intentional: users hitting this bug are unlikely to have `LOG_LEVEL=debug`.
- Gracefully handles missing files (no error if `.env` or `auth.json` don't exist).

**Relationship to existing `resolveKeyValue()` in `api-key-store.js`:** The existing function gives `.env` file priority over `process.env`. After `loadCredentials()` projects all sources into `process.env`, `resolveKeyValue()` remains correct for its use case (setup UI display), but runtime validation now uses `process.env` as the single source of truth. No conflict because `loadCredentials()` never overwrites existing `process.env` values.

**Known limitation:** `auth.json` path (`~/.local/share/opencode/auth.json`) follows the Linux XDG layout. This matches OpenCode's own behavior and is not a regression.

### Update: `bin/sidecar.js`

Replace the existing early dotenv load and legacy key migration (lines 14-19) with a single `loadCredentials()` call before any validation or command dispatch. This consolidates three scattered concerns (dotenv loading, legacy migration, auth.json import) into one call.

**MCP entry point:** `sidecar mcp` dispatches through `bin/sidecar.js` via `handleMcp()`, so `loadCredentials()` runs before any MCP tool handler touches API keys. No separate MCP-specific loading needed.

### Update: `src/utils/validators.js`

Remove the special auth.json existence check from `validateApiKey()`. After `loadCredentials()` runs, all available keys are in `process.env`, so the validator becomes a pure `process.env` check. No fallback logic needed.

Improved error message when keys are truly missing:

```
Error: GOOGLE_GENERATIVE_AI_API_KEY not found.

In non-interactive shells (Claude Code, CI), ~/.zshrc is not sourced.
Fix with one of:
  - Run `sidecar setup` to store keys in sidecar's config
  - Move your export to ~/.zshenv (sourced by all zsh shells)
  - Add key to ~/.local/share/opencode/auth.json
```

### Update: Documentation

- `skill/SKILL.md`: Add note under "Option B (Direct)" warning zsh users that `~/.zshrc` exports only work in interactive terminals. Recommend `~/.zshenv` or `sidecar setup`.
- Add troubleshooting entry for this specific scenario.

## What We're NOT Doing

- **No sourcing shell profiles.** Executing `~/.zshenv` or `~/.zshrc` from Node.js is fragile, non-portable (bash vs zsh vs fish), and may have side effects or hang in CI. Both Gemini and GPT independently flagged this as "architecturally leaky."
- **No writing back to `.env` from auth.json.** Importing auth.json keys is in-memory only for the current process. Avoids side-effect writes during simple commands like `sidecar list`.
- **No loading arbitrary `.env` from cwd.** Only sidecar's own config directory `.env` is loaded.

## Testing

### Unit Tests: `tests/env-loader.test.js`

- Priority order: `process.env` > `.env` file > `auth.json`
- No-overwrite: existing `process.env` values are preserved
- Missing files: graceful handling when `.env` or `auth.json` don't exist
- `SIDECAR_ENV_DIR` override: respects custom `.env` path
- Per-provider merge: one key from `.env`, another from `auth.json`
- Security: file permissions, no secret logging

### Update: `tests/utils/validators.test.js`

- Remove tests for auth.json special-case fallback in `validateApiKey()`
- Add test for improved error message content
- Verify validation passes when keys come from `.env` (loaded via `loadCredentials()`)

### Integration Test

- Mocked integration test that calls `loadCredentials()` + `validateApiKey()` with a stubbed `process.env` and temp `.env` file. No real API call needed; just verify the key reaches `process.env` and validation passes.

## Multi-Model Review

Design reviewed by Gemini and GPT-4 via sidecar. Both independently recommended Option B with the same priority order. Key feedback incorporated:
- Reject Option C (sourcing shell profiles) as fragile and unsafe
- Centralize loading in a single module
- Fix the "lying validator" that checks auth.json existence without loading keys
- Keep auth.json imports in-memory only
