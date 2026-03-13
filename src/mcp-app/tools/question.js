const { escapeHtml } = require('../utils');

/**
 * Formats an AskUserQuestion tool call as a styled question card.
 * @param {object|null} input - Tool input; expects `input.question`.
 * @param {string} output - Tool output (optional user response).
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatQuestionOutput(input, output) {
  const question = input?.question || '';
  const outputStr = output || '';

  let html = '<div class="question-output">';

  if (question) {
    html += `<div class="question-text">${escapeHtml(question)}</div>`;
  }

  if (outputStr.trim()) {
    html += `<div class="question-response">${escapeHtml(outputStr)}</div>`;
  }

  html += '</div>';
  return html;
}

module.exports = { formatQuestionOutput };
