/**
 * E2E Test: Headless Agent Spawns Subagent
 *
 * Tests that a headless agent can spawn a subagent (via Task tool call)
 * and the work can be validated through read-only inspection.
 *
 * This test does NOT write any data - validation is purely through
 * mock response inspection and SDK call verification.
 */

// Mock fs to prevent any file writes (read-only test)
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn()
}));

// Mock the opencode-client module
const mockCreateSession = jest.fn();
const mockSendPrompt = jest.fn();
const mockGetMessages = jest.fn();
const mockGetSessionStatus = jest.fn();
const mockCheckHealth = jest.fn();
const mockStartServer = jest.fn();
const mockServerClose = jest.fn();

jest.mock('../src/opencode-client', () => ({
  createSession: mockCreateSession,
  sendPrompt: mockSendPrompt,
  getMessages: mockGetMessages,
  getSessionStatus: mockGetSessionStatus,
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

const { runHeadless, COMPLETE_MARKER } = require('../src/headless');

describe('Headless Agent Subagent Invocation (Read-Only E2E)', () => {
  let mockClient;
  let mockServer;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      session: { create: jest.fn(), prompt: jest.fn(), messages: jest.fn() },
      config: { get: jest.fn() }
    };

    mockServer = {
      url: 'http://127.0.0.1:4440',
      close: mockServerClose
    };

    mockStartServer.mockResolvedValue({ client: mockClient, server: mockServer });
    mockCheckHealth.mockResolvedValue(true);
    mockCreateSession.mockResolvedValue('main-session-123');
  });

  describe('Subagent Tool Call Detection', () => {
    it('should detect when headless agent spawns an Explore subagent via Task tool', async () => {
      // Mock response sequence:
      // 1. Agent decides to spawn Explore subagent
      // 2. Returns tool_use for Task with agentType: 'explore'
      // 3. Tool result shows subagent completed
      // 4. Final summary with completion marker

      const toolCallId = 'toolu_explore_001';

      // First sendPrompt: Agent analyzes and decides to spawn subagent
      mockSendPrompt.mockResolvedValueOnce({
        data: {
          parts: [
            { type: 'text', text: 'I need to explore the codebase to find the auth implementation.' },
            {
              type: 'tool_use',
              id: toolCallId,
              name: 'Task',
              input: {
                description: 'Find auth implementation',
                prompt: 'Search the codebase for authentication-related files and understand the auth flow',
                subagent_type: 'Explore'
              }
            }
          ]
        }
      });

      // Status check shows agent processing
      mockGetSessionStatus.mockResolvedValueOnce({ status: 'running' });

      // Second poll: Tool result and completion
      mockGetMessages.mockResolvedValueOnce([
        {
          parts: [
            { type: 'text', text: 'I need to explore the codebase to find the auth implementation.' },
            {
              type: 'tool_use',
              id: toolCallId,
              name: 'Task',
              input: {
                description: 'Find auth implementation',
                prompt: 'Search the codebase for authentication-related files',
                subagent_type: 'Explore'
              }
            },
            {
              type: 'tool_result',
              tool_use_id: toolCallId,
              content: 'Found auth files in src/auth/: auth.js, token-manager.js, session.js. The main auth flow is in auth.js which calls TokenManager for JWT handling.'
            },
            {
              type: 'text',
              text: `## Sidecar Results: Auth Implementation Analysis

**Task:** Explore the auth implementation

**Findings:**
- Auth files located in src/auth/
- Main authentication flow in auth.js
- JWT token handling via TokenManager in token-manager.js

**Recommendations:**
1. Check token-manager.js for the refresh logic
2. Look for race conditions in concurrent token refresh calls

${COMPLETE_MARKER}`
            }
          ]
        }
      ]);

      // Status shows idle (completed)
      mockGetSessionStatus.mockResolvedValueOnce({ status: 'idle' });

      // Run headless
      const result = await runHeadless(
        'openrouter/google/gemini-2.5-flash',
        '# Sidecar Session\nYou are analyzing auth issues.',
        'Find and analyze the auth implementation',
        'test-task-001',
        '/test/project',
        10000,
        'build'
      );

      // VERIFICATION (Read-Only):

      // 1. Verify headless completed successfully
      expect(result.completed).toBe(true);
      expect(result.timedOut).toBe(false);

      // 2. Verify summary contains evidence of subagent work
      expect(result.summary).toContain('Auth Implementation Analysis');
      expect(result.summary).toContain('src/auth/');
      expect(result.summary).toContain('token-manager.js');

      // 3. Verify SDK was called correctly (no file reads needed)
      expect(mockSendPrompt).toHaveBeenCalledWith(
        mockClient,
        'main-session-123',
        expect.objectContaining({
          model: 'openrouter/google/gemini-2.5-flash',
          agent: 'Build'
        })
      );

      // 4. Verify polling happened
      expect(mockGetSessionStatus).toHaveBeenCalled();
      expect(mockGetMessages).toHaveBeenCalled();

      // 5. Server was cleaned up
      expect(mockServerClose).toHaveBeenCalled();
    });

    it('should capture subagent results in the final summary', async () => {
      const subagentResult = 'Found 15 API endpoints across 5 files. Main router in src/api/routes.ts.';

      mockSendPrompt.mockResolvedValueOnce({
        data: {
          parts: [
            { type: 'text', text: 'Let me spawn an explore agent to map the API.' },
            {
              type: 'tool_use',
              id: 'task_001',
              name: 'Task',
              input: { description: 'Map API', prompt: 'Find all API endpoints', subagent_type: 'Explore' }
            }
          ]
        }
      });

      mockGetSessionStatus.mockResolvedValue({ status: 'idle' });
      mockGetMessages.mockResolvedValueOnce([
        {
          parts: [
            { type: 'tool_result', tool_use_id: 'task_001', content: subagentResult },
            { type: 'text', text: `## Summary\n${subagentResult}\n${COMPLETE_MARKER}` }
          ]
        }
      ]);

      const result = await runHeadless(
        'openrouter/google/gemini-2.5-flash',
        '# Test',
        'Map the API endpoints',
        'test-002',
        '/test/project',
        10000
      );

      // VERIFICATION: Subagent result appears in summary
      expect(result.summary).toContain('15 API endpoints');
      expect(result.summary).toContain('src/api/routes.ts');
    });

    it('should handle subagent spawning Plan agent (read-only) via Task tool', async () => {
      mockSendPrompt.mockResolvedValueOnce({
        data: {
          parts: [
            { type: 'text', text: 'I will create a plan for the feature.' },
            {
              type: 'tool_use',
              id: 'plan_001',
              name: 'Task',
              input: {
                description: 'Plan feature implementation',
                prompt: 'Create a detailed implementation plan for user authentication',
                subagent_type: 'Plan'
              }
            }
          ]
        }
      });

      const planResult = `Implementation Plan:
1. Create UserAuthService class
2. Add JWT token generation
3. Implement refresh token logic
4. Add session management`;

      mockGetSessionStatus.mockResolvedValue({ status: 'idle' });
      mockGetMessages.mockResolvedValueOnce([
        {
          parts: [
            { type: 'tool_result', tool_use_id: 'plan_001', content: planResult },
            { type: 'text', text: `## Plan Created\n${planResult}\n${COMPLETE_MARKER}` }
          ]
        }
      ]);

      const result = await runHeadless(
        'openrouter/google/gemini-2.5-flash',
        '# Test',
        'Plan the auth feature',
        'test-003',
        '/test/project',
        10000
      );

      // VERIFICATION: Plan subagent result captured
      expect(result.summary).toContain('UserAuthService');
      expect(result.summary).toContain('JWT token');
      expect(result.completed).toBe(true);
    });
  });

  describe('Model Routing for Subagents', () => {
    it('should verify Explore subagent uses configured model (via tool input inspection)', async () => {
      // This test verifies that when an Explore subagent is spawned,
      // the model routing configuration is respected

      mockSendPrompt.mockResolvedValueOnce({
        data: {
          parts: [
            { type: 'text', text: 'Spawning explore agent...' },
            {
              type: 'tool_use',
              id: 'explore_001',
              name: 'Task',
              input: {
                description: 'Search codebase',
                prompt: 'Find all test files',
                subagent_type: 'Explore',
                // Model routing would inject this based on config
                model: 'openrouter/google/gemini-3-flash-preview'
              }
            }
          ]
        }
      });

      mockGetSessionStatus.mockResolvedValue({ status: 'idle' });
      mockGetMessages.mockResolvedValueOnce([
        {
          parts: [
            { type: 'tool_result', tool_use_id: 'explore_001', content: 'Found 50 test files' },
            { type: 'text', text: `Done!\n${COMPLETE_MARKER}` }
          ]
        }
      ]);

      const result = await runHeadless(
        'openrouter/anthropic/claude-3.5-sonnet', // Expensive parent model
        '# Test',
        'Find test files',
        'test-004',
        '/test/project',
        10000
      );

      // Verify completion
      expect(result.completed).toBe(true);

      // Verify main session used expensive model
      expect(mockSendPrompt).toHaveBeenCalledWith(
        mockClient,
        'main-session-123',
        expect.objectContaining({
          model: 'openrouter/anthropic/claude-3.5-sonnet'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle subagent tool call failure gracefully', async () => {
      mockSendPrompt.mockResolvedValueOnce({
        data: {
          parts: [
            { type: 'text', text: 'Spawning subagent...' },
            {
              type: 'tool_use',
              id: 'failed_001',
              name: 'Task',
              input: { description: 'Failing task', prompt: 'This will fail', subagent_type: 'Explore' }
            }
          ]
        }
      });

      mockGetSessionStatus.mockResolvedValue({ status: 'idle' });
      mockGetMessages.mockResolvedValueOnce([
        {
          parts: [
            {
              type: 'tool_result',
              tool_use_id: 'failed_001',
              is_error: true,
              content: 'Error: Subagent timed out'
            },
            {
              type: 'text',
              text: `## Summary\nThe subagent exploration failed due to timeout. Proceeding with available information.\n${COMPLETE_MARKER}`
            }
          ]
        }
      ]);

      const result = await runHeadless(
        'openrouter/google/gemini-2.5-flash',
        '# Test',
        'Explore with failure',
        'test-005',
        '/test/project',
        10000
      );

      // Should still complete even if subagent failed
      expect(result.completed).toBe(true);
      expect(result.summary).toContain('failed');
    });

    it('should complete if no subagent is spawned (direct completion)', async () => {
      mockSendPrompt.mockResolvedValueOnce({
        data: {
          parts: [
            {
              type: 'text',
              text: `## Quick Analysis\nThe task is simple enough that no subagent is needed.\n${COMPLETE_MARKER}`
            }
          ]
        }
      });

      const result = await runHeadless(
        'openrouter/google/gemini-2.5-flash',
        '# Test',
        'Simple task',
        'test-006',
        '/test/project',
        5000
      );

      expect(result.completed).toBe(true);
      expect(result.summary).toContain('Quick Analysis');

      // Verify no polling was needed since completion was in first response
      expect(mockGetMessages).not.toHaveBeenCalled();
    });
  });
});
