#!/usr/bin/env node

/**
 * sync-agent-docs.js
 *
 * Syncs agent documentation files from the primary CLAUDE.md to other agent formats.
 *
 * Primary source: CLAUDE.md
 * Synced targets:
 *   - GEMINI.md (for Gemini/Google AI)
 *   - AGENTS.md (generic agent instructions)
 *
 * Usage:
 *   node scripts/sync-agent-docs.js
 *
 * The script replaces the title line and updates any self-references in the content.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const PRIMARY_FILE = 'CLAUDE.md';
const SYNC_TARGETS = [
  {
    filename: 'GEMINI.md',
    titleReplacement: '# GEMINI.md',
    agentName: 'Gemini',
    description: 'Gemini AI instructions (synced from CLAUDE.md)',
  },
  {
    filename: 'AGENTS.md',
    titleReplacement: '# AGENTS.md',
    agentName: 'AI agents',
    description: 'Generic agent instructions (synced from CLAUDE.md)',
  },
];

/**
 * Transform content for a specific target agent.
 * @param {string} content - Original CLAUDE.md content
 * @param {object} target - Target configuration
 * @returns {string} - Transformed content
 */
function transformContent(content, target) {
  let transformed = content;

  // Replace the title line (first line)
  transformed = transformed.replace(/^# CLAUDE\.md/, target.titleReplacement);

  // Replace "Claude Code" references with generic term where appropriate
  // Keep specific tool references intact, but update guidance text
  if (target.filename === 'AGENTS.md') {
    transformed = transformed.replace(
      /This file provides guidance to Claude Code when working with code in this repository\./,
      'This file provides guidance to AI agents when working with code in this repository.'
    );
  } else if (target.filename === 'GEMINI.md') {
    transformed = transformed.replace(
      /This file provides guidance to Claude Code when working with code in this repository\./,
      'This file provides guidance to Gemini when working with code in this repository.'
    );
  }

  // Add sync notice at the top (after the title)
  const syncNotice = `\n<!-- AUTO-SYNCED from CLAUDE.md - Do not edit directly -->\n<!-- Run: node scripts/sync-agent-docs.js to update -->\n`;
  const titleEndIndex = transformed.indexOf('\n');
  transformed = transformed.slice(0, titleEndIndex) + syncNotice + transformed.slice(titleEndIndex);

  return transformed;
}

/**
 * Main sync function
 */
function syncAgentDocs() {
  const primaryPath = path.join(projectRoot, PRIMARY_FILE);

  // Check if primary file exists
  if (!fs.existsSync(primaryPath)) {
    console.error(`Error: Primary file ${PRIMARY_FILE} not found at ${primaryPath}`);
    process.exit(1);
  }

  // Read primary file
  const primaryContent = fs.readFileSync(primaryPath, 'utf-8');
  console.log(`Read primary file: ${PRIMARY_FILE} (${primaryContent.length} bytes)`);

  // Sync to each target
  const results = [];
  for (const target of SYNC_TARGETS) {
    const targetPath = path.join(projectRoot, target.filename);
    const transformedContent = transformContent(primaryContent, target);

    try {
      fs.writeFileSync(targetPath, transformedContent, 'utf-8');
      results.push({ filename: target.filename, status: 'success', bytes: transformedContent.length });
      console.log(`Synced: ${target.filename} (${transformedContent.length} bytes)`);
    } catch (error) {
      results.push({ filename: target.filename, status: 'error', error: error.message });
      console.error(`Failed to sync ${target.filename}: ${error.message}`);
    }
  }

  // Summary
  console.log('\nSync complete:');
  console.log(`  Primary: ${PRIMARY_FILE}`);
  for (const result of results) {
    const status = result.status === 'success' ? '✓' : '✗';
    console.log(`  ${status} ${result.filename}`);
  }

  // Exit with error if any failed
  const hasErrors = results.some(r => r.status === 'error');
  if (hasErrors) {
    process.exit(1);
  }
}

// Run
syncAgentDocs();
