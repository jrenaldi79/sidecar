const { escapeHtml } = require('../utils');

const MAX_DIFF_LINES = 12;

/**
 * Builds a list of diff line descriptors from old/new string input.
 * Each entry has: { type: 'context'|'deletion'|'addition', oldNum, newNum, content }.
 *
 * @param {object} input - Object with old_string/oldString and new_string/newString.
 * @returns {{ type: string, oldNum: number|null, newNum: number|null, content: string }[]}
 */
function buildEditDiffLines(input) {
  const oldStr = input.old_string || input.oldString || '';
  const newStr = input.new_string || input.newString || '';
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const diffLines = [];

  let commonPrefixCount = 0;
  while (
    commonPrefixCount < oldLines.length &&
    commonPrefixCount < newLines.length &&
    oldLines[commonPrefixCount] === newLines[commonPrefixCount]
  ) {
    commonPrefixCount++;
  }

  let commonSuffixCount = 0;
  while (
    commonSuffixCount < oldLines.length - commonPrefixCount &&
    commonSuffixCount < newLines.length - commonPrefixCount &&
    oldLines[oldLines.length - 1 - commonSuffixCount] === newLines[newLines.length - 1 - commonSuffixCount]
  ) {
    commonSuffixCount++;
  }

  const contextBefore = Math.min(commonPrefixCount, 2);
  for (let i = commonPrefixCount - contextBefore; i < commonPrefixCount; i++) {
    diffLines.push({ type: 'context', oldNum: i + 1, newNum: i + 1, content: oldLines[i] });
  }

  for (let i = commonPrefixCount; i < oldLines.length - commonSuffixCount; i++) {
    diffLines.push({ type: 'deletion', oldNum: i + 1, newNum: null, content: oldLines[i] });
  }

  for (let i = commonPrefixCount; i < newLines.length - commonSuffixCount; i++) {
    diffLines.push({ type: 'addition', oldNum: null, newNum: i + 1, content: newLines[i] });
  }

  const contextAfter = Math.min(commonSuffixCount, 2);
  const suffixStart = oldLines.length - commonSuffixCount;
  for (let i = 0; i < contextAfter; i++) {
    diffLines.push({
      type: 'context',
      oldNum: suffixStart + i + 1,
      newNum: newLines.length - commonSuffixCount + i + 1,
      content: oldLines[suffixStart + i],
    });
  }

  return diffLines;
}

/**
 * Renders a single diff line as an HTML string.
 *
 * @param {{ type: string, oldNum: number|null, newNum: number|null, content: string }} line
 * @returns {string} HTML string for the diff line.
 */
function renderDiffLine(line) {
  if (line.type === 'context') {
    return (
      `<div class="tool-diff-line context">` +
      `<span class="tool-diff-line-number">${line.oldNum}</span>` +
      `<span class="tool-diff-line-number">${line.newNum}</span>` +
      `<span class="tool-diff-gutter"></span>` +
      `<span class="tool-diff-content">${escapeHtml(line.content)}</span>` +
      `</div>`
    );
  }
  if (line.type === 'deletion') {
    return (
      `<div class="tool-diff-line deletion">` +
      `<span class="tool-diff-line-number deletion">${line.oldNum}</span>` +
      `<span class="tool-diff-line-number"></span>` +
      `<span class="tool-diff-gutter deletion">-</span>` +
      `<span class="tool-diff-content">${escapeHtml(line.content)}</span>` +
      `</div>`
    );
  }
  if (line.type === 'addition') {
    return (
      `<div class="tool-diff-line addition">` +
      `<span class="tool-diff-line-number"></span>` +
      `<span class="tool-diff-line-number addition">${line.newNum}</span>` +
      `<span class="tool-diff-gutter addition">+</span>` +
      `<span class="tool-diff-content">${escapeHtml(line.content)}</span>` +
      `</div>`
    );
  }
  return '';
}

/**
 * Formats an edit tool call as an HTML diff card.
 *
 * @param {object|null} input - Tool input with old_string/new_string fields.
 * @returns {string} HTML string for the diff visualization.
 */
function formatEditDiff(input) {
  if (!input || typeof input !== 'object') {
    return '<div class="tool-output">Edit applied successfully.</div>';
  }
  const oldStr = input.old_string || input.oldString || '';
  const newStr = input.new_string || input.newString || '';
  if (!oldStr && !newStr) {
    return '<div class="tool-output">Edit applied successfully.</div>';
  }

  const diffLines = buildEditDiffLines(input);
  const truncated = diffLines.length > MAX_DIFF_LINES;
  const displayLines = truncated ? diffLines.slice(0, MAX_DIFF_LINES) : diffLines;

  let html = '<div class="tool-diff-card">';
  html += '<div class="tool-diff">';
  displayLines.forEach(line => { html += renderDiffLine(line); });
  html += '</div>';
  if (truncated) {
    html += `<div class="tool-diff-toggle">Show ${diffLines.length - MAX_DIFF_LINES} more lines</div>`;
  }
  html += '</div>';
  return html;
}

module.exports = { formatEditDiff, buildEditDiffLines, renderDiffLine };
