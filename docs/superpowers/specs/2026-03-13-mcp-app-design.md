# Sidecar MCP App — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Branch:** feature/mcp-app

## Summary

Render the sidecar interactive chat experience as an MCP App inside Claude Chat (Desktop). Instead of opening an Electron window, Claude spawns a sidecar session that appears inline in the conversation as a sandboxed iframe — a "chat within a chat." The user converses with the target model (Gemini, GPT-4, etc.) via the OpenCode agent harness, then clicks Fold to push a structured summary back to Claude via `context/update`.

## Goals

- Identical UX to the Electron experience, embedded in Claude Chat
- Zero breaking changes to existing CLI/headless/Electron users
- Reuse the OpenCode web UI (no custom chat renderer)
- Fold is the critical feature — structured summary flows back to Claude

## Non-Goals (v1)

- Multi-session / parallel sidecars
- Web/hosted deployment (claude.ai browser)
- WebSocket streaming (polling is sufficient for v1)
- Custom message rendering (we embed OpenCode's UI)

## Architecture

```
Claude Desktop
  ├─ LLM calls sidecar_start tool → returns immediately + UI renders
  │
  ├─ MCP App iframe (ui://sidecar/chat)
  │    ├─ Inner iframe → http://localhost:PORT (OpenCode web UI)
  │    │    ├─ CSS injected: hide OpenCode header
  │    │    └─ JS injected: rebrand logo to Sidecar wordmark
  │    └─ Toolbar div (bottom, 40px)
  │         ├─ Logo + model badge (real SVGs) + task ID + timer
  │         ├─ Chat input + Send button (left)
  │         └─ Fold button (right, orange #D97757)
  │
  └─ Sidecar MCP Server (existing, stdio)
       ├─ Manages OpenCode process lifecycle
       ├─ Proxies fold request to OpenCode HTTP API
       ├─ Persists sessions (existing session-manager)
       └─ Serves ui:// resource
            │
            └─ OpenCode Server (local child process)
                 ├─ Agent harness (Build/Plan/Explore)
                 ├─ Tool execution (bash, file read/write, etc.)
                 └─ LLM API calls (via OpenRouter)
```

## MCP Tools

### Modified Tools

| Tool | Change | Backwards Compatible? |
|------|--------|----------------------|
| `sidecar_start` | Add `_meta.ui.resourceUri: "ui://sidecar/chat"` to tool definition | Yes — non-App clients ignore `_meta.ui` |

### New Tools (iframe-only)

| Tool | Purpose | Called By |
|------|---------|----------|
| `sidecar_send` | Send user message to OpenCode session | Iframe |
| `sidecar_messages` | Get latest messages (cursor-based) | Iframe (polling) |
| `sidecar_fold` | Generate summary, return for context/update | Iframe |

Existing tools (`sidecar_list`, `sidecar_read`, `sidecar_resume`, `sidecar_status`, `sidecar_abort`) are unchanged.

## UI Resource: `ui://sidecar/chat`

A single HTML page served by the MCP server. Structure:

```html
<div id="sidecar-app" style="display:flex; flex-direction:column; height:100vh;">
  <!-- OpenCode web UI (same as Electron BrowserView) -->
  <iframe id="opencode-frame"
    src="http://localhost:${PORT}/${BASE64_CWD}/session/${SESSION_ID}"
    style="flex:1; border:none; width:100%;">
  </iframe>

  <!-- Sidecar toolbar (same HTML/CSS as electron/toolbar.js) -->
  <div id="sidecar-toolbar">
    <!-- Logo, model badge, task ID, timer -->
    <!-- Chat input + Send (left) | Fold button (right) -->
  </div>
</div>

<script>
  // 1. On load: inject CSS into inner iframe to hide OpenCode header
  // 2. Inject JS to rebrand logo (same MutationObserver from main.js)
  // 3. Timer logic (same as toolbar.js)
  // 4. Fold button: call sidecar_fold via App.callTool, then context/update
</script>
```

### Key Reuse from Electron

| What | Source | Reuse Method |
|------|--------|--------------|
| OpenCode web UI rendering | OpenCode binary serves at localhost | Inner iframe loads same URL |
| Header hiding | `main.js` line 141-144 | Same CSS injected into inner iframe |
| Logo rebranding | `main.js` rebrandUI() lines 302-345 | Same JS injected into inner iframe |
| Toolbar HTML/CSS | `electron/toolbar.js` | Same styles, adapted to div (not separate window) |
| Fold overlay | `electron/fold.js` showFoldOverlay() | Same overlay CSS, injected via postMessage |
| Fold logic | `electron/fold.js` + `electron/summary.js` | Same requestSummaryFromModel(), delivered via MCP |
| Session persistence | `src/sidecar/session-utils.js` | Called by MCP server (unchanged) |

## Styling

- **Base:** Claude Desktop color palette (warm neutrals, dark theme)
- **Container:** Subtle warm top border (`rgba(196,149,107,0.35)`), barely-there background tint
- **Buttons:** Orange gradient (`#D97757` → `#c4654a`) for Fold and Send
- **Model logos:** Real SVGs from `site/index.html` (Gemini, OpenAI, xAI/Grok, Meta/Llama, DeepSeek)
- **Fallback:** Generic `?` badge for unknown models

## Fold Flow (Critical Path)

```
User clicks Fold button (bottom-right of toolbar)
  → Toolbar: button shows spinner, "Generating summary..."
  → postMessage to inner iframe: inject overlay (same CSS from fold.js)
  → App.callTool('sidecar_fold', { taskId })
  → MCP server: requestSummaryFromModel(sessionId, port, getSummaryTemplate)
  → OpenCode generates structured summary (same SUMMARY_TEMPLATE)
  → MCP server returns { summary } to iframe
  → Iframe calls App.updateContext(summary) → Claude receives summary
  → Toolbar shows "Folded ✓", inner iframe goes read-only
  → MCP server: finalizeSession(taskId, summary)
```

Summary format (unchanged):
- Task, Findings, Attempted Approaches, Recommendations
- Code Changes, Files Modified, Assumptions, Open Questions

## Message Polling

```javascript
// Inside MCP App iframe
let cursor = null;
setInterval(async () => {
  const result = await app.callTool('sidecar_messages', { cursor });
  if (result.messages.length > 0) {
    // Forward to inner iframe if needed, or let OpenCode UI handle it
    cursor = result.cursor;
  }
  updateStatus(result.status);
}, 750);
```

Note: The inner iframe loads the OpenCode web UI which handles its own message rendering via SSE/polling. The outer `sidecar_messages` polling is primarily for status tracking (to know when to enable/disable the Fold button) rather than rendering.

## Technical Risks & Mitigations

### Risk 1: Iframe-in-iframe (localhost loading)

MCP App sandbox may block inner iframe loading `http://localhost`.

**Mitigation:** Use `_meta.ui.csp` to allow `frame-src http://localhost:*`. If blocked, fall back to reverse-proxying OpenCode HTML through the MCP server.

**Validation:** Build minimal MCP App with localhost iframe, test in Claude Desktop.

### Risk 2: context/update support

Claude Desktop may not yet implement `context/update` from MCP Apps spec.

**Mitigation:** Fall back to two-tool pattern: `sidecar_fold` stores summary, LLM calls `sidecar_read` to retrieve.

### Risk 3: Port discovery

UI resource needs OpenCode port at render time, but port is dynamic.

**Mitigation:** HTML resource calls `sidecar_status` on load to get port, then sets iframe src dynamically.

## Validation Spike (Day 1)

Before full implementation:

1. MCP App iframe can embed child iframe to localhost
2. `context/update` works in Claude Desktop
3. `postMessage` between outer frame and inner iframe works
4. OpenCode CSS/JS injection works cross-origin

## Upgrade Path

- **Polling → WebSocket:** If 750ms polling feels janky, add WebSocket endpoint to MCP server. Iframe rendering stays identical, only the data transport changes.
- **Single → Multi-session:** Add tab UI to the toolbar. Each tab = separate inner iframe + OpenCode process.
- **Local → Hosted:** Run MCP server + OpenCode on remote host. Inner iframe URL changes from localhost to remote. Architecture otherwise identical.

## File Impact Estimate

| File | Change |
|------|--------|
| `src/mcp-server.js` | Add `sidecar_send`, `sidecar_messages`, `sidecar_fold` handlers |
| `src/mcp-tools.js` | Add tool definitions + `_meta.ui` on `sidecar_start` |
| `src/mcp-app/chat.html` | NEW — the UI resource (HTML + inline JS/CSS) |
| `src/mcp-app/logos.js` | NEW — model logo SVG registry |
| `src/sidecar/start.js` | Minor — store port in session metadata for `sidecar_status` |
| `electron/*` | NO CHANGES — Electron path is untouched |
| `tests/` | New test files for MCP App tools and fold flow |
