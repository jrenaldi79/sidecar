# Tool Coverage

Coverage matrix for MCP App tool renderers vs. OpenCode built-in tools.

## Coverage Matrix

| OpenCode Tool | Renderer | File |
|---------------|----------|------|
| `bash` | Yes | `src/mcp-app/tools/bash.js` |
| `read` | Yes | `src/mcp-app/tools/read.js` |
| `write` | Yes | `src/mcp-app/tools/write.js` |
| `edit` | Yes | `src/mcp-app/tools/edit.js` |
| `glob` | Yes | `src/mcp-app/tools/glob.js` |
| `grep` | Yes | `src/mcp-app/tools/grep.js` |
| `question` | Yes | `src/mcp-app/tools/question.js` |
| `list` / `ls` | Yes | `src/mcp-app/tools/list.js` |
| `task` | Yes | `src/mcp-app/tools/task.js` |
| `webfetch` | Yes | `src/mcp-app/tools/webfetch.js` |
| `todowrite` / `todoread` | Yes | `src/mcp-app/tools/todo.js` |
| `websearch` | **No** | Known gap |
| `codesearch` | **No** | Known gap |
| `skill` | **No** | Known gap |
| `apply_patch` | **No** | Known gap |

Tools not listed above (e.g. `mcp__*` prefixed) are provider-specific and use the generic fallback renderer (`src/mcp-app/tools/generic.js`).

## Missing Tool Details

| Tool | Description | Priority |
|------|-------------|----------|
| `websearch` | Web search with query, returns search results | Known gap |
| `codesearch` | Code-aware search (semantic/symbol search) | Known gap |
| `skill` | Invoke a skill by name with arguments | Known gap |
| `apply_patch` | Apply a unified diff patch to files | Known gap |

## How to Find Input/Output Schemas

Query the OpenCode tool schema endpoint with a valid provider/model pair:

    GET /experimental/tool?provider={provider}&model={model}

This returns JSON schemas for each tool's parameters. The `@opencode-ai/sdk` type definitions are also helpful: `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`.

## How to Build a New Renderer

1. Query the schema endpoint to understand the input/output shape
2. Start the interactive harness (`npm run dev:ui -- --model gemini --prompt "use <toolname>"`) and exercise the tool
3. Inspect raw API data via the browser console or CDP (see `docs/interactive-harness.md`)
4. Create `src/mcp-app/tools/<name>.js` following the CJS pattern:
   ```js
   const { escapeHtml } = require('../utils');

   function formatXxxOutput(input, output) {
     // Return an HTML string
     return '<div class="xxx-output">' + escapeHtml(output) + '</div>';
   }

   module.exports = { formatXxxOutput };
   ```
5. Add the entry to `TOOL_HANDLERS` in `src/mcp-app/tool-output.js`
6. Add mock data to `src/mcp-app/test-harness.js`
7. Add unit test in `tests/mcp-app/tools/<name>.test.js`
8. Remove from `KNOWN_GAPS` in `tests/mcp-app/tool-coverage-e2e.integration.test.js`
9. Run `npm run qa:ui` to visually verify the rendering

## Running the Coverage Test

```bash
# Run the integration test (requires opencode-ai installed)
npm test tests/mcp-app/tool-coverage-e2e.integration.test.js

# View the static test harness with coverage panel
npm run qa:ui
```

The integration test writes `tests/fixtures/tool-coverage.json`. The `qa:ui` script copies it to `src/mcp-app/tool-coverage.json` so the coverage panel can display it.

## Reference

- OpenCode SDK types: `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`
- Tool IDs endpoint: `GET /experimental/tool/ids`
- Tool schemas endpoint: `GET /experimental/tool?provider=X&model=Y`
- Existing renderer pattern: `src/mcp-app/tools/bash.js` (simplest example)
- Static test harness: `npm run qa:ui`
- Interactive harness: `npm run dev:ui` (see `docs/interactive-harness.md`)
