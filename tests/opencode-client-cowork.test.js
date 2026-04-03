/**
 * Tests for client-aware prompt in opencode-client.js buildServerOptions()
 *
 * Tests the config-building logic directly via buildServerOptions(),
 * which is a pure function with no SDK dependency. This avoids the
 * dynamic import() limitation in Jest (requires --experimental-vm-modules).
 */

const { buildServerOptions } = require('../src/opencode-client');

describe('buildServerOptions client-aware prompt', () => {
  it('sets chat.prompt when client is cowork', () => {
    const opts = buildServerOptions({ client: 'cowork' });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent).toBeDefined();
    expect(chatAgent.prompt).toBeDefined();
    expect(typeof chatAgent.prompt).toBe('string');
    expect(chatAgent.prompt).toContain('Sidecar');
  });

  it('does NOT set chat.prompt when client is code-local', () => {
    const opts = buildServerOptions({ client: 'code-local' });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent).toBeDefined();
    expect(chatAgent.prompt).toBeUndefined();
  });

  it('does NOT set chat.prompt when client is undefined', () => {
    const opts = buildServerOptions({});
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent).toBeDefined();
    expect(chatAgent.prompt).toBeUndefined();
  });

  it('preserves existing chat agent permissions when cowork', () => {
    const opts = buildServerOptions({ client: 'cowork' });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent.permission).toEqual({
      edit: 'ask',
      bash: 'ask',
      webfetch: 'allow'
    });
    expect(chatAgent.mode).toBe('primary');
  });
});

describe('buildServerOptions systemPrompt on agent config', () => {
  it('sets systemPrompt on the target agent (chat)', () => {
    const opts = buildServerOptions({
      systemPrompt: '# SIDECAR SESSION\nYou are a sidecar agent.',
      agentName: 'chat'
    });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent.prompt).toBe('# SIDECAR SESSION\nYou are a sidecar agent.');
  });

  it('sets systemPrompt on build agent when agentName is build', () => {
    const opts = buildServerOptions({
      systemPrompt: '# SIDECAR SESSION\nBuild agent prompt.',
      agentName: 'build'
    });

    expect(opts.config.agent.build).toBeDefined();
    expect(opts.config.agent.build.prompt).toBe('# SIDECAR SESSION\nBuild agent prompt.');
  });

  it('sets systemPrompt on plan agent when agentName is plan', () => {
    const opts = buildServerOptions({
      systemPrompt: '# SIDECAR SESSION\nPlan agent prompt.',
      agentName: 'plan'
    });

    expect(opts.config.agent.plan).toBeDefined();
    expect(opts.config.agent.plan.prompt).toBe('# SIDECAR SESSION\nPlan agent prompt.');
  });

  it('defaults to chat agent when agentName is not specified', () => {
    const opts = buildServerOptions({
      systemPrompt: '# SIDECAR SESSION\nDefault agent.'
    });
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent.prompt).toBe('# SIDECAR SESSION\nDefault agent.');
  });

  it('appends systemPrompt to existing cowork prompt', () => {
    const opts = buildServerOptions({
      client: 'cowork',
      systemPrompt: '# SIDECAR SESSION\nContext here.',
      agentName: 'chat'
    });
    const chatAgent = opts.config.agent.chat;

    // Should contain both cowork prompt and system prompt
    expect(chatAgent.prompt).toContain('Sidecar');
    expect(chatAgent.prompt).toContain('# SIDECAR SESSION');
    expect(chatAgent.prompt).toContain('Context here.');
  });

  it('does not set systemPrompt when not provided', () => {
    const opts = buildServerOptions({});
    const chatAgent = opts.config.agent.chat;

    expect(chatAgent.prompt).toBeUndefined();
  });

  it('handles case-insensitive agent names', () => {
    const opts = buildServerOptions({
      systemPrompt: 'test prompt',
      agentName: 'Build'
    });

    expect(opts.config.agent.build).toBeDefined();
    expect(opts.config.agent.build.prompt).toBe('test prompt');
  });
});

describe('buildServerOptions port handling', () => {
  it('does not include port key when port is not specified', () => {
    const opts = buildServerOptions({});
    expect(opts).not.toHaveProperty('port');
  });

  it('does not include port key when port is undefined', () => {
    const opts = buildServerOptions({ port: undefined });
    expect(opts).not.toHaveProperty('port');
  });

  it('includes port when explicitly set', () => {
    const opts = buildServerOptions({ port: 8080 });
    expect(opts.port).toBe(8080);
  });

  it('does not include signal key when signal is not specified', () => {
    const opts = buildServerOptions({});
    expect(opts).not.toHaveProperty('signal');
  });
});

describe('buildServerOptions provider model sync', () => {
  it('includes provider.openrouter.models from sidecar aliases', () => {
    const opts = buildServerOptions({});
    const provider = opts.config.provider;

    expect(provider).toBeDefined();
    expect(provider.openrouter).toBeDefined();
    expect(provider.openrouter.models).toBeDefined();

    // Should include models from default aliases
    expect(provider.openrouter.models['x-ai/grok-4.1-fast']).toBeDefined();
    expect(provider.openrouter.models['anthropic/claude-opus-4.6']).toBeDefined();
  });

  it('includes provider models even when other options are set', () => {
    const opts = buildServerOptions({
      model: 'openrouter/x-ai/grok-4.1-fast',
      systemPrompt: 'test',
    });

    expect(opts.config.provider.openrouter.models).toBeDefined();
    expect(opts.config.model).toBe('openrouter/x-ai/grok-4.1-fast');
  });
});

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
});
