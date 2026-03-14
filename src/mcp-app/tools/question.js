const { escapeHtml } = require('../utils');

/**
 * Formats an AskUserQuestion tool call.
 *
 * Two rendering modes based on whether the tool has output:
 * - **Pending** (no output): Interactive-looking card with option buttons,
 *   radio indicators, and free-form input. Options are styled as clickable
 *   buttons with hover/active states via CSS.
 * - **Completed** (has output): Read-only card showing the question, options
 *   (with the selected one highlighted), and the answer in a green pill.
 *
 * Supports single question (`input.question`) and multi-question
 * (`input.questions[]`) formats, each with optional options.
 *
 * @param {object|null} input - Tool input.
 * @param {string} output - Tool output (user response).
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatQuestionOutput(input, output) {
  const outputStr = output || '';
  const isCompleted = !!outputStr.trim();

  let html = '<div class="question-tool-container' +
    (isCompleted ? ' question-completed' : '') + '"' +
    (!isCompleted ? ' data-pending="true"' : '') + '>';

  // Header
  html += '<div class="question-header">';
  html += '<div class="question-header-left">';
  html += '<span class="question-icon">?</span>';
  html += '<span class="question-header-label">Question</span>';
  html += '</div>';
  html += '</div>';

  // Support both single-question and multi-question formats
  if (input?.question || input?.questions) {
    const questions = input.questions || [input];
    questions.forEach((q, idx) => {
      const questionText = q.question || q.text || 'Question';

      // Question counter for multi-part
      if (questions.length > 1) {
        html += `<div class="question-counter">${idx + 1} / ${questions.length}</div>`;
      }

      // Question text
      html += `<div class="question-text">${escapeHtml(questionText)}</div>`;

      // Options
      if (q.options && q.options.length > 0) {
        html += '<div class="question-input-area">';
        html += '<div class="question-options">';
        q.options.forEach((opt, optIdx) => {
          const label = typeof opt === 'string' ? opt : (opt.label || opt);
          const desc = typeof opt === 'string' ? '' : (opt.description || '');
          const isSelected = isCompleted && outputStr.trim() === String(label);
          const highlighted = !isCompleted && optIdx === 0;

          html += '<button class="question-option-btn single-select';
          if (isSelected) { html += ' selected'; }
          if (highlighted) { html += ' highlighted'; }
          html += '" data-answer="' + escapeHtml(String(label)) + '">';

          // Radio indicator
          html += '<span class="question-radio"></span>';

          // Content (label + description)
          html += '<div class="question-option-content">';
          html += `<span class="question-btn-label">${escapeHtml(String(label))}</span>`;
          if (desc) {
            html += `<span class="question-btn-desc">${escapeHtml(desc)}</span>`;
          }
          html += '</div>';

          // Number badge
          html += `<span class="question-option-badge">${optIdx + 1}</span>`;

          html += '</button>';
        });
        html += '</div>'; // .question-options

        // "Type something else..." option (only when pending)
        if (!isCompleted) {
          html += '<button class="question-option-btn question-other-btn" data-action="other">';
          html += '<span class="question-radio"></span>';
          html += '<div class="question-option-content">';
          html += '<span class="question-btn-label">Type something else...</span>';
          html += '</div>';
          html += '</button>';
        }

        html += '</div>'; // .question-input-area
      } else {
        // No options -- free-form input
        html += '<div class="question-input-area">';
        if (!isCompleted) {
          html += '<div class="question-freeform-wrapper">';
          html += '<input type="text" class="question-freeform-input" placeholder="Type your answer..." />';
          html += '<button class="question-submit-btn">Submit</button>';
          html += '</div>';
        }
        html += '</div>';
      }
    });
  }

  // Show the answer (completed state)
  if (isCompleted) {
    html += '<div class="question-selected-answer">';
    html += '<span class="answer-label">Answer: </span>';
    html += escapeHtml(outputStr);
    html += '</div>';
  }

  // Footer with skip button (pending state)
  if (!isCompleted) {
    html += '<div class="question-footer">';
    html += '<button class="question-skip-btn" data-action="skip">Skip</button>';
    html += '</div>';
  }

  html += '</div>'; // .question-tool-container
  return html;
}

module.exports = { formatQuestionOutput };
