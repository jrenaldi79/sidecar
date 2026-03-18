const http = require('http');
const { apiRequest } = require('../../src/utils/opencode-api');
const { installCrashHandler } = require('../../src/sidecar/crash-handler');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('VM lifecycle integration', () => {
  describe('apiRequest host parameter', () => {
    let server;
    let port;

    beforeAll((done) => {
      server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        done();
      });
    });

    afterAll((done) => {
      server.close(done);
    });

    test('defaults to 127.0.0.1 when no host option provided', async () => {
      const result = await apiRequest('GET', '/test', port);
      expect(result).toEqual({ ok: true });
    });

    test('uses custom host from options', async () => {
      // 127.0.0.1 works as the custom host since our test server binds there
      const result = await apiRequest('GET', '/test', port, null, { host: '127.0.0.1' });
      expect(result).toEqual({ ok: true });
    });

    test('sends JSON body when provided', async () => {
      const result = await apiRequest('POST', '/test', port, { data: 'hello' });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('crash handler with vmProvider', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-crash-test-'));
      // SessionPaths.sessionDir = project/.claude/sidecar_sessions/<taskId>
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'test-task');
      fs.mkdirSync(sessionDir, { recursive: true });
      const metadata = { taskId: 'test-task', status: 'running', createdAt: new Date().toISOString() };
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('calls vmProvider.shutdown() on crash', () => {
      const mockProvider = { shutdown: jest.fn() };
      const handler = installCrashHandler('test-task', tmpDir, { vmProvider: mockProvider });
      handler(new Error('crash'));
      expect(mockProvider.shutdown).toHaveBeenCalledTimes(1);
    });

    test('does not throw if vmProvider.shutdown() throws', () => {
      const mockProvider = { shutdown: jest.fn(() => { throw new Error('shutdown failed'); }) };
      const handler = installCrashHandler('test-task', tmpDir, { vmProvider: mockProvider });
      expect(() => handler(new Error('crash'))).not.toThrow();
    });

    test('works without vmProvider (backward compatible)', () => {
      const handler = installCrashHandler('test-task', tmpDir);
      expect(() => handler(new Error('crash'))).not.toThrow();
    });
  });
});
