const { escapeHtml } = require('../utils');

const MAX_LINES = 12;

/**
 * Renders a single line as a diff addition row.
 * @param {number} lineNum - 1-based line number.
 * @param {string} content - Line content to display.
 * @returns {string} HTML string for the addition line.
 */
function renderAdditionLine(lineNum, content) {
  return (
    '<div class="tool-diff-line addition">' +
    '<span class="tool-diff-line-number"></span>' +
    `<span class="tool-diff-line-number addition">${lineNum}</span>` +
    '<span class="tool-diff-gutter addition">+</span>' +
    `<span class="tool-diff-content">${escapeHtml(content)}</span>` +
    '</div>'
  );
}

/**
 * Formats a Write tool call as an HTML diff card showing all content as additions.
 * @param {object|null} input - Tool input; expects `input.file_path` and `input.content`.
 * @param {string} _output - Tool output string (typically a success message; not displayed).
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatWriteOutput(input, _output) {
  if (!input || typeof input !== 'object') {
    return '<div class="tool-diff-card"><div class="tool-diff"></div></div>';
  }

  const filePath = input.file_path || input.filePath || '';
  const content = input.content || '';
  const lines = content ? content.split('\n') : [];
  const truncated = lines.length > MAX_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_LINES) : lines;

  let html = '<div class="tool-diff-card">';

  if (filePath) {
    html += `<div class="tool-diff-header"><span class="tool-diff-filepath">${escapeHtml(filePath)}</span></div>`;
  }

  html += '<div class="tool-diff">';
  displayLines.forEach((line, i) => {
    html += renderAdditionLine(i + 1, line);
  });
  html += '</div>';

  if (truncated) {
    html += `<div class="tool-diff-toggle">Show ${lines.length - MAX_LINES} more lines</div>`;
  }

  html += '</div>';
  return html;
}

module.exports = { formatWriteOutput };
