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
