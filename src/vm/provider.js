'use strict';

/**
 * Abstract VM provider interface.
 * All providers must implement these methods.
 */
class VMProvider {
  async isAvailable() { throw new Error('Not implemented'); }
  async needsProvisioning() { throw new Error('Not implemented'); }
  async provision() { throw new Error('Not implemented'); }
  async boot(_options) { throw new Error('Not implemented'); }
  async shutdown() { throw new Error('Not implemented'); }
  async reconcileOrphans() { throw new Error('Not implemented'); }
}

/**
 * Create the appropriate VM provider for the current platform.
 * Falls back to NoopProvider if sandboxing is unavailable.
 *
 * @param {string} [platform=process.platform] - Override platform for testing
 * @returns {VMProvider}
 */
function createVMProvider(platform = process.platform) {
  if (platform === 'darwin' && !process.env.SIDECAR_VM_DISABLED) {
    try {
      const { MacOSProvider } = require('./macos-vz');
      return new MacOSProvider();
    } catch {
      // macos-vz not available, fall through to noop
    }
  }
  const { NoopProvider } = require('./noop');
  return new NoopProvider();
}

module.exports = { VMProvider, createVMProvider };
