// CommonJS for Jest compatibility
const { marked } = require('marked');
const { highlightCode } = require('./highlight');
const { escapeHtml } = require('./utils');

/**
 * Custom marked renderer with syntax highlighting and HTML escaping.
 * @type {import('marked').Renderer}
 */
const renderer = new marked.Renderer();

/**
 * Renders a fenced code block with syntax highlighting and a language label.
 * Handles both marked v4 (string args) and v17+ (token object) APIs.
 * @param {Object|string} token - Marked token object (v17+) or raw code string (v4).
 * @param {string} [language] - Language hint passed as second arg in v4.
 * @returns {string} HTML string for the code block.
 */
renderer.code = function (token, language) {
  const isToken = typeof token === 'object' && token !== null;
  const codeText = isToken ? token.text : token;
  const lang = (isToken ? token.lang : language) || '';
  const highlighted = highlightCode(codeText, lang);
  const langLabel = lang ? `<div class="code-language">${escapeHtml(lang)}</div>` : '';
  return `<pre>${langLabel}<code class="language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
};

/**
 * Escapes raw HTML blocks to prevent injection (marked v17 passes HTML through by default).
 * @param {Object|string} token - Marked token or raw HTML string.
 * @returns {string} Escaped HTML string.
 */
renderer.html = function (token) {
  const raw = typeof token === 'object' && token !== null ? token.text : token;
  return escapeHtml(raw);
};

marked.setOptions({ breaks: true, gfm: true });

/**
 * Renders markdown text to an HTML string.
 * Falls back to escaped plain text if the marked parser throws.
 * @param {string} text - Markdown source text.
 * @returns {string} Rendered HTML string.
 */
function renderMarkdown(text) {
  try {
    return marked.parse(text, { renderer });
  } catch {
    return escapeHtml(text);
  }
}

module.exports = { renderMarkdown };
