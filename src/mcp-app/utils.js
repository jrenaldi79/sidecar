const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes HTML special characters to prevent XSS injection.
 * @param {*} text - Input to escape; non-strings are coerced via String().
 * @returns {string} Escaped string, or '' for falsy input.
 */
function escapeHtml(text) {
  if (!text) { return ''; }
  return String(text).replace(/[&<>"']/g, c => ESCAPE_MAP[c]);
}

const copyIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const chevronRightSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2L8 6L4 10"/></svg>';
const chevronDownSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4L6 8L10 4"/></svg>';
const chevronUpSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8L6 4L10 8"/></svg>';

module.exports = { escapeHtml, copyIconSvg, chevronRightSvg, chevronDownSvg, chevronUpSvg };
