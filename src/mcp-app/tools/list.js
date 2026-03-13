const { escapeHtml } = require('../utils');

/**
 * Formats an LS/List tool call as a simple directory listing.
 * @param {object|null} input - Tool input; may include `input.path`.
 * @param {string} output - Newline-separated list of files/dirs.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatListOutput(input, output) {
  const dirPath = input?.path || '';
  const outputStr = output || '';
  const entries = outputStr ? outputStr.split('\n').map(l => l.trim()).filter(Boolean) : [];

  let html = '<div class="list-output">';

  if (dirPath) {
    html += `<div class="list-path">${escapeHtml(dirPath)}</div>`;
  }

  if (entries.length > 0) {
    html += '<div class="list-entries">';
    entries.forEach(entry => {
      html += `<div class="list-entry">${escapeHtml(entry)}</div>`;
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

module.exports = { formatListOutput };
