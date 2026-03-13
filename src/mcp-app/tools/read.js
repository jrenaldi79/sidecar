const { escapeHtml } = require('../utils');

const MAX_LINES = 25;

/**
 * Formats file content output (Read tool) into a line-numbered diff-style HTML block.
 *
 * Handles two line number formats produced by Claude Code's Read tool:
 *   - Arrow format:  `     1→content`
 *   - Pipe format:   `00001| content`
 *
 * @param {object} _input - Tool input parameters (ignored; present for dispatcher signature consistency).
 * @param {string} output - Raw file content string returned by the Read tool.
 * @returns {string} HTML string with line-numbered rows, truncated at 25 lines.
 */
function formatFileOutput(_input, output) {
  let content = output !== null && output !== undefined ? String(output) : '';

  // Strip XML-like <file> wrapper tags that Claude Code sometimes emits.
  content = content.replace(/<\/?file[^>]*>/g, '');
  // Strip trailing "File has more lines" notice.
  content = content.replace(/\(File has more lines\.[^)]*\)/g, '');

  const lines = content.split('\n').filter(line => line.trim());
  const displayLines = lines.slice(0, MAX_LINES);
  const moreLines = lines.length - MAX_LINES;

  let html = '<div class="tool-diff">';

  displayLines.forEach((line) => {
    // Arrow format: optional leading spaces, digits, →, content
    // Pipe format:  zero-padded digits, |, optional space, content
    const arrowMatch = line.match(/^\s*(\d+)\u2192(.*)$/);
    const pipeMatch = line.match(/^(\d+)\|\s?(.*)$/);
    const numberedMatch = arrowMatch || pipeMatch;

    if (numberedMatch) {
      const lineNum = parseInt(numberedMatch[1], 10);
      const lineContent = numberedMatch[2];
      html += `<div class="tool-diff-line"><span class="tool-diff-line-number">${lineNum}</span><span class="tool-diff-content">${escapeHtml(lineContent)}</span></div>`;
    } else if (line.trim()) {
      html += `<div class="tool-diff-line"><span class="tool-diff-line-number"></span><span class="tool-diff-content">${escapeHtml(line)}</span></div>`;
    }
  });

  html += '</div>';

  if (moreLines > 0) {
    html += `<div class="tool-diff-more">Show more (${moreLines} more lines)</div>`;
  }

  return html;
}

module.exports = { formatFileOutput };
