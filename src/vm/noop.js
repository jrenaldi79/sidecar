'use strict';

const { VMProvider } = require('./provider');

/**
 * No-op VM provider. Runs everything locally (current unsandboxed behavior).
 * Used as fallback when VM sandboxing is unavailable.
 */
class NoopProvider extends VMProvider {
  async isAvailable() { return true; }
  async needsProvisioning() { return false; }
  async provision() { /* no-op */ }

  async boot({ workspace } = {}) {
    return {
      host: '127.0.0.1',
      transport: 'http',
      workspace: workspace || process.cwd(),
    };
  }

  async shutdown() { /* no-op */ }
  async reconcileOrphans() { /* no-op */ }
}

module.exports = { NoopProvider };
