const { createVMProvider } = require('../../src/vm/provider');
const { NoopProvider } = require('../../src/vm/noop');

describe('createVMProvider', () => {
  test('returns NoopProvider for linux', () => {
    const provider = createVMProvider('linux');
    expect(provider).toBeInstanceOf(NoopProvider);
  });

  test('returns NoopProvider for win32', () => {
    const provider = createVMProvider('win32');
    expect(provider).toBeInstanceOf(NoopProvider);
  });

  test('returns NoopProvider when SIDECAR_VM_DISABLED is set', () => {
    process.env.SIDECAR_VM_DISABLED = 'true';
    const provider = createVMProvider('darwin');
    expect(provider).toBeInstanceOf(NoopProvider);
    delete process.env.SIDECAR_VM_DISABLED;
  });
});
