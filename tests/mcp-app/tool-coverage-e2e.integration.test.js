/**
 * Tool Coverage Integration Test
 *
 * Starts a real OpenCode server, queries the tool registry endpoint,
 * and asserts our TOOL_HANDLERS map covers every built-in tool.
 *
 * Skipped if opencode-ai is not installed (no LLM calls needed).
 * Writes tests/fixtures/tool-coverage.json for the static test harness.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { TOOL_HANDLERS } = require('../../src/mcp-app/tool-output');

// Skip if opencode-ai binary is not available
const HAS_OPENCODE = (() => {
  try { require.resolve('opencode-ai'); return true; } catch { return false; }
})();
const describeToolCoverage = HAS_OPENCODE ? describe : describe.skip;

/** Fetch JSON from a URL (no external deps). */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/** Known gaps: tools we know about but haven't built renderers for yet. */
const KNOWN_GAPS = ['websearch', 'codesearch', 'apply_patch'];

describeToolCoverage('Tool Coverage E2E', () => {
  let serverProcess;
  let port;

  beforeAll(async () => {
    // Start real OpenCode server
    serverProcess = spawn(
      process.execPath,
      [path.join(__dirname, '..', 'helpers', 'start-server.js')],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Parse port from stdout
    const info = await new Promise((resolve, reject) => {
      let stdout = '';
      serverProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        const lines = stdout.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{')) {
            try {
              resolve(JSON.parse(trimmed));
            } catch { /* not valid JSON yet */ }
          }
        }
      });
      serverProcess.on('error', reject);
      setTimeout(() => reject(new Error('Server start timeout')), 30000);
    });

    port = info.port;
  }, 40000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  it('covers all OpenCode built-in tools (no undocumented gaps)', async () => {
    // 1. Query the authoritative tool list
    const toolIds = await fetchJSON(`http://localhost:${port}/experimental/tool/ids`);
    expect(Array.isArray(toolIds)).toBe(true);
    expect(toolIds.length).toBeGreaterThan(0);

    // 2. Filter out non-tool entries
    const builtinTools = toolIds
      .map(id => id.toLowerCase())
      .filter(id => id !== 'invalid')           // error sentinel
      .filter(id => !id.startsWith('mcp__'));   // provider-specific MCP tools

    // 3. Get our handled tool names
    const handledTools = Object.keys(TOOL_HANDLERS);

    // 4. Find missing tools
    const missing = builtinTools.filter(t => !handledTools.includes(t));

    // 5. Write coverage JSON (always, even on failure)
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    if (!fs.existsSync(fixturesDir)) { fs.mkdirSync(fixturesDir, { recursive: true }); }
    const coverageData = {
      generated: new Date().toISOString(),
      opencode: builtinTools,
      handled: handledTools.filter(t => builtinTools.includes(t)),
      missing,
    };
    fs.writeFileSync(
      path.join(fixturesDir, 'tool-coverage.json'),
      JSON.stringify(coverageData, null, 2) + '\n'
    );

    // 6. Assert: no UNDOCUMENTED missing tools
    const undocumented = missing.filter(t => !KNOWN_GAPS.includes(t));
    if (undocumented.length > 0) {
      throw new Error(
        `Missing renderer for undocumented tools: ${undocumented.join(', ')}\n` +
        'Add formatters in src/mcp-app/tools/ and wire them in tool-output.js.\n' +
        'Or add to KNOWN_GAPS in this test if intentionally deferred.\n' +
        'See docs/tool-coverage.md for instructions.'
      );
    }

    // 7. Log known gaps as info (not failure)
    const knownMissing = missing.filter(t => KNOWN_GAPS.includes(t));
    if (knownMissing.length > 0) {
      console.log(`Known gaps (deferred): ${knownMissing.join(', ')}`);
    }
  }, 60000);
});
