/**
 * MCP Server Handler Tests
 *
 * Tests the tool handler implementations in src/mcp-server.js.
 * Each handler is tested directly (without starting the actual MCP server)
 * using the exported `handlers` object.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('MCP Server Handlers', () => {
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = require('../src/mcp-server').handlers;
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('exports handlers object', () => {
    expect(handlers).toBeDefined();
    expect(typeof handlers).toBe('object');
  });

  test('exports startMcpServer function', () => {
    const { startMcpServer } = require('../src/mcp-server');
    expect(typeof startMcpServer).toBe('function');
  });

  test('handlers has all expected tool names', () => {
    const expectedTools = [
      'sidecar_start', 'sidecar_status', 'sidecar_read',
      'sidecar_list', 'sidecar_resume', 'sidecar_continue',
      'sidecar_setup', 'sidecar_guide', 'sidecar_abort',
    ];
    for (const name of expectedTools) {
      expect(handlers).toHaveProperty(name);
      expect(typeof handlers[name]).toBe('function');
    }
  });

  describe('sidecar_guide', () => {
    test('returns guide text with Sidecar content', async () => {
      const result = await handlers.sidecar_guide({});
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Sidecar');
    });

    test('guide text contains workflow instructions', async () => {
      const result = await handlers.sidecar_guide({});
      const text = result.content[0].text;
      expect(text).toContain('sidecar_start');
      expect(text).toContain('sidecar_status');
      expect(text).toContain('sidecar_read');
    });
  });

  describe('sidecar_list', () => {
    test('returns empty message for fresh project with no sessions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.sidecar_list({}, tmpDir);
        expect(result.content[0].text).toContain('No sidecar sessions found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns empty message when sessions dir exists but is empty', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessionsDir = path.join(tmpDir, '.claude', 'sidecar_sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      try {
        const result = await handlers.sidecar_list({}, tmpDir);
        expect(result.content[0].text).toContain('No sidecar sessions found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('lists sessions with metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'task001');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'task001',
        status: 'complete',
        model: 'gemini',
        briefing: 'Test task briefing',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_list({}, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].id).toBe('task001');
        expect(parsed[0].status).toBe('complete');
        expect(parsed[0].model).toBe('gemini');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('filters sessions by status', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessionsBase = path.join(tmpDir, '.claude', 'sidecar_sessions');

      // Create a running session
      const runDir = path.join(sessionsBase, 'running1');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        taskId: 'running1', status: 'running', model: 'gemini',
        createdAt: new Date().toISOString(),
      }));

      // Create a complete session
      const doneDir = path.join(sessionsBase, 'done1');
      fs.mkdirSync(doneDir, { recursive: true });
      fs.writeFileSync(path.join(doneDir, 'metadata.json'), JSON.stringify({
        taskId: 'done1', status: 'complete', model: 'gpt',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_list({ status: 'running' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].status).toBe('running');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('sorts sessions by createdAt descending', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessionsBase = path.join(tmpDir, '.claude', 'sidecar_sessions');

      const older = path.join(sessionsBase, 'older');
      fs.mkdirSync(older, { recursive: true });
      fs.writeFileSync(path.join(older, 'metadata.json'), JSON.stringify({
        taskId: 'older', status: 'complete', model: 'a',
        createdAt: '2026-01-01T00:00:00.000Z',
      }));

      const newer = path.join(sessionsBase, 'newer');
      fs.mkdirSync(newer, { recursive: true });
      fs.writeFileSync(path.join(newer, 'metadata.json'), JSON.stringify({
        taskId: 'newer', status: 'complete', model: 'b',
        createdAt: '2026-03-01T00:00:00.000Z',
      }));

      try {
        const result = await handlers.sidecar_list({}, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed[0].id).toBe('newer');
        expect(parsed[1].id).toBe('older');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('sidecar_status', () => {
    test('returns status for existing session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abc12345');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'abc12345',
        status: 'running',
        model: 'gemini',
        agent: 'Chat',
        briefing: 'Test briefing content',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'abc12345' }, tmpDir);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.taskId).toBe('abc12345');
        expect(parsed.status).toBe('running');
        expect(parsed.model).toBe('gemini');
        expect(parsed.agent).toBe('Chat');
        expect(parsed).toHaveProperty('elapsed');
        expect(parsed.briefing).toContain('Test briefing');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns error for missing session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.sidecar_status({ taskId: 'nonexistent' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('truncates long briefings', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'trunc1');
      fs.mkdirSync(sessDir, { recursive: true });
      const longBriefing = 'x'.repeat(200);
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'trunc1', status: 'running', model: 'a',
        briefing: longBriefing,
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'trunc1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.briefing.length).toBeLessThanOrEqual(100);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('sidecar_read', () => {
    test('returns summary when available', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'read123');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Test Summary\n\nResults here.');

      try {
        const result = await handlers.sidecar_read({ taskId: 'read123' }, tmpDir);
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('Test Summary');
        expect(result.content[0].text).toContain('Results here.');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns metadata when mode is metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'meta1');
      fs.mkdirSync(sessDir, { recursive: true });
      const meta = { taskId: 'meta1', status: 'complete', model: 'gemini' };
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify(meta));

      try {
        const result = await handlers.sidecar_read({ taskId: 'meta1', mode: 'metadata' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.taskId).toBe('meta1');
        expect(parsed.status).toBe('complete');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns conversation when mode is conversation', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'conv1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '{"role":"user","content":"hello"}\n');

      try {
        const result = await handlers.sidecar_read({ taskId: 'conv1', mode: 'conversation' }, tmpDir);
        expect(result.content[0].text).toContain('hello');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns message when no conversation file exists', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'noconv');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');

      try {
        const result = await handlers.sidecar_read({ taskId: 'noconv', mode: 'conversation' }, tmpDir);
        expect(result.content[0].text).toContain('No conversation recorded');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns message when no summary file exists', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'nosum');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');

      try {
        const result = await handlers.sidecar_read({ taskId: 'nosum' }, tmpDir);
        expect(result.content[0].text).toContain('No summary available');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns error for missing session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.sidecar_read({ taskId: 'nope' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('sidecar_start', () => {
    test('handler is an async function', () => {
      expect(typeof handlers.sidecar_start).toBe('function');
    });
  });

  describe('sidecar_resume', () => {
    test('handler is an async function', () => {
      expect(typeof handlers.sidecar_resume).toBe('function');
    });
  });

  describe('sidecar_continue', () => {
    test('handler is an async function', () => {
      expect(typeof handlers.sidecar_continue).toBe('function');
    });
  });

  describe('sidecar_setup', () => {
    test('handler is an async function', () => {
      expect(typeof handlers.sidecar_setup).toBe('function');
    });
  });

  describe('sidecar_abort', () => {
    test('aborts a running session — status updated to aborted', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abort1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'abort1', status: 'running', model: 'gemini',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_abort({ taskId: 'abort1' }, tmpDir);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('aborted');
        expect(parsed.taskId).toBe('abort1');

        // Verify metadata was updated on disk
        const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
        expect(meta.status).toBe('aborted');
        expect(meta.abortedAt).toBeDefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns informational message for non-running session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'done1', status: 'complete', model: 'gemini',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_abort({ taskId: 'done1' }, tmpDir);
        expect(result.content[0].text).toContain('not running');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns error for missing session', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      try {
        const result = await handlers.sidecar_abort({ taskId: 'nonexistent' }, tmpDir);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });
});
