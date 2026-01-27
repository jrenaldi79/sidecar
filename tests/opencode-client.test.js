/**
 * Tests for OpenCode SDK Client Wrapper
 *
 * Tests the SDK wrapper module that provides a clean interface
 * for interacting with the @opencode-ai/sdk.
 */

// Mock the SDK before requiring the module
const mockCreateOpencodeClient = jest.fn();
const mockCreateOpencodeServer = jest.fn();

// Mock the SDK module (used for require and dynamic import)
jest.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: mockCreateOpencodeClient,
  createOpencodeServer: mockCreateOpencodeServer,
  __esModule: true,
  default: {
    createOpencodeClient: mockCreateOpencodeClient,
    createOpencodeServer: mockCreateOpencodeServer
  }
}), { virtual: true });

// Import after mock is set up
const {
  parseModelString,
  createClient,
  sendPrompt,
  createSession,
  getMessages,
  checkHealth
} = require('../src/opencode-client');

describe('OpenCode Client Wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default mock for createOpencodeClient
    mockCreateOpencodeClient.mockReturnValue({
      session: {
        create: jest.fn(),
        prompt: jest.fn(),
        messages: jest.fn()
      },
      config: {
        get: jest.fn()
      }
    });
  });

  describe('parseModelString', () => {
    it('should parse openrouter model string with nested path', () => {
      const result = parseModelString('openrouter/google/gemini-2.5-flash');
      expect(result).toEqual({
        providerID: 'openrouter',
        modelID: 'google/gemini-2.5-flash'
      });
    });

    it('should parse simple provider/model format', () => {
      const result = parseModelString('anthropic/claude-3-5-sonnet');
      expect(result).toEqual({
        providerID: 'anthropic',
        modelID: 'claude-3-5-sonnet'
      });
    });

    it('should default to openrouter provider for model-only string', () => {
      const result = parseModelString('gemini-2.5-flash');
      expect(result).toEqual({
        providerID: 'openrouter',
        modelID: 'gemini-2.5-flash'
      });
    });

    it('should handle deeply nested model paths', () => {
      const result = parseModelString('openrouter/google/gemini-2.5-flash-preview-05-20');
      expect(result).toEqual({
        providerID: 'openrouter',
        modelID: 'google/gemini-2.5-flash-preview-05-20'
      });
    });

    it('should return object unchanged if already in SDK format', () => {
      const input = { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' };
      const result = parseModelString(input);
      expect(result).toEqual(input);
    });

    it('should handle empty string gracefully', () => {
      const result = parseModelString('');
      expect(result).toEqual({
        providerID: 'openrouter',
        modelID: ''
      });
    });
  });

  describe('createClient', () => {
    // Note: These tests are skipped because Jest cannot mock dynamic import()
    // calls without --experimental-vm-modules. The createClient function is
    // tested indirectly through integration tests and the startServer tests.
    it.skip('should create a client with the specified base URL', async () => {
      const client = await createClient('http://127.0.0.1:14440');
      expect(client).toBeDefined();
      expect(client.session).toBeDefined();
    });

    it.skip('should create a client with default URL if not specified', async () => {
      const client = await createClient();
      expect(client).toBeDefined();
    });
  });

  describe('createSession', () => {
    it('should create a session and return session ID', async () => {
      // Mock the SDK client
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            data: { id: 'test-session-123' }
          })
        }
      };

      const sessionId = await createSession(mockClient);
      expect(sessionId).toBe('test-session-123');
      expect(mockClient.session.create).toHaveBeenCalled();
    });

    it('should throw if session creation fails', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            error: { message: 'Failed to create session' }
          })
        }
      };

      await expect(createSession(mockClient)).rejects.toThrow('Failed to create session');
    });

    it('should handle nested session ID in response', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            data: { session: { id: 'nested-session-456' } }
          })
        }
      };

      const sessionId = await createSession(mockClient);
      expect(sessionId).toBe('nested-session-456');
    });
  });

  describe('sendPrompt', () => {
    it('should send prompt with model specification', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: {
              parts: [{ type: 'text', text: 'Response text' }]
            }
          })
        }
      };

      const result = await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-2.5-flash',
        parts: [{ type: 'text', text: 'Hello' }]
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          model: { providerID: 'openrouter', modelID: 'google/gemini-2.5-flash' },
          parts: [{ type: 'text', text: 'Hello' }]
        })
      });
      expect(result.data.parts[0].text).toBe('Response text');
    });

    it('should include system prompt when provided', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'anthropic/claude-3-5-sonnet',
        system: 'You are a helpful assistant',
        parts: [{ type: 'text', text: 'Hello' }]
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          system: 'You are a helpful assistant'
        })
      });
    });

    it('should include agent when provided', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'anthropic/claude-3-5-sonnet',
        parts: [{ type: 'text', text: 'Hello' }],
        agent: 'build'
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          agent: 'build'
        })
      });
    });

    it('should include tools config when provided', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'anthropic/claude-3-5-sonnet',
        parts: [{ type: 'text', text: 'Hello' }],
        tools: { Bash: true, Edit: false }
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          tools: { Bash: true, Edit: false }
        })
      });
    });

    it('should handle model as object (already parsed)', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
        parts: [{ type: 'text', text: 'Hello' }]
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' }
        })
      });
    });

    it('should include reasoning parameter when provided', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-3-pro-preview',
        parts: [{ type: 'text', text: 'Hello' }],
        reasoning: { effort: 'low' }
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: expect.objectContaining({
          reasoning: { effort: 'low' }
        })
      });
    });

    it('should support all reasoning effort levels', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      const effortLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'none'];

      for (const effort of effortLevels) {
        await sendPrompt(mockClient, 'session-123', {
          model: 'openrouter/openai/gpt-5.2',
          parts: [{ type: 'text', text: 'Test' }],
          reasoning: { effort }
        });

        expect(mockClient.session.prompt).toHaveBeenLastCalledWith({
          path: { id: 'session-123' },
          body: expect.objectContaining({
            reasoning: { effort }
          })
        });
      }
    });

    it('should not include reasoning when not provided', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-3-flash-preview',
        parts: [{ type: 'text', text: 'Hello' }]
      });

      const callBody = mockClient.session.prompt.mock.calls[0][0].body;
      expect(callBody).not.toHaveProperty('reasoning');
    });

    it('should combine reasoning with other optional parameters', async () => {
      const mockClient = {
        session: {
          prompt: jest.fn().mockResolvedValue({
            data: { parts: [] }
          })
        }
      };

      await sendPrompt(mockClient, 'session-123', {
        model: 'openrouter/google/gemini-3-pro-preview',
        parts: [{ type: 'text', text: 'Hello' }],
        system: 'You are a helpful assistant',
        agent: 'build',
        tools: { Bash: true },
        reasoning: { effort: 'high' }
      });

      expect(mockClient.session.prompt).toHaveBeenCalledWith({
        path: { id: 'session-123' },
        body: {
          model: { providerID: 'openrouter', modelID: 'google/gemini-3-pro-preview' },
          parts: [{ type: 'text', text: 'Hello' }],
          system: 'You are a helpful assistant',
          agent: 'build',
          tools: { Bash: true },
          reasoning: { effort: 'high' }
        }
      });
    });
  });

  describe('getMessages', () => {
    it('should retrieve messages for a session', async () => {
      const mockClient = {
        session: {
          messages: jest.fn().mockResolvedValue({
            data: [
              { id: 'msg-1', parts: [{ type: 'text', text: 'Hello' }] },
              { id: 'msg-2', parts: [{ type: 'text', text: 'World' }] }
            ]
          })
        }
      };

      const messages = await getMessages(mockClient, 'session-123');
      expect(messages).toHaveLength(2);
      expect(mockClient.session.messages).toHaveBeenCalledWith({
        path: { id: 'session-123' }
      });
    });

    it('should return empty array if no messages', async () => {
      const mockClient = {
        session: {
          messages: jest.fn().mockResolvedValue({
            data: []
          })
        }
      };

      const messages = await getMessages(mockClient, 'session-123');
      expect(messages).toEqual([]);
    });
  });

  describe('checkHealth', () => {
    it('should return true when server is healthy', async () => {
      const mockClient = {
        global: {
          event: jest.fn().mockResolvedValue({})
        },
        config: {
          get: jest.fn().mockResolvedValue({ data: { version: '1.0' } })
        }
      };

      const isHealthy = await checkHealth(mockClient);
      expect(isHealthy).toBe(true);
    });

    it('should return false when server is not responding', async () => {
      const mockClient = {
        config: {
          get: jest.fn().mockRejectedValue(new Error('Connection refused'))
        }
      };

      const isHealthy = await checkHealth(mockClient);
      expect(isHealthy).toBe(false);
    });
  });

  describe('createChildSession', () => {
    it('should create a child session with parent ID', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            data: { id: 'child-session-789' }
          })
        }
      };

      const { createChildSession } = require('../src/opencode-client');
      const sessionId = await createChildSession(mockClient, 'parent-session-123');

      expect(sessionId).toBe('child-session-789');
      expect(mockClient.session.create).toHaveBeenCalledWith({
        body: { parentID: 'parent-session-123' }
      });
    });

    it('should throw if child session creation fails', async () => {
      const mockClient = {
        session: {
          create: jest.fn().mockResolvedValue({
            error: { message: 'Failed to create child session' }
          })
        }
      };

      const { createChildSession } = require('../src/opencode-client');
      await expect(createChildSession(mockClient, 'parent-123'))
        .rejects.toThrow('Failed to create child session');
    });
  });

  describe('getChildren', () => {
    it('should get child sessions for a parent', async () => {
      const mockClient = {
        session: {
          children: jest.fn().mockResolvedValue({
            data: [
              { id: 'child-1', parentID: 'parent-123' },
              { id: 'child-2', parentID: 'parent-123' }
            ]
          })
        }
      };

      const { getChildren } = require('../src/opencode-client');
      const children = await getChildren(mockClient, 'parent-123');

      expect(children).toHaveLength(2);
      expect(mockClient.session.children).toHaveBeenCalledWith({
        path: { id: 'parent-123' }
      });
    });

    it('should return empty array if no children', async () => {
      const mockClient = {
        session: {
          children: jest.fn().mockResolvedValue({
            data: []
          })
        }
      };

      const { getChildren } = require('../src/opencode-client');
      const children = await getChildren(mockClient, 'parent-123');

      expect(children).toEqual([]);
    });
  });

  describe('getSessionStatus', () => {
    it('should get session status', async () => {
      const mockClient = {
        session: {
          status: jest.fn().mockResolvedValue({
            data: { status: 'completed', id: 'session-123' }
          })
        }
      };

      const { getSessionStatus } = require('../src/opencode-client');
      const status = await getSessionStatus(mockClient, 'session-123');

      expect(status).toEqual({ status: 'completed', id: 'session-123' });
      expect(mockClient.session.status).toHaveBeenCalledWith({
        path: { id: 'session-123' }
      });
    });
  });

  describe('loadMcpConfig', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    beforeEach(() => {
      jest.spyOn(fs, 'existsSync');
      jest.spyOn(fs, 'readFileSync');
    });

    afterEach(() => {
      fs.existsSync.mockRestore();
      fs.readFileSync.mockRestore();
    });

    it('should return null if no config file exists', () => {
      fs.existsSync.mockReturnValue(false);

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toBeNull();
    });

    it('should load MCP config from global opencode.json', () => {
      const globalConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      const mcpConfig = {
        'my-server': {
          type: 'local',
          command: ['npx', 'my-mcp-server'],
          enabled: true
        }
      };

      fs.existsSync.mockImplementation((p) => p === globalConfigPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: mcpConfig }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toEqual(mcpConfig);
    });

    it('should load MCP config from custom config path', () => {
      const customPath = '/custom/path/opencode.json';
      const mcpConfig = {
        'custom-server': {
          type: 'remote',
          url: 'https://mcp.example.com',
          enabled: true
        }
      };

      fs.existsSync.mockImplementation((p) => p === customPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: mcpConfig }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig(customPath);

      expect(result).toEqual(mcpConfig);
    });

    it('should return null if config has no mcp section', () => {
      const globalConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      fs.existsSync.mockImplementation((p) => p === globalConfigPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ model: 'gemini-2.5' }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toBeNull();
    });

    it('should return null if mcp section is empty', () => {
      const globalConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      fs.existsSync.mockImplementation((p) => p === globalConfigPath);
      fs.readFileSync.mockReturnValue(JSON.stringify({ mcp: {} }));

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toBeNull();
    });

    it('should handle JSON parse errors gracefully', () => {
      const globalConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      fs.existsSync.mockImplementation((p) => p === globalConfigPath);
      fs.readFileSync.mockReturnValue('invalid json {');

      const { loadMcpConfig } = require('../src/opencode-client');
      const result = loadMcpConfig();

      expect(result).toBeNull();
    });
  });

  describe('parseMcpSpec', () => {
    it('should parse remote server URL format (name=url)', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('my-server=https://mcp.example.com');

      expect(result).toEqual({
        name: 'my-server',
        config: {
          type: 'remote',
          url: 'https://mcp.example.com',
          enabled: true
        }
      });
    });

    it('should parse local server command format (name=command)', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('my-server=npx my-mcp-server');

      expect(result).toEqual({
        name: 'my-server',
        config: {
          type: 'local',
          command: ['npx', 'my-mcp-server'],
          enabled: true
        }
      });
    });

    it('should parse JSON format', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const jsonSpec = JSON.stringify({
        'custom-server': {
          type: 'local',
          command: ['node', 'server.js'],
          environment: { API_KEY: 'xxx' }
        }
      });
      const result = parseMcpSpec(jsonSpec);

      expect(result).toEqual({
        name: 'custom-server',
        config: {
          type: 'local',
          command: ['node', 'server.js'],
          environment: { API_KEY: 'xxx' }
        }
      });
    });

    it('should handle http URLs as remote', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('local-server=http://localhost:3000');

      expect(result).toEqual({
        name: 'local-server',
        config: {
          type: 'remote',
          url: 'http://localhost:3000',
          enabled: true
        }
      });
    });

    it('should return null for invalid format (no =)', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('invalid-format');

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('{invalid json');

      expect(result).toBeNull();
    });

    it('should handle empty name gracefully', () => {
      const { parseMcpSpec } = require('../src/opencode-client');
      const result = parseMcpSpec('=https://mcp.example.com');

      expect(result).toBeNull();
    });
  });
});
