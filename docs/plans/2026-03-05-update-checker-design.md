# Update Checker Design

## Overview

Add self-updating capability to sidecar: automatic update detection via npm registry (cached, 24h TTL) with one-click update in the Electron UI and a `sidecar update` CLI command.

## Decisions

- **Distribution**: npm only (`npm install -g claude-sidecar`)
- **Check mechanism**: `update-notifier` package (background check, 24h cache, semver comparison)
- **Update mechanism**: Spawn `npm install -g claude-sidecar@latest`
- **CLI**: stderr notification box on every invocation (except `mcp`, `--version`, `--help`)
- **Electron UI**: Dismissible banner with "Update" button in the toolbar
- **Post-update UX**: "Updated to vX.Y.Z! Your next sidecar session will use the new version." No restart language.

## New Module: `src/utils/updater.js`

Single module handling both check and execute:

### API

```javascript
/**
 * Initialize update-notifier and trigger background check.
 * Call once at CLI startup.
 */
function initUpdateCheck()

/**
 * Get cached update info (no network call).
 * @returns {{ current: string, latest: string, hasUpdate: boolean } | null}
 */
function getUpdateInfo()

/**
 * Print update notification box to stderr (CLI only).
 * Skips if no update available or non-TTY.
 */
function notifyUpdate()

/**
 * Execute npm install -g claude-sidecar@latest.
 * @returns {Promise<{ success: boolean, newVersion?: string, error?: string }>}
 */
function performUpdate()
```

## CLI Integration (`bin/sidecar.js`)

- At top of `main()`, after parsing args, before command dispatch:
  - Skip for `mcp`, `--version`, `--help`
  - Call `initUpdateCheck()` then `notifyUpdate()`
- Add `sidecar update` command that calls `performUpdate()` with terminal progress
- Fix hardcoded `VERSION = '0.1.0'` to read from `package.json`

## Electron UI Integration (`electron/main.js`)

### IPC Channels

| Channel | Direction | Payload |
|---------|-----------|---------|
| `update-available` | main -> renderer | `{ current, latest }` |
| `perform-update` | renderer -> main | (no payload) |
| `update-result` | main -> renderer | `{ success, newVersion, error }` |

### Flow

1. On window launch, call `getUpdateInfo()`
2. If update available, send `update-available` to toolbar
3. Toolbar shows banner: "vX.Y.Z available" + "Update" button
4. User clicks "Update" -> button becomes "Updating..." (disabled)
5. Renderer sends `perform-update` IPC
6. Main process calls `performUpdate()`
7. On success: banner shows "Updated to vX.Y.Z! Your next sidecar session will use the new version."
8. On failure: banner shows "Update failed: {error}" with dismiss

### Toolbar Banner

- Rendered as a conditional element in the toolbar's `data:` URL HTML
- Subtle accent-colored strip above the main toolbar content
- Dismissible via "x" button (sets `display: none`)

## Testing

### Unit Tests (`tests/updater.test.js`)

- Mock `update-notifier` to return various states
- Test `getUpdateInfo()` shape and edge cases
- Test `performUpdate()` with mocked `child_process.spawn` (success, failure, timeout)
- Test `notifyUpdate()` skips in MCP/non-TTY

### Electron UI Mock Testing

Environment variable `SIDECAR_MOCK_UPDATE` forces specific update states for visual testing:

| Value | Simulated State |
|-------|-----------------|
| `available` | Update available (current=0.3.0, latest=99.0.0) |
| `updating` | In-progress "Updating..." state |
| `success` | Completed update confirmation |
| `error` | Failed update with error message |

Usage:
```bash
SIDECAR_MOCK_UPDATE=available sidecar start --model gemini --prompt "test"
```

No DOM mock tests for toolbar HTML (per project testing guidelines).

## CLAUDE.md Updates

- Add `SIDECAR_MOCK_UPDATE` to Environment Variables section
- Add `updater.js` to Key Modules table
- Add `updater.test.js` to Testing Strategy table
- Document the mock env var pattern in the UI Testing section

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `update-notifier` | ^7.0.0 | Background update check with npm registry |

## Files Changed

| File | Change |
|------|--------|
| `src/utils/updater.js` | New — update check + execute module |
| `bin/sidecar.js` | Add update check at startup, add `update` command, fix VERSION |
| `electron/main.js` | Add IPC handlers for update flow |
| `electron/preload.js` | Expose update IPC channels |
| `tests/updater.test.js` | New — unit tests |
| `package.json` | Add `update-notifier` dependency |
| `CLAUDE.md` | Document new module, env var, testing pattern |
