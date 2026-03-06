#!/usr/bin/env node

/**
 * Post-install script for claude-sidecar
 *
 * 1. Copies SKILL.md to ~/.claude/skills/sidecar/
 * 2. Registers MCP server in Claude Code (~/.claude.json)
 * 3. Registers MCP server in Claude Desktop/Cowork config
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SKILL_SOURCE = path.join(__dirname, '..', 'skill', 'SKILL.md');
const SKILL_DEST_DIR = path.join(os.homedir(), '.claude', 'skills', 'sidecar');
const SKILL_DEST = path.join(SKILL_DEST_DIR, 'SKILL.md');

const MCP_CONFIG = { command: 'sidecar', args: ['mcp'] };

/**
 * Add an MCP server to a JSON config file.
 * Does NOT overwrite an existing entry with the same name.
 *
 * @param {string} configPath - Path to the JSON config file
 * @param {string} name - MCP server name
 * @param {object} config - MCP server config object
 * @returns {boolean} true if added, false if already existed
 */
function addMcpToConfigFile(configPath, name, config) {
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  if (!existing.mcpServers) { existing.mcpServers = {}; }
  if (existing.mcpServers[name]) { return false; }

  existing.mcpServers[name] = config;
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
  return true;
}

/** Install skill file to ~/.claude/skills/sidecar/ */
function installSkill() {
  try {
    fs.mkdirSync(SKILL_DEST_DIR, { recursive: true });
    fs.copyFileSync(SKILL_SOURCE, SKILL_DEST);
    console.log('[claude-sidecar] Skill installed to ~/.claude/skills/sidecar/');
  } catch (err) {
    console.error(`[claude-sidecar] Warning: Could not install skill: ${err.message}`);
  }
}

/** Register MCP server in Claude Code config */
function registerClaudeCode() {
  // Try the CLI first
  try {
    const mcpJson = JSON.stringify(MCP_CONFIG);
    execFileSync('claude', ['mcp', 'add-json', 'sidecar', mcpJson, '--scope', 'user'], {
      stdio: 'pipe',
      timeout: 10000,
    });
    console.log('[claude-sidecar] MCP registered in Claude Code (via CLI).');
    return;
  } catch {
    // CLI not available or failed — fall back to file edit
  }

  // Fallback: direct file edit
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  const added = addMcpToConfigFile(claudeConfigPath, 'sidecar', MCP_CONFIG);
  if (added) {
    console.log('[claude-sidecar] MCP registered in Claude Code (~/.claude.json).');
  } else {
    console.log('[claude-sidecar] MCP already registered in Claude Code.');
  }
}

/** Register MCP server in Claude Desktop / Cowork config */
function registerClaudeDesktop() {
  let configDir;
  if (process.platform === 'darwin') {
    configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
  } else if (process.platform === 'win32') {
    configDir = path.join(process.env.APPDATA || '', 'Claude');
  } else {
    configDir = path.join(os.homedir(), '.config', 'claude');
  }

  const configPath = path.join(configDir, 'claude_desktop_config.json');
  const added = addMcpToConfigFile(configPath, 'sidecar', MCP_CONFIG);
  if (added) {
    console.log('[claude-sidecar] MCP registered in Claude Desktop.');
  } else {
    console.log('[claude-sidecar] MCP already registered in Claude Desktop.');
  }
}

function main() {
  console.log('[claude-sidecar] Installing...');
  installSkill();
  registerClaudeCode();
  registerClaudeDesktop();

  console.log('');
  console.log('[claude-sidecar] Setup:');
  console.log('  - Configure API: Run `sidecar setup` or set API keys directly');
  console.log('  - API keys: OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, etc.');
}

// Only run main when executed directly (not when required for testing)
if (require.main === module) {
  main();
}

module.exports = { addMcpToConfigFile };
