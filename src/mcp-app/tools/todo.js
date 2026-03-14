const { escapeHtml } = require('../utils');

const STATUS_ICONS = { pending: '☐', in_progress: '◐', completed: '☑', done: '☑' };

/**
 * Render an array of structured todo objects as a checklist.
 * @param {Array<{content?: string, text?: string, status?: string}>} todos
 * @returns {string} HTML
 */
function renderTodoList(todos) {
  const completed = todos.filter(t => t.status === 'completed' || t.status === 'done').length;
  const inProgress = todos.filter(t => t.status === 'in_progress').length;

  let html = '<div class="todo-output">';
  html += '<div class="todo-summary">';
  html += `${completed}/${todos.length} completed`;
  if (inProgress > 0) { html += ` &middot; ${inProgress} in progress`; }
  html += '</div>';
  html += '<ul class="todo-list">';
  for (const todo of todos) {
    const status = todo.status || 'pending';
    const icon = STATUS_ICONS[status] || '☐';
    const content = escapeHtml(todo.content || todo.text || todo.subject || 'Task');
    html += `<li class="todo-item todo-${status}">`;
    html += `<span class="todo-checkbox">${icon}</span>`;
    html += `<span class="todo-text">${content}</span>`;
    html += '</li>';
  }
  html += '</ul></div>';
  return html;
}

/**
 * Formats a TodoWrite/TodoRead tool call as a checklist with status icons.
 * Sources (in priority order): input.todos, JSON-parsed output, line-parsed output.
 * @param {object|null} input - Tool input with optional todos array.
 * @param {string} output - Raw output string (fallback).
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatTodoOutput(input, output) {
  // 1. Structured input (TodoWrite)
  if (Array.isArray(input?.todos) && input.todos.length > 0) {
    return renderTodoList(input.todos);
  }

  // 2. Try parsing output as JSON (TodoRead / TodoWrite output)
  if (output && output.trim()) {
    try {
      const parsed = JSON.parse(output.trim());
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.todos) ? parsed.todos : null);
      if (arr && arr.length > 0) { return renderTodoList(arr); }
    } catch { /* not JSON */ }
  }

  // 3. Fallback: plain text lines
  const lines = (output || '').split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    return '<div class="todo-output"><div class="todo-summary">Todo list updated</div></div>';
  }

  let html = '<div class="todo-output"><ul class="todo-list">';
  for (const line of lines) {
    const doneMatch = line.match(/^\s*\[([xX✓])\]\s*(.*)/);
    const pendingMatch = line.match(/^\s*\[\s\]\s*(.*)/);
    const done = !!doneMatch;
    const text = doneMatch ? doneMatch[2] : (pendingMatch ? pendingMatch[1] : line);
    const icon = done ? '☑' : '☐';
    const cls = done ? 'completed' : 'pending';
    html += `<li class="todo-item todo-${cls}">`;
    html += `<span class="todo-checkbox">${icon}</span>`;
    html += `<span class="todo-text">${escapeHtml(text)}</span>`;
    html += '</li>';
  }
  html += '</ul></div>';
  return html;
}

module.exports = { formatTodoOutput };
