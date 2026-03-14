const { escapeHtml } = require('../utils');

const MAX_OUTPUT_LEN = 300;

/**
 * Formats a Skill tool call showing the skill name and truncated output.
 * @param {object|null} input - Tool input; may include `input.skill` or `input.name`.
 * @param {string} output - Skill output string.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatSkillOutput(input, output) {
  const skillName = input?.skill || input?.name || '';
  const outputStr = output || '';

  let html = '<div class="task-output">';

  if (skillName) {
    html += `<div class="task-id">${escapeHtml(skillName)}</div>`;
  }

  if (outputStr.trim()) {
    const truncated = outputStr.length > MAX_OUTPUT_LEN;
    const displayStr = truncated ? outputStr.slice(0, MAX_OUTPUT_LEN) : outputStr;
    html += `<div class="task-status">${escapeHtml(displayStr)}</div>`;
    if (truncated) {
      html += `<div class="task-more">+${outputStr.length - MAX_OUTPUT_LEN} more characters</div>`;
    }
  }

  html += '</div>';
  return html;
}

module.exports = { formatSkillOutput };
