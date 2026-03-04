/**
 * MCP Discovery - Discovers MCP servers from parent LLM configuration
 *
 * Supports discovering MCP servers from:
 * - Claude Code (reads plugin chain from ~/.claude/)
 * - Cowork / Claude Desktop (reads claude_desktop_config.json)
 *
 * @module utils/mcp-discovery
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./logger');

/**
 * Normalize .mcp.json to a flat { name: config } map.
 * Handles both Format A (wrapped) and Format B (flat).
 *
 * @param {object|null|undefined} raw - Raw parsed JSON from .mcp.json
 * @returns {object} Normalized server configs
 */
function normalizeMcpJson(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  // Format A: { mcpServers: { name: config } }
  if (raw.mcpServers && typeof raw.mcpServers === 'object') {
    return raw.mcpServers;
  }
  // Format B: { name: config } (flat)
  return raw;
}

/**
 * Discover MCP servers from Claude Code's plugin chain.
 *
 * Discovery chain:
 * 1. Read settings.json → enabledPlugins map (filter: value === true)
 * 2. Read installed_plugins.json → plugins map → get installPath
 * 3. Read {installPath}/.mcp.json → normalize
 * 4. Check blocklist.json → skip blocked plugins
 *
 * @param {string} [claudeDir] - Path to ~/.claude directory (for testing)
 * @returns {object|null} Merged MCP server configs, or null if none found
 */
function discoverClaudeCodeMcps(claudeDir) {
  const baseDir = claudeDir || path.join(os.homedir(), '.claude');

  // Step 1: Read enabled plugins
  let enabledPlugins;
  try {
    const settingsPath = path.join(baseDir, 'settings.json');
    if (!fs.existsSync(settingsPath)) { return null; }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    enabledPlugins = settings.enabledPlugins;
    if (!enabledPlugins || typeof enabledPlugins !== 'object') { return null; }
  } catch (err) {
    logger.debug('Failed to read Claude Code settings', { error: err.message });
    return null;
  }

  // Step 2: Read installed plugins
  let installedPlugins;
  try {
    const pluginsDir = path.join(baseDir, 'plugins');
    const installedPath = path.join(pluginsDir, 'installed_plugins.json');
    if (!fs.existsSync(installedPath)) { return null; }
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
    installedPlugins = installed.plugins || {};
  } catch (err) {
    logger.debug('Failed to read installed plugins', { error: err.message });
    return null;
  }

  // Step 4 (early): Read blocklist
  let blocklist = [];
  try {
    const blocklistPath = path.join(baseDir, 'plugins', 'blocklist.json');
    if (fs.existsSync(blocklistPath)) {
      blocklist = JSON.parse(fs.readFileSync(blocklistPath, 'utf-8'));
      if (!Array.isArray(blocklist)) { blocklist = []; }
    }
  } catch {
    // Ignore blocklist read errors
  }

  // Iterate enabled plugins and collect MCP configs
  const merged = {};
  let found = false;

  for (const [pluginName, isEnabled] of Object.entries(enabledPlugins)) {
    if (!isEnabled) { continue; }
    if (blocklist.includes(pluginName)) {
      logger.debug('Skipping blocklisted plugin', { pluginName });
      continue;
    }

    const pluginInfo = installedPlugins[pluginName];
    if (!pluginInfo || !pluginInfo.installPath) { continue; }

    // Step 3: Read .mcp.json
    try {
      const mcpPath = path.join(pluginInfo.installPath, '.mcp.json');
      if (!fs.existsSync(mcpPath)) { continue; }
      const raw = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      const servers = normalizeMcpJson(raw);

      for (const [name, config] of Object.entries(servers)) {
        merged[name] = config;
        found = true;
      }
    } catch (err) {
      logger.debug('Failed to read plugin MCP config', { pluginName, error: err.message });
    }
  }

  return found ? merged : null;
}

/**
 * Discover MCP servers from Cowork / Claude Desktop config.
 *
 * @param {string} [configDir] - Path to config directory (for testing)
 * @returns {object|null} MCP server configs, or null if none found
 */
function discoverCoworkMcps(configDir) {
  const baseDir = configDir || (
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude')
      : path.join(os.homedir(), '.config', 'Claude')
  );

  try {
    const configPath = path.join(baseDir, 'claude_desktop_config.json');
    if (!fs.existsSync(configPath)) { return null; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      return null;
    }
    return config.mcpServers;
  } catch (err) {
    logger.debug('Failed to read Cowork config', { error: err.message });
    return null;
  }
}

/**
 * Discover MCP servers from the parent LLM's configuration.
 *
 * @param {string} [clientType] - Client type: 'code-local', 'code-web', 'cowork'
 * @returns {object|null} Discovered MCP server configs, or null
 */
function discoverParentMcps(clientType) {
  if (clientType === 'cowork') {
    return discoverCoworkMcps();
  }
  if (!clientType || clientType === 'code-local' || clientType === 'code-web') {
    return discoverClaudeCodeMcps();
  }
  logger.debug('Unknown client type for MCP discovery', { clientType });
  return null;
}

module.exports = {
  discoverParentMcps,
  discoverClaudeCodeMcps,
  discoverCoworkMcps,
  normalizeMcpJson
};
