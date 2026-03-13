const { escapeHtml } = require('../utils');

/**
 * Parses a single todo line to detect completion status.
 * Recognises formats: `[x]`, `[X]`, `[✓]` as completed; `[ ]` as pending.
 * @param {string} line - Raw todo line text.
 * @returns {{ done: boolean, text: string }}
 */
function parseTodoLine(line) {
  const doneMatch = line.match(/^\s*\[([xX✓])\]\s*(.*)/);
  if (doneMatch) { return { done: true, text: doneMatch[2] }; }
  const pendingMatch = line.match(/^\s*\[\s\]\s*(.*)/);
  if (pendingMatch) { return { done: false, text: pendingMatch[1] }; }
  return { done: false, text: line };
}

/**
 * Formats a TodoWrite/TodoRead tool call as a simple todo list.
 * @param {object|null} _input - Tool input (ignored; present for dispatcher signature consistency).
 * @param {string} output - Raw output string with todo items.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatTodoOutput(_input, output) {
  const outputStr = output || '';
  const lines = outputStr ? outputStr.split('\n').filter(l => l.trim()) : [];

  let html = '<div class="todo-output">';

  if (lines.length > 0) {
    html += '<ul class="todo-list">';
    lines.forEach(line => {
      const { done, text } = parseTodoLine(line);
      const doneClass = done ? ' todo-done' : ' todo-pending';
      html += `<li class="todo-item${doneClass}">${escapeHtml(text)}</li>`;
    });
    html += '</ul>';
  }

  html += '</div>';
  return html;
}

module.exports = { formatTodoOutput };
