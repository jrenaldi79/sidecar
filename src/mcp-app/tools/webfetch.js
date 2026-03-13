const { escapeHtml } = require('../utils');

const MAX_CONTENT_LENGTH = 2000;

/**
 * Formats a WebFetch tool call showing the URL and truncated response content.
 * @param {object|null} input - Tool input; expects `input.url`.
 * @param {string} output - Raw fetched content string.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatWebfetchOutput(input, output) {
  const url = input?.url || '';
  const outputStr = output || '';
  const truncated = outputStr.length > MAX_CONTENT_LENGTH;
  const displayContent = truncated ? outputStr.slice(0, MAX_CONTENT_LENGTH) : outputStr;

  let html = '<div class="webfetch-output">';

  if (url) {
    html += `<div class="webfetch-url">${escapeHtml(url)}</div>`;
  }

  if (displayContent.trim()) {
    html += `<div class="webfetch-content">${escapeHtml(displayContent)}</div>`;
  }

  if (truncated) {
    html += `<div class="webfetch-more">+${outputStr.length - MAX_CONTENT_LENGTH} more characters</div>`;
  }

  html += '</div>';
  return html;
}

module.exports = { formatWebfetchOutput };
