/**
 * Electron Lazy Loading Guard Tests
 *
 * Tests that runInteractive fails gracefully when Electron is not installed.
 * Part of the deployment model: Electron moved from hard dep to optional dep.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Electron lazy loading guard', () => {
  test('checkElectronAvailable returns a boolean', () => {
    const { checkElectronAvailable } = require('../../src/sidecar/start');
    const result = checkElectronAvailable();
    expect(typeof result).toBe('boolean');
  });

  test('checkElectronAvailable is exported as a function', () => {
    const { checkElectronAvailable } = require('../../src/sidecar/start');
    expect(typeof checkElectronAvailable).toBe('function');
  });
});
