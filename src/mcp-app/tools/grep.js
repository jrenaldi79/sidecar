const { escapeHtml } = require('../utils');

const MAX_MATCHES = 50;
const MAX_PER_FILE = 5;

/**
 * Parses a grep output line into its file, line number, and content parts.
 * Expects format: `path/to/file.js:42:matching content`
 * @param {string} line - Raw grep output line.
 * @returns {{ file: string, lineNum: string, content: string }|null}
 */
function parseGrepLine(line) {
  const match = line.match(/^([^:]+):(\d+):(.*)$/);
  if (!match) { return null; }
  return { file: match[1], lineNum: match[2], content: match[3] };
}

/**
 * Highlights occurrences of a pattern string within escaped HTML content.
 * @param {string} content - Raw text content.
 * @param {string} pattern - Pattern to highlight.
 * @returns {string} HTML with pattern wrapped in highlight spans.
 */
function highlightPattern(content, pattern) {
  if (!pattern) { return escapeHtml(content); }
  try {
    const escapedForHtml = escapeHtml(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escapeHtml(content).replace(
      new RegExp(escapedForHtml, 'gi'),
      m => `<span class="grep-highlight">${m}</span>`
    );
  } catch (_e) {
    return escapeHtml(content);
  }
}

/**
 * Groups an array of parsed match objects by file path.
 * @param {{ file: string, lineNum: string, content: string }[]} matches
 * @returns {Map<string, { lineNum: string, content: string }[]>}
 */
function groupByFile(matches) {
  const groups = new Map();
  matches.forEach(m => {
    if (!groups.has(m.file)) { groups.set(m.file, []); }
    groups.get(m.file).push({ lineNum: m.lineNum, content: m.content });
  });
  return groups;
}

/**
 * Formats a Grep tool call as an HTML result list grouped by file.
 * @param {object} input - Tool input; may include `input.pattern` for highlighting.
 * @param {string} output - Raw grep output string.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatGrepOutput(input, output) {
  const pattern = input?.pattern || '';
  const outputStr = output || '';
  const rawLines = outputStr ? outputStr.split('\n').filter(l => l.trim()) : [];

  const allMatches = rawLines.map(parseGrepLine).filter(Boolean);
  const truncated = allMatches.length > MAX_MATCHES;
  const displayMatches = truncated ? allMatches.slice(0, MAX_MATCHES) : allMatches;
  const groups = groupByFile(displayMatches);

  let html = '<div class="grep-results">';

  groups.forEach((fileMatches, file) => {
    html += '<div class="grep-file">';
    html += `<span class="grep-file-name">${escapeHtml(file)}</span>`;
    html += `<span class="grep-file-count">${fileMatches.length}</span>`;
    html += '</div>';

    const displayFileMatches = fileMatches.slice(0, MAX_PER_FILE);
    displayFileMatches.forEach(m => {
      html += '<div class="grep-match">';
      html += `<span class="grep-line-num">${escapeHtml(m.lineNum)}</span>`;
      html += `<span class="grep-content">${highlightPattern(m.content, pattern)}</span>`;
      html += '</div>';
    });
    if (fileMatches.length > MAX_PER_FILE) {
      html += `<div class="grep-file-overflow">+${fileMatches.length - MAX_PER_FILE} more in this file</div>`;
    }
  });

  if (truncated) {
    html += `<div class="grep-more">+${allMatches.length - MAX_MATCHES} more matches</div>`;
  }

  html += '</div>';
  return html;
}

module.exports = { formatGrepOutput };
