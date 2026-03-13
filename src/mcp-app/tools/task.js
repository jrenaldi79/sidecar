const { escapeHtml } = require('../utils');

/**
 * Formats a Task tool call showing the task ID and status output.
 * @param {object|null} input - Tool input; may include `input.id`.
 * @param {string} output - Task status or result string.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatTaskOutput(input, output) {
  const taskId = input?.id || '';
  const outputStr = output || '';

  let html = '<div class="task-output">';

  if (taskId) {
    html += `<div class="task-id">${escapeHtml(taskId)}</div>`;
  }

  if (outputStr.trim()) {
    html += `<div class="task-status">${escapeHtml(outputStr)}</div>`;
  }

  html += '</div>';
  return html;
}

module.exports = { formatTaskOutput };
