const fs = require('fs');
const path = require('path');
const os = require('os');
const { handlers } = require('../../src/mcp-server');

describe('MCP App tool handlers', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-app-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('sidecar_app_send', () => {
    test('returns error if session not found', async () => {
      const result = await handlers.sidecar_app_send(
        { taskId: 'nonexistent', message: 'hello' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    test('returns error if no port in metadata', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'test-task');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'test-task', status: 'running',
      }));
      const result = await handlers.sidecar_app_send(
        { taskId: 'test-task', message: 'hello' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('port');
    });
  });

  describe('sidecar_app_messages', () => {
    test('returns error if session not found', async () => {
      const result = await handlers.sidecar_app_messages(
        { taskId: 'nonexistent' }, tmpDir
      );
      expect(result.isError).toBe(true);
    });

    test('returns error if no port in metadata', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'msg-task');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'msg-task', status: 'running',
      }));
      const result = await handlers.sidecar_app_messages(
        { taskId: 'msg-task' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('port');
    });
  });

  describe('sidecar_app_answer_question', () => {
    test('returns error if session not found', async () => {
      const result = await handlers.sidecar_app_answer_question(
        { taskId: 'nonexistent', answer: 'yes' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    test('returns error if no port in metadata', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'q-no-port');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'q-no-port', status: 'running',
      }));
      const result = await handlers.sidecar_app_answer_question(
        { taskId: 'q-no-port', answer: 'yes' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('port');
    });
  });

  describe('sidecar_app_skip_question', () => {
    test('returns error if session not found', async () => {
      const result = await handlers.sidecar_app_skip_question(
        { taskId: 'nonexistent' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    test('returns error if no port in metadata', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'skip-no-port');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'skip-no-port', status: 'running',
      }));
      const result = await handlers.sidecar_app_skip_question(
        { taskId: 'skip-no-port' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('port');
    });
  });

  describe('sidecar_app_fold', () => {
    test('returns error if session not found', async () => {
      const result = await handlers.sidecar_app_fold(
        { taskId: 'nonexistent' }, tmpDir
      );
      expect(result.isError).toBe(true);
    });

    test('returns error if session not running', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done-task');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'done-task', status: 'complete', opencodePort: 3456, opencodeSessionId: 'sid',
      }));
      const result = await handlers.sidecar_app_fold(
        { taskId: 'done-task' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not running');
    });

    test('returns error if no port in metadata', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'no-port');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'no-port', status: 'running',
      }));
      const result = await handlers.sidecar_app_fold(
        { taskId: 'no-port' }, tmpDir
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('port');
    });
  });
});
