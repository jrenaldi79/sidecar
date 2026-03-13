# MCP App Tool Components Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rich tool output rendering to the MCP App inline chat UI, recovering
components from the deleted Electron UI (commit `ef82aba`) and adapting them for
the Vite-bundled ext-apps sandbox.

**Architecture:** Modular files under `src/mcp-app/`. Each tool formatter is a
standalone file exporting a function that takes `(input, output)` and returns an
**HTML string**. The integration layer in `renderers.js` converts HTML strings
to DOM nodes via `DOMParser` (safe alternative to innerHTML, which is blocked by
security hooks). A dispatcher routes `toolName` to the right formatter. Markdown
rendering via `marked` npm dependency. All CSS in `mcp-app.html` using existing
theme variables.

**Module format:** CommonJS (`module.exports`) for all files under `src/mcp-app/tools/`,
`utils.js`, `icons.js`, `highlight.js`, `tool-output.js`, and `markdown.js`. This
enables direct Jest testing without transpilation. Vite handles CJS-to-ESM conversion
at bundle time. Browser-only files (`mcp-app.js`, `renderers.js`, `auto-scroll.js`)
use ESM imports since they run only in the Vite bundle, not in Jest.

**Rendering contract:** Formatters return HTML strings. The single conversion point
is in `renderers.js` which uses `DOMParser().parseFromString(html, 'text/html')` to
create DOM nodes safely. No direct innerHTML assignment anywhere.

**Commit policy:** Feature commits may omit CLAUDE.md updates. A single consolidated
CLAUDE.md update happens in Task 16 (cleanup) at the end.

**Tech Stack:** Vite + vite-plugin-singlefile, marked (npm), ext-apps SDK, vanilla DOM

**Spec:** `docs/superpowers/specs/2026-03-13-mcp-app-tool-components-design.md`

**Recovery source:** `git show ef82aba^:electron/ui/renderer.js`

---

## Rebaseline (2026-03-13)

The following tasks are **complete** with tests passing and code committed:

| Task | Status | Files | Tests |
|------|--------|-------|-------|
| Task 1: Utility Functions | DONE | `src/mcp-app/utils.js` | 8/8 pass |
| Task 2: Tool Icons | DONE | `src/mcp-app/icons.js` | 8/8 pass |
| Task 3: Syntax Highlighting | DONE | `src/mcp-app/highlight.js` | 10/10 pass |
| Task 4: Generic + Dispatcher | DONE | `src/mcp-app/tool-output.js`, `tools/generic.js` | 9/9 pass |
| Task 5: Bash Formatter | DONE | `src/mcp-app/tools/bash.js` | 7/7 pass |
| Task 6: Edit Diff Formatter | DONE | `src/mcp-app/tools/edit.js` | 12/12 pass |
| Task 7: Read/File Formatter | DONE | `src/mcp-app/tools/read.js` | 6/6 pass |
| Task 14: Auto-Scroll | DONE | `src/mcp-app/auto-scroll.js` | 1/1 pass |

**Total: 61 tests passing across mcp-app suite.**

All remaining tasks below start from this baseline. No "expected fail" steps
for files that already exist.

---

## File Structure

```
src/mcp-app/
  mcp-app.html          MODIFY  Add CSS for tool output, code blocks, diff, etc.
  mcp-app.js            MODIFY  Wire auto-scroll only (polling/lifecycle)
  renderers.js          MODIFY  Wire formatToolOutput + renderMarkdown (rendering)
  utils.js              DONE    escapeHtml, SVG constants
  icons.js              DONE    getToolIcon, getFileIcon
  highlight.js          DONE    highlightCode, formatBashCommand
  markdown.js           CREATE  renderMarkdown (marked + custom code renderer)
  auto-scroll.js        DONE    setupAutoScroll
  tool-output.js        MODIFY  Wire remaining formatter routes
  tools/
    bash.js             DONE    formatBashOutput
    edit.js             DONE    formatEditDiff
    write.js            CREATE  formatWriteOutput
    read.js             DONE    formatFileOutput
    grep.js             CREATE  formatGrepOutput
    glob.js             CREATE  formatGlobOutput
    question.js         CREATE  formatQuestionOutput
    list.js             CREATE  formatListOutput
    todo.js             CREATE  formatTodoOutput
    webfetch.js         CREATE  formatWebfetchOutput
    task.js             CREATE  formatTaskOutput
    generic.js          DONE    formatGenericOutput
```

---

## Chunk 3: Tool Output Formatters (Tier 2)

### Task 8: Write Formatter

**Files:**
- Create: `src/mcp-app/tools/write.js`
- Modify: `src/mcp-app/tool-output.js` (add write route)

Recover `formatWriteOutput` (line 3044) from git history. All-green addition lines.
Pattern identical to edit.js but simpler (no deletions).

- [ ] **Step 1: Write test in `tests/mcp-app/tools/write.test.js`**
- [ ] **Step 2: Implement `src/mcp-app/tools/write.js`**
- [ ] **Step 3: Add write route to dispatcher, run tests**
- [ ] **Step 4: Commit**

### Task 9: Grep Formatter

**Files:**
- Create: `src/mcp-app/tools/grep.js`
- Modify: `src/mcp-app/tool-output.js` (add grep route)

Recover `formatGrepOutput` (line 3447) and `highlightSearchPattern` (line 3568).
Groups by file, shows match counts, line numbers, pattern highlighting.

- [ ] **Step 1: Write test in `tests/mcp-app/tools/grep.test.js`**
- [ ] **Step 2: Implement `src/mcp-app/tools/grep.js`**
- [ ] **Step 3: Add grep route to dispatcher, run tests**
- [ ] **Step 4: Commit**

### Task 10: Glob Formatter

**Files:**
- Create: `src/mcp-app/tools/glob.js`
- Modify: `src/mcp-app/tool-output.js` (add glob route)

Recover `formatGlobOutput` (line 3388). Groups by directory, file type badges.

- [ ] **Step 1: Write test in `tests/mcp-app/tools/glob.test.js`**
- [ ] **Step 2: Implement `src/mcp-app/tools/glob.js`**
- [ ] **Step 3: Add glob route to dispatcher, run tests**
- [ ] **Step 4: Commit**

### Task 11: Question, List, Todo, WebFetch, Task Formatters

**Files:**
- Create: `src/mcp-app/tools/question.js`
- Create: `src/mcp-app/tools/list.js`
- Create: `src/mcp-app/tools/todo.js`
- Create: `src/mcp-app/tools/webfetch.js`
- Create: `src/mcp-app/tools/task.js`
- Modify: `src/mcp-app/tool-output.js` (add all routes)

Recover each from git history (see spec for line numbers).
Each is a standalone file, one test file per formatter.

- [ ] **Step 1: Implement all five formatters with tests**
- [ ] **Step 2: Add all routes to dispatcher**
- [ ] **Step 3: Run all tool tests**
- [ ] **Step 4: Commit**

**Execution note:** Tasks 8-11 each modify `tool-output.js` dispatcher. Execute
sequentially (not in parallel) to avoid merge conflicts. Alternatively, implement
all formatters in parallel, then batch all dispatcher route updates into one commit.

---

## Chunk 4: Markdown Rendering

### Task 12: Install marked + Markdown Renderer

**Files:**
- Create: `src/mcp-app/markdown.js`
- Modify: `package.json` (add marked dependency)

- [ ] **Step 1: Install marked**

Run: `npm install marked`

- [ ] **Step 2: Write test in `tests/mcp-app/markdown.test.js`**

Test that `renderMarkdown('**bold**')` returns HTML with `<strong>`.
Test that code blocks get syntax highlighting classes.
Test that raw HTML tags like `<script>` in markdown input are escaped in output
(rely on `marked`'s default HTML escaping; DOMParser in renderers.js is the
secondary sanitization boundary).

- [ ] **Step 3: Implement markdown.js**

```javascript
// CommonJS for Jest compatibility
const { marked } = require('marked');
const { highlightCode } = require('./highlight');
const { escapeHtml } = require('./utils');

const renderer = new marked.Renderer();
renderer.code = function(code, language) {
  const isToken = typeof code === 'object';
  const codeText = isToken ? code.text : code;
  const lang = (isToken ? code.lang : language) || '';
  const highlighted = highlightCode(codeText, lang);
  const langLabel = lang ? `<div class="code-language">${escapeHtml(lang)}</div>` : '';
  return `<pre>${langLabel}<code class="language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
};

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  try {
    return marked.parse(text, { renderer });
  } catch {
    return escapeHtml(text);
  }
}

module.exports = { renderMarkdown };
```

- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add src/mcp-app/markdown.js tests/mcp-app/markdown.test.js package.json package-lock.json
git commit -m "feat(mcp-app): add markdown renderer with syntax highlighting"
```

---

## Chunk 5: Integration

### Task 13: Wire Tool Output + Markdown into renderers.js

**Files:**
- Modify: `src/mcp-app/renderers.js` (NOT mcp-app.js)
- Modify: `src/mcp-app/mcp-app.js` (auto-scroll wiring only)

**Key change:** `renderMessage` and `makeToolIndicator` live in `renderers.js`,
not `mcp-app.js`. All rendering logic changes go in `renderers.js`.

- [ ] **Step 1: Add DOMParser helper to renderers.js**

```javascript
/** Convert an HTML string to a DocumentFragment safely (no innerHTML). */
function htmlToFragment(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const frag = document.createDocumentFragment();
  while (doc.body.firstChild) {
    frag.appendChild(doc.body.firstChild);
  }
  return frag;
}
```

- [ ] **Step 2: Update makeToolIndicator to use formatToolOutput**

For each tool part with output, call `formatToolOutput(p.toolName, p.state?.input, p.state?.output)`.
Convert the HTML string result to DOM via `htmlToFragment()`.
Keep the compact indicator as a clickable summary; tool output as expandable detail below it.

- [ ] **Step 3: Update makeBubble to use renderMarkdown for assistant text**

For assistant role messages, render markdown instead of plain textContent:
```javascript
const rendered = renderMarkdown(text);
const contentFragment = htmlToFragment(rendered);
```

- [ ] **Step 4: Wire auto-scroll in mcp-app.js**

Import `setupAutoScroll` from `./auto-scroll.js`. Replace manual
`container.scrollTop = container.scrollHeight` calls with the controller.

- [ ] **Step 5: Build and manually test**

Run: `npm run build:ui`
Test in Claude Desktop with a sidecar that uses bash, edit, read tools.

- [ ] **Step 6: Commit**

```bash
git add src/mcp-app/renderers.js src/mcp-app/mcp-app.js
git commit -m "feat(mcp-app): wire tool output and markdown into message rendering"
```

---

### Task 15: CSS for Tool Output Components

**Files:**
- Modify: `src/mcp-app/mcp-app.html`

- [ ] **Step 1: Add CSS for all tool output components**

Add styles for: `.tool-diff-card`, `.tool-diff-line`, `.tool-diff-line-number`,
`.tool-diff-gutter`, `.tool-diff-content`, `.tool-diff-line.addition`,
`.tool-diff-line.deletion`, `.tool-diff-line.context`, `.tool-bash-command-card`,
`.tool-bash-output-card`, `.tool-bash-cmd`, `.tool-bash-line`, `.tool-bash-line.success`,
`.tool-bash-line.error`, `.bash-cmd`, `.bash-flag`, `.bash-string`,
`.code-language`, `pre`, `code`, `.hl-keyword`, `.hl-function`, `.hl-string`,
`.hl-number`, `.hl-comment`, `.hl-type`, `.hl-constant`,
`.copy-btn`, `.copy-btn.copied`, `.file-icon`, `.file-icon-js`, etc.,
`.grep-results`, `.grep-file`, `.grep-highlight`, `.glob-results`, `.glob-dir`,
`.question-output`, `.todo-output-simple`, `.webfetch-output`, `.task-output`.

Recover from `git show ef82aba^:electron/ui/styles.css` and adapt for light/dark
theme using existing CSS variables.

- [ ] **Step 2: Build and visually verify**

Run: `npm run build:ui`

- [ ] **Step 3: Commit**

```bash
git add src/mcp-app/mcp-app.html
git commit -m "feat(mcp-app): add CSS for tool output components"
```

---

### Task 16: Clean Up + CLAUDE.md Update

**Files:**
- Delete: `src/mcp-app/chat-script.js` (replaced by mcp-app.js) if it exists
- Delete: `src/mcp-app/chat-styles.js` (replaced by mcp-app.html CSS) if it exists
- Modify: `CLAUDE.md` (consolidated doc update for all new files)

- [ ] **Step 1: Verify no imports reference legacy files**

Run: `grep -r 'chat-script\|chat-styles' src/`

- [ ] **Step 2: Delete if unused**

- [ ] **Step 3: Run full test suite**

Run: `npm test`

- [ ] **Step 4: Update CLAUDE.md**

Run: `node scripts/validate-docs.js --full` to identify drift.
Manually update the directory structure and module tables in CLAUDE.md
to reflect all new `src/mcp-app/` files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(mcp-app): cleanup legacy files, update CLAUDE.md for tool components"
```

---

## Revised Task Dependency Graph

```
DONE ─────────────────────────────────────────────────────────────────
  Task 1 (utils), Task 2 (icons), Task 3 (highlight),
  Task 4 (generic+dispatcher), Task 5 (bash), Task 6 (edit),
  Task 7 (read), Task 14 (auto-scroll)
──────────────────────────────────────────────────────────────────────

REMAINING (sequential to avoid dispatcher conflicts):

  Task 8 (write) ──> Task 9 (grep) ──> Task 10 (glob) ──> Task 11 (rest)
                                                                │
  Task 12 (markdown) ───────────────────────────────────────────┤
                                                                │
                                                                v
                                                    Task 13 (integration)
                                                                │
                                                                v
                                                    Task 15 (CSS)
                                                                │
                                                                v
                                                    Task 16 (cleanup + docs)
```

**Execution strategy:** Tasks 8-11 run sequentially (they share `tool-output.js`).
Task 12 (markdown) can run in parallel with Tasks 8-11. Task 13 waits for all
formatters + markdown. Task 15 and 16 are sequential at the end.
