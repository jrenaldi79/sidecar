/**
 * MCP Server Integration Tests
 *
 * End-to-end tests that verify MCP handlers work with real filesystem
 * operations. Unlike the unit tests in mcp-server.test.js, these tests
 * exercise multi-step workflows: creating sessions on disk, then reading,
 * listing, filtering, and verifying sort order, error cases, and fallbacks.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('MCP Server Integration', () => {
  let handlers;
  let tmpDir;

  beforeAll(() => {
    handlers = require('../src/mcp-server').handlers;
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-integration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('sidecar_guide', () => {
    test('returns comprehensive guide text', async () => {
      const result = await handlers.sidecar_guide({});
      expect(result.content[0].type).toBe('text');
      const text = result.content[0].text;
      expect(text).toContain('Sidecar');
      expect(text).toContain('sidecar_start');
      expect(text).toContain('sidecar_status');
      expect(text).toContain('Agent');
    });
  });

  describe('sidecar_list', () => {
    test('returns empty message for project with no sessions', async () => {
      const result = await handlers.sidecar_list({}, tmpDir);
      expect(result.content[0].text).toContain('No sidecar sessions found');
    });

    test('returns empty message when sessions dir exists but is empty', async () => {
      fs.mkdirSync(path.join(tmpDir, '.claude', 'sidecar_sessions'), { recursive: true });
      const result = await handlers.sidecar_list({}, tmpDir);
      expect(result.content[0].text).toContain('No sidecar sessions found');
    });

    test('lists sessions sorted by creation date (newest first)', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions');

      // Create older session
      const old = path.join(sessDir, 'old123');
      fs.mkdirSync(old, { recursive: true });
      fs.writeFileSync(path.join(old, 'metadata.json'), JSON.stringify({
        taskId: 'old123', model: 'gemini', status: 'complete',
        briefing: 'Old task', createdAt: '2026-01-01T00:00:00Z',
      }));

      // Create newer session
      const newSess = path.join(sessDir, 'new456');
      fs.mkdirSync(newSess, { recursive: true });
      fs.writeFileSync(path.join(newSess, 'metadata.json'), JSON.stringify({
        taskId: 'new456', model: 'opus', status: 'running',
        briefing: 'New task', createdAt: '2026-03-04T00:00:00Z',
      }));

      const result = await handlers.sidecar_list({}, tmpDir);
      const sessions = JSON.parse(result.content[0].text);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('new456'); // Newest first
      expect(sessions[1].id).toBe('old123');
    });

    test('filters sessions by status', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions');

      const running = path.join(sessDir, 'run123');
      fs.mkdirSync(running, { recursive: true });
      fs.writeFileSync(path.join(running, 'metadata.json'), JSON.stringify({
        taskId: 'run123', status: 'running', createdAt: '2026-03-04T00:00:00Z',
      }));

      const complete = path.join(sessDir, 'done456');
      fs.mkdirSync(complete, { recursive: true });
      fs.writeFileSync(path.join(complete, 'metadata.json'), JSON.stringify({
        taskId: 'done456', status: 'complete', createdAt: '2026-03-03T00:00:00Z',
      }));

      const result = await handlers.sidecar_list({ status: 'running' }, tmpDir);
      const sessions = JSON.parse(result.content[0].text);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('running');
    });

    test('returns all sessions when status is "all"', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions');

      const s1 = path.join(sessDir, 'sess1');
      fs.mkdirSync(s1, { recursive: true });
      fs.writeFileSync(path.join(s1, 'metadata.json'), JSON.stringify({
        taskId: 'sess1', status: 'running', createdAt: '2026-03-04T00:00:00Z',
      }));

      const s2 = path.join(sessDir, 'sess2');
      fs.mkdirSync(s2, { recursive: true });
      fs.writeFileSync(path.join(s2, 'metadata.json'), JSON.stringify({
        taskId: 'sess2', status: 'complete', createdAt: '2026-03-03T00:00:00Z',
      }));

      const result = await handlers.sidecar_list({ status: 'all' }, tmpDir);
      const sessions = JSON.parse(result.content[0].text);
      expect(sessions).toHaveLength(2);
    });

    test('ignores directories without metadata.json', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions');

      // Directory with metadata
      const valid = path.join(sessDir, 'valid');
      fs.mkdirSync(valid, { recursive: true });
      fs.writeFileSync(path.join(valid, 'metadata.json'), JSON.stringify({
        taskId: 'valid', status: 'complete', createdAt: '2026-03-04T00:00:00Z',
      }));

      // Directory without metadata (e.g. leftover/corrupt)
      const invalid = path.join(sessDir, 'invalid');
      fs.mkdirSync(invalid, { recursive: true });

      const result = await handlers.sidecar_list({}, tmpDir);
      const sessions = JSON.parse(result.content[0].text);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('valid');
    });

    test('truncates long briefings to 80 chars', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'longbrief');
      fs.mkdirSync(sessDir, { recursive: true });
      const longBriefing = 'A'.repeat(200);
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'longbrief', status: 'complete',
        briefing: longBriefing, createdAt: '2026-03-04T00:00:00Z',
      }));

      const result = await handlers.sidecar_list({}, tmpDir);
      const sessions = JSON.parse(result.content[0].text);
      expect(sessions[0].briefing.length).toBeLessThanOrEqual(80);
    });
  });

  describe('sidecar_status + sidecar_read workflow', () => {
    let sessionId;

    beforeEach(() => {
      sessionId = 'workflow123';
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', sessionId);
      fs.mkdirSync(sessDir, { recursive: true });

      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: sessionId, model: 'gemini', status: 'complete',
        agent: 'Build', briefing: 'Debug the auth issue',
        createdAt: new Date().toISOString(),
      }));

      fs.writeFileSync(path.join(sessDir, 'summary.md'),
        '## Task: Debug Auth\n\n### Findings\nFound the bug in token validation.\n'
      );

      fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
        '{"role":"user","content":"Debug auth","timestamp":"2026-03-04T00:00:00Z"}\n' +
        '{"role":"assistant","content":"Found the issue","timestamp":"2026-03-04T00:01:00Z"}\n'
      );
    });

    test('status returns session info', async () => {
      const result = await handlers.sidecar_status({ taskId: sessionId }, tmpDir);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('complete');
      expect(parsed.model).toBe('gemini');
      expect(parsed.agent).toBe('Build');
      expect(parsed.briefing).toContain('Debug');
    });

    test('status includes elapsed time', async () => {
      const result = await handlers.sidecar_status({ taskId: sessionId }, tmpDir);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('elapsed');
      expect(parsed.elapsed).toMatch(/^\d+m \d+s$/);
    });

    test('read returns summary by default', async () => {
      const result = await handlers.sidecar_read({ taskId: sessionId }, tmpDir);
      expect(result.content[0].text).toContain('Debug Auth');
      expect(result.content[0].text).toContain('token validation');
    });

    test('read returns conversation when mode is conversation', async () => {
      const result = await handlers.sidecar_read({ taskId: sessionId, mode: 'conversation' }, tmpDir);
      expect(result.content[0].text).toContain('Debug auth');
      expect(result.content[0].text).toContain('Found the issue');
    });

    test('read returns metadata when mode is metadata', async () => {
      const result = await handlers.sidecar_read({ taskId: sessionId, mode: 'metadata' }, tmpDir);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe(sessionId);
      expect(parsed.model).toBe('gemini');
    });

    test('full workflow: list -> status -> read summary', async () => {
      // Step 1: List sessions
      const listResult = await handlers.sidecar_list({}, tmpDir);
      const sessions = JSON.parse(listResult.content[0].text);
      expect(sessions).toHaveLength(1);
      const listedId = sessions[0].id;

      // Step 2: Get status of that session
      const statusResult = await handlers.sidecar_status({ taskId: listedId }, tmpDir);
      const statusParsed = JSON.parse(statusResult.content[0].text);
      expect(statusParsed.status).toBe('complete');

      // Step 3: Read summary of completed session
      const readResult = await handlers.sidecar_read({ taskId: listedId }, tmpDir);
      expect(readResult.content[0].text).toContain('Debug Auth');
    });
  });

  describe('error cases', () => {
    test('status returns error for nonexistent session', async () => {
      const result = await handlers.sidecar_status({ taskId: 'ghost' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    test('read returns error for nonexistent session', async () => {
      const result = await handlers.sidecar_read({ taskId: 'ghost' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    test('read returns fallback when summary is missing', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'nosummary');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');

      const result = await handlers.sidecar_read({ taskId: 'nosummary' }, tmpDir);
      expect(result.content[0].text).toContain('No summary available');
    });

    test('read returns fallback when conversation is missing', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'noconv');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), '{}');

      const result = await handlers.sidecar_read({ taskId: 'noconv', mode: 'conversation' }, tmpDir);
      expect(result.content[0].text).toContain('No conversation');
    });

    test('status error includes the task ID in the message', async () => {
      const result = await handlers.sidecar_status({ taskId: 'specific-id-42' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('specific-id-42');
    });

    test('read error includes the task ID in the message', async () => {
      const result = await handlers.sidecar_read({ taskId: 'specific-id-99' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('specific-id-99');
    });
  });

  describe('multi-session scenarios', () => {
    test('three sessions with mixed statuses list and filter correctly', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions');

      const sessions = [
        { id: 'a1', status: 'running', createdAt: '2026-03-04T12:00:00Z' },
        { id: 'b2', status: 'complete', createdAt: '2026-03-04T06:00:00Z' },
        { id: 'c3', status: 'running', createdAt: '2026-03-03T18:00:00Z' },
      ];

      for (const s of sessions) {
        const dir = path.join(sessDir, s.id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
          taskId: s.id, status: s.status, model: 'gemini',
          briefing: `Task ${s.id}`, createdAt: s.createdAt,
        }));
      }

      // List all - should be sorted newest first
      const allResult = await handlers.sidecar_list({}, tmpDir);
      const all = JSON.parse(allResult.content[0].text);
      expect(all).toHaveLength(3);
      expect(all[0].id).toBe('a1');
      expect(all[1].id).toBe('b2');
      expect(all[2].id).toBe('c3');

      // Filter running - should get 2
      const runningResult = await handlers.sidecar_list({ status: 'running' }, tmpDir);
      const running = JSON.parse(runningResult.content[0].text);
      expect(running).toHaveLength(2);
      expect(running.every(s => s.status === 'running')).toBe(true);

      // Filter complete - should get 1
      const completeResult = await handlers.sidecar_list({ status: 'complete' }, tmpDir);
      const complete = JSON.parse(completeResult.content[0].text);
      expect(complete).toHaveLength(1);
      expect(complete[0].id).toBe('b2');
    });

    test('reading different sessions returns correct data', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions');

      // Session A with summary
      const dirA = path.join(sessDir, 'sessionA');
      fs.mkdirSync(dirA, { recursive: true });
      fs.writeFileSync(path.join(dirA, 'metadata.json'), JSON.stringify({
        taskId: 'sessionA', model: 'gemini', status: 'complete',
        createdAt: '2026-03-04T00:00:00Z',
      }));
      fs.writeFileSync(path.join(dirA, 'summary.md'), 'Summary for session A');

      // Session B with different summary
      const dirB = path.join(sessDir, 'sessionB');
      fs.mkdirSync(dirB, { recursive: true });
      fs.writeFileSync(path.join(dirB, 'metadata.json'), JSON.stringify({
        taskId: 'sessionB', model: 'opus', status: 'complete',
        createdAt: '2026-03-03T00:00:00Z',
      }));
      fs.writeFileSync(path.join(dirB, 'summary.md'), 'Summary for session B');

      const resultA = await handlers.sidecar_read({ taskId: 'sessionA' }, tmpDir);
      expect(resultA.content[0].text).toBe('Summary for session A');

      const resultB = await handlers.sidecar_read({ taskId: 'sessionB' }, tmpDir);
      expect(resultB.content[0].text).toBe('Summary for session B');
    });
  });

  describe('sidecar_abort workflow', () => {
    test('abort running session updates metadata to aborted', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abort-test');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'abort-test', model: 'gemini', status: 'running',
        briefing: 'Long running task', createdAt: '2026-03-04T00:00:00Z',
      }));

      const result = await handlers.sidecar_abort({ taskId: 'abort-test' }, tmpDir);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('aborted');
      expect(parsed.taskId).toBe('abort-test');

      // Verify metadata file was updated on disk
      const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
      expect(meta.status).toBe('aborted');
      expect(meta.abortedAt).toBeDefined();
    });

    test('abort non-running session returns informational message', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done-task');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
        taskId: 'done-task', status: 'complete', createdAt: '2026-03-04T00:00:00Z',
      }));

      const result = await handlers.sidecar_abort({ taskId: 'done-task' }, tmpDir);
      expect(result.content[0].text).toContain('not running');
      expect(result.content[0].text).toContain('complete');

      // Verify metadata was NOT changed
      const meta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
      expect(meta.status).toBe('complete');
    });

    test('abort missing session returns error', async () => {
      const result = await handlers.sidecar_abort({ taskId: 'nonexistent' }, tmpDir);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    test('full abort workflow: start running → abort → list shows aborted', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions');

      // Create a running session
      const runDir = path.join(sessDir, 'workflow-abort');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
        taskId: 'workflow-abort', model: 'gemini', status: 'running',
        briefing: 'Running task to abort', createdAt: '2026-03-04T00:00:00Z',
      }));

      // Step 1: Verify it shows as running
      const statusBefore = await handlers.sidecar_status({ taskId: 'workflow-abort' }, tmpDir);
      expect(JSON.parse(statusBefore.content[0].text).status).toBe('running');

      // Step 2: Abort the session
      const abortResult = await handlers.sidecar_abort({ taskId: 'workflow-abort' }, tmpDir);
      expect(JSON.parse(abortResult.content[0].text).status).toBe('aborted');

      // Step 3: Status now shows aborted
      const statusAfter = await handlers.sidecar_status({ taskId: 'workflow-abort' }, tmpDir);
      expect(JSON.parse(statusAfter.content[0].text).status).toBe('aborted');

      // Step 4: List with status filter shows aborted session
      const listResult = await handlers.sidecar_list({ status: 'aborted' }, tmpDir);
      const sessions = JSON.parse(listResult.content[0].text);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('workflow-abort');
      expect(sessions[0].status).toBe('aborted');
    });

    test('abort does not affect other sessions', async () => {
      const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions');

      // Create two running sessions
      for (const id of ['keep-running', 'to-abort']) {
        const dir = path.join(sessDir, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
          taskId: id, model: 'gemini', status: 'running',
          briefing: `Task ${id}`, createdAt: '2026-03-04T00:00:00Z',
        }));
      }

      // Abort only one
      await handlers.sidecar_abort({ taskId: 'to-abort' }, tmpDir);

      // Verify the other is still running
      const otherMeta = JSON.parse(fs.readFileSync(
        path.join(sessDir, 'keep-running', 'metadata.json'), 'utf-8'
      ));
      expect(otherMeta.status).toBe('running');

      // List running sessions should only show the non-aborted one
      const listResult = await handlers.sidecar_list({ status: 'running' }, tmpDir);
      const running = JSON.parse(listResult.content[0].text);
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe('keep-running');
    });
  });
});
