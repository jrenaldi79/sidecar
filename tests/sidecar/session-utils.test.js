/**
 * Session Utils Tests
 *
 * Tests for shared session utilities: SessionPaths, saveInitialContext,
 * finalizeSession, createHeartbeat, outputSummary, executeMode.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('../../src/conflict', () => ({
  detectConflicts: jest.fn().mockReturnValue([]),
  formatConflictWarning: jest.fn().mockReturnValue('conflict warning')
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const {
  HEARTBEAT_INTERVAL,
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  executeMode
} = require('../../src/sidecar/session-utils');

const { detectConflicts } = require('../../src/conflict');

describe('Session Utils', () => {
  describe('HEARTBEAT_INTERVAL', () => {
    it('should be 15 seconds', () => {
      expect(HEARTBEAT_INTERVAL).toBe(15000);
    });
  });

  describe('SessionPaths', () => {
    const project = '/test/project';
    const taskId = 'task-123';

    it('should return root sidecar sessions directory', () => {
      expect(SessionPaths.rootDir(project)).toBe(
        path.join('/test/project', '.claude', 'sidecar_sessions')
      );
    });

    it('should return session directory for a task', () => {
      expect(SessionPaths.sessionDir(project, taskId)).toBe(
        path.join('/test/project', '.claude', 'sidecar_sessions', 'task-123')
      );
    });

    it('should return metadata.json path', () => {
      const sessDir = '/test/session';
      expect(SessionPaths.metadataFile(sessDir)).toBe(
        path.join('/test/session', 'metadata.json')
      );
    });

    it('should return conversation.jsonl path', () => {
      const sessDir = '/test/session';
      expect(SessionPaths.conversationFile(sessDir)).toBe(
        path.join('/test/session', 'conversation.jsonl')
      );
    });

    it('should return summary.md path', () => {
      const sessDir = '/test/session';
      expect(SessionPaths.summaryFile(sessDir)).toBe(
        path.join('/test/session', 'summary.md')
      );
    });

    it('should return initial_context.md path', () => {
      const sessDir = '/test/session';
      expect(SessionPaths.contextFile(sessDir)).toBe(
        path.join('/test/session', 'initial_context.md')
      );
    });
  });

  describe('saveInitialContext', () => {
    it('should write system prompt and user message to initial_context.md', () => {
      const sessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-context-session-'));

      try {
        saveInitialContext(sessDir, 'System prompt here', 'User message here');

        expect(fs.readFileSync(path.join(sessDir, 'initial_context.md'), 'utf-8')).toBe(
          '# System Prompt\n\nSystem prompt here\n\n# User Message (Task)\n\nUser message here'
        );
      } finally {
        fs.rmSync(sessDir, { recursive: true, force: true });
      }
    });

    it('rejects an initial_context.md symlink without modifying the outside target', () => {
      const sessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-context-session-'));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-context-outside-'));
      const outsideContext = path.join(outsideDir, 'initial_context.md');

      try {
        fs.writeFileSync(outsideContext, 'outside context untouched');
        fs.symlinkSync(outsideContext, path.join(sessDir, 'initial_context.md'));

        expect(() => {
          saveInitialContext(sessDir, 'System prompt here', 'User message here');
        }).toThrow(/symbolic link|session directory|outside/i);

        expect(fs.readFileSync(outsideContext, 'utf-8')).toBe('outside context untouched');
      } finally {
        fs.rmSync(sessDir, { recursive: true, force: true });
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a dangling initial_context.md symlink before creating the outside target', () => {
      const sessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-context-session-'));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-context-outside-'));
      const outsideContext = path.join(outsideDir, 'new-initial-context.md');

      try {
        fs.symlinkSync(outsideContext, path.join(sessDir, 'initial_context.md'));

        expect(() => {
          saveInitialContext(sessDir, 'System prompt here', 'User message here');
        }).toThrow(/symbolic link|session directory|outside/i);

        expect(fs.existsSync(outsideContext)).toBe(false);
      } finally {
        fs.rmSync(sessDir, { recursive: true, force: true });
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('finalizeSession', () => {
    let project;
    let sessDir;

    beforeEach(() => {
      project = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-finalize-project-'));
      sessDir = path.join(project, '.claude', 'sidecar_sessions', 'task-1');
      fs.mkdirSync(sessDir, { recursive: true });
      detectConflicts.mockReturnValue([]);
    });

    afterEach(() => {
      fs.rmSync(project, { recursive: true, force: true });
    });

    it('should save summary and update metadata to complete', () => {
      const summary = '## Results\n\nDone';
      const metadata = {
        taskId: 'task-1',
        filesWritten: [],
        createdAt: new Date().toISOString()
      };

      finalizeSession(sessDir, summary, project, metadata);

      expect(fs.readFileSync(path.join(sessDir, 'summary.md'), 'utf-8')).toBe(summary);
      const savedMeta = JSON.parse(fs.readFileSync(path.join(sessDir, 'metadata.json'), 'utf-8'));
      expect(savedMeta.status).toBe('complete');
      expect(savedMeta.completedAt).toBeDefined();
    });

    it('should detect conflicts and attach to metadata', () => {
      const conflicts = [{ file: 'src/foo.js', type: 'external_edit' }];
      detectConflicts.mockReturnValue(conflicts);

      const metadata = {
        taskId: 'task-2',
        filesWritten: ['src/foo.js'],
        createdAt: new Date().toISOString()
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      finalizeSession(sessDir, 'summary', project, metadata);
      consoleSpy.mockRestore();

      expect(metadata.conflicts).toEqual(conflicts);
    });

    it('rejects a summary symlink that escapes the session directory without modifying the target', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-finalize-outside-'));
      const outsideSummary = path.join(outsideDir, 'summary.md');

      try {
        fs.writeFileSync(outsideSummary, 'outside summary untouched');
        fs.symlinkSync(outsideSummary, path.join(sessDir, 'summary.md'));

        expect(() => finalizeSession(sessDir, 'new summary', project, {
          taskId: 'summary-link',
          filesWritten: [],
          createdAt: new Date().toISOString()
        })).toThrow(/outside|session directory/i);

        expect(fs.readFileSync(outsideSummary, 'utf-8')).toBe('outside summary untouched');
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('outputSummary', () => {
    it('should write summary to stdout', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
      outputSummary('Test summary');
      expect(spy).toHaveBeenCalledWith('Test summary');
      spy.mockRestore();
    });
  });

  describe('createHeartbeat', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should write elapsed time to stderr at interval', () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});

      const heartbeat = createHeartbeat(1000); // 1s for testing

      // Advance 1 second
      jest.advanceTimersByTime(1000);
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0][0]).toMatch(/\[sidecar\] still running\.\.\. \d+s elapsed/);

      // Advance another second
      jest.advanceTimersByTime(1000);
      expect(stderrSpy).toHaveBeenCalledTimes(2);

      heartbeat.stop();
      stderrSpy.mockRestore();
    });

    it('should format minutes and seconds when elapsed > 60s', () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});

      const heartbeat = createHeartbeat(1000);

      // Advance 65 seconds (65 ticks at 1s interval)
      jest.advanceTimersByTime(65000);

      const lastCall = stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1][0];
      expect(lastCall).toMatch(/\d+m\d+s elapsed/);

      heartbeat.stop();
      stderrSpy.mockRestore();
    });

    it('should stop when stop() is called', () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});

      const heartbeat = createHeartbeat(1000);
      jest.advanceTimersByTime(2000);
      const countBefore = stderrSpy.mock.calls.length;

      heartbeat.stop();
      jest.advanceTimersByTime(5000);

      expect(stderrSpy.mock.calls.length).toBe(countBefore);
      stderrSpy.mockRestore();
    });

    it('should default to HEARTBEAT_INTERVAL (15s)', () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});

      const heartbeat = createHeartbeat();

      // At 14s, no output yet
      jest.advanceTimersByTime(14000);
      expect(stderrSpy).not.toHaveBeenCalled();

      // At 15s, first output
      jest.advanceTimersByTime(1000);
      expect(stderrSpy).toHaveBeenCalledTimes(1);

      heartbeat.stop();
      stderrSpy.mockRestore();
    });
  });

  describe('createHeartbeat with progress', () => {
    let tmpDir;
    let stderrSpy;

    beforeEach(() => {
      jest.useFakeTimers();
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'heartbeat-progress-'));
      stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      jest.useRealTimers();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('includes message count and latest activity in heartbeat', () => {
      // Write conversation.jsonl with 2 assistant entries
      const entries = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Working on it' },
        { role: 'assistant', toolCall: { name: 'Read src/auth/token.ts' } }
      ];
      const convPath = path.join(tmpDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, entries.map(e => JSON.stringify(e)).join('\n'));

      const heartbeat = createHeartbeat(1000, tmpDir);
      jest.advanceTimersByTime(1000);

      const output = stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1][0];
      expect(output).toContain('2 messages');
      expect(output).toContain('Using Read src/auth/token.ts');
      expect(output).toMatch(/\[sidecar\]/);

      heartbeat.stop();
    });

    it('shows Starting up when no conversation exists', () => {
      // tmpDir exists but no conversation.jsonl
      const heartbeat = createHeartbeat(1000, tmpDir);
      jest.advanceTimersByTime(1000);

      const output = stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1][0];
      expect(output).toContain('Starting up...');
      expect(output).toContain('0 messages');

      heartbeat.stop();
    });

    it('falls back to basic heartbeat when no sessionDir provided', () => {
      const heartbeat = createHeartbeat(1000);
      jest.advanceTimersByTime(1000);

      const output = stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1][0];
      expect(output).toContain('still running');

      heartbeat.stop();
    });
  });

  describe('executeMode', () => {
    it('should call runHeadless in headless mode', async () => {
      const mockRunHeadless = jest.fn().mockResolvedValue({
        summary: 'headless result',
        timedOut: false,
        error: null
      });

      const result = await executeMode({
        headless: true,
        runHeadless: mockRunHeadless,
        runInteractive: jest.fn(),
        model: 'test-model',
        systemPrompt: 'system',
        userMessage: 'user msg',
        taskId: 'task-1',
        project: '/project',
        timeout: 15,
        agent: 'Build'
      });

      expect(mockRunHeadless).toHaveBeenCalledWith(
        'test-model', 'system', 'user msg', 'task-1', '/project',
        15 * 60 * 1000, 'Build', {}
      );
      expect(result.summary).toBe('headless result');
    });

    it('should call runInteractive in interactive mode', async () => {
      const mockRunInteractive = jest.fn().mockResolvedValue({
        summary: 'interactive result',
        error: null
      });

      const result = await executeMode({
        headless: false,
        runHeadless: jest.fn(),
        runInteractive: mockRunInteractive,
        model: 'test-model',
        systemPrompt: 'system',
        userMessage: 'user msg',
        taskId: 'task-1',
        project: '/project',
        timeout: 15,
        agent: 'Plan'
      });

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'test-model', 'system', 'user msg', 'task-1', '/project',
        { agent: 'Plan' }
      );
      expect(result.summary).toBe('interactive result');
    });

    it('should provide default summary when headless returns none', async () => {
      const mockRunHeadless = jest.fn().mockResolvedValue({
        summary: '',
        timedOut: false,
        error: null
      });

      const result = await executeMode({
        headless: true,
        runHeadless: mockRunHeadless,
        runInteractive: jest.fn(),
        model: 'test-model',
        systemPrompt: 'system',
        userMessage: 'msg',
        taskId: 'task-1',
        project: '/p',
        timeout: 15,
        agent: null
      });

      expect(result.summary).toContain('No Output');
    });

    it('should pass extraOptions to headless runner', async () => {
      const mockRunHeadless = jest.fn().mockResolvedValue({
        summary: 'ok',
        timedOut: false
      });

      await executeMode({
        headless: true,
        runHeadless: mockRunHeadless,
        runInteractive: jest.fn(),
        model: 'm',
        systemPrompt: 's',
        userMessage: 'u',
        taskId: 't',
        project: '/p',
        timeout: 10,
        agent: 'Build',
        extraOptions: { mcp: { server: {} }, summaryLength: 'verbose' }
      });

      expect(mockRunHeadless).toHaveBeenCalledWith(
        'm', 's', 'u', 't', '/p',
        10 * 60 * 1000, 'Build',
        { mcp: { server: {} }, summaryLength: 'verbose' }
      );
    });
  });
});

/**
 * Client parameter passthrough tests
 * (merged from session-utils-client.test.js)
 */
describe('startOpenCodeServer client passthrough', () => {
  let startOpenCodeServer;
  let mockStartServer;

  beforeAll(() => {
    jest.resetModules();

    jest.mock('../../src/utils/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
    }));
    jest.mock('../../src/utils/path-setup', () => ({
      ensureNodeModulesBinInPath: jest.fn()
    }));
    jest.mock('../../src/utils/server-setup', () => ({
      ensurePortAvailable: jest.fn()
    }));
    jest.mock('../../src/headless', () => ({
      waitForServer: jest.fn(async () => true)
    }));

    mockStartServer = jest.fn(async () => ({
      client: { config: { get: jest.fn() } },
      server: { url: 'http://127.0.0.1:3456', close: jest.fn() }
    }));

    jest.mock('../../src/opencode-client', () => ({
      startServer: mockStartServer,
      checkHealth: jest.fn(async () => true)
    }));

    ({ startOpenCodeServer } = require('../../src/sidecar/session-utils'));
  });

  beforeEach(() => {
    mockStartServer.mockClear();
  });

  it('passes client option to startServer when provided', async () => {
    await startOpenCodeServer(null, { client: 'cowork' });
    expect(mockStartServer).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'cowork' })
    );
  });

  it('does not set client when not provided', async () => {
    await startOpenCodeServer(null);
    const passedOpts = mockStartServer.mock.calls[0][0];
    expect(passedOpts.client).toBeUndefined();
  });

  it('passes both mcp and client when both provided', async () => {
    const mcpConfig = { myServer: { command: 'test' } };
    await startOpenCodeServer(mcpConfig, { client: 'code-local' });
    expect(mockStartServer).toHaveBeenCalledWith(
      expect.objectContaining({ mcp: mcpConfig, client: 'code-local' })
    );
  });
});
