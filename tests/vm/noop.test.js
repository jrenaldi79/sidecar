const { NoopProvider } = require('../../src/vm/noop');

describe('NoopProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new NoopProvider();
  });

  test('isAvailable returns true', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  test('needsProvisioning returns false', async () => {
    expect(await provider.needsProvisioning()).toBe(false);
  });

  test('boot returns noop connection with localhost', async () => {
    const conn = await provider.boot({ workspace: '/tmp/test' });
    expect(conn.host).toBe('127.0.0.1');
    expect(conn.transport).toBe('http');
  });

  test('shutdown is a no-op', async () => {
    await expect(provider.shutdown()).resolves.not.toThrow();
  });

  test('reconcileOrphans is a no-op', async () => {
    await expect(provider.reconcileOrphans()).resolves.not.toThrow();
  });
});
