const fs = require('fs');
const path = require('path');
const os = require('os');

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

  test('addMcpToConfigFile does not overwrite existing sidecar entry', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-test-'));
    const configPath = path.join(tmpDir, 'claude.json');

    const existingConfig = { command: 'sidecar', args: ['mcp'], env: { CUSTOM: 'value' } };
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { sidecar: existingConfig },
    }));

    const { addMcpToConfigFile } = require('../scripts/postinstall');
    const added = addMcpToConfigFile(configPath, 'sidecar', { command: 'sidecar', args: ['mcp'] });

    expect(added).toBe(false);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.sidecar).toEqual(existingConfig);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
