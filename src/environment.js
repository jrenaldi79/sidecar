/**
 * Environment Detection Module
 *
 * Detects the client type (code-local, code-web, cowork), determines
 * display availability, and resolves the session root directory based
 * on platform and CLI arguments.
 */

const path = require('path');
const os = require('os');
const { logger } = require('./utils/logger');

/**
 * Valid client types for the --client flag
 * @type {string[]}
 */
const VALID_CLIENTS = ['code-local', 'code-web', 'cowork', 'mcp-app'];

/**
 * Infer the client type from args and platform
 *
 * @param {object} args - Parsed CLI arguments
 * @param {string} [args.client] - Explicit client type
 * @param {string} platform - OS platform (e.g., 'darwin', 'linux', 'win32')
 * @returns {string} The inferred client type
 * @throws {Error} If args.client is provided but not a valid value
 */
function inferClient(args, platform) {
  if (args.client) {
    if (!VALID_CLIENTS.includes(args.client)) {
      throw new Error(
        `Invalid client '${args.client}'. Valid values: ${VALID_CLIENTS.join(', ')}`
      );
    }
    logger.debug('Using explicit client', { client: args.client });
    return args.client;
  }

  if (platform === 'darwin') {
    logger.debug('Detected code-local on macOS');
    return 'code-local';
  }

  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    logger.debug('Detected code-local via display env var', {
      DISPLAY: process.env.DISPLAY || null,
      WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || null
    });
    return 'code-local';
  }

  logger.debug('No display detected, defaulting to code-web', { platform });
  return 'code-web';
}

/**
 * Encode a filesystem path for use as a directory name.
 * Replaces /, \, and _ with dashes.
 *
 * @param {string} cwdPath - The working directory path
 * @returns {string} Encoded path safe for directory names
 */
function encodePath(cwdPath) {
  return cwdPath.replace(/[/\\_]/g, '-');
}

/**
 * Resolve the cowork local-agent-mode-sessions root for the given platform.
 * Cowork stores session audit logs inside Claude Desktop's Application Support
 * under local-agent-mode-sessions/<org>/<user>/local_<id>/audit.jsonl.
 *
 * @param {string} platform - OS platform
 * @returns {string} Cowork session root directory
 */
function getCoworkRoot(platform) {
  const homedir = os.homedir();

  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
  }

  if (platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    return path.join(appdata, 'Claude', 'local-agent-mode-sessions');
  }

  // Linux and other Unix-like systems
  return path.join(homedir, '.config', 'Claude', 'local-agent-mode-sessions');
}

/**
 * Get the session root directory based on client type and platform
 *
 * @param {object} args - Parsed CLI arguments
 * @param {string} [args.sessionDir] - Explicit session directory
 * @param {string} args.client - Client type (code-local, code-web, cowork)
 * @param {string} [args.cwd] - Working directory (defaults to process.cwd())
 * @param {string} platform - OS platform
 * @returns {string} Resolved session root directory path
 * @throws {Error} If client is code-web and --session-dir is not provided
 */
function getSessionRoot(args, platform) {
  if (args.sessionDir) {
    logger.debug('Using explicit session directory', { sessionDir: args.sessionDir });
    return args.sessionDir;
  }

  const { client } = args;

  if (client === 'code-local') {
    const cwd = args.cwd || process.cwd();
    const encodedPath = encodePath(cwd);
    const sessionRoot = path.join(os.homedir(), '.claude', 'projects', encodedPath);
    logger.debug('Resolved code-local session root', { cwd, sessionRoot });
    return sessionRoot;
  }

  if (client === 'code-web') {
    throw new Error('--session-dir is required when --client is code-web');
  }

  if (client === 'cowork' || client === 'mcp-app') {
    const sessionRoot = getCoworkRoot(platform);
    logger.debug('Resolved cowork session root', { platform, sessionRoot });
    return sessionRoot;
  }

  throw new Error(`Unknown client type: ${client}`);
}

/**
 * Detect the full environment configuration
 *
 * @param {object} args - Parsed CLI arguments
 * @param {string} [args.client] - Explicit client type
 * @param {string} [args.sessionDir] - Explicit session directory
 * @param {string} [args.cwd] - Working directory
 * @param {string} platform - OS platform
 * @returns {{ client: string, hasDisplay: boolean, sessionRoot: string }}
 */
function detectEnvironment(args, platform) {
  const client = inferClient(args, platform);
  const hasDisplay = client !== 'code-web';
  const resolvedArgs = { ...args, client };
  const sessionRoot = getSessionRoot(resolvedArgs, platform);

  logger.info('Environment detected', { client, hasDisplay, sessionRoot });

  return { client, hasDisplay, sessionRoot };
}

module.exports = {
  inferClient,
  getSessionRoot,
  detectEnvironment,
  VALID_CLIENTS
};
