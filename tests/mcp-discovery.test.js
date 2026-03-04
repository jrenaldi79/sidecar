/**
 * MCP Discovery Tests
 *
 * Tests for discovering MCP servers from parent LLM (Claude Code, Cowork).
 * Tests normalization of .mcp.json formats and filtering of enabled/blocked plugins.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('MCP Discovery', () => {
  let discoverParentMcps, discoverClaudeCodeMcps, discoverCoworkMcps, normalizeMcpJson;
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-discovery-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: load module fresh (after mocks are set up)
  function loadModule() {
    const mod = require('../src/utils/mcp-discovery');
    discoverParentMcps = mod.discoverParentMcps;
    discoverClaudeCodeMcps = mod.discoverClaudeCodeMcps;
    discoverCoworkMcps = mod.discoverCoworkMcps;
    normalizeMcpJson = mod.normalizeMcpJson;
  }

  describe('normalizeMcpJson', () => {
    beforeEach(() => loadModule());

    test('handles Format A (wrapped with mcpServers key)', () => {
      const raw = {
        mcpServers: {
          'my-server': { command: 'npx', args: ['my-mcp'] }
        }
      };
      const result = normalizeMcpJson(raw);
      expect(result).toEqual({
        'my-server': { command: 'npx', args: ['my-mcp'] }
      });
    });

    test('handles Format B (flat — no mcpServers wrapper)', () => {
      const raw = {
        'my-server': { command: 'npx', args: ['my-mcp'] }
      };
      const result = normalizeMcpJson(raw);
      expect(result).toEqual({
        'my-server': { command: 'npx', args: ['my-mcp'] }
      });
    });

    test('returns empty object for null input', () => {
      expect(normalizeMcpJson(null)).toEqual({});
    });

    test('returns empty object for undefined input', () => {
      expect(normalizeMcpJson(undefined)).toEqual({});
    });

    test('returns empty object for empty object', () => {
      expect(normalizeMcpJson({})).toEqual({});
    });

    test('handles Format A with empty mcpServers', () => {
      const raw = { mcpServers: {} };
      expect(normalizeMcpJson(raw)).toEqual({});
    });

    test('handles multiple servers in Format A', () => {
      const raw = {
        mcpServers: {
          server1: { command: 'cmd1' },
          server2: { command: 'cmd2' }
        }
      };
      const result = normalizeMcpJson(raw);
      expect(Object.keys(result)).toHaveLength(2);
      expect(result.server1).toBeDefined();
      expect(result.server2).toBeDefined();
    });
  });

  describe('discoverClaudeCodeMcps', () => {
    test('reads settings.json → installed_plugins.json → .mcp.json chain', () => {
      // Create fake Claude Code plugin chain
      const claudeDir = path.join(tmpDir, '.claude');
      const pluginsDir = path.join(claudeDir, 'plugins');
      const installDir = path.join(tmpDir, 'my-plugin');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(installDir, { recursive: true });

      // settings.json: plugin enabled
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'my-plugin': true } })
      );

      // installed_plugins.json: install path
      fs.writeFileSync(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'my-plugin': { installPath: installDir } } })
      );

      // .mcp.json at install path (Format B)
      fs.writeFileSync(
        path.join(installDir, '.mcp.json'),
        JSON.stringify({ 'my-mcp-server': { command: 'npx', args: ['@my/mcp'] } })
      );

      loadModule();
      const result = discoverClaudeCodeMcps(claudeDir);
      expect(result).not.toBeNull();
      expect(result['my-mcp-server']).toBeDefined();
      expect(result['my-mcp-server'].command).toBe('npx');
    });

    test('skips disabled plugins (enabledPlugins value is false)', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      const pluginsDir = path.join(claudeDir, 'plugins');
      const installDir = path.join(tmpDir, 'disabled-plugin');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(installDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'disabled-plugin': false } })
      );

      fs.writeFileSync(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'disabled-plugin': { installPath: installDir } } })
      );

      fs.writeFileSync(
        path.join(installDir, '.mcp.json'),
        JSON.stringify({ 'some-server': { command: 'npx' } })
      );

      loadModule();
      const result = discoverClaudeCodeMcps(claudeDir);
      expect(result).toBeNull();
    });

    test('skips blocklisted plugins', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      const pluginsDir = path.join(claudeDir, 'plugins');
      const installDir = path.join(tmpDir, 'blocked-plugin');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(installDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'blocked-plugin': true } })
      );

      fs.writeFileSync(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'blocked-plugin': { installPath: installDir } } })
      );

      fs.writeFileSync(
        path.join(pluginsDir, 'blocklist.json'),
        JSON.stringify(['blocked-plugin'])
      );

      fs.writeFileSync(
        path.join(installDir, '.mcp.json'),
        JSON.stringify({ 'blocked-server': { command: 'npx' } })
      );

      loadModule();
      const result = discoverClaudeCodeMcps(claudeDir);
      expect(result).toBeNull();
    });

    test('handles Format A (wrapped) .mcp.json', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      const pluginsDir = path.join(claudeDir, 'plugins');
      const installDir = path.join(tmpDir, 'fmt-a-plugin');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(installDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'fmt-a-plugin': true } })
      );

      fs.writeFileSync(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'fmt-a-plugin': { installPath: installDir } } })
      );

      // Format A: wrapped with mcpServers key
      fs.writeFileSync(
        path.join(installDir, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            'wrapped-server': { command: 'node', args: ['server.js'] }
          }
        })
      );

      loadModule();
      const result = discoverClaudeCodeMcps(claudeDir);
      expect(result).not.toBeNull();
      expect(result['wrapped-server']).toBeDefined();
    });

    test('returns null when no MCPs found', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      // No settings.json at all
      loadModule();
      const result = discoverClaudeCodeMcps(claudeDir);
      expect(result).toBeNull();
    });

    test('returns null when settings.json has no enabledPlugins', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ someOtherKey: true })
      );

      loadModule();
      const result = discoverClaudeCodeMcps(claudeDir);
      expect(result).toBeNull();
    });

    test('merges MCPs from multiple enabled plugins', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      const pluginsDir = path.join(claudeDir, 'plugins');
      const installDir1 = path.join(tmpDir, 'plugin-1');
      const installDir2 = path.join(tmpDir, 'plugin-2');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(installDir1, { recursive: true });
      fs.mkdirSync(installDir2, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({
          enabledPlugins: { 'plugin-1': true, 'plugin-2': true }
        })
      );

      fs.writeFileSync(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({
          plugins: {
            'plugin-1': { installPath: installDir1 },
            'plugin-2': { installPath: installDir2 }
          }
        })
      );

      fs.writeFileSync(
        path.join(installDir1, '.mcp.json'),
        JSON.stringify({ server1: { command: 'cmd1' } })
      );

      fs.writeFileSync(
        path.join(installDir2, '.mcp.json'),
        JSON.stringify({ server2: { command: 'cmd2' } })
      );

      loadModule();
      const result = discoverClaudeCodeMcps(claudeDir);
      expect(result).not.toBeNull();
      expect(result.server1).toBeDefined();
      expect(result.server2).toBeDefined();
    });

    test('silently skips malformed .mcp.json files', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      const pluginsDir = path.join(claudeDir, 'plugins');
      const installDir = path.join(tmpDir, 'bad-json-plugin');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(installDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'bad-json-plugin': true } })
      );

      fs.writeFileSync(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'bad-json-plugin': { installPath: installDir } } })
      );

      // Malformed JSON
      fs.writeFileSync(path.join(installDir, '.mcp.json'), '{ invalid json }');

      loadModule();
      const result = discoverClaudeCodeMcps(claudeDir);
      // Should return null — the one plugin had invalid JSON
      expect(result).toBeNull();
    });
  });

  describe('discoverCoworkMcps', () => {
    test('reads Claude desktop config', () => {
      const configDir = path.join(tmpDir, 'Claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'claude_desktop_config.json'),
        JSON.stringify({
          mcpServers: {
            'desktop-server': { command: 'npx', args: ['@desktop/mcp'] }
          }
        })
      );

      loadModule();
      const result = discoverCoworkMcps(configDir);
      expect(result).not.toBeNull();
      expect(result['desktop-server']).toBeDefined();
      expect(result['desktop-server'].command).toBe('npx');
    });

    test('returns null when config file does not exist', () => {
      loadModule();
      const result = discoverCoworkMcps(path.join(tmpDir, 'nonexistent'));
      expect(result).toBeNull();
    });

    test('returns null when config has no mcpServers', () => {
      const configDir = path.join(tmpDir, 'Claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'claude_desktop_config.json'),
        JSON.stringify({ someOtherKey: true })
      );

      loadModule();
      const result = discoverCoworkMcps(configDir);
      expect(result).toBeNull();
    });
  });

  describe('discoverParentMcps', () => {
    test('calls discoverClaudeCodeMcps for code-local client', () => {
      loadModule();
      // With no real Claude dir, should return null
      const result = discoverParentMcps('code-local');
      expect(result).toBeNull();
    });

    test('calls discoverCoworkMcps for cowork client', () => {
      loadModule();
      const result = discoverParentMcps('cowork');
      expect(result).toBeNull();
    });

    test('defaults to discoverClaudeCodeMcps when no clientType specified', () => {
      loadModule();
      const result = discoverParentMcps();
      expect(result).toBeNull();
    });

    test('returns null for unknown client type', () => {
      loadModule();
      const result = discoverParentMcps('unknown-client');
      expect(result).toBeNull();
    });
  });
});
