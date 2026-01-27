const path = require('path');

/**
 * Ensures that the project's node_modules/.bin directory is included in the PATH.
 * The OpenCode SDK spawns the 'opencode' command, and this ensures it can be found.
 */
function ensureNodeModulesBinInPath() {
  const nodeModulesBin = path.join(__dirname, '..', '..', 'node_modules', '.bin');
  
  if (!process.env.PATH.includes(nodeModulesBin)) {
    process.env.PATH = `${nodeModulesBin}${path.delimiter}${process.env.PATH}`;
  }
}

module.exports = {
  ensureNodeModulesBinInPath,
};
