/**
 * Tests for MCP App UI resource registration and port/session metadata storage.
 * Covers registerAppResource with RESOURCE_MIME_TYPE from ext-apps SDK.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('MCP App resource registration', () => {
  test('startMcpServer registers ui://sidecar/chat resource via registerAppResource', async () => {
    let registeredResources = [];
    let registeredAppTools = [];

    await jest.isolateModulesAsync(async () => {
      jest.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: class {
          constructor() {}
          registerTool() {}
          async connect() {}
        },
      }));
      jest.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: class {},
      }));

      // Mock the ext-apps dynamic import
      jest.doMock('@modelcontextprotocol/ext-apps/server', () => ({
        registerAppTool(server, name, config, handler) {
          registeredAppTools.push({ name, config, handler });
        },
        registerAppResource(server, name, uri, metadata, callback) {
          registeredResources.push({ name, uri, metadata, callback });
        },
        RESOURCE_MIME_TYPE: 'application/vnd.mcp.app+html',
      }));

      const { startMcpServer } = require('../../src/mcp-server');
      await startMcpServer();
    });

    const chatResource = registeredResources.find(r => r.uri === 'ui://sidecar/chat');
    expect(chatResource).toBeDefined();
    expect(chatResource.metadata.mimeType).toBe('application/vnd.mcp.app+html');
  });

  test('ui://sidecar/chat resource returns valid HTML', async () => {
    let registeredResources = [];

    await jest.isolateModulesAsync(async () => {
      jest.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: class {
          constructor() {}
          registerTool() {}
          async connect() {}
        },
      }));
      jest.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: class {},
      }));
      jest.doMock('@modelcontextprotocol/ext-apps/server', () => ({
        registerAppTool() {},
        registerAppResource(server, name, uri, metadata, callback) {
          registeredResources.push({ name, uri, metadata, callback });
        },
        RESOURCE_MIME_TYPE: 'application/vnd.mcp.app+html',
      }));

      const { startMcpServer } = require('../../src/mcp-server');
      await startMcpServer();
    });

    const chatResource = registeredResources.find(r => r.uri === 'ui://sidecar/chat');
    const result = await chatResource.callback();
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('ui://sidecar/chat');
    expect(result.contents[0].mimeType).toBe('application/vnd.mcp.app+html');
    expect(result.contents[0].text).toContain('<!DOCTYPE html>');
    expect(result.contents[0].text).toContain('sidecar-toolbar');
  });

  test('sidecar_start is registered via registerAppTool with _meta.ui', async () => {
    let registeredAppTools = [];

    await jest.isolateModulesAsync(async () => {
      jest.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: class {
          constructor() {}
          registerTool() {}
          async connect() {}
        },
      }));
      jest.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: class {},
      }));
      jest.doMock('@modelcontextprotocol/ext-apps/server', () => ({
        registerAppTool(server, name, config, handler) {
          registeredAppTools.push({ name, config, handler });
        },
        registerAppResource() {},
        RESOURCE_MIME_TYPE: 'application/vnd.mcp.app+html',
      }));

      const { startMcpServer } = require('../../src/mcp-server');
      await startMcpServer();
    });

    const startTool = registeredAppTools.find(t => t.name === 'sidecar_start');
    expect(startTool).toBeDefined();
    expect(startTool.config._meta.ui.resourceUri).toBe('ui://sidecar/chat');
  });
});

describe('writeSessionInfo', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-info-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes opencodePort and opencodeSessionId to existing metadata', () => {
    const { writeSessionInfo } = require('../../src/sidecar/session-utils');

    // Create initial metadata
    fs.writeFileSync(
      path.join(tmpDir, 'metadata.json'),
      JSON.stringify({ taskId: 'abc123', status: 'running' }, null, 2)
    );

    writeSessionInfo(tmpDir, '4567', 'sess-xyz');

    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'metadata.json'), 'utf-8'));
    expect(meta.taskId).toBe('abc123');
    expect(meta.status).toBe('running');
    expect(meta.opencodePort).toBe('4567');
    expect(meta.opencodeSessionId).toBe('sess-xyz');
  });

  test('is a no-op if metadata.json does not exist', () => {
    const { writeSessionInfo } = require('../../src/sidecar/session-utils');

    // Should not throw
    writeSessionInfo(tmpDir, '4567', 'sess-xyz');

    // No file created
    expect(fs.existsSync(path.join(tmpDir, 'metadata.json'))).toBe(false);
  });

  test('preserves all existing metadata fields', () => {
    const { writeSessionInfo } = require('../../src/sidecar/session-utils');

    fs.writeFileSync(
      path.join(tmpDir, 'metadata.json'),
      JSON.stringify({
        taskId: 't1', status: 'running', model: 'gemini', pid: 999,
        createdAt: '2026-01-01T00:00:00Z',
      }, null, 2)
    );

    writeSessionInfo(tmpDir, '8080', 'sid-42');

    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'metadata.json'), 'utf-8'));
    expect(meta.taskId).toBe('t1');
    expect(meta.model).toBe('gemini');
    expect(meta.pid).toBe(999);
    expect(meta.opencodePort).toBe('8080');
    expect(meta.opencodeSessionId).toBe('sid-42');
  });
});
