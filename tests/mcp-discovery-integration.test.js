/**
 * MCP Discovery + buildMcpConfig Integration Tests
 *
 * End-to-end tests that verify MCP discovery works with real filesystem
 * operations: creating plugin chains, config files, and verifying
 * discovery + merge + exclusion across the full stack.
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

// Mock opencode-client to avoid requiring the actual SDK
jest.mock('../src/opencode-client', () => ({
  loadMcpConfig: jest.fn(),
  parseMcpSpec: jest.fn()
}));

describe('MCP Discovery Integration', () => {
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-disc-integ-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Claude Code plugin chain (end-to-end)', () => {
    /**
     * Creates a complete Claude Code plugin chain on disk:
     * claudeDir/settings.json → plugins/installed_plugins.json → installPath/.mcp.json
     */
    function createPluginChain(claudeDir, plugins) {
      const pluginsDir = path.join(claudeDir, 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });

      const enabledPlugins = {};
      const installedPlugins = {};

      for (const plugin of plugins) {
        enabledPlugins[plugin.name] = plugin.enabled !== false;

        const installDir = path.join(tmpDir, 'installs', plugin.name);
        fs.mkdirSync(installDir, { recursive: true });
        installedPlugins[plugin.name] = { installPath: installDir };

        if (plugin.mcpJson) {
          fs.writeFileSync(
            path.join(installDir, '.mcp.json'),
            JSON.stringify(plugin.mcpJson)
          );
        }
      }

      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins })
      );

      fs.writeFileSync(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: installedPlugins })
      );

      if (plugins.some(p => p.blocked)) {
        fs.writeFileSync(
          path.join(pluginsDir, 'blocklist.json'),
          JSON.stringify(plugins.filter(p => p.blocked).map(p => p.name))
        );
      }
    }

    test('discovers single plugin with Format B (flat) .mcp.json', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      createPluginChain(claudeDir, [{
        name: 'my-plugin',
        mcpJson: { 'my-server': { command: 'npx', args: ['@my/mcp'] } }
      }]);

      const { discoverClaudeCodeMcps } = require('../src/utils/mcp-discovery');
      const result = discoverClaudeCodeMcps(claudeDir);

      expect(result).not.toBeNull();
      expect(result['my-server']).toBeDefined();
      expect(result['my-server'].command).toBe('npx');
      expect(result['my-server'].args).toEqual(['@my/mcp']);
    });

    test('discovers single plugin with Format A (wrapped) .mcp.json', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      createPluginChain(claudeDir, [{
        name: 'wrapped-plugin',
        mcpJson: {
          mcpServers: {
            'wrapped-server': { command: 'node', args: ['server.js'] }
          }
        }
      }]);

      const { discoverClaudeCodeMcps } = require('../src/utils/mcp-discovery');
      const result = discoverClaudeCodeMcps(claudeDir);

      expect(result).not.toBeNull();
      expect(result['wrapped-server']).toBeDefined();
      expect(result['wrapped-server'].command).toBe('node');
    });

    test('merges servers from multiple enabled plugins', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      createPluginChain(claudeDir, [
        {
          name: 'plugin-a',
          mcpJson: { 'server-a': { command: 'cmd-a' } }
        },
        {
          name: 'plugin-b',
          mcpJson: { 'server-b': { command: 'cmd-b' } }
        },
        {
          name: 'plugin-c',
          mcpJson: {
            mcpServers: { 'server-c': { command: 'cmd-c' } }
          }
        }
      ]);

      const { discoverClaudeCodeMcps } = require('../src/utils/mcp-discovery');
      const result = discoverClaudeCodeMcps(claudeDir);

      expect(result).not.toBeNull();
      expect(Object.keys(result)).toHaveLength(3);
      expect(result['server-a'].command).toBe('cmd-a');
      expect(result['server-b'].command).toBe('cmd-b');
      expect(result['server-c'].command).toBe('cmd-c');
    });

    test('skips disabled plugins entirely', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      createPluginChain(claudeDir, [
        {
          name: 'enabled-plugin',
          mcpJson: { 'enabled-server': { command: 'cmd1' } }
        },
        {
          name: 'disabled-plugin',
          enabled: false,
          mcpJson: { 'disabled-server': { command: 'cmd2' } }
        }
      ]);

      const { discoverClaudeCodeMcps } = require('../src/utils/mcp-discovery');
      const result = discoverClaudeCodeMcps(claudeDir);

      expect(result).not.toBeNull();
      expect(result['enabled-server']).toBeDefined();
      expect(result['disabled-server']).toBeUndefined();
    });

    test('skips blocklisted plugins', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      createPluginChain(claudeDir, [
        {
          name: 'good-plugin',
          mcpJson: { 'good-server': { command: 'cmd1' } }
        },
        {
          name: 'bad-plugin',
          blocked: true,
          mcpJson: { 'bad-server': { command: 'cmd2' } }
        }
      ]);

      const { discoverClaudeCodeMcps } = require('../src/utils/mcp-discovery');
      const result = discoverClaudeCodeMcps(claudeDir);

      expect(result).not.toBeNull();
      expect(result['good-server']).toBeDefined();
      expect(result['bad-server']).toBeUndefined();
    });

    test('handles plugin with no .mcp.json gracefully', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      createPluginChain(claudeDir, [
        {
          name: 'no-mcp-plugin'
          // no mcpJson property → no .mcp.json file created
        },
        {
          name: 'has-mcp-plugin',
          mcpJson: { 'real-server': { command: 'cmd1' } }
        }
      ]);

      const { discoverClaudeCodeMcps } = require('../src/utils/mcp-discovery');
      const result = discoverClaudeCodeMcps(claudeDir);

      expect(result).not.toBeNull();
      expect(result['real-server']).toBeDefined();
    });

    test('returns null when no plugins are enabled', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      createPluginChain(claudeDir, [
        {
          name: 'disabled-only',
          enabled: false,
          mcpJson: { 'server': { command: 'cmd' } }
        }
      ]);

      const { discoverClaudeCodeMcps } = require('../src/utils/mcp-discovery');
      const result = discoverClaudeCodeMcps(claudeDir);
      expect(result).toBeNull();
    });
  });

  describe('Cowork discovery (end-to-end)', () => {
    test('discovers servers from claude_desktop_config.json', () => {
      const configDir = path.join(tmpDir, 'Claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'claude_desktop_config.json'),
        JSON.stringify({
          mcpServers: {
            'desktop-server': { command: 'npx', args: ['@desktop/mcp'] },
            'another-server': { command: 'node', args: ['server.js'] }
          }
        })
      );

      const { discoverCoworkMcps } = require('../src/utils/mcp-discovery');
      const result = discoverCoworkMcps(configDir);

      expect(result).not.toBeNull();
      expect(Object.keys(result)).toHaveLength(2);
      expect(result['desktop-server'].command).toBe('npx');
      expect(result['another-server'].command).toBe('node');
    });

    test('returns null when config has empty mcpServers', () => {
      const configDir = path.join(tmpDir, 'Claude');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'claude_desktop_config.json'),
        JSON.stringify({ mcpServers: {} })
      );

      const { discoverCoworkMcps } = require('../src/utils/mcp-discovery');
      const result = discoverCoworkMcps(configDir);
      expect(result).toBeNull();
    });
  });

  describe('buildMcpConfig integration', () => {
    let buildMcpConfig;

    beforeEach(() => {
      jest.resetModules();

      // Re-mock after resetModules
      jest.mock('../src/utils/logger', () => ({
        logger: {
          info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
        }
      }));
    });

    test('discovery + file config merge (file overrides discovered)', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      const pluginsDir = path.join(claudeDir, 'plugins');
      const installDir = path.join(tmpDir, 'installs', 'test-plugin');
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.mkdirSync(installDir, { recursive: true });

      fs.writeFileSync(path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'test-plugin': true } }));
      fs.writeFileSync(path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'test-plugin': { installPath: installDir } } }));
      fs.writeFileSync(path.join(installDir, '.mcp.json'),
        JSON.stringify({ 'discovered-server': { command: 'discovered-cmd' } }));

      // Mock discoverParentMcps to use our test directory
      jest.mock('../src/utils/mcp-discovery', () => ({
        discoverParentMcps: () => ({ 'discovered-server': { command: 'discovered-cmd' } })
      }));

      // Mock loadMcpConfig to return file config that overrides discovered
      jest.mock('../src/opencode-client', () => ({
        loadMcpConfig: () => ({
          'discovered-server': { command: 'file-override-cmd' },
          'file-only-server': { command: 'file-cmd' }
        }),
        parseMcpSpec: jest.fn()
      }));

      buildMcpConfig = require('../src/sidecar/start').buildMcpConfig;
      const result = buildMcpConfig({});

      expect(result).not.toBeNull();
      // File config overrides discovered for same-name server
      expect(result['discovered-server'].command).toBe('file-override-cmd');
      // File-only server is included
      expect(result['file-only-server'].command).toBe('file-cmd');
    });

    test('CLI --mcp overrides all other sources', () => {
      jest.mock('../src/utils/mcp-discovery', () => ({
        discoverParentMcps: () => ({ 'shared-name': { command: 'discovered' } })
      }));

      jest.mock('../src/opencode-client', () => ({
        loadMcpConfig: () => ({ 'shared-name': { command: 'from-file' } }),
        parseMcpSpec: (spec) => {
          if (spec === 'shared-name=cli-cmd') {
            return { name: 'shared-name', config: { command: 'cli-cmd' } };
          }
          return null;
        }
      }));

      buildMcpConfig = require('../src/sidecar/start').buildMcpConfig;
      const result = buildMcpConfig({ mcp: 'shared-name=cli-cmd' });

      expect(result).not.toBeNull();
      // CLI --mcp wins over discovered and file config
      expect(result['shared-name'].command).toBe('cli-cmd');
    });

    test('--no-mcp skips discovery but keeps file and CLI sources', () => {
      jest.mock('../src/utils/mcp-discovery', () => ({
        discoverParentMcps: jest.fn(() => ({ 'should-not-appear': { command: 'disc' } }))
      }));

      const mockLoadMcpConfig = jest.fn(() => ({
        'file-server': { command: 'file-cmd' }
      }));
      jest.mock('../src/opencode-client', () => ({
        loadMcpConfig: mockLoadMcpConfig,
        parseMcpSpec: jest.fn()
      }));

      const { discoverParentMcps } = require('../src/utils/mcp-discovery');
      buildMcpConfig = require('../src/sidecar/start').buildMcpConfig;

      const result = buildMcpConfig({ noMcp: true });

      // Discovery should NOT have been called
      expect(discoverParentMcps).not.toHaveBeenCalled();
      // File config should still be present
      expect(result).not.toBeNull();
      expect(result['file-server']).toBeDefined();
      // Discovered server should NOT be present
      expect(result['should-not-appear']).toBeUndefined();
    });

    test('--exclude-mcp removes specific servers from final result', () => {
      jest.mock('../src/utils/mcp-discovery', () => ({
        discoverParentMcps: () => ({
          'keep-me': { command: 'keep' },
          'remove-me': { command: 'remove' },
          'also-remove': { command: 'remove2' }
        })
      }));

      jest.mock('../src/opencode-client', () => ({
        loadMcpConfig: () => null,
        parseMcpSpec: jest.fn()
      }));

      buildMcpConfig = require('../src/sidecar/start').buildMcpConfig;
      const result = buildMcpConfig({
        excludeMcp: ['remove-me', 'also-remove']
      });

      expect(result).not.toBeNull();
      expect(result['keep-me']).toBeDefined();
      expect(result['remove-me']).toBeUndefined();
      expect(result['also-remove']).toBeUndefined();
    });

    test('excluding all servers returns null', () => {
      jest.mock('../src/utils/mcp-discovery', () => ({
        discoverParentMcps: () => ({
          'only-server': { command: 'cmd' }
        })
      }));

      jest.mock('../src/opencode-client', () => ({
        loadMcpConfig: () => null,
        parseMcpSpec: jest.fn()
      }));

      buildMcpConfig = require('../src/sidecar/start').buildMcpConfig;
      const result = buildMcpConfig({ excludeMcp: ['only-server'] });

      expect(result).toBeNull();
    });
  });

  describe('CLI parsing integration', () => {
    let parseArgs;

    beforeEach(() => {
      jest.resetModules();
      jest.mock('../src/utils/logger', () => ({
        logger: {
          info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
        }
      }));
      parseArgs = require('../src/cli').parseArgs;
    });

    test('--no-mcp + --exclude-mcp parsed together', () => {
      const args = parseArgs([
        'start', '--prompt', 'test',
        '--no-mcp', '--exclude-mcp', 'context7', '--exclude-mcp', 'slack'
      ]);

      expect(args['no-mcp']).toBe(true);
      expect(args['exclude-mcp']).toEqual(['context7', 'slack']);
      expect(args._[0]).toBe('start');
      expect(args.prompt).toBe('test');
    });

    test('abort command is parsed as positional', () => {
      const args = parseArgs(['abort', 'task-abc-123']);

      expect(args._[0]).toBe('abort');
      expect(args._[1]).toBe('task-abc-123');
    });

    test('abort with --cwd option', () => {
      const args = parseArgs(['abort', 'task-xyz', '--cwd', '/some/project']);

      expect(args._[0]).toBe('abort');
      expect(args._[1]).toBe('task-xyz');
      expect(args.cwd).toBe('/some/project');
    });

    test('--exclude-mcp with no value does not consume next flag', () => {
      const args = parseArgs([
        'start', '--prompt', 'test', '--exclude-mcp', '--no-ui'
      ]);

      // --exclude-mcp followed by --no-ui should NOT consume --no-ui as the value
      // The parser falls through and sets --exclude-mcp as a boolean true
      expect(Array.isArray(args['exclude-mcp'])).toBe(false);
      expect(args['no-ui']).toBe(true);
    });
  });
});
