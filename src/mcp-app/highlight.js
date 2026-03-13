const { escapeHtml } = require('./utils');

/**
 * Applies a transform function only to text segments outside HTML tags.
 * This prevents keyword/type patterns from corrupting span class attributes.
 * @param {string} html - HTML string potentially containing span tags.
 * @param {function(string): string} fn - Transform to apply to text segments.
 * @returns {string} HTML with fn applied only outside tags.
 */
function applyOutsideTags(html, fn) {
  // Split on HTML tags, apply fn to odd-indexed segments (text nodes)
  const parts = html.split(/(<[^>]+>)/);
  return parts.map((part, i) => (i % 2 === 0 ? fn(part) : part)).join('');
}

const KEYWORDS = [
  'async', 'await', 'function', 'const', 'let', 'var', 'return', 'if', 'else',
  'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'new', 'class', 'extends', 'import', 'export', 'from',
  'default', 'static', 'public', 'private', 'protected', 'interface', 'type',
  'enum', 'implements', 'abstract', 'fn', 'pub', 'impl', 'struct', 'trait',
  'use', 'mod', 'crate', 'self', 'super', 'where', 'mut', 'ref', 'move',
  'def', 'elif', 'pass', 'with', 'as', 'lambda', 'yield', 'global', 'nonlocal',
  'true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil'
];

const TYPES = [
  'string', 'number', 'boolean', 'object', 'any', 'void', 'never', 'unknown',
  'int', 'float', 'double', 'char', 'bool', 'i32', 'i64', 'u32', 'u64',
  'f32', 'f64', 'str', 'String', 'Vec', 'Option', 'Result', 'Box', 'Rc', 'Arc'
];

const BASH_COMMANDS = [
  'grep', 'find', 'ls', 'cat', 'echo', 'cd', 'mkdir', 'rm', 'cp', 'mv',
  'git', 'npm', 'node', 'python', 'curl', 'wget', 'sed', 'awk', 'sort',
  'head', 'tail', 'wc'
];

/**
 * Applies regex-based syntax highlighting to a code string.
 * @param {string} code - Source code to highlight.
 * @param {string} lang - Language hint (unused but kept for API compatibility).
 * @returns {string} HTML string with span-wrapped tokens.
 */
function highlightCode(code, lang) { // eslint-disable-line no-unused-vars
  let result = escapeHtml(code);
  if (!result) { return result; }

  result = result.replace(/(\/\/[^\n]*)/g, '<span class="hl-comment">$1</span>');
  result = result.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, '<span class="hl-string">$1</span>');
  result = result.replace(/(&#39;(?:[^&]|&(?!#39;))*?&#39;)/g, '<span class="hl-string">$1</span>');

  // Apply keyword/type/function/constant/number highlighting only to text segments
  // outside already-inserted span tags to avoid corrupting span attributes.
  result = applyOutsideTags(result, text => {
    const keywordPattern = new RegExp(`(?<![\\w])\\b(${KEYWORDS.join('|')})\\b(?![\\w])`, 'g');
    let t = text.replace(keywordPattern, '<span class="hl-keyword">$1</span>');
    const typePattern = new RegExp(`\\b(${TYPES.join('|')})\\b`, 'g');
    t = t.replace(typePattern, '<span class="hl-type">$1</span>');
    t = t.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g, '<span class="hl-function">$1</span>(');
    t = t.replace(/\b([A-Z][A-Z0-9_]{2,})\b/g, '<span class="hl-constant">$1</span>');
    t = t.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');
    return t;
  });

  return result;
}

/**
 * Applies shell syntax highlighting to a bash command string.
 * @param {string} cmd - Shell command to highlight.
 * @returns {string} HTML string with span-wrapped tokens.
 */
function formatBashCommand(cmd) {
  let result = escapeHtml(cmd);
  if (!result) { return result; }

  result = result.replace(/&quot;([^&]*)&quot;/g, '<span class="bash-string">"$1"</span>');
  result = result.replace(/&#39;([^&]*)&#39;/g, "<span class=\"bash-string\">'$1'</span>");

  const cmdPattern = new RegExp(`^(${BASH_COMMANDS.join('|')})\\b`, 'i');
  result = result.replace(cmdPattern, '<span class="bash-cmd">$1</span>');

  result = result.replace(/\s(-{1,2}[a-zA-Z][\w-]*)/g, ' <span class="bash-flag">$1</span>');

  return result;
}

module.exports = { highlightCode, formatBashCommand };
