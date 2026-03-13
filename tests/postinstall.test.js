const fs = require('fs');
const path = require('path');
const os = require('os');

const { mergeHooks } = require('../scripts/postinstall');

describe('mergeHooks', () => {
  function makeHooksConfig(commands) {
    const hooks = {};
    for (const [event, cmd] of Object.entries(commands)) {
      hooks[event] = [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] }];
    }
    return { hooks };
  }

  test('registers hooks into empty settings', () => {
    const settings = {};
    const config = makeHooksConfig({ PreToolUse: '/path/to/pre-bash.sh' });
    const count = mergeHooks(settings, config);
    expect(count).toBe(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('/path/to/pre-bash.sh');
  });

  test('skips registration when exact hook already exists', () => {
    const settings = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/path/to/pre-bash.sh' }] }],
      },
    };
    const config = makeHooksConfig({ PreToolUse: '/path/to/pre-bash.sh' });
    const count = mergeHooks(settings, config);
    expect(count).toBe(0);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  test('replaces old sidecar hook on upgrade (different path, same basename)', () => {
    const settings = {
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: '/old/claude-sidecar/hooks/pre-bash.sh' }],
        }],
      },
    };
    const config = makeHooksConfig({ PreToolUse: '/new/claude-sidecar/hooks/pre-bash.sh' });
    const count = mergeHooks(settings, config);
    expect(count).toBe(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('/new/claude-sidecar/hooks/pre-bash.sh');
  });

  test('preserves user hooks with same basename but non-sidecar path', () => {
    const settings = {
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: '/home/user/my-hooks/pre-bash.sh' }],
        }],
      },
    };
    const config = makeHooksConfig({ PreToolUse: '/lib/claude-sidecar/hooks/pre-bash.sh' });
    const count = mergeHooks(settings, config);
    expect(count).toBe(1);
    // Both user hook and sidecar hook should be present
    expect(settings.hooks.PreToolUse).toHaveLength(2);
  });

  test('returns 0 when hooksConfig has no hooks', () => {
    const settings = {};
    const count = mergeHooks(settings, { hooks: {} });
    expect(count).toBe(0);
  });

  test('replaces hook when command matches but matcher changed (upgrade)', () => {
    const settings = {
      hooks: {
        PostToolUse: [{
          matcher: 'Edit|Write',
          hooks: [{ type: 'command', command: '/path/claude-sidecar/hooks/post-tool-use.sh' }],
        }],
      },
    };
    const config = {
      hooks: {
        PostToolUse: [{
          matcher: 'Edit|Write|Bash|MultiEdit',
          hooks: [{ type: 'command', command: '/path/claude-sidecar/hooks/post-tool-use.sh' }],
        }],
      },
    };
    const count = mergeHooks(settings, config);
    expect(count).toBe(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe('Edit|Write|Bash|MultiEdit');
  });

  test('handles malformed hook entries without command property', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command' }] },
        ],
      },
    };
    const config = makeHooksConfig({ PreToolUse: '/path/claude-sidecar/hooks/pre-bash.sh' });
    // Should not throw
    const count = mergeHooks(settings, config);
    expect(count).toBe(1);
    // Malformed entry preserved, new hook appended
    expect(settings.hooks.PreToolUse).toHaveLength(2);
  });
});

describe('Postinstall MCP registration', () => {
  test('addMcpToConfigFile creates config file if it does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    addMcpToConfigFile(configPath, 'sidecar', { command: 'sidecar', args: ['mcp'] });

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.sidecar).toEqual({ command: 'sidecar', args: ['mcp'] });

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('addMcpToConfigFile preserves existing config entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { existing: { command: 'other' } },
      otherKey: 'preserved',
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    addMcpToConfigFile(configPath, 'sidecar', { command: 'sidecar', args: ['mcp'] });

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.existing).toEqual({ command: 'other' });
    expect(config.mcpServers.sidecar).toEqual({ command: 'sidecar', args: ['mcp'] });
    expect(config.otherKey).toBe('preserved');

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('addMcpToConfigFile updates existing sidecar entry with new config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const oldConfig = { command: 'sidecar', args: ['mcp'] };
    const newConfig = { command: 'npx', args: ['-y', 'claude-sidecar@latest', 'mcp'] };
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { sidecar: oldConfig },
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    const status = addMcpToConfigFile(configPath, 'sidecar', newConfig);

    expect(status).toBe('updated');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.sidecar).toEqual(newConfig);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('addMcpToConfigFile returns unchanged when config matches', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const config = { command: 'npx', args: ['-y', 'claude-sidecar@latest', 'mcp'] };
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { sidecar: config },
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    const status = addMcpToConfigFile(configPath, 'sidecar', config);

    expect(status).toBe('unchanged');

    fs.rmSync(tmpDir, { recursive: true });
  });
});
