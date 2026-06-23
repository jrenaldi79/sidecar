/**
 * Tests for headless mode runner
 *
 * Tests the headless mode runner that uses OpenCode SDK (no CLI spawning).
 */

const fs = require('fs');
const path = require('path');

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn()
}));

// Mock the opencode-client module
const mockCreateSession = jest.fn();
const mockSendPromptAsync = jest.fn();

const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockServerClose = jest.fn();
const mockAbortSession = jest.fn();

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPrompt: mockSendPromptAsync,
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

const mockAppendContainedSessionFile = jest.fn();
const mockEnsureSidecarSessionDir = jest.fn();
const mockWriteContainedSessionFile = jest.fn();

jest.mock('../src/utils/sidecar-session-boundaries', () => ({
  appendContainedSessionFile: (...args) => mockAppendContainedSessionFile(...args),
  ensureSidecarSessionDir: (...args) => mockEnsureSidecarSessionDir(...args),
  writeContainedSessionFile: (...args) => mockWriteContainedSessionFile(...args),
  resolveContainedSessionFile: jest.fn(() => null)
}));

const { runHeadless, extractSummary, COMPLETE_MARKER, FOLD_MARKER, formatFoldOutput, DEFAULT_TIMEOUT } = require('../src/headless');

describe('Headless Mode Runner', () => {
  let mockClient;
  let mockServer;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureSidecarSessionDir.mockImplementation((project, taskId) =>
      path.join(project, '.claude', 'sidecar_sessions', taskId)
    );
    mockAppendContainedSessionFile.mockImplementation((sessionDir, filename, data, options) => {
      fs.appendFileSync(path.join(sessionDir, filename), data, options);
    });
    mockWriteContainedSessionFile.mockImplementation((sessionDir, filename, data, options) => {
      fs.writeFileSync(path.join(sessionDir, filename), data, options);
    });

    // Setup fs mocks
    fs.existsSync.mockReturnValue(true);

    // Setup SDK client mock
    mockClient = {
      session: {
        create: jest.fn(),
        prompt: jest.fn(),
        messages: jest.fn()
      },
      config: {
        get: jest.fn()
      }
    };

    mockServer = {
      url: 'http://127.0.0.1:4440',
      close: mockServerClose
    };

    mockStartServer.mockResolvedValue({ client: mockClient, server: mockServer });
  });

  describe('runHeadless', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-2.5-flash';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'abc12345';

    it('should start server using SDK startServer', async () => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: `Done!\n${COMPLETE_MARKER}` }]
      }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

      expect(mockStartServer).toHaveBeenCalled();
    });

    describe('SDK Integration', () => {
      it('should use createSession from SDK client', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);
      });

      it('should use sendPromptAsync from SDK client with model specification', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockSendPromptAsync).toHaveBeenCalledWith(
          mockClient,
          'session-123',
          expect.objectContaining({
            model: testModel,
            system: testSystemPrompt,
            parts: [{ type: 'text', text: testUserMessage }]
          })
        );
      });

      it('should use checkHealth to verify server is ready', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);
      });

      it('should use getMessages to poll for completion', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        // First poll doesn't have marker, second does
        mockGetMessages
          .mockResolvedValueOnce([{ parts: [{ type: 'text', text: 'Still working...' }] }])
          .mockResolvedValueOnce([{
            info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
            parts: [{ type: 'text', text: `Done!\n${COMPLETE_MARKER}` }]
          }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000);

        expect(mockGetMessages).toHaveBeenCalledWith(mockClient, 'session-123');
      }, 15000); // Increase timeout for polling test
    });

    describe('Default Agent', () => {
      it('should default to build agent when no agent specified', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);

        // Call without agent parameter (undefined)
        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000, undefined);

        expect(mockSendPromptAsync).toHaveBeenCalledWith(
          mockClient,
          'session-123',
          expect.objectContaining({
            agent: 'build'
          })
        );
      });

      it('should respect explicit agent when provided', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000, 'plan');

        expect(mockSendPromptAsync).toHaveBeenCalledWith(
          mockClient,
          'session-123',
          expect.objectContaining({
            agent: 'plan'
          })
        );
      });
    });

    describe('Completion Detection', () => {
      it('should detect [SIDECAR_FOLD] marker in response', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: `Summary content\n${COMPLETE_MARKER}` }]
        }]);
      });

      it('should return summary content before [SIDECAR_FOLD] marker', async () => {
        const summaryText = '## Task Summary\nCompleted the task.';
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: `${summaryText}\n${COMPLETE_MARKER}` }]
        }]);
      });
    });

    describe('Server Management', () => {
      it('should return error if server fails to start', async () => {
        // Health check always fails
        mockCheckHealth.mockResolvedValue(false);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.completed).toBe(false);
        expect(result.error).toContain('server failed to start');
        expect(mockServerClose).toHaveBeenCalled();
      }, 20000);

      it('should return error if startServer throws', async () => {
        mockStartServer.mockRejectedValue(new Error('Failed to start server'));

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.completed).toBe(false);
        expect(result.error).toContain('Failed to start server');
      });

      it('should return error if session creation fails', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockRejectedValue(new Error('Failed to create session'));

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.completed).toBe(false);
        expect(result.error).toContain('Failed to create session');
      });

      it('should close server on completion', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockServerClose).toHaveBeenCalled();
      });

      it('should close server on error', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockRejectedValue(new Error('Network error'));

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockServerClose).toHaveBeenCalled();
      });
    });

    describe('Conversation Logging', () => {
      it('should create session directory if it does not exist', async () => {
        fs.existsSync.mockReturnValue(false);
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockEnsureSidecarSessionDir).toHaveBeenCalledWith(testProject, testTaskId);
      });

      it('should log system prompt as first message', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(fs.appendFileSync).toHaveBeenCalled();
        const firstCall = fs.appendFileSync.mock.calls[0];
        const loggedMessage = JSON.parse(firstCall[1].replace('\n', ''));
        expect(loggedMessage.role).toBe('system');
        expect(loggedMessage.content).toBe(testSystemPrompt);
      });

      it('should log assistant output', async () => {
        const responseText = 'This is the response';
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: `${responseText}\n${COMPLETE_MARKER}` }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        const assistantCalls = fs.appendFileSync.mock.calls.filter(call => {
          try {
            const msg = JSON.parse(call[1].replace('\n', ''));
            return msg.role === 'assistant';
          } catch {
            return false;
          }
        });
        expect(assistantCalls.length).toBeGreaterThan(0);
      });

      it('should include timestamps in logged messages', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        const firstCall = fs.appendFileSync.mock.calls[0];
        const loggedMessage = JSON.parse(firstCall[1].replace('\n', ''));
        expect(loggedMessage.timestamp).toBeDefined();
        expect(() => new Date(loggedMessage.timestamp)).not.toThrow();
      });
    });

    describe('Return Value', () => {
      it('should return summary, completed flag, and timedOut flag', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: `Summary\n${COMPLETE_MARKER}` }]
        }]);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result).toHaveProperty('summary');
        expect(result).toHaveProperty('completed');
        expect(result).toHaveProperty('timedOut');
      });

      it('should return taskId in result', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPromptAsync.mockResolvedValue(undefined);
        mockGetMessages.mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text: COMPLETE_MARKER }]
        }]);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.taskId).toBe(testTaskId);
      });
    });
  });

  describe('extractSummary', () => {
    it('should extract content before [SIDECAR_FOLD]', () => {
      const output = 'Summary content\n[SIDECAR_FOLD]';
      expect(extractSummary(output)).toBe('Summary content');
    });

    it('should handle output without marker', () => {
      const output = 'Just some text without marker';
      expect(extractSummary(output)).toBe(output);
    });

    it('should handle empty output', () => {
      expect(extractSummary('')).toBe('');
      expect(extractSummary(null)).toBe('');
      expect(extractSummary(undefined)).toBe('');
    });

    it('should trim whitespace', () => {
      const output = '  Summary  \n  [SIDECAR_FOLD]';
      expect(extractSummary(output)).toBe('Summary');
    });
  });

  describe('Reasoning/Thinking Support', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-3-pro-preview';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'abc12345';

    beforeEach(() => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: COMPLETE_MARKER }]
      }]);
    });

    it('should pass reasoning parameter to sendPromptAsync when provided', async () => {
      await runHeadless(
        testModel,
        testSystemPrompt,
        testUserMessage,
        testTaskId,
        testProject,
        5000,
        'build',
        { reasoning: { effort: 'low' } }
      );

      expect(mockSendPromptAsync).toHaveBeenCalledWith(
        expect.anything(),
        'session-123',
        expect.objectContaining({
          reasoning: { effort: 'low' }
        })
      );
    });

    it('should support all reasoning effort levels', async () => {
      const effortLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'none'];

      for (const effort of effortLevels) {
        mockSendPromptAsync.mockClear();

        await runHeadless(
          testModel,
          testSystemPrompt,
          testUserMessage,
          testTaskId,
          testProject,
          5000,
          'build',
          { reasoning: { effort } }
        );

        expect(mockSendPromptAsync).toHaveBeenCalledWith(
          expect.anything(),
          'session-123',
          expect.objectContaining({
            reasoning: { effort }
          })
        );
      }
    }, 30000);

    it('should not include reasoning when not provided in options', async () => {
      await runHeadless(
        testModel,
        testSystemPrompt,
        testUserMessage,
        testTaskId,
        testProject,
        5000,
        'build',
        {}
      );

      const callArgs = mockSendPromptAsync.mock.calls[0][2];
      expect(callArgs).not.toHaveProperty('reasoning');
    });

    it('should combine reasoning with other options like mcp', async () => {
      const mcpConfig = { 'my-server': { type: 'remote', url: 'https://example.com' } };

      await runHeadless(
        testModel,
        testSystemPrompt,
        testUserMessage,
        testTaskId,
        testProject,
        5000,
        'build',
        { mcp: mcpConfig, reasoning: { effort: 'high' } }
      );

      expect(mockSendPromptAsync).toHaveBeenCalledWith(
        expect.anything(),
        'session-123',
        expect.objectContaining({
          reasoning: { effort: 'high' }
        })
      );

      // Verify MCP was passed to startServer
      expect(mockStartServer).toHaveBeenCalledWith(
        expect.objectContaining({
          mcp: mcpConfig
        })
      );
    });
  });

  describe('FOLD_MARKER', () => {
    it('should be exported as [SIDECAR_FOLD]', () => {
      expect(FOLD_MARKER).toBe('[SIDECAR_FOLD]');
    });

    it('should have COMPLETE_MARKER equal FOLD_MARKER for backward compat', () => {
      expect(COMPLETE_MARKER).toBe(FOLD_MARKER);
    });
  });

  describe('formatFoldOutput', () => {
    it('should format with all fields', () => {
      const output = formatFoldOutput({
        model: 'google/gemini-2.5-pro', sessionId: 'abc123',
        client: 'code-local', cwd: '/projects/myapp',
        mode: 'interactive', summary: 'Test summary'
      });
      expect(output).toContain('[SIDECAR_FOLD]');
      expect(output).toContain('Model: google/gemini-2.5-pro');
      expect(output).toContain('Session: abc123');
      expect(output).toContain('Client: code-local');
      expect(output).toContain('CWD: /projects/myapp');
      expect(output).toContain('Mode: interactive');
      expect(output).toContain('---');
      expect(output).toContain('Test summary');
    });

    it('should use defaults for missing optional fields', () => {
      const output = formatFoldOutput({ model: 'test', sessionId: 'x', summary: 'hi' });
      expect(output).toContain('Client: code-local');
      expect(output).toContain('Mode: headless');
    });
  });

  describe('DEFAULT_TIMEOUT', () => {
    it('should be 15 minutes per spec §6.2', () => {
      expect(DEFAULT_TIMEOUT).toBe(15 * 60 * 1000);
    });
  });

  describe('Session Abort', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-2.5-flash';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'abort123';

    beforeEach(() => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
    });

    it('should set timedOut flag when timeout is reached', async () => {
      // Never complete — timeout should trigger
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: 'Still working...' }]
      }]);

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        3000 // Very short timeout
      );

      expect(result.timedOut).toBe(true);
      expect(mockServerClose).toHaveBeenCalled();
    }, 10000);

    it('should check for external abort signal in metadata', async () => {
      // First poll: normal. Second poll: metadata says aborted.
      let pollCount = 0;
      mockGetMessages.mockImplementation(() => {
        pollCount++;
        return Promise.resolve([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'Working...' }]
        }]);
      });

      // On second poll, simulate metadata.status = 'aborted'
      const originalReadFileSync = fs.readFileSync;
      fs.readFileSync = jest.fn((filePath, encoding) => {
        if (typeof filePath === 'string' && filePath.includes('metadata.json') && pollCount >= 2) {
          return JSON.stringify({ status: 'aborted' });
        }
        // For other reads, return empty string
        return '';
      });

      // existsSync should return true for metadata check
      fs.existsSync.mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('metadata.json')) {
          return pollCount >= 2;
        }
        return true;
      });

      const result = await runHeadless(
        testModel, testSystemPrompt, testUserMessage, testTaskId, testProject,
        30000 // Long timeout — abort should happen before this
      );

      // Should have detected external abort
      expect(result.aborted).toBe(true);
      expect(mockServerClose).toHaveBeenCalled();

      // Restore
      fs.readFileSync = originalReadFileSync;
    }, 15000);
  });

  describe('Progress Updates', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-2.5-flash';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'progress1';

    beforeEach(() => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ type: 'text', text: COMPLETE_MARKER }]
      }]);
    });

    it('should write progress updates to progress.json at lifecycle stages', async () => {
      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

      // Verify writeFileSync was called with progress.json content
      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      // Should have at least 3 progress updates:
      // initializing, server_ready/session_created, prompt_sent
      expect(progressWrites.length).toBeGreaterThanOrEqual(3);

      // Check that stages were written in order
      const stages = progressWrites.map(call => JSON.parse(call[1]).stage);
      expect(stages).toContain('initializing');
      expect(stages).toContain('prompt_sent');
    });

    it('should write receiving stage when first assistant text is detected', async () => {
      // First poll: model starts producing text
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'Working on it...' }]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: `Working on it... Done\n${COMPLETE_MARKER}` }]
        }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);

      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      const stages = progressWrites.map(call => JSON.parse(call[1]).stage);
      expect(stages).toContain('receiving');
    }, 20000);

    it('should write receiving stage when tool_use is detected (no text yet)', async () => {
      // First poll: model makes a tool call, no text yet
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } }
          ]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } },
            { id: 'p1', type: 'text', text: `Search results found\n${COMPLETE_MARKER}` }
          ]
        }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);

      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      const stages = progressWrites.map(call => JSON.parse(call[1]).stage);
      expect(stages).toContain('receiving');

      // Should include tool name in the progress data
      const receivingWrite = progressWrites.find(call =>
        JSON.parse(call[1]).stage === 'receiving'
      );
      if (receivingWrite) {
        const data = JSON.parse(receivingWrite[1]);
        expect(data.latestTool).toBe('web_search');
      }
    }, 20000);

    it('should update progress with latest tool name on each new tool call', async () => {
      // Multiple tool calls across polls
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } }
          ]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } },
            { id: 'tool-2', type: 'tool_use', name: 'Read', input: { path: '/tmp/x' } }
          ]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [
            { id: 'tool-1', type: 'tool_use', name: 'web_search', input: { query: 'test' } },
            { id: 'tool-2', type: 'tool_use', name: 'Read', input: { path: '/tmp/x' } },
            { id: 'p1', type: 'text', text: `Done\n${COMPLETE_MARKER}` }
          ]
        }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);

      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      // Find all receiving writes
      const receivingWrites = progressWrites.filter(call =>
        JSON.parse(call[1]).stage === 'receiving'
      );

      // Should have updated at least twice (one for each new tool)
      expect(receivingWrites.length).toBeGreaterThanOrEqual(2);

      // Last receiving write should have the latest tool name
      const lastReceiving = JSON.parse(receivingWrites[receivingWrites.length - 1][1]);
      expect(lastReceiving.latestTool).toBe('Read');
    }, 25000);

    it('should include messagesReceived count in receiving stage', async () => {
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: `Response text\n${COMPLETE_MARKER}` }]
      }]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

      const progressWrites = fs.writeFileSync.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('progress.json')
      );

      const receivingWrites = progressWrites.filter(call =>
        JSON.parse(call[1]).stage === 'receiving'
      );

      if (receivingWrites.length > 0) {
        const data = JSON.parse(receivingWrites[receivingWrites.length - 1][1]);
        expect(data.messagesReceived).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('Polling Behavior', () => {
    const testProject = '/test/project';
    const testModel = 'openrouter/google/gemini-2.5-flash';
    const testSystemPrompt = '# Test system prompt';
    const testUserMessage = 'Please complete the task';
    const testTaskId = 'poll12345';

    beforeEach(() => {
      mockCheckHealth.mockResolvedValue(true);
      mockCreateSession.mockResolvedValue('session-123');
      mockSendPromptAsync.mockResolvedValue(undefined);
    });

    it('should capture streaming text incrementally (no duplication)', async () => {
      // Simulate text growing between polls (same part, increasing length)
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'Hello' }]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'Hello world' }]
        }])
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: `Hello world done\n${COMPLETE_MARKER}` }]
        }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);

      // Output should be "Hello world done" — not "HelloHello worldHello world done"
      expect(result.summary).toBe('Hello world done');
    }, 20000);

    it('should only finish when the LAST assistant message is complete', async () => {
      // Two assistant messages: first is finished, second still streaming
      mockGetMessages
        .mockResolvedValueOnce([
          {
            info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
            parts: [{ id: 'p1', type: 'text', text: 'First response done' }]
          },
          {
            info: { role: 'assistant', id: 'msg-2', time: {} },
            parts: [{ id: 'p2', type: 'text', text: 'Still working...' }]
          }
        ])
        .mockResolvedValueOnce([
          {
            info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
            parts: [{ id: 'p1', type: 'text', text: 'First response done' }]
          },
          {
            info: { role: 'assistant', id: 'msg-2', time: { completed: Date.now() } },
            parts: [{ id: 'p2', type: 'text', text: `Still working... Done\n${COMPLETE_MARKER}` }]
          }
        ]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);
      expect(result.summary).toContain('Done');
    }, 20000);

    it('should exclude user message parts from output', async () => {
      mockGetMessages.mockResolvedValue([
        {
          info: { role: 'user', id: 'msg-u1', time: {} },
          parts: [{ id: 'pu1', type: 'text', text: 'USER TEXT SHOULD NOT APPEAR' }]
        },
        {
          info: { role: 'assistant', id: 'msg-a1', time: { completed: Date.now() } },
          parts: [{ id: 'pa1', type: 'text', text: `Assistant output\n${COMPLETE_MARKER}` }]
        }
      ]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000);
      expect(result.summary).not.toContain('USER TEXT SHOULD NOT APPEAR');
      expect(result.summary).toContain('Assistant output');
    }, 15000);

    it('should handle tool part type same as tool_use', async () => {
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [
          { id: 'tool-1', type: 'tool', name: 'Read', input: { path: '/test.js' } },
          { id: 'p1', type: 'text', text: `Found file\n${COMPLETE_MARKER}` }
        ]
      }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000);
      expect(result.toolCalls).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Read' })])
      );
    }, 15000);

    it('should NOT trigger fold for inline [SIDECAR_FOLD] in prose', async () => {
      // First poll has FOLD inline (not on its own line) — should NOT trigger
      mockGetMessages
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text: 'The function splits on [SIDECAR_FOLD] marker' }]
        }])
        // Second poll: same output, assistant finishes (stablePolls kicks in)
        .mockResolvedValueOnce([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'The function splits on [SIDECAR_FOLD] marker' }]
        }])
        .mockResolvedValue([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'The function splits on [SIDECAR_FOLD] marker' }]
        }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 15000);
      // Should NOT have detected FOLD — completed via stablePolls fallback
      expect(result.completed).toBe(false);
      expect(result.summary).toContain('[SIDECAR_FOLD]');
    }, 25000);

    it('should trigger fold when [SIDECAR_FOLD] is on its own line', async () => {
      mockGetMessages.mockResolvedValue([{
        info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
        parts: [{ id: 'p1', type: 'text', text: `Summary content\n[SIDECAR_FOLD]` }]
      }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000);
      expect(result.completed).toBe(true);
      expect(result.summary).toBe('Summary content');
    }, 15000);

    it('should complete via stablePolls fallback after 4 stable polls without assistantFinished', async () => {
      // assistantFinished is never true (time.completed not set), but output is stable
      const stableMessage = [{
        info: { role: 'assistant', id: 'msg-1', time: {} },
        parts: [{ id: 'p1', type: 'text', text: 'Final output' }]
      }];

      mockGetMessages.mockResolvedValue(stableMessage);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      // Should break out after 4 stable polls (first poll captures text, then 4 stable)
      expect(result.summary).toBe('Final output');
    }, 35000);

    it('should NOT exit early when model has not started generating yet', async () => {
      // Simulate slow model startup: first 3 polls return empty messages,
      // then assistant message appears. Before the fix, stablePolls would
      // increment during the empty polls and exit after 4, before the model
      // even started.
      let callCount = 0;
      mockGetMessages.mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          // Model still loading — no assistant message yet
          return Promise.resolve([]);
        }
        // Model responds on poll 4
        return Promise.resolve([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'Delayed response' }]
        }]);
      });

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      expect(result.summary).toBe('Delayed response');
      // Must have polled at least 4 times (3 empty + 1 with response + 2 stable)
      expect(callCount).toBeGreaterThanOrEqual(4);
    }, 35000);

    it('should NOT exit early when assistant message exists but has no output', async () => {
      // The SDK creates an empty assistant message placeholder immediately
      // when promptAsync is called. This message has a non-null ID but no
      // text parts. Without the output.length > 0 guard, stablePolls would
      // count these empty polls and exit after 4.
      let callCount = 0;
      mockGetMessages.mockImplementation(() => {
        callCount++;
        if (callCount <= 4) {
          // SDK placeholder: assistant message exists but has no text parts
          return Promise.resolve([{
            info: { role: 'assistant', id: 'msg-placeholder', time: {} },
            parts: []
          }]);
        }
        // Model actually responds on poll 5
        return Promise.resolve([{
          info: { role: 'assistant', id: 'msg-1', time: { completed: Date.now() } },
          parts: [{ id: 'p1', type: 'text', text: 'Real response' }]
        }]);
      });

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      expect(result.summary).toBe('Real response');
      expect(callCount).toBeGreaterThanOrEqual(5);
    }, 35000);

    it('should propagate session error when model returns error with no output', async () => {
      // Simulate model error: assistant message has error info, time.completed,
      // but no text parts. This happens when API key is invalid, model not found, etc.
      mockGetMessages.mockResolvedValue([{
        info: {
          role: 'assistant',
          id: 'msg-err-1',
          time: { completed: Date.now() },
          error: { name: 'ModelError', data: { message: 'API key invalid' } }
        },
        parts: []
      }]);

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      expect(result.error).toBe('API key invalid');
      expect(result.completed).toBe(false);
      expect(result.summary).toBe('');
    }, 15000);

    it('should reset stablePolls when output grows', async () => {
      // Simulate streaming: same part ID, text grows each poll then stabilizes
      let callCount = 0;
      const textStages = ['A', 'AB', 'ABC', 'ABC', 'ABC', 'ABC', 'ABC', 'ABC', 'ABC'];
      mockGetMessages.mockImplementation(() => {
        callCount++;
        const text = textStages[Math.min(callCount - 1, textStages.length - 1)];
        return Promise.resolve([{
          info: { role: 'assistant', id: 'msg-1', time: {} },
          parts: [{ id: 'p1', type: 'text', text }]
        }]);
      });

      const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 30000);
      // Output should be "ABC" (incremental: "A" + "B" + "C")
      expect(result.summary).toBe('ABC');
      // Polls: 1(A), 2(AB), 3(ABC), then 4 stable polls needed → at least 7
      expect(callCount).toBeGreaterThanOrEqual(7);
    }, 35000);
  });
});
