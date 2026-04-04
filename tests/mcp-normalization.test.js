/**
 * MCP Type Normalization Unit Tests
 *
 * Tests buildServerOptions() MCP normalization logic:
 *   stdio/Claude Desktop → local
 *   http/sse → remote (preserving extra options)
 *   already-normalized → pass through
 *   malformed entries → skip with warning
 */

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const { buildServerOptions } = require('../src/opencode-client');

describe('buildServerOptions MCP type normalization', () => {
  it('normalizes Claude Desktop format (no type) to local', () => {
    const opts = buildServerOptions({
      mcp: { myserver: { command: 'npx', args: ['-y', '@my/server'] } }
    });
    expect(opts.config.mcp.myserver).toEqual({
      type: 'local',
      enabled: true,
      command: ['npx', '-y', '@my/server']
    });
  });

  it('normalizes type: "stdio" (Claude Code internal format) to local', () => {
    const opts = buildServerOptions({
      mcp: { myserver: { type: 'stdio', command: 'node', args: ['server.js'] } }
    });
    expect(opts.config.mcp.myserver).toEqual({
      type: 'local',
      enabled: true,
      command: ['node', 'server.js']
    });
  });

  it('normalizes type: "http" to remote', () => {
    const opts = buildServerOptions({
      mcp: { remote: { type: 'http', url: 'https://example.com/mcp' } }
    });
    expect(opts.config.mcp.remote).toEqual({
      type: 'remote',
      enabled: true,
      url: 'https://example.com/mcp'
    });
  });

  it('normalizes type: "sse" to remote', () => {
    const opts = buildServerOptions({
      mcp: { remote: { type: 'sse', url: 'https://example.com/sse' } }
    });
    expect(opts.config.mcp.remote).toEqual({
      type: 'remote',
      enabled: true,
      url: 'https://example.com/sse'
    });
  });

  it('passes through already-normalized local config unchanged', () => {
    const already = { type: 'local', enabled: true, command: ['node', 'srv.js'] };
    const opts = buildServerOptions({ mcp: { s: already } });
    expect(opts.config.mcp.s).toEqual(already);
  });

  it('passes through already-normalized remote config unchanged', () => {
    const already = { type: 'remote', enabled: true, url: 'https://example.com' };
    const opts = buildServerOptions({ mcp: { s: already } });
    expect(opts.config.mcp.s).toEqual(already);
  });

  it('handles multiple servers with mixed input formats', () => {
    const opts = buildServerOptions({
      mcp: {
        desktop: { command: 'npx', args: ['-y', '@pkg/mcp'] },
        codeMcp: { type: 'stdio', command: 'node', args: ['s.js'] },
        httpRemote: { type: 'http', url: 'https://api.example.com/mcp' },
        sseRemote: { type: 'sse', url: 'https://api.example.com/sse' },
      }
    });
    expect(opts.config.mcp.desktop.type).toBe('local');
    expect(opts.config.mcp.codeMcp.type).toBe('local');
    expect(opts.config.mcp.httpRemote.type).toBe('remote');
    expect(opts.config.mcp.sseRemote.type).toBe('remote');
  });

  it('handles stdio server with no args', () => {
    const opts = buildServerOptions({
      mcp: { minimal: { type: 'stdio', command: '/usr/bin/mcp-server' } }
    });
    expect(opts.config.mcp.minimal).toEqual({
      type: 'local',
      enabled: true,
      command: ['/usr/bin/mcp-server']
    });
  });

  it('skips type:stdio server with no command', () => {
    const opts = buildServerOptions({
      mcp: {
        bad: { type: 'stdio' },
        good: { type: 'stdio', command: 'node', args: ['s.js'] }
      }
    });
    expect(opts.config.mcp.bad).toBeUndefined();
    expect(opts.config.mcp.good).toBeDefined();
  });

  it('skips type:http server with no url', () => {
    const opts = buildServerOptions({
      mcp: {
        bad: { type: 'http' },
        good: { type: 'http', url: 'https://example.com/mcp' }
      }
    });
    expect(opts.config.mcp.bad).toBeUndefined();
    expect(opts.config.mcp.good).toBeDefined();
  });

  it('skips type:sse server with no url', () => {
    const opts = buildServerOptions({
      mcp: { bad: { type: 'sse' } }
    });
    expect(opts.config.mcp.bad).toBeUndefined();
  });

  it('preserves extra remote options during http/sse normalization', () => {
    const opts = buildServerOptions({
      mcp: {
        authed: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: { Authorization: 'Bearer tok' },
          timeout: 30
        }
      }
    });
    expect(opts.config.mcp.authed).toEqual({
      type: 'remote',
      enabled: true,
      url: 'https://api.example.com/mcp',
      headers: { Authorization: 'Bearer tok' },
      timeout: 30
    });
  });

  it('preserves explicit enabled:false during http/sse normalization', () => {
    const opts = buildServerOptions({
      mcp: {
        disabled: {
          type: 'sse',
          url: 'https://example.com/sse',
          enabled: false
        }
      }
    });
    expect(opts.config.mcp.disabled.enabled).toBe(false);
    expect(opts.config.mcp.disabled.type).toBe('remote');
  });

  it('passes through unknown types with a warning', () => {
    const { logger } = require('../src/utils/logger');
    const opts = buildServerOptions({
      mcp: {
        exotic: { type: 'grpc', url: 'grpc://localhost:50051' }
      }
    });
    // Unknown type passes through unchanged
    expect(opts.config.mcp.exotic).toEqual({
      type: 'grpc',
      url: 'grpc://localhost:50051'
    });
    // Warning logged for unrecognized type
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognized type "grpc"')
    );
  });
});
