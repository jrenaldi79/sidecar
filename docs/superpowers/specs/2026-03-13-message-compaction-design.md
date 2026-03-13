# Auto-Collapsing Message History

## Goal

Automatically collapse older messages as new content arrives in the MCP App chat UI, freeing vertical space in the narrow (~480px) Claude Desktop panel while keeping the conversation scannable.

## Architecture

Pure CSS + DOM class toggle system. No new modules. Extends existing rendering in `renderers.js` and the polling loops in `mcp-app.js` / `test-harness.js`.

## Behavior

1. After the full render loop completes (all messages rebuilt), `collapseOlderSiblings(container)` runs once to collapse all elements except the last non-connector child.
2. The newest element is always fully expanded.
3. Clicking any collapsed element toggles it back open in-place. Multiple old elements can be expanded simultaneously.
4. All element types collapse: user messages, assistant messages, tool groups, and thinking cards.

## Collapsed State Per Element Type

### Message bubbles (`.msg.user`, `.msg.assistant`)

**Current structure:**
```
.msg
  .msg-role          (role label: "GEMINI" with logo, or "USER")
  .msg-content       (full markdown/text content)
```

**New structure adds a preview element:**
```
.msg
  .msg-role
  .msg-preview       (NEW: truncated first line, hidden when expanded)
  .msg-content       (hidden when collapsed via grid animation)
```

**Collapsed rendering:**
- `.msg-content` collapses to 0fr (same grid animation pattern as tool groups)
- `.msg-preview` becomes visible: shows first ~80 characters of the text content, ellipsized
- `.msg-role` stays visible with logo (assistant) or label (user)
- A chevron indicator on the right signals expandability
- Entire collapsed row is clickable

**Example collapsed assistant message:**
```
[gemini-logo] GEMINI  I can see the project structure. Here's what's in the...  >
```

**Example collapsed user message:**
```
USER  Can you check the current directory and read the config file?  >
```

### Tool groups (`.tool-group`)

Already have a collapsed state with header showing "3 of 3 completed". No structural changes needed. Compaction just removes the `.expanded` class.

### Thinking cards (`.thinking-card`)

Already have a collapsed state with header showing "Thought: ...preview". No structural changes needed. Compaction just removes the `.expanded` class.

## Collapse Trigger

A `collapseOlderSiblings(container)` function is called **once after the full render loop completes**, not per-element. This avoids issues with connector elements being the last child mid-loop.

```
function collapseOlderSiblings(container):
  children = container.children (live HTMLCollection)

  // Find the last non-connector child (the newest message element)
  newestEl = null
  for i from children.length-1 down to 0:
    if children[i] does NOT have class .connector:
      newestEl = children[i]
      break

  for each child in children:
    if child === newestEl: skip
    if child is .connector: skip
    if child is .msg:
      add .collapsed class (triggers CSS transition)
    if child is .tool-group:
      remove .expanded class
    if child is .thinking-card:
      remove .expanded class
```

**Click to re-expand:**
- `.msg.collapsed` click handler toggles `.collapsed` class
- Tool groups and thinking cards use their existing click handlers

## CSS Animation

Uses the same grid `0fr`/`1fr` pattern already established throughout the codebase:

```css
/* Message content collapse */
.msg-content {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.3s ease-out;
}
.msg-content-inner {
  overflow: hidden;
  white-space: normal;  /* Reset from .msg's pre-wrap to preserve existing content styling */
}
.msg.collapsed .msg-content {
  grid-template-rows: 0fr;
}

/* Preview visibility */
.msg-preview {
  display: none;
}
.msg.collapsed .msg-preview {
  display: flex;
}
```

This wraps `.msg-content`'s children in a `.msg-content-inner` div (same pattern as tool-group-items-inner, tool-item-details-inner, thinking-content-inner).

**Important:** `.msg` has `white-space: pre-wrap`. The new `.msg-content-inner` must explicitly set `white-space: normal` so that assistant message content (rendered markdown) retains its current behavior. Without this reset, markdown paragraphs would preserve whitespace incorrectly.

## Structural Change to makeBubble()

`makeBubble()` in `renderers.js` currently creates:
```javascript
div.msg > div.msg-role + div.msg-content
```

It needs to become:
```javascript
div.msg > div.msg-role + span.msg-preview + div.msg-content > div.msg-content-inner
```

Where:
- `.msg-preview` contains truncated text (first ~80 chars) + chevron SVG. **Preview text is derived from the raw `text` parameter** passed to `makeBubble()`, not from the rendered HTML. This means markdown symbols (`**`, `` ` ``) may appear in the preview, which is acceptable since the preview is a brief hint, not a rendered view.
- `.msg-content-inner` wraps the existing content (for grid overflow: hidden), with `white-space: normal` to preserve existing content styling
- Click handler on the `.msg` div toggles `.collapsed`

## Integration Points

### test-harness.js

After the rendering loop, call `collapseOlderSiblings(container)` to demonstrate the collapsed state. Optionally, render with a staggered delay to show the collapse animation.

### mcp-app.js (Polling Loop)

**Current behavior (lines 130-137):** Full DOM wipe + rebuild on every cursor change.

**Required change:** After rebuilding, call `collapseOlderSiblings(container)`. Since the entire DOM is reconstructed each poll, collapsed state is applied fresh each time. This means previously user-expanded messages will re-collapse on the next poll. This is acceptable for now because:
- The newest content (what the user cares about) is always expanded
- Poll frequency is ~300ms, so manual expansion of old messages is transient by nature
- A future improvement could track expanded state across re-renders, but YAGNI for now

### sendMessage() Optimistic Render

`sendMessage()` in `mcp-app.js` creates a raw `.msg.user` div via `document.createElement` (bypassing `makeBubble()`). This optimistic message lacks the `.msg-preview` and `.msg-content-inner` structure. This is acceptable because the raw div is short-lived: the next poll cycle (~300ms) does a full DOM rebuild using `makeBubble()`, replacing the optimistic node with a properly-structured one. No changes needed to `sendMessage()`.

### Connectors

Connectors (`.connector` elements) are not collapsed. They remain visible between collapsed elements, maintaining the flowchart visual. Their fixed 40px height provides consistent spacing between collapsed items.

## Scope Exclusions

- **Incremental DOM updates**: The polling loop still does full wipe-and-rebuild. Making it incremental (append-only) would enable proper connector draw-in animations but is a separate, larger change.
- **Persisted expand state**: User-expanded old messages re-collapse on next poll. Not worth tracking for v1.
- **Scroll-based behavior**: No scroll-triggered collapse/expand. Purely based on new content arrival.

## Files Modified

| File | Change |
|------|--------|
| `src/mcp-app/renderers.js` | Add `.msg-preview` + `.msg-content-inner` to `makeBubble()`, export `collapseOlderSiblings()` |
| `src/mcp-app/test-harness.html` | Add CSS for `.msg.collapsed`, `.msg-preview`, `.msg-content` grid animation |
| `src/mcp-app/mcp-app.html` | Same CSS additions |
| `src/mcp-app/test-harness.js` | Call `collapseOlderSiblings()` after render loop |
| `src/mcp-app/mcp-app.js` | Call `collapseOlderSiblings()` after each poll re-render |

## Testing

- Unit tests: `collapseOlderSiblings()` is a pure DOM function, testable with jsdom
- Visual QA: Puppeteer screenshots of test harness showing collapsed state
- Verify: collapsed messages show correct preview text
- Verify: click toggles expand/collapse
- Verify: tool groups and thinking cards collapse properly
- Verify: connectors remain visible between collapsed elements
