'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();
const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockServerClose = jest.fn();
const mockAbortSession = jest.fn();

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPromptAsync: mockSendPromptAsync,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer,
  abortSession: mockAbortSession
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../src/utils/path-setup', () => ({
  ensureNodeModulesBinInPath: jest.fn()
}));

jest.mock('../src/utils/server-setup', () => ({
  ensurePortAvailable: jest.fn()
}));

jest.mock('../src/utils/idle-watchdog', () => ({
  IdleWatchdog: class {
    start() { return this; }
    touch() {}
    cancel() {}
  }
}));

const { runHeadless, COMPLETE_MARKER } = require('../src/headless');

describe('Headless session boundary containment', () => {
  let projectDir;
  let outsideDir;

  beforeEach(() => {
    jest.clearAllMocks();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headless-boundary-project-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headless-boundary-outside-'));

    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('opencode-session');
    mockSendPromptAsync.mockResolvedValue(undefined);
    mockGetMessages.mockResolvedValue([{
      info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
      parts: [{ id: 'p1', type: 'text', text: COMPLETE_MARKER }]
    }]);
    mockStartServer.mockResolvedValue({
      client: {},
      server: {
        url: 'http://127.0.0.1:4440',
        close: mockServerClose
      }
    });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('rejects a dangling conversation symlink before headless logging creates the outside target', async () => {
    const taskId = 'dangling-headless';
    const sessionDir = path.join(projectDir, '.claude', 'sidecar_sessions', taskId);
    const outsideTarget = path.join(outsideDir, 'new-conversation.jsonl');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.symlinkSync(outsideTarget, path.join(sessionDir, 'conversation.jsonl'));

    await expect(runHeadless(
      'test-model',
      'system prompt',
      'user message',
      taskId,
      projectDir,
      5000
    )).rejects.toThrow(/symbolic link|session directory|outside/i);

    expect(fs.existsSync(outsideTarget)).toBe(false);
  });

  it('ignores a symlinked metadata abort signal outside the session directory', async () => {
    const taskId = 'metadata-abort-escape';
    const sessionDir = path.join(projectDir, '.claude', 'sidecar_sessions', taskId);
    const outsideMetadata = path.join(outsideDir, 'metadata.json');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(outsideMetadata, JSON.stringify({ status: 'aborted' }));
    fs.symlinkSync(outsideMetadata, path.join(sessionDir, 'metadata.json'));

    const result = await runHeadless(
      'test-model',
      'system prompt',
      'user message',
      taskId,
      projectDir,
      5000
    );

    expect(result.aborted).toBe(false);
    expect(result.completed).toBe(true);
    expect(mockAbortSession).not.toHaveBeenCalled();
  });
});
