const { escapeHtml } = require('../utils');
const { formatBashCommand } = require('../highlight');

const MAX_LINES = 8;

/**
 * Colorizes a single bash output line based on success/error markers.
 * @param {string} line - Raw output line.
 * @returns {string} HTML div element with appropriate class.
 */
function formatBashLine(line) {
  if (line.includes('✓') || line.includes('PASS')) {
    return `<div class="tool-bash-line success">${escapeHtml(line)}</div>`;
  }
  if (line.includes('✗') || line.includes('FAIL') || line.includes('Error')) {
    return `<div class="tool-bash-line error">${escapeHtml(line)}</div>`;
  }
  return `<div class="tool-bash-line">${escapeHtml(line)}</div>`;
}

/**
 * Formats a bash tool call as an HTML card with command and output sections.
 * @param {object} input - Tool input parameters; expects `input.command`.
 * @param {string} output - Raw stdout/stderr string from the tool.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatBashOutput(input, output) {
  const command = input?.command || '';
  const outputStr = output || '';
  const lines = outputStr ? outputStr.split('\n') : [];
  const truncated = lines.length > MAX_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_LINES) : lines;

  if (!command && !outputStr.trim()) {
    return '<div class="tool-pending-message">Awaiting execution...</div>';
  }

  const copyIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  let html = '';

  if (command) {
    const escapedCmd = escapeHtml(command).replace(/'/g, '&#39;');
    html += `<div class="tool-bash-command-card"><div class="tool-bash-label">bash</div><button class="bash-copy-btn" data-copy="${escapedCmd}" title="Copy command">${copyIcon}</button><div class="tool-bash-cmd">${formatBashCommand(command)}</div></div>`;
  }

  if (outputStr.trim()) {
    const escapedOutput = escapeHtml(outputStr.trim()).replace(/'/g, '&#39;');
    html += `<div class="tool-bash-output-card"><button class="bash-copy-btn" data-copy="${escapedOutput}" title="Copy output">${copyIcon}</button>`;
    displayLines.forEach(line => { html += formatBashLine(line); });
    if (truncated) {
      html += `<div class="tool-bash-toggle">Show ${lines.length - MAX_LINES} more lines</div>`;
    }
    html += '</div>';
  }

  return html;
}

module.exports = { formatBashOutput };
