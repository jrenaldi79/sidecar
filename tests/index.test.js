/**
 * Tests for main index module
 *
 * Tests for startSidecar, resumeSidecar, continueSidecar, listSidecars, readSidecar
 * Spec Reference: §4.1-4.5, §8.3, §8.5
 */

// Mock the opencode-client SDK module first (before any imports)
jest.mock('../src/opencode-client', () => ({
  createClient: jest.fn().mockReturnValue({}),
  createSession: jest.fn().mockResolvedValue('mock-session-id'),
  sendPrompt: jest.fn().mockResolvedValue({ data: { parts: [{ type: 'text', text: '[SIDECAR_COMPLETE]' }] } }),
  getMessages: jest.fn().mockResolvedValue([]),
  checkHealth: jest.fn().mockResolvedValue(true),
  startServer: jest.fn().mockResolvedValue({
    client: {},
    server: { url: 'http://127.0.0.1:4440', close: jest.fn() }
  })
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock child_process for spawn
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

// Mock http for headless mode
jest.mock('http', () => ({
  request: jest.fn()
}));

const { spawn } = require('child_process');
const http = require('http');
const EventEmitter = require('events');

// Import module after mocks
const {
  startSidecar,
  listSidecars,
  resumeSidecar,
  continueSidecar,
  readSidecar,
  generateTaskId,
  COMPLETE_MARKER
} = require('../src/index');

describe('Index Module', () => {
  let tmpDir;
  let mockChild;
  let httpResponses;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create temp directory for tests
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-test-'));

    // Setup mock child process
    mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.stdin = { write: jest.fn() };
    mockChild.kill = jest.fn();
    spawn.mockReturnValue(mockChild);

    // Setup HTTP mock responses queue
    httpResponses = [];
    http.request.mockImplementation((options, callback) => {
      const response = httpResponses.shift() || { status: 200, data: {} };
      const mockReq = new EventEmitter();
      mockReq.write = jest.fn();
      mockReq.end = jest.fn(() => {
        if (response.error) {
          setImmediate(() => mockReq.emit('error', new Error('ECONNREFUSED')));
          return;
        }
        const mockRes = new EventEmitter();
        mockRes.statusCode = response.status;
        setImmediate(() => {
          callback(mockRes);
          mockRes.emit('data', JSON.stringify(response.data));
          mockRes.emit('end');
        });
      });
      return mockReq;
    });
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('generateTaskId', () => {
    it('should generate an 8-character hex string', () => {
      const taskId = generateTaskId();
      expect(taskId).toMatch(/^[a-f0-9]{8}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTaskId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('listSidecars', () => {
    it('should list no sessions when directory is empty', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await listSidecars({ project: tmpDir });

      expect(consoleSpy).toHaveBeenCalledWith('No sidecar sessions found.');
      consoleSpy.mockRestore();
    });

    it('should list sessions with metadata', async () => {
      // Create session directory with metadata
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'test1234');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'test1234',
        model: 'google/gemini-2.5-flash',
        status: 'complete',
        briefing: 'Test briefing',
        createdAt: new Date().toISOString()
      }));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await listSidecars({ project: tmpDir });

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('test1234');
      expect(output).toContain('google/gemini-2.5-flash');
      consoleSpy.mockRestore();
    });

    it('should output JSON when --json flag is set', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'json1234');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'json1234',
        model: 'test-model',
        status: 'complete',
        createdAt: new Date().toISOString()
      }));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await listSidecars({ project: tmpDir, json: true });

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].taskId).toBe('json1234');
      consoleSpy.mockRestore();
    });

    it('should filter by status', async () => {
      const sessionDir1 = path.join(tmpDir, '.claude', 'sidecar_sessions', 'run1');
      const sessionDir2 = path.join(tmpDir, '.claude', 'sidecar_sessions', 'done1');
      fs.mkdirSync(sessionDir1, { recursive: true });
      fs.mkdirSync(sessionDir2, { recursive: true });

      fs.writeFileSync(path.join(sessionDir1, 'metadata.json'), JSON.stringify({
        taskId: 'run1', status: 'running', createdAt: new Date().toISOString()
      }));
      fs.writeFileSync(path.join(sessionDir2, 'metadata.json'), JSON.stringify({
        taskId: 'done1', status: 'complete', createdAt: new Date().toISOString()
      }));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await listSidecars({ project: tmpDir, status: 'running' });

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('run1');
      expect(output).not.toContain('done1');
      consoleSpy.mockRestore();
    });
  });

  describe('readSidecar', () => {
    it('should throw error for non-existent session', async () => {
      await expect(readSidecar({ taskId: 'nonexistent', project: tmpDir }))
        .rejects.toThrow('Session nonexistent not found');
    });

    it('should read summary by default', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'read1');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'summary.md'), '## Summary\nTest content');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await readSidecar({ taskId: 'read1', project: tmpDir });

      expect(consoleSpy).toHaveBeenCalledWith('## Summary\nTest content');
      consoleSpy.mockRestore();
    });

    it('should read conversation with --conversation flag', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'conv1');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'user', content: 'Hello', timestamp: new Date().toISOString() }) + '\n' +
        JSON.stringify({ role: 'assistant', content: 'Hi there', timestamp: new Date().toISOString() })
      );

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await readSidecar({ taskId: 'conv1', conversation: true, project: tmpDir });

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('[user');
      expect(output).toContain('Hello');
      expect(output).toContain('[assistant');
      consoleSpy.mockRestore();
    });

    it('should read metadata with --metadata flag', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'meta1');
      fs.mkdirSync(sessionDir, { recursive: true });
      const metadata = { taskId: 'meta1', model: 'test-model', status: 'complete' };
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await readSidecar({ taskId: 'meta1', metadata: true, project: tmpDir });

      const output = consoleSpy.mock.calls[0][0];
      expect(JSON.parse(output).taskId).toBe('meta1');
      consoleSpy.mockRestore();
    });
  });

  describe('resumeSidecar', () => {
    it('should throw error for non-existent session', async () => {
      await expect(resumeSidecar({ taskId: 'nonexistent', project: tmpDir }))
        .rejects.toThrow('Session nonexistent not found');
    });

    it('should load previous session metadata', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'resume1');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'resume1',
        model: 'google/gemini-2.5-flash',
        status: 'complete',
        briefing: 'Original briefing',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        completedAt: new Date().toISOString()
      }));
      fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), '# System Prompt\nTest prompt');
      fs.writeFileSync(path.join(sessionDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'system', content: 'System prompt', timestamp: new Date().toISOString() }) + '\n'
      );

      // Setup HTTP responses for headless mode
      httpResponses = [
        { error: true }, // Port check
        { status: 200, data: { version: '1.0' } }, // Health check
        { status: 201, data: { id: 'session-123' } }, // Create session
        { status: 200, data: { parts: [{ type: 'text', text: `Resumed! ${COMPLETE_MARKER}` }] } }
      ];

      const { logger } = require('../src/utils/logger');
      jest.spyOn(console, 'log').mockImplementation();

      await resumeSidecar({ taskId: 'resume1', project: tmpDir, headless: true });

      expect(logger.info).toHaveBeenCalledWith('Resuming session', expect.objectContaining({ taskId: 'resume1' }));
    });

    it('should detect file drift since last activity', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'drift1');
      fs.mkdirSync(sessionDir, { recursive: true });

      // Create a file that was "read" in the original session
      const testFile = path.join(tmpDir, 'test.js');
      fs.writeFileSync(testFile, 'original content');

      const oldTime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'drift1',
        model: 'google/gemini-2.5-flash',
        status: 'complete',
        briefing: 'Test',
        createdAt: new Date(oldTime).toISOString(),
        completedAt: new Date(oldTime + 60000).toISOString(),
        filesRead: ['test.js']
      }));
      fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), '# System Prompt');
      fs.writeFileSync(path.join(sessionDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'system', content: 'System prompt', timestamp: new Date().toISOString() }) + '\n'
      );

      // Modify the file after session ended
      fs.writeFileSync(testFile, 'modified content');

      // Setup HTTP responses
      httpResponses = [
        { error: true },
        { status: 200, data: { version: '1.0' } },
        { status: 201, data: { id: 'session-456' } },
        { status: 200, data: { parts: [{ type: 'text', text: `Done ${COMPLETE_MARKER}` }] } }
      ];

      const { logger } = require('../src/utils/logger');
      jest.spyOn(console, 'log').mockImplementation();

      await resumeSidecar({ taskId: 'drift1', project: tmpDir, headless: true });

      // Should warn about file changes
      expect(logger.warn).toHaveBeenCalledWith('Files changed since last activity', expect.objectContaining({ taskId: 'drift1' }));
    });

    it('should update session status to running on resume', async () => {
      const sessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'status1');
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'status1',
        model: 'google/gemini-2.5-flash',
        status: 'complete',
        createdAt: new Date().toISOString()
      }));
      fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), '# Prompt');
      fs.writeFileSync(path.join(sessionDir, 'conversation.jsonl'), '');

      httpResponses = [
        { error: true },
        { status: 200, data: { version: '1.0' } },
        { status: 201, data: { id: 'session-789' } },
        { status: 200, data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] } }
      ];

      jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(console, 'log').mockImplementation();

      await resumeSidecar({ taskId: 'status1', project: tmpDir, headless: true });

      // Check metadata was updated
      const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8'));
      expect(meta.status).toBe('complete');
      expect(meta.resumedAt).toBeDefined();
    });
  });

  describe('continueSidecar', () => {
    it('should throw error for non-existent session', async () => {
      await expect(continueSidecar({
        taskId: 'nonexistent',
        briefing: 'New task',
        project: tmpDir
      })).rejects.toThrow('Session nonexistent not found');
    });

    it('should create a new session that references the old one', async () => {
      const oldSessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'old1234');
      fs.mkdirSync(oldSessionDir, { recursive: true });
      fs.writeFileSync(path.join(oldSessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'old1234',
        model: 'google/gemini-2.5-flash',
        status: 'complete',
        briefing: 'Original task',
        createdAt: new Date(Date.now() - 3600000).toISOString()
      }));
      fs.writeFileSync(path.join(oldSessionDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'user', content: 'Old message', timestamp: new Date().toISOString() }) + '\n'
      );
      fs.writeFileSync(path.join(oldSessionDir, 'summary.md'), '## Previous Summary\nDid some work.');

      httpResponses = [
        { error: true },
        { status: 200, data: { version: '1.0' } },
        { status: 201, data: { id: 'session-new' } },
        { status: 200, data: { parts: [{ type: 'text', text: `Continued! ${COMPLETE_MARKER}` }] } }
      ];

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(process.stdout, 'write').mockImplementation();

      await continueSidecar({
        taskId: 'old1234',
        briefing: 'Continue the work',
        model: 'google/gemini-2.5-flash',
        project: tmpDir,
        headless: true
      });

      // Should have created a new session
      const sessions = fs.readdirSync(path.join(tmpDir, '.claude', 'sidecar_sessions'));
      expect(sessions.length).toBe(2);

      // New session should reference old one
      const newSessionId = sessions.find(s => s !== 'old1234');
      const newMeta = JSON.parse(fs.readFileSync(
        path.join(tmpDir, '.claude', 'sidecar_sessions', newSessionId, 'metadata.json'),
        'utf-8'
      ));
      expect(newMeta.continuesFrom).toBe('old1234');

      consoleSpy.mockRestore();
    });

    it('should include previous conversation in new system prompt', async () => {
      const oldSessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'prev1');
      fs.mkdirSync(oldSessionDir, { recursive: true });
      fs.writeFileSync(path.join(oldSessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'prev1',
        model: 'google/gemini-2.5-flash',
        status: 'complete',
        briefing: 'Original',
        createdAt: new Date().toISOString()
      }));
      fs.writeFileSync(path.join(oldSessionDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'assistant', content: 'I found the bug in auth.js', timestamp: new Date().toISOString() }) + '\n'
      );
      fs.writeFileSync(path.join(oldSessionDir, 'summary.md'), '## Summary\nFound bug in auth.');

      httpResponses = [
        { error: true },
        { status: 200, data: { version: '1.0' } },
        { status: 201, data: { id: 'session-cont' } },
        { status: 200, data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] } }
      ];

      jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(process.stdout, 'write').mockImplementation();

      await continueSidecar({
        taskId: 'prev1',
        briefing: 'Now fix the bug',
        model: 'google/gemini-2.5-flash',
        project: tmpDir,
        headless: true
      });

      // Check that initial_context.md contains reference to previous session
      const newSessionId = fs.readdirSync(path.join(tmpDir, '.claude', 'sidecar_sessions'))
        .find(s => s !== 'prev1');
      const context = fs.readFileSync(
        path.join(tmpDir, '.claude', 'sidecar_sessions', newSessionId, 'initial_context.md'),
        'utf-8'
      );
      expect(context).toContain('PREVIOUS SIDECAR');
      expect(context).toContain('Found bug in auth');
    });

    it('should use model from previous session if not specified', async () => {
      const oldSessionDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'model1');
      fs.mkdirSync(oldSessionDir, { recursive: true });
      fs.writeFileSync(path.join(oldSessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'model1',
        model: 'anthropic/claude-3.5-sonnet',
        status: 'complete',
        briefing: 'Test',
        createdAt: new Date().toISOString()
      }));
      fs.writeFileSync(path.join(oldSessionDir, 'conversation.jsonl'), '');
      fs.writeFileSync(path.join(oldSessionDir, 'summary.md'), 'Summary');

      // Get reference to mocked SDK functions
      const { sendPrompt } = require('../src/opencode-client');

      jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(process.stdout, 'write').mockImplementation();

      await continueSidecar({
        taskId: 'model1',
        briefing: 'Continue',
        project: tmpDir,
        headless: true
        // No model specified
      });

      // Check SDK sendPrompt was called with inherited model
      expect(sendPrompt).toHaveBeenCalled();
      const promptCall = sendPrompt.mock.calls[0];
      // Model is passed as the second argument's model field
      expect(promptCall[2].model).toBe('anthropic/claude-3.5-sonnet');
    });
  });
});
