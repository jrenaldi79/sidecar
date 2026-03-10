/**
 * Start Command Helpers
 *
 * Model resolution and validation helpers extracted from bin/sidecar.js
 * to keep the CLI entry point under the 300-line limit.
 */

/**
 * Resolve model from args: resolve alias or config default.
 * Returns { model, alias } or calls process.exit(1) on error.
 * @param {object} args - Parsed CLI arguments
 * @returns {{ model: string, alias: string|undefined }}
 */
function resolveModelFromArgs(args) {
  const { resolveModel, loadConfig } = require('./config');
  const rawAlias = args.model;
  let model;
  try {
    model = resolveModel(args.model);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Determine the alias used (explicit or config default)
  let alias = rawAlias;
  if (alias === undefined) {
    const cfg = loadConfig();
    if (cfg && cfg.default && !cfg.default.includes('/')) {
      alias = cfg.default;
    }
  }
  return { model, alias };
}

/**
 * Validate direct-API fallback models exist on the provider (opt-in via --validate-model).
 * Returns the (possibly corrected) model string.
 * @param {object} args - Parsed CLI arguments
 * @param {string|undefined} alias - The alias used for resolution
 * @returns {Promise<string>} Validated model string
 */
async function validateFallbackModel(args, alias) {
  const { detectFallback } = require('./config');
  if (!args['validate-model'] || !alias || !detectFallback(alias, args.model)) {
    return args.model;
  }
  const { validateDirectModel } = require('./model-validator');
  try {
    return await validateDirectModel(args.model, alias, {
      headless: args['no-ui'] || !process.stdin.isTTY
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  resolveModelFromArgs,
  validateFallbackModel,
};
