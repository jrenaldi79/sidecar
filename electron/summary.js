/**
 * Summary Generation via OpenCode API
 *
 * Re-exports from the shared module at src/utils/opencode-api.js.
 * Kept for backwards compatibility with existing electron imports.
 */

const { apiRequest, requestSummaryFromModel } = require('../src/utils/opencode-api');

module.exports = { apiRequest, requestSummaryFromModel };
