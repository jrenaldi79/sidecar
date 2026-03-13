# MCP App Tool Components Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rich tool output rendering to the MCP App inline chat UI, recovering
components from the deleted Electron UI (commit `ef82aba`) and adapting them for
the Vite-bundled ext-apps sandbox.

**Architecture:** Modular ES modules under `src/mcp-app/`. Each tool formatter is a
standalone file exporting a function that takes `(input, output)` and returns a
`DocumentFragment` (no innerHTML). A dispatcher routes `toolName` to the right
formatter. Markdown rendering via `marked` npm dependency with DOM-based output.
All CSS in `mcp-app.html` using existing theme variables.

**Tech Stack:** Vite + vite-plugin-singlefile, marked (npm), ext-apps SDK, vanilla DOM

**Spec:** `docs/superpowers/specs/2026-03-13-mcp-app-tool-components-design.md`

**Recovery source:** `git show ef82aba^:electron/ui/renderer.js`

---

## File Structure

```
src/mcp-app/
  mcp-app.html          MODIFY  Add CSS for tool output, code blocks, diff, etc.
  mcp-app.js            MODIFY  Import dispatcher, use in renderMessage, add auto-scroll
  utils.js              CREATE  escapeHtml, copyToClipboard, chevron SVG constants
  icons.js              CREATE  getToolIcon, getFileIcon
  highlight.js          CREATE  highlightCode, formatBashCommand
  markdown.js           CREATE  renderMarkdown (marked + custom code renderer)
  auto-scroll.js        CREATE  setupAutoScroll
  tool-output.js        CREATE  formatToolOutput dispatcher
  tools/
    bash.js             CREATE  formatBashOutput
    edit.js             CREATE  formatEditDiff
    write.js            CREATE  formatWriteOutput
    read.js             CREATE  formatFileOutput
    grep.js             CREATE  formatGrepOutput
    glob.js             CREATE  formatGlobOutput
    question.js         CREATE  formatQuestionOutput
    list.js             CREATE  formatListOutput
    todo.js             CREATE  formatTodoOutput
    webfetch.js         CREATE  formatWebfetchOutput
    task.js             CREATE  formatTaskOutput
    generic.js          CREATE  formatGenericOutput
tests/mcp-app/
  utils.test.js         CREATE  escapeHtml, copyToClipboard tests
  icons.test.js         CREATE  getToolIcon, getFileIcon tests
  highlight.test.js     CREATE  highlightCode, formatBashCommand tests
  tool-output.test.js   CREATE  dispatcher routing tests
  tools/
    bash.test.js        CREATE  formatBashOutput tests
    edit.test.js        CREATE  formatEditDiff tests
    read.test.js        CREATE  formatFileOutput tests
    generic.test.js     CREATE  formatGenericOutput tests
```

---

## Chunk 1: Foundation (utils, icons, highlight)

### Task 1: Utility Functions

**Files:**
- Create: `src/mcp-app/utils.js`
- Test: `tests/mcp-app/utils.test.js`

- [ ] **Step 1: Write failing tests for escapeHtml**

```javascript
// tests/mcp-app/utils.test.js
const { escapeHtml, copyIconSvg, chevronRightSvg, chevronDownSvg } = require('../../src/mcp-app/utils');

describe('escapeHtml', () => {
  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
  test('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });
  test('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
  test('passes through safe text', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('SVG constants', () => {
  test('copyIconSvg is an SVG string', () => {
    expect(copyIconSvg).toContain('<svg');
  });
  test('chevronRightSvg is an SVG string', () => {
    expect(chevronRightSvg).toContain('<svg');
  });
  test('chevronDownSvg is an SVG string', () => {
    expect(chevronDownSvg).toContain('<svg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-app/utils.test.js`
Expected: FAIL - cannot find module

- [ ] **Step 3: Implement utils.js**

Recover `escapeHtml` (line 4447), `copyToClipboard` (line 3103), and SVG
constants (lines 1610-1612, 3096) from `git show ef82aba^:electron/ui/renderer.js`.

Adapt: use string replacement instead of `document.createElement` for Node.js
test compatibility. Export as CommonJS for test compat (Vite handles ESM conversion).

```javascript
// src/mcp-app/utils.js
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text) {
  if (!text) { return ''; }
  return String(text).replace(/[&<>"']/g, c => ESCAPE_MAP[c]);
}

const copyIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const chevronRightSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2L8 6L4 10"/></svg>';
const chevronDownSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4L6 8L10 4"/></svg>';
const chevronUpSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8L6 4L10 8"/></svg>';

module.exports = { escapeHtml, copyIconSvg, chevronRightSvg, chevronDownSvg, chevronUpSvg };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/mcp-app/utils.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-app/utils.js tests/mcp-app/utils.test.js
git commit -m "feat(mcp-app): add escapeHtml utility and SVG constants"
```

---

### Task 2: Tool Icons

**Files:**
- Create: `src/mcp-app/icons.js`
- Test: `tests/mcp-app/icons.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
const { getToolIcon, getFileIcon } = require('../../src/mcp-app/icons');

describe('getToolIcon', () => {
  test('returns SVG for bash', () => {
    expect(getToolIcon('bash')).toContain('<svg');
  });
  test('returns SVG for unknown tool', () => {
    expect(getToolIcon('unknown_tool')).toContain('<svg');
  });
  test('is case-insensitive', () => {
    expect(getToolIcon('Bash')).toEqual(getToolIcon('bash'));
  });
});

describe('getFileIcon', () => {
  test('returns JS badge for js extension', () => {
    expect(getFileIcon('js')).toContain('JS');
  });
  test('returns empty for unknown extension', () => {
    expect(getFileIcon('xyz')).toContain('file-icon');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-app/icons.test.js`
Expected: FAIL

- [ ] **Step 3: Implement icons.js**

Recover `getToolIcon` (line 4534) and `getFileIcon` (line 3536) from git history.
Export as CommonJS.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/mcp-app/icons.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-app/icons.js tests/mcp-app/icons.test.js
git commit -m "feat(mcp-app): add tool and file type SVG icons"
```

---

### Task 3: Syntax Highlighting

**Files:**
- Create: `src/mcp-app/highlight.js`
- Test: `tests/mcp-app/highlight.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
const { highlightCode, formatBashCommand } = require('../../src/mcp-app/highlight');

describe('highlightCode', () => {
  test('highlights JS keywords', () => {
    const result = highlightCode('const x = 1;', 'js');
    expect(result).toContain('hl-keyword');
    expect(result).toContain('hl-number');
  });
  test('highlights strings', () => {
    const result = highlightCode('const s = "hello";', 'js');
    expect(result).toContain('hl-string');
  });
  test('escapes HTML in code', () => {
    const result = highlightCode('<div>test</div>', 'html');
    expect(result).toContain('&lt;div&gt;');
  });
});

describe('formatBashCommand', () => {
  test('highlights common commands', () => {
    const result = formatBashCommand('git status');
    expect(result).toContain('bash-cmd');
  });
  test('highlights flags', () => {
    const result = formatBashCommand('ls -la --all');
    expect(result).toContain('bash-flag');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-app/highlight.test.js`
Expected: FAIL

- [ ] **Step 3: Implement highlight.js**

Recover `highlightCode` (line 4483) and `formatBashCommand` (line 3261) from
git history. Both depend on `escapeHtml` from `utils.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/mcp-app/highlight.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-app/highlight.js tests/mcp-app/highlight.test.js
git commit -m "feat(mcp-app): add syntax highlighting for code and bash commands"
```

---

## Chunk 2: Tool Output Formatters (Tier 1)

### Task 4: Generic Formatter + Dispatcher

**Files:**
- Create: `src/mcp-app/tools/generic.js`
- Create: `src/mcp-app/tool-output.js`
- Test: `tests/mcp-app/tools/generic.test.js`
- Test: `tests/mcp-app/tool-output.test.js`

- [ ] **Step 1: Write failing tests for generic formatter**

```javascript
const { formatGenericOutput } = require('../../../src/mcp-app/tools/generic');

describe('formatGenericOutput', () => {
  test('returns escaped text', () => {
    const el = formatGenericOutput({}, 'hello <world>');
    expect(el).toContain('hello');
    expect(el).not.toContain('<world>');
  });
  test('truncates long output', () => {
    const long = 'x'.repeat(3000);
    const el = formatGenericOutput({}, long);
    expect(el).toContain('...');
  });
});
```

- [ ] **Step 2: Write failing tests for dispatcher**

```javascript
const { formatToolOutput } = require('../../src/mcp-app/tool-output');

describe('formatToolOutput', () => {
  test('routes bash to bash formatter', () => {
    const result = formatToolOutput('Bash', { command: 'ls' }, 'file.txt');
    expect(result).toBeTruthy();
  });
  test('falls back to generic for unknown tools', () => {
    const result = formatToolOutput('UnknownTool', {}, 'output text');
    expect(result).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test tests/mcp-app/tools/generic.test.js tests/mcp-app/tool-output.test.js`
Expected: FAIL

- [ ] **Step 4: Implement generic.js**

Recover `formatGenericOutput` (line 3331). Adapt to return HTML string
(formatters return strings; the caller in mcp-app.js creates DOM elements).

- [ ] **Step 5: Implement tool-output.js dispatcher**

Recover `formatToolOutput` (line 2829). Start with just generic fallback.
Other formatters added in subsequent tasks.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test tests/mcp-app/tools/generic.test.js tests/mcp-app/tool-output.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/mcp-app/tools/generic.js src/mcp-app/tool-output.js tests/mcp-app/tools/ tests/mcp-app/tool-output.test.js
git commit -m "feat(mcp-app): add tool output dispatcher and generic formatter"
```

---

### Task 5: Bash Formatter

**Files:**
- Create: `src/mcp-app/tools/bash.js`
- Test: `tests/mcp-app/tools/bash.test.js`
- Modify: `src/mcp-app/tool-output.js` (add bash route)

- [ ] **Step 1: Write failing tests**

```javascript
const { formatBashOutput } = require('../../../src/mcp-app/tools/bash');

describe('formatBashOutput', () => {
  test('renders command card', () => {
    const html = formatBashOutput({ command: 'npm test' }, 'PASS');
    expect(html).toContain('npm');
    expect(html).toContain('bash');
  });
  test('renders output section', () => {
    const html = formatBashOutput({ command: 'ls' }, 'file.txt\ndir/');
    expect(html).toContain('file.txt');
  });
  test('colorizes PASS lines', () => {
    const html = formatBashOutput({ command: 'npm test' }, 'PASS tests/foo.test.js');
    expect(html).toContain('success');
  });
  test('truncates long output', () => {
    const lines = Array(20).fill('line').join('\n');
    const html = formatBashOutput({ command: 'cat' }, lines);
    expect(html).toContain('more lines');
  });
  test('handles missing command', () => {
    const html = formatBashOutput({}, 'some output');
    expect(html).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/mcp-app/tools/bash.test.js`
Expected: FAIL

- [ ] **Step 3: Implement bash.js**

Recover `formatBashOutput` (line 3118), `formatBashLine` (line 3180) from
git history. Depends on `escapeHtml`, `formatBashCommand`, `copyIconSvg`,
`chevronDownSvg`.

- [ ] **Step 4: Add bash route to dispatcher**

In `tool-output.js`, add: `if (name === 'bash') { return formatBashOutput(input, output); }`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test tests/mcp-app/tools/bash.test.js tests/mcp-app/tool-output.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/mcp-app/tools/bash.js tests/mcp-app/tools/bash.test.js src/mcp-app/tool-output.js
git commit -m "feat(mcp-app): add bash tool output formatter"
```

---

### Task 6: Edit Diff Formatter

**Files:**
- Create: `src/mcp-app/tools/edit.js`
- Test: `tests/mcp-app/tools/edit.test.js`
- Modify: `src/mcp-app/tool-output.js` (add edit route)

- [ ] **Step 1: Write failing tests**

```javascript
const { formatEditDiff } = require('../../../src/mcp-app/tools/edit');

describe('formatEditDiff', () => {
  test('renders diff with additions and deletions', () => {
    const html = formatEditDiff({ old_string: 'foo', new_string: 'bar' });
    expect(html).toContain('deletion');
    expect(html).toContain('addition');
  });
  test('shows context lines', () => {
    const html = formatEditDiff({
      old_string: 'a\nb\nc\nd',
      new_string: 'a\nb\nX\nd'
    });
    expect(html).toContain('context');
  });
  test('handles empty input gracefully', () => {
    const html = formatEditDiff({});
    expect(html).toBeTruthy();
  });
  test('truncates long diffs', () => {
    const old_string = Array(20).fill('old line').join('\n');
    const new_string = Array(20).fill('new line').join('\n');
    const html = formatEditDiff({ old_string, new_string });
    expect(html).toContain('more lines');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement edit.js**

Recover `buildEditDiffLines` (line 2893), `renderDiffLine` (line 2949),
`formatEditDiff` (line 2982) from git history.

- [ ] **Step 4: Add edit route to dispatcher, run tests**

- [ ] **Step 5: Commit**

```bash
git add src/mcp-app/tools/edit.js tests/mcp-app/tools/edit.test.js src/mcp-app/tool-output.js
git commit -m "feat(mcp-app): add edit diff tool output formatter"
```

---

### Task 7: Read/File Formatter

**Files:**
- Create: `src/mcp-app/tools/read.js`
- Test: `tests/mcp-app/tools/read.test.js`
- Modify: `src/mcp-app/tool-output.js` (add read route)

- [ ] **Step 1: Write failing tests**

```javascript
const { formatFileOutput } = require('../../../src/mcp-app/tools/read');

describe('formatFileOutput', () => {
  test('renders line numbers', () => {
    const html = formatFileOutput({}, '     1\u2192const x = 1;\n     2\u2192const y = 2;');
    expect(html).toContain('1');
    expect(html).toContain('2');
  });
  test('handles pipe format', () => {
    const html = formatFileOutput({}, '00001| const x = 1;');
    expect(html).toContain('1');
  });
  test('truncates long files', () => {
    const lines = Array(30).fill('     1\u2192line').join('\n');
    const html = formatFileOutput({}, lines);
    expect(html).toContain('more');
  });
});
```

- [ ] **Step 2-4: Implement and test**

- [ ] **Step 5: Commit**

```bash
git add src/mcp-app/tools/read.js tests/mcp-app/tools/read.test.js src/mcp-app/tool-output.js
git commit -m "feat(mcp-app): add file read tool output formatter"
```

---

## Chunk 3: Tool Output Formatters (Tier 2)

### Task 8: Write Formatter

**Files:**
- Create: `src/mcp-app/tools/write.js`
- Modify: `src/mcp-app/tool-output.js`

Recover `formatWriteOutput` (line 3044). All-green addition lines.
Pattern identical to edit.js but simpler (no deletions).

- [ ] **Step 1: Write failing test**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Add route, run tests**
- [ ] **Step 4: Commit**

### Task 9: Grep Formatter

**Files:**
- Create: `src/mcp-app/tools/grep.js`
- Modify: `src/mcp-app/tool-output.js`

Recover `formatGrepOutput` (line 3447) and `highlightSearchPattern` (line 3568).
Groups by file, shows match counts, line numbers, pattern highlighting.

- [ ] **Step 1: Write failing test**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Add route, run tests**
- [ ] **Step 4: Commit**

### Task 10: Glob Formatter

**Files:**
- Create: `src/mcp-app/tools/glob.js`
- Modify: `src/mcp-app/tool-output.js`

Recover `formatGlobOutput` (line 3388). Groups by directory, file type badges.

- [ ] **Step 1: Write failing test**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Add route, run tests**
- [ ] **Step 4: Commit**

### Task 11: Question, List, Todo, WebFetch, Task Formatters

**Files:**
- Create: `src/mcp-app/tools/question.js`
- Create: `src/mcp-app/tools/list.js`
- Create: `src/mcp-app/tools/todo.js`
- Create: `src/mcp-app/tools/webfetch.js`
- Create: `src/mcp-app/tools/task.js`
- Modify: `src/mcp-app/tool-output.js`

Recover each from git history (see spec for line numbers).
Each is a standalone file, one test file per formatter.

- [ ] **Step 1: Implement all five formatters**
- [ ] **Step 2: Write tests for each**
- [ ] **Step 3: Add routes to dispatcher**
- [ ] **Step 4: Run all tool tests**
- [ ] **Step 5: Commit**

---

## Chunk 4: Markdown Rendering

### Task 12: Install marked + Markdown Renderer

**Files:**
- Create: `src/mcp-app/markdown.js`
- Modify: `package.json` (add marked dependency)

- [ ] **Step 1: Install marked**

Run: `npm install marked`

- [ ] **Step 2: Write failing test**

Test that `renderMarkdown('**bold**')` returns HTML with `<strong>`.
Test that code blocks get syntax highlighting classes.
Test that HTML in markdown is escaped.

- [ ] **Step 3: Implement markdown.js**

```javascript
import { marked } from 'marked';
import { highlightCode } from './highlight.js';
import { escapeHtml } from './utils.js';

const renderer = new marked.Renderer();
renderer.code = function(code, language) {
  const lang = language || '';
  const codeText = typeof code === 'object' ? code.text : code;
  const highlighted = highlightCode(codeText, lang);
  const langLabel = lang ? `<div class="code-language">${escapeHtml(lang)}</div>` : '';
  return `<pre>${langLabel}<code class="language-${lang}">${highlighted}</code></pre>`;
};

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(text) {
  try {
    return marked.parse(text, { renderer });
  } catch {
    return escapeHtml(text);
  }
}
```

**IMPORTANT:** The HTML output from marked will be set via a sanitized approach.
Since innerHTML is blocked by security hooks, use DOMParser to create elements
safely, or use marked's `walkTokens` to build DOM directly.

- [ ] **Step 4: Run test**
- [ ] **Step 5: Commit**

```bash
git add src/mcp-app/markdown.js package.json package-lock.json
git commit -m "feat(mcp-app): add markdown renderer with syntax highlighting"
```

---

## Chunk 5: Integration

### Task 13: Wire Tool Output into renderMessage

**Files:**
- Modify: `src/mcp-app/mcp-app.js`

- [ ] **Step 1: Update renderMessage to use formatToolOutput**

Replace the current `makeToolIndicator` call with:
1. Import `formatToolOutput` from `./tool-output.js`
2. For each tool part, call `formatToolOutput(p.toolName, p.state?.input, p.state?.output)`
3. Create a container div, set its innerHTML via DOMParser sanitization
4. Keep the compact indicator as a summary header, tool output as expandable detail

- [ ] **Step 2: Update makeBubble to use renderMarkdown for assistant text**

For assistant role messages, render markdown instead of plain textContent.

- [ ] **Step 3: Build and manually test**

Run: `npm run build:ui`
Test in Claude Desktop with a sidecar that uses bash, edit, read tools.

- [ ] **Step 4: Commit**

```bash
git add src/mcp-app/mcp-app.js
git commit -m "feat(mcp-app): wire tool output formatters into message rendering"
```

---

### Task 14: Auto-Scroll with User Override

**Files:**
- Create: `src/mcp-app/auto-scroll.js`
- Modify: `src/mcp-app/mcp-app.js`

- [ ] **Step 1: Implement auto-scroll.js**

Recover pattern from renderer.js line 1271. MutationObserver on messages
container, disable auto-scroll when user scrolls up (50px threshold),
re-enable at bottom.

- [ ] **Step 2: Import and attach in mcp-app.js**

Replace the current `container.scrollTop = container.scrollHeight` calls
with the auto-scroll controller.

- [ ] **Step 3: Build and test**

Run: `npm run build:ui`

- [ ] **Step 4: Commit**

```bash
git add src/mcp-app/auto-scroll.js src/mcp-app/mcp-app.js
git commit -m "feat(mcp-app): add auto-scroll with user-override"
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

### Task 16: Clean Up Legacy Files

**Files:**
- Delete: `src/mcp-app/chat-script.js` (replaced by mcp-app.js)
- Delete: `src/mcp-app/chat-styles.js` (replaced by mcp-app.html CSS)

- [ ] **Step 1: Verify no imports reference these files**

Run: `grep -r 'chat-script\|chat-styles' src/`

- [ ] **Step 2: Delete if unused**

- [ ] **Step 3: Run full test suite**

Run: `npm test`

- [ ] **Step 4: Update CLAUDE.md if needed**

Run: `node scripts/generate-docs.js`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(mcp-app): remove legacy chat-script and chat-styles"
```

---

## Task Dependency Graph

```
Task 1 (utils) ──┬──> Task 3 (highlight) ──> Task 12 (markdown) ──> Task 13 (integration)
                  │                                                          │
Task 2 (icons) ──┤                                                          ├──> Task 15 (CSS)
                  │                                                          │
                  └──> Task 4 (generic+dispatcher) ──> Task 5 (bash) ───┐   │
                                                       Task 6 (edit) ───┤   │
                                                       Task 7 (read) ───┼──>┘
                                                       Task 8 (write) ──┤
                                                       Task 9 (grep) ───┤
                                                       Task 10 (glob) ──┤
                                                       Task 11 (rest) ──┘

Task 14 (auto-scroll) ──> Task 13 (integration)
Task 16 (cleanup) ──> runs last
```

**Parallelizable:** Tasks 1+2 can run in parallel. Tasks 5-11 can all run in
parallel after Task 4. Task 14 is independent of Tasks 5-12.
