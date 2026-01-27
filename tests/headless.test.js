/**
 * Tests for headless mode runner
 *
 * Tests the headless mode runner that uses OpenCode SDK (no CLI spawning).
 */

const fs = require('fs');

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
const mockSendPrompt = jest.fn();
const mockGetMessages = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockServerClose = jest.fn();

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPrompt: mockSendPrompt,
  getMessages: mockGetMessages,
  checkHealth: mockCheckHealth,
  startServer: mockStartServer
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const { runHeadless, extractSummary, COMPLETE_MARKER, DEFAULT_TIMEOUT } = require('../src/headless');

describe('Headless Mode Runner', () => {
  let mockClient;
  let mockServer;

  beforeEach(() => {
    jest.clearAllMocks();

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
      mockSendPrompt.mockResolvedValue({
        data: { parts: [{ type: 'text', text: `Done! ${COMPLETE_MARKER}` }] }
      });
      mockGetMessages.mockResolvedValue([]);

      await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

      expect(mockStartServer).toHaveBeenCalled();
    });

    describe('SDK Integration', () => {
      it('should use createSession from SDK client', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
        });
        mockGetMessages.mockResolvedValue([]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockCreateSession).toHaveBeenCalledWith(mockClient);
      });

      it('should use sendPrompt from SDK client with model specification', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
        });
        mockGetMessages.mockResolvedValue([]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockSendPrompt).toHaveBeenCalledWith(
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
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
        });
        mockGetMessages.mockResolvedValue([]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockCheckHealth).toHaveBeenCalledWith(mockClient);
      });

      it('should use getMessages to poll for completion', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        // First prompt doesn't have marker
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: 'Working on it...' }] }
        });
        // First poll doesn't have marker, second does
        mockGetMessages
          .mockResolvedValueOnce([{ parts: [{ type: 'text', text: 'Still working...' }] }])
          .mockResolvedValueOnce([{ parts: [{ type: 'text', text: `Done! ${COMPLETE_MARKER}` }] }]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 10000);

        expect(mockGetMessages).toHaveBeenCalledWith(mockClient, 'session-123');
      }, 15000); // Increase timeout for polling test
    });

    describe('Completion Detection', () => {
      it('should detect [SIDECAR_COMPLETE] marker in response', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: `Summary content\n${COMPLETE_MARKER}` }] }
        });
        mockGetMessages.mockResolvedValue([]);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.completed).toBe(true);
      });

      it('should return summary content before [SIDECAR_COMPLETE] marker', async () => {
        const summaryText = '## Task Summary\nCompleted the task.';
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: `${summaryText}\n${COMPLETE_MARKER}` }] }
        });
        mockGetMessages.mockResolvedValue([]);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.summary).toBe(summaryText);
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
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
        });
        mockGetMessages.mockResolvedValue([]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockServerClose).toHaveBeenCalled();
      });

      it('should close server on error', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPrompt.mockRejectedValue(new Error('Network error'));

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(mockServerClose).toHaveBeenCalled();
      });
    });

    describe('Conversation Logging', () => {
      it('should create session directory if it does not exist', async () => {
        fs.existsSync.mockReturnValue(false);
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
        });
        mockGetMessages.mockResolvedValue([]);

        await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(fs.mkdirSync).toHaveBeenCalledWith(
          expect.stringContaining(testTaskId),
          { recursive: true }
        );
      });

      it('should log system prompt as first message', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
        });
        mockGetMessages.mockResolvedValue([]);

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
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: `${responseText}${COMPLETE_MARKER}` }] }
        });
        mockGetMessages.mockResolvedValue([]);

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
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
        });
        mockGetMessages.mockResolvedValue([]);

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
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: `Summary${COMPLETE_MARKER}` }] }
        });
        mockGetMessages.mockResolvedValue([]);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result).toHaveProperty('summary');
        expect(result).toHaveProperty('completed');
        expect(result).toHaveProperty('timedOut');
      });

      it('should return taskId in result', async () => {
        mockCheckHealth.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-123');
        mockSendPrompt.mockResolvedValue({
          data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
        });
        mockGetMessages.mockResolvedValue([]);

        const result = await runHeadless(testModel, testSystemPrompt, testUserMessage, testTaskId, testProject, 5000);

        expect(result.taskId).toBe(testTaskId);
      });
    });
  });

  describe('extractSummary', () => {
    it('should extract content before [SIDECAR_COMPLETE]', () => {
      const output = 'Summary content\n[SIDECAR_COMPLETE]';
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
      const output = '  Summary  \n  [SIDECAR_COMPLETE]';
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
      mockSendPrompt.mockResolvedValue({
        data: { parts: [{ type: 'text', text: COMPLETE_MARKER }] }
      });
      mockGetMessages.mockResolvedValue([]);
    });

    it('should pass reasoning parameter to sendPrompt when provided', async () => {
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

      expect(mockSendPrompt).toHaveBeenCalledWith(
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
        mockSendPrompt.mockClear();

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

        expect(mockSendPrompt).toHaveBeenCalledWith(
          expect.anything(),
          'session-123',
          expect.objectContaining({
            reasoning: { effort }
          })
        );
      }
    });

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

      const callArgs = mockSendPrompt.mock.calls[0][2];
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

      // Verify reasoning was passed to sendPrompt
      expect(mockSendPrompt).toHaveBeenCalledWith(
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

  describe('COMPLETE_MARKER', () => {
    it('should be exported as [SIDECAR_COMPLETE]', () => {
      expect(COMPLETE_MARKER).toBe('[SIDECAR_COMPLETE]');
    });
  });

  describe('DEFAULT_TIMEOUT', () => {
    it('should be 15 minutes per spec §6.2', () => {
      expect(DEFAULT_TIMEOUT).toBe(15 * 60 * 1000);
    });
  });
});
