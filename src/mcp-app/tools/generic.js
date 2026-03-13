const { escapeHtml } = require('../utils');

const MAX_LENGTH = 2000;

/**
 * Fallback formatter for unknown or unhandled tool outputs.
 * @param {object} _input - Tool input (ignored by this formatter).
 * @param {*} output - Tool output to display.
 * @returns {string} HTML string.
 */
function formatGenericOutput(_input, output) {
  const text = output !== null && output !== undefined ? String(output) : '';
  const truncated = text.length > MAX_LENGTH;
  const displayText = truncated ? text.slice(0, MAX_LENGTH) : text;
  let html = `<div class="tool-output">${escapeHtml(displayText)}</div>`;
  if (truncated) {
    html += `<div class="tool-output-more">... +${text.length - MAX_LENGTH} characters</div>`;
  }
  return html;
}

module.exports = { formatGenericOutput };
