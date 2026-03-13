# MCP App Tool Components: Recovered Component Reference

> Source: `electron/ui/renderer.js` and `electron/ui/styles.css` deleted in commit `ef82aba`
> ("chore: delete 14K lines of custom UI, subagent manager, and model capabilities")
> Recovery command: `git show ef82aba^:electron/ui/renderer.js`

**Goal:** Reintroduce rich tool output rendering into the MCP App inline chat UI,
adapting the deleted Electron UI components to work within the Vite-bundled
ext-apps sandbox (no Node.js, no IPC, no Electron APIs).

**Architecture:** Modular ES module files under `src/mcp-app/`, each exporting
pure DOM-building functions. No innerHTML (blocked by security hook). All rendering
uses `document.createElement()` + `textContent`. Bundled by Vite into a single HTML
file via `vite-plugin-singlefile`.

---

## Current State

- `mcp-app.js` (352 lines): App lifecycle, polling, theme, message rendering
- `mcp-app.html` (580 lines): CSS + HTML shell with light/dark theme
- Tool output: single-line `makeToolIndicator(name, status)` showing `"checkmark name"`
- Text rendering: plain `textContent`, no markdown parsing

## Target State

Rich tool output rendering matching the old Electron UI quality, adapted for
the ext-apps sandbox:

- Markdown rendering for assistant text (code blocks, lists, bold, etc.)
- Per-tool formatters (bash, edit, read, grep, glob, question, list, todo, webfetch, task)
- Syntax highlighting for code blocks and bash commands
- Copy-to-clipboard on code blocks and bash output
- Expand/collapse on truncated output
- SVG tool icons
- Auto-scroll with user-override

---

## Recovered Components Inventory

### Tier 1: Must-Have (immediate visual improvement)

| Component | Old lines | Description | New file |
|---|---|---|---|
| `escapeHtml()` | 4447 | XSS-safe HTML escaping via `document.createElement` | `utils.js` |
| `highlightCode()` | 4483-4533 | Regex syntax highlighter (keywords, types, functions, strings, comments, numbers) | `highlight.js` |
| `formatBashCommand()` | 3261-3279 | Shell command syntax highlighting (commands, flags, strings) | `highlight.js` |
| `getToolIcon()` | 4534-4577 | SVG icon map: bash, read, write, edit, glob, grep, list, task, webfetch, question, todo | `icons.js` |
| `getFileIcon()` | 3536-3566 | Colored type badges: JS, TS, JSX, JSON, MD, CSS, HTML, PY, GO, RS, SH, YML | `icons.js` |
| `copyToClipboard()` | 3103-3116 | Copy with checkmark feedback (1.5s timeout) | `utils.js` |
| Markdown rendering | 660, 1468 | `marked.js` + custom code renderer with language labels + highlightCode | `markdown.js` |
| `formatToolOutput()` | 2829-2892 | Dispatcher: routes tool name to the right formatter | `tool-output.js` |
| `formatBashOutput()` | 3118-3178 | Stacked command + output cards, copy buttons, test colorization, truncation | `tools/bash.js` |
| `formatEditDiff()` | 2982-3031 | Old/new diff with line nums, +/- gutter, context, truncation toggle | `tools/edit.js` |
| `formatFileOutput()` | 3281-3330 | Read tool: line-numbered content, parses `00001\|` format | `tools/read.js` |
| Auto-scroll | 1271-1380 | MutationObserver, disables on scroll-up, re-enables at bottom | `auto-scroll.js` |

### Tier 2: High-Value (complete tool coverage)

| Component | Old lines | Description | New file |
|---|---|---|---|
| `formatWriteOutput()` | 3044-3117 | New file content as all-green additions with line nums | `tools/write.js` |
| `formatGrepOutput()` | 3447-3566 | Grouped by file, match counts, line nums, `<mark>` highlighting | `tools/grep.js` |
| `formatGlobOutput()` | 3388-3445 | Files grouped by directory, colored type badges | `tools/glob.js` |
| `formatQuestionOutput()` | 3568-3627 | Question + options + answer display | `tools/question.js` |
| `formatListOutput()` | 3628-3695 | Directory listing with folder/file icons | `tools/list.js` |
| `formatTodoOutput()` | 4063-4186 | Checkbox list, strikethrough completed, JSON + markdown | `tools/todo.js` |
| `formatWebfetchOutput()` | 3914-4062 | URL header, HTML parsing, raw toggle | `tools/webfetch.js` |
| `formatTaskOutput()` | 3696-3913 | Agent badge, nested tool tree with `+-`/`L-`, results | `tools/task.js` |
| `formatGenericOutput()` | 3331-3387 | Fallback: plain text truncated to 2000 chars | `tools/generic.js` |

### Tier 3: Polish

| Component | Old lines | Description |
|---|---|---|
| SVG chevrons | 1610-1612 | Right/Down/Up chevron constants for expand/collapse |
| Tool group connector | 2220-2306 | Vertical line connecting tool items with status colors |
| Typing indicator | 4611 | Animated indicator with rotating messages |
| Request timer | 4668-4733 | Per-tool elapsed time display |

---

## Constraints (ext-apps Sandbox)

1. **No innerHTML** - Security hook blocks it. Use `document.createElement` + `textContent`
   or a sanitizer. The markdown renderer needs special handling.
2. **No Node.js** - Pure browser ES modules only.
3. **No external CDN** - Everything must be bundled by Vite. `marked` must be an npm dep.
4. **Bundle size** - Single HTML file. Keep deps minimal (marked ~40KB minified).
5. **300-line file limit** - Per project CLAUDE.md. Each formatter in its own file.

---

## OpenCode Message Part Format

Tool parts from OpenCode have this structure:

```json
{
  "type": "tool",
  "toolName": "Bash",
  "state": {
    "status": "completed",
    "input": {
      "command": "npm test",
      "description": "Run tests"
    },
    "output": "PASS tests/foo.test.js\n..."
  }
}
```

The `toolName` maps to our formatter dispatcher. `state.input` has tool-specific
args. `state.output` has the result string.

---

## Recovery Commands

To extract any component's full source:
```bash
git show ef82aba^:electron/ui/renderer.js | sed -n '<start>,<end>p'
git show ef82aba^:electron/ui/styles.css | sed -n '<start>,<end>p'
```
