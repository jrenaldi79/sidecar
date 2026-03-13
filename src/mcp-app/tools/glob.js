const { escapeHtml } = require('../utils');
const { getFileIcon } = require('../icons');

const MAX_FILES = 50;

/**
 * Extracts the directory portion of a file path.
 * Returns '.' for root-level files.
 * @param {string} filePath - Full file path.
 * @returns {string} Directory path.
 */
function getDir(filePath) {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) { return '.'; }
  return filePath.slice(0, lastSlash);
}

/**
 * Extracts the filename (basename) from a file path.
 * @param {string} filePath - Full file path.
 * @returns {string} File name.
 */
function getBasename(filePath) {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

/**
 * Extracts the extension from a filename (without the dot).
 * @param {string} name - File name.
 * @returns {string} Extension or empty string.
 */
function getExt(name) {
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === 0) { return ''; }
  return name.slice(dotIdx + 1).toLowerCase();
}

/**
 * Groups an array of file paths by their parent directory.
 * @param {string[]} paths - Array of file paths.
 * @returns {Map<string, string[]>} Map of dir -> filenames.
 */
function groupByDir(paths) {
  const groups = new Map();
  paths.forEach(p => {
    const dir = getDir(p);
    const name = getBasename(p);
    if (!groups.has(dir)) { groups.set(dir, []); }
    groups.get(dir).push(name);
  });
  return groups;
}

/**
 * Formats a Glob tool call as an HTML file list grouped by directory.
 * @param {object} _input - Tool input (ignored; present for dispatcher signature consistency).
 * @param {string} output - Newline-separated list of file paths.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatGlobOutput(_input, output) {
  const outputStr = output || '';
  const allPaths = outputStr ? outputStr.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const truncated = allPaths.length > MAX_FILES;
  const displayPaths = truncated ? allPaths.slice(0, MAX_FILES) : allPaths;
  const groups = groupByDir(displayPaths);

  let html = '<div class="glob-results">';

  groups.forEach((names, dir) => {
    html += '<div class="glob-dir">';
    html += `<span class="glob-dir-name">${escapeHtml(dir)}</span>`;
    html += `<span class="glob-dir-count">${names.length}</span>`;
    html += '</div>';

    names.forEach(name => {
      const ext = getExt(name);
      const icon = getFileIcon(ext);
      html += '<div class="glob-file">';
      html += `<span class="glob-file-icon">${icon}</span>`;
      html += `<span class="glob-file-name">${escapeHtml(name)}</span>`;
      html += '</div>';
    });
  });

  if (truncated) {
    html += `<div class="glob-more">+${allPaths.length - MAX_FILES} more files</div>`;
  }

  html += '</div>';
  return html;
}

module.exports = { formatGlobOutput };
