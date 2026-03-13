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

  let html = '';

  if (command) {
    html += `<div class="tool-bash-command-card"><div class="tool-bash-label">bash</div><div class="tool-bash-cmd">${formatBashCommand(command)}</div></div>`;
  }

  if (outputStr.trim()) {
    html += '<div class="tool-bash-output-card">';
    displayLines.forEach(line => { html += formatBashLine(line); });
    if (truncated) {
      html += `<div class="tool-bash-toggle">Show ${lines.length - MAX_LINES} more lines</div>`;
    }
    html += '</div>';
  }

  return html;
}

module.exports = { formatBashOutput };
