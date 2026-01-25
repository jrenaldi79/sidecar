#!/usr/bin/env node

/**
 * Post-install script for claude-sidecar
 * 
 * Copies the SKILL.md to the user's Claude Code skills directory
 * so Claude Code automatically learns how to use sidecars.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_SOURCE = path.join(__dirname, '..', 'skill', 'SKILL.md');
const SKILL_DEST_DIR = path.join(os.homedir(), '.claude', 'skills', 'sidecar');
const SKILL_DEST = path.join(SKILL_DEST_DIR, 'SKILL.md');

function main() {
  console.log('[claude-sidecar] Installing skill...');
  
  try {
    // Create skills directory if it doesn't exist
    fs.mkdirSync(SKILL_DEST_DIR, { recursive: true });
    
    // Copy skill file
    fs.copyFileSync(SKILL_SOURCE, SKILL_DEST);
    
    console.log('[claude-sidecar] ✓ Skill installed to ~/.claude/skills/sidecar/');
    console.log('[claude-sidecar] Claude Code will now know how to use sidecars.');
    console.log('');
    console.log('[claude-sidecar] Quick start:');
    console.log('  sidecar start --model google/gemini-2.5-pro --briefing "Your task"');
    console.log('');
    console.log('[claude-sidecar] Prerequisites:');
    console.log('  - OpenCode CLI: npm install -g opencode');
    console.log('  - Configure API keys for your chosen models');
    
  } catch (err) {
    console.error('[claude-sidecar] Warning: Could not install skill automatically.');
    console.error('[claude-sidecar] You can manually copy SKILL.md to ~/.claude/skills/sidecar/');
    console.error(`[claude-sidecar] Error: ${err.message}`);
  }
}

main();
