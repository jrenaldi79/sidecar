#!/usr/bin/env node

/**
 * Post-install script for claude-sidecar
 *
 * 1. Copies SKILL.md to ~/.claude/skills/sidecar/
 * 2. Registers MCP server in Claude Code (~/.claude.json)
 * 3. Registers MCP server in Claude Desktop/Cowork config
 * 4. Checks VM sandboxing prerequisites
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SKILL_SOURCE = path.join(__dirname, '..', 'skill', 'SKILL.md');
const SKILL_DEST_DIR = path.join(os.homedir(), '.claude', 'skills', 'sidecar');
const SKILL_DEST = path.join(SKILL_DEST_DIR, 'SKILL.md');

const MCP_CONFIG = { command: 'npx', args: ['-y', 'claude-sidecar@latest', 'mcp'] };

/**
 * Add or update an MCP server in a JSON config file.
 * Always overwrites the entry to ensure upgrades apply the latest config.
 *
 * @param {string} configPath - Path to the JSON config file
 * @param {string} name - MCP server name
 * @param {object} config - MCP server config object
 * @returns {string} 'added', 'updated', or 'unchanged'
 */
function addMcpToConfigFile(configPath, name, config) {
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  if (!existing.mcpServers) { existing.mcpServers = {}; }

  const prev = existing.mcpServers[name];
  const status = !prev ? 'added' : JSON.stringify(prev) !== JSON.stringify(config) ? 'updated' : 'unchanged';

  existing.mcpServers[name] = config;
  if (status !== 'unchanged') {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), { mode: 0o600 });
  }
  return status;
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
  const status = addMcpToConfigFile(claudeConfigPath, 'sidecar', MCP_CONFIG);
  if (status === 'added') {
    console.log('[claude-sidecar] MCP registered in Claude Code (~/.claude.json).');
  } else if (status === 'updated') {
    console.log('[claude-sidecar] MCP config updated in Claude Code (~/.claude.json).');
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
  const status = addMcpToConfigFile(configPath, 'sidecar', MCP_CONFIG);
  if (status === 'added') {
    console.log('[claude-sidecar] MCP registered in Claude Desktop.');
  } else if (status === 'updated') {
    console.log('[claude-sidecar] MCP config updated in Claude Desktop.');
  } else {
    console.log('[claude-sidecar] MCP already registered in Claude Desktop.');
  }
}

/**
 * Check VM sandboxing prerequisites and return warnings.
 * @param {object} [overrides] - Override paths for testing
 * @returns {string[]} Array of warning messages
 */
function checkVMPrerequisites(overrides = {}) {
  if (process.platform !== 'darwin') { return []; }

  const warnings = [];
  const claudeAppPath = overrides.claudeAppPath || '/Applications/Claude.app';
  const coworkImagePath = overrides.coworkImagePath || path.join(
    os.homedir(), 'Library', 'Application Support', 'Claude',
    'vm_bundles', 'claudevm.bundle', 'rootfs.img'
  );

  if (!fs.existsSync(claudeAppPath)) {
    warnings.push('Claude Desktop not found. VM sandboxing requires Claude Desktop to be installed.');
  } else if (!fs.existsSync(coworkImagePath)) {
    warnings.push('Cowork VM image not found. Enable Cowork in Claude Desktop for VM sandboxing.');
  }

  return warnings;
}

function main() {
  console.log('[claude-sidecar] Installing...');
  installSkill();
  registerClaudeCode();
  registerClaudeDesktop();

  const vmWarnings = checkVMPrerequisites();
  if (vmWarnings.length > 0) {
    console.log('');
    console.log('[claude-sidecar] VM Sandboxing:');
    for (const w of vmWarnings) {
      console.log(`  Warning: ${w}`);
    }
    console.log('  Sidecar will run without sandboxing until prerequisites are met.');
  }

  console.log('');
  console.log('[claude-sidecar] Setup:');
  console.log('  - Configure API: Run `sidecar setup` or set API keys directly');
  console.log('  - API keys: OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, etc.');
}

// Only run main when executed directly (not when required for testing)
if (require.main === module) {
  main();
}

module.exports = { addMcpToConfigFile, checkVMPrerequisites };
