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

/**
 * Tests that verify the args passed to the spawned CLI process.
 * Uses jest.isolateModulesAsync + jest.doMock to mock child_process per-test.
 * jest.doMock (unlike jest.mock) is not hoisted, so it can reference outer variables.
 */
describe('MCP spawn arg building', () => {
  test('sidecar_start passes --task-id matching returned taskId', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      const result = await h.sidecar_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test' }, '/tmp');
      const { taskId } = JSON.parse(result.content[0].text);
      const idx = capturedArgs.indexOf('--task-id');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe(taskId);
    });
  });

  test('sidecar_start passes --client cowork only when coworkProcess is set', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');

      // Without coworkProcess: no --client flag
      await h.sidecar_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test' }, '/tmp');
      expect(capturedArgs.indexOf('--client')).toBe(-1);
    });

    // With coworkProcess: --client cowork is passed
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      await h.sidecar_start({ prompt: 'test', noUi: true, model: 'google/gemini-test', coworkProcess: 'my-vm' }, '/tmp');
      const idx = capturedArgs.indexOf('--client');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe('cowork');
    });
  });

  test('sidecar_start passes --session-id when parentSession is provided', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      await h.sidecar_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test', parentSession: 'f58f2782-fc8c-41bc-afbc-e0c130b91aaf' }, '/tmp');
      const idx = capturedArgs.indexOf('--session-id');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe('f58f2782-fc8c-41bc-afbc-e0c130b91aaf');
    });
  });

  test('sidecar_start passes --timeout when provided', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      await h.sidecar_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test', timeout: 30 }, '/tmp');
      const idx = capturedArgs.indexOf('--timeout');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe('30');
    });
  });

  test('sidecar_continue returns a NEW taskId, not the parent taskId', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => ({
          pid: 12345, unref: jest.fn(),
          stdout: { on: jest.fn() }, stderr: { on: jest.fn() },
        })),
      }));
      const { handlers: h } = require('../src/mcp-server');
      const parentTaskId = 'parent123';
      const result = await h.sidecar_continue(
        { taskId: parentTaskId, prompt: 'follow-up task', noUi: true }, '/tmp'
      );
      const { taskId } = JSON.parse(result.content[0].text);
      expect(taskId).not.toBe(parentTaskId);
      expect(taskId).toBeTruthy();
    });
  });

  test('sidecar_continue passes --task-id matching the new returned taskId', async () => {
    let capturedArgs;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = args;
          return { pid: 12345, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }),
      }));
      const { handlers: h } = require('../src/mcp-server');
      const result = await h.sidecar_continue(
        { taskId: 'old-parent', prompt: 'new task', noUi: true }, '/tmp'
      );
      const { taskId: newTaskId } = JSON.parse(result.content[0].text);
      const idx = capturedArgs.indexOf('--task-id');
      expect(idx).toBeGreaterThan(-1);
      expect(capturedArgs[idx + 1]).toBe(newTaskId);
    });
  });
});

describe('safeSessionDir (shared validator)', () => {
  const { safeSessionDir, validateTaskId } = require('../src/utils/validators');

  test('allows valid task IDs', () => {
    const result = safeSessionDir('/tmp/project', 'abc-123_task');
    expect(result).toContain('abc-123_task');
  });

  test('rejects path traversal attempts', () => {
    expect(() => safeSessionDir('/tmp/project', '../../../etc'))
      .toThrow('path traversal');
  });

  test('rejects dot-dot within task ID', () => {
    expect(() => safeSessionDir('/tmp/project', 'task/../../../etc'))
      .toThrow('path traversal');
  });

  test('validateTaskId accepts valid IDs', () => {
    expect(validateTaskId('abc123').valid).toBe(true);
    expect(validateTaskId('task-001').valid).toBe(true);
    expect(validateTaskId('my_task').valid).toBe(true);
  });

  test('validateTaskId rejects invalid IDs', () => {
    expect(validateTaskId('../etc').valid).toBe(false);
    expect(validateTaskId('').valid).toBe(false);
    expect(validateTaskId(null).valid).toBe(false);
    expect(validateTaskId('a;rm -rf /').valid).toBe(false);
  });
});

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
    test('returns status for existing running session with progress', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abc12345');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'abc12345',
        status: 'running',
        pid: process.pid,
        model: 'gemini',
        agent: 'Chat',
        briefing: 'Test briefing content',
        createdAt: new Date().toISOString(),
      }));
      // Write a conversation.jsonl so progress reader finds messages
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
        '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}\n');

      try {
        const result = await handlers.sidecar_status({ taskId: 'abc12345' }, tmpDir);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.taskId).toBe('abc12345');
        expect(parsed.status).toBe('running');
        expect(parsed).toHaveProperty('elapsed');
        expect(parsed).toHaveProperty('messages');
        expect(parsed).toHaveProperty('lastActivity');
        expect(parsed).toHaveProperty('latest');
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
  });

  describe('sidecar_status enriched response', () => {
    test('includes messages and lastActivity when running', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'prog1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'prog1', status: 'running', pid: process.pid,
        createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
        '{"role":"user","content":"analyze auth"}\n' +
        '{"role":"assistant","toolCall":{"name":"Read"}}\n' +
        '{"role":"assistant","content":"Found the issue"}\n');

      try {
        const result = await handlers.sidecar_status({ taskId: 'prog1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('running');
        expect(parsed.messages).toBe(2);
        expect(parsed.lastActivity).toBeDefined();
        expect(parsed.latest).toBeDefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('returns Starting up when no conversation yet', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'noprog');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'noprog', status: 'running', pid: process.pid,
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'noprog' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.messages).toBe(0);
        expect(parsed.latest).toBe('Starting up...');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('detects crashed process and updates status', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'dead1');
      fs.mkdirSync(sessDir, { recursive: true });
      // PID 2147483647 is guaranteed to not exist
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'dead1', status: 'running', pid: 2147483647,
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'dead1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('crashed');
        expect(parsed.reason).toBeDefined();

        // Verify metadata on disk was updated
        const diskMeta = JSON.parse(fs.readFileSync(
          path.join(sessDir, 'metadata.json'), 'utf-8'));
        expect(diskMeta.status).toBe('crashed');
        expect(diskMeta.crashedAt).toBeDefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not include latest/messages for completed sessions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'done1', status: 'complete',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'done1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.taskId).toBe('done1');
        expect(parsed.status).toBe('complete');
        expect(parsed).toHaveProperty('elapsed');
        expect(parsed.latest).toBeUndefined();
        expect(parsed.messages).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('includes reason for error/crashed sessions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-status-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'err1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'err1', status: 'error',
        reason: 'API key expired',
        createdAt: new Date().toISOString(),
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'err1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('error');
        expect(parsed.reason).toBe('API key expired');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('sidecar_status next_poll field', () => {
    test('includes next_poll when headless:true and status:running', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'hl1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'hl1', status: 'running', pid: process.pid,
        headless: true, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.sidecar_status({ taskId: 'hl1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveProperty('next_poll');
        expect(parsed.next_poll).toHaveProperty('hint');
        expect(parsed.next_poll.hint).toContain('sleep 25');
        expect(parsed.next_poll).not.toHaveProperty('recommended_wait_seconds');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('omits next_poll when headless is false (interactive)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'ia1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'ia1', status: 'running', pid: process.pid,
        headless: false, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.sidecar_status({ taskId: 'ia1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).not.toHaveProperty('next_poll');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('omits next_poll when headless is missing (legacy sessions)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'leg1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'leg1', status: 'running', pid: process.pid,
        createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.sidecar_status({ taskId: 'leg1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).not.toHaveProperty('next_poll');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('omits next_poll when headless:true but status:complete', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'hlc1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'hlc1', status: 'complete', headless: true,
        createdAt: new Date().toISOString(),
      }));
      try {
        const result = await handlers.sidecar_status({ taskId: 'hlc1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('complete');
        expect(parsed).not.toHaveProperty('next_poll');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('next_poll hint contains at-least-30s guidance', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'ph1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'ph1', status: 'running', pid: process.pid,
        headless: true, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.sidecar_status({ taskId: 'ph1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.next_poll.hint).toContain('sleep 25');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('headless running sidecar_status includes system-reminder content block', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'sr2');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'sr2', status: 'running', pid: process.pid,
        headless: true, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.sidecar_status({ taskId: 'sr2' }, tmpDir);
        expect(result.content).toHaveLength(2);
        expect(result.content[1].text).toContain('<system-reminder>');
        expect(result.content[1].text).toContain('sleep 25');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('interactive running sidecar_status has no system-reminder', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-poll-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'sri2');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'sri2', status: 'running', pid: process.pid,
        headless: false, createdAt: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'), '');
      try {
        const result = await handlers.sidecar_status({ taskId: 'sri2' }, tmpDir);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].text).not.toContain('<system-reminder>');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('sidecar_status stall detection', () => {
    test('includes stalled: true when lastActivityMs exceeds threshold', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stall-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'stall1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'stall1', status: 'running', model: 'gemini',
        pid: process.pid, headless: true,
        createdAt: new Date(Date.now() - 300000).toISOString(),
      }));
      // Write conversation.jsonl with old mtime (3 minutes ago)
      const convPath = path.join(sessDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'assistant', content: 'working' }));
      const threeMinutesAgo = new Date(Date.now() - 180000);
      fs.utimesSync(convPath, threeMinutesAgo, threeMinutesAgo);
      // Write old progress.json too
      fs.writeFileSync(path.join(sessDir, 'progress.json'), JSON.stringify({
        stage: 'receiving', stageLabel: 'Executing tool call...',
        updatedAt: threeMinutesAgo.toISOString()
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'stall1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.stalled).toBe(true);
        expect(parsed.stalledForSeconds).toBeGreaterThanOrEqual(170);
        expect(parsed.recovery).toContain('sidecar_abort');
        expect(parsed.recovery).toContain('sidecar_resume');
        expect(parsed.recovery).toContain('stall1');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not include stalled flag when activity is recent', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nostall-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'active1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'active1', status: 'running', model: 'gemini',
        pid: process.pid, headless: true,
        createdAt: new Date().toISOString(),
      }));
      // Write fresh conversation.jsonl
      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'assistant', content: 'working' }));
      fs.writeFileSync(path.join(sessDir, 'progress.json'), JSON.stringify({
        stage: 'receiving', stageLabel: 'Generating response...',
        updatedAt: new Date().toISOString()
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'active1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.stalled).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not include stalled flag for interactive sessions even when idle', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-int-stall-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'int1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'int1', status: 'running', model: 'gemini',
        pid: process.pid,
        createdAt: new Date(Date.now() - 300000).toISOString(),
      }));
      const convPath = path.join(sessDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'assistant', content: 'working' }));
      const threeMinutesAgo = new Date(Date.now() - 180000);
      fs.utimesSync(convPath, threeMinutesAgo, threeMinutesAgo);
      fs.writeFileSync(path.join(sessDir, 'progress.json'), JSON.stringify({
        stage: 'receiving', stageLabel: 'Executing tool call...',
        updatedAt: threeMinutesAgo.toISOString()
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'int1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.stalled).toBeUndefined();
        expect(parsed.recovery).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('does not include stalled flag for completed sessions', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-done-stall-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done2');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'done2', status: 'complete', model: 'gemini',
        createdAt: new Date(Date.now() - 600000).toISOString(),
      }));

      try {
        const result = await handlers.sidecar_status({ taskId: 'done2' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.stalled).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('sidecar_status model field', () => {
    test('includes model in status response when stored in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-model-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'mdl1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'mdl1', status: 'complete',
        model: 'openrouter/x-ai/grok-4.1-fast',
        createdAt: new Date().toISOString(),
      }));
      try {
        const result = await handlers.sidecar_status({ taskId: 'mdl1' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.model).toBe('openrouter/x-ai/grok-4.1-fast');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('omits model field when not stored in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-nomodel-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'nomdl');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'nomdl', status: 'complete',
        createdAt: new Date().toISOString(),
      }));
      try {
        const result = await handlers.sidecar_status({ taskId: 'nomdl' }, tmpDir);
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).not.toHaveProperty('model');
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

    test('summary prepends model when stored in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-readmdl-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'rdmdl1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        model: 'openrouter/x-ai/grok-4.1-fast',
      }));
      fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Results\n\nFound the bug.');
      try {
        const result = await handlers.sidecar_read({ taskId: 'rdmdl1' }, tmpDir);
        expect(result.content[0].text).toContain('openrouter/x-ai/grok-4.1-fast');
        expect(result.content[0].text).toContain('Found the bug.');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('summary works without model in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-readnomdl-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'rdnomdl');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');
      fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Results\n\nAll good.');
      try {
        const result = await handlers.sidecar_read({ taskId: 'rdnomdl' }, tmpDir);
        expect(result.content[0].text).toContain('All good.');
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

    test('returns interactive mode message when noUi is false', async () => {
      let _capturedArgs;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn((_cmd, args) => {
            _capturedArgs = args;
            return { pid: 12345, unref: jest.fn() };
          }),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.sidecar_start({ prompt: 'analyze auth', noUi: false, model: 'google/gemini-test' }, '/tmp');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.mode).toBe('interactive');
        expect(parsed.message).toContain('Do NOT poll');
        expect(parsed.message).toContain('clicked Fold');
      });
    });

    test('returns headless mode message with at-least-30s guidance when noUi is true', async () => {
      let _capturedArgs;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn((_cmd, args) => {
            _capturedArgs = args;
            return { pid: 12345, unref: jest.fn() };
          }),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.sidecar_start({ prompt: 'implement feature', noUi: true, model: 'google/gemini-test' }, '/tmp');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.mode).toBe('headless');
        expect(parsed.message).toContain('headless');
      });
    });

    test('headless sidecar_start response includes system-reminder content block', async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 12345, unref: jest.fn() })),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.sidecar_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test' }, '/tmp');
        expect(result.content).toHaveLength(2);
        expect(result.content[1].text).toContain('<system-reminder>');
        expect(result.content[1].text).toContain('sleep 25');
      });
    });

    test('interactive sidecar_start response has no system-reminder', async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 12345, unref: jest.fn() })),
        }));
        const { handlers: h } = require('../src/mcp-server');
        const result = await h.sidecar_start({ prompt: 'analyze auth', noUi: false, model: 'google/gemini-test' }, '/tmp');
        expect(result.content).toHaveLength(1);
        expect(result.content[0].text).not.toContain('<system-reminder>');
      });
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

  describe('sidecar_abort PID killing', () => {
    test('sends SIGTERM to process when PID is stored in metadata', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-abort-pid-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'killme1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'killme1', status: 'running', model: 'gemini',
        pid: 99999,
        createdAt: new Date().toISOString(),
      }));

      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
      try {
        const result = await handlers.sidecar_abort({ taskId: 'killme1' }, tmpDir);
        expect(result.isError).toBeUndefined();
        expect(killSpy).toHaveBeenCalledWith(99999, 'SIGTERM');
      } finally {
        killSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('marks aborted even if process already exited (SIGTERM throws ESRCH)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-abort-gone-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'gone1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'gone1', status: 'running', model: 'gemini',
        pid: 99999,
        createdAt: new Date().toISOString(),
      }));

      const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('No such process');
        err.code = 'ESRCH';
        throw err;
      });
      try {
        const result = await handlers.sidecar_abort({ taskId: 'gone1' }, tmpDir);
        expect(result.isError).toBeUndefined();
        const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
        expect(meta.status).toBe('aborted');
      } finally {
        killSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test('aborts a running session — status updated to aborted', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abort1');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'abort1', status: 'running', model: 'gemini',
        createdAt: new Date().toISOString(),
      }));

      // No PID in metadata — abort should still update status gracefully
      try {
        const result = await handlers.sidecar_abort({ taskId: 'abort1' }, tmpDir);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.status).toBe('aborted');
        expect(parsed.taskId).toBe('abort1');

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

describe('sidecar_start context and summary args', () => {
  it('passes --context-turns to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_start({ prompt: 'test', model: 'openrouter/test/model', contextTurns: 25 }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-turns');
    expect(capturedArgs).toContain('25');
  });

  it('passes --context-since to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_start({ prompt: 'test', model: 'openrouter/test/model', contextSince: '2h' }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-since');
    expect(capturedArgs).toContain('2h');
  });

  it('passes --context-max-tokens to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_start({ prompt: 'test', model: 'openrouter/test/model', contextMaxTokens: 40000 }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-max-tokens');
    expect(capturedArgs).toContain('40000');
  });

  it('passes --summary-length to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_start({ prompt: 'test', model: 'openrouter/test/model', summaryLength: 'verbose' }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--summary-length');
    expect(capturedArgs).toContain('verbose');
  });

  it('passes --no-context to CLI when includeContext is false', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_start({ prompt: 'self-contained task', model: 'openrouter/test/model', includeContext: false }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--no-context');
  });

  it('does NOT pass --no-context when includeContext is true', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_start({ prompt: 'needs context', model: 'openrouter/test/model', includeContext: true }, '/tmp/proj');
    });
    expect(capturedArgs).not.toContain('--no-context');
  });

  it('does NOT pass --no-context when includeContext is omitted', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_start({ prompt: 'default behavior', model: 'openrouter/test/model' }, '/tmp/proj');
    });
    expect(capturedArgs).not.toContain('--no-context');
  });
});

describe('sidecar_continue context args', () => {
  it('passes --context-turns to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_continue({ taskId: 'abc123', prompt: 'continue task', contextTurns: 10 }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-turns');
    expect(capturedArgs).toContain('10');
  });

  it('passes --context-max-tokens to CLI', async () => {
    let capturedArgs = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: (_cmd, args, _opts) => {
          capturedArgs = args;
          return { pid: 1234, unref: jest.fn(), stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
        }
      }));
      jest.doMock('fs', () => ({
        ...jest.requireActual('fs'),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        existsSync: jest.fn(() => false)
      }));
      const { handlers } = require('../src/mcp-server');
      await handlers.sidecar_continue({ taskId: 'abc123', prompt: 'continue task', contextMaxTokens: 20000 }, '/tmp/proj');
    });
    expect(capturedArgs).toContain('--context-max-tokens');
    expect(capturedArgs).toContain('20000');
  });
});

describe('sidecar_start stderr capture', () => {
  let tmpDir;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stderr-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('spawns process with stderr redirected to file', async () => {
    let capturedOpts;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((_cmd, _args, opts) => {
          capturedOpts = opts;
          return { pid: 12345, unref: jest.fn() };
        }),
      }));
      // Ensure real fs is used (clear any leaked mock from prior tests)
      jest.doMock('fs', () => jest.requireActual('fs'));
      const { handlers: h } = require('../src/mcp-server');
      await h.sidecar_start({ prompt: 'test task', noUi: true, model: 'google/gemini-test' }, tmpDir);
    });
    // stdio[2] should be a number (file descriptor), not 'ignore'
    expect(typeof capturedOpts.stdio[2]).toBe('number');
  });

  test('sidecar_resume passes sessionDir for stderr capture', async () => {
    let capturedOpts;
    // Pre-create session with metadata so resume can find it
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'res1');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'res1', status: 'complete',
      createdAt: new Date().toISOString(),
    }));

    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((_cmd, _args, opts) => {
          capturedOpts = opts;
          return { pid: 12345, unref: jest.fn() };
        }),
      }));
      jest.doMock('fs', () => jest.requireActual('fs'));
      const { handlers: h } = require('../src/mcp-server');
      await h.sidecar_resume({ taskId: 'res1' }, tmpDir);
    });
    // stdio[2] should be a number (file descriptor), not 'ignore'
    expect(typeof capturedOpts.stdio[2]).toBe('number');
  });

  test('sidecar_continue passes sessionDir for stderr capture', async () => {
    let capturedOpts;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((_cmd, _args, opts) => {
          capturedOpts = opts;
          return { pid: 12345, unref: jest.fn() };
        }),
      }));
      jest.doMock('fs', () => jest.requireActual('fs'));
      const { handlers: h } = require('../src/mcp-server');
      await h.sidecar_continue({ taskId: 'old1', prompt: 'follow up' }, tmpDir);
    });
    // stdio[2] should be a number (file descriptor), not 'ignore'
    expect(typeof capturedOpts.stdio[2]).toBe('number');
  });
});
