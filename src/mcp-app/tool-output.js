const { formatGenericOutput } = require('./tools/generic');

/**
 * Routes a tool call to the appropriate HTML formatter.
 *
 * Formatters for specific tools (bash, edit, write, read, glob, grep, etc.)
 * will be wired in by subsequent tasks. Until then all routing falls through
 * to the generic formatter so the dispatcher is already structurally complete.
 *
 * @param {string} toolName - Name of the tool (case-insensitive).
 * @param {object} input - Tool input parameters.
 * @param {*} output - Raw tool output.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatToolOutput(toolName, input, output) {
  const name = toolName.toLowerCase();
  const outputStr = output !== null && output !== undefined ? String(output) : '';

  // Individual formatters will replace these stubs as they are implemented.
  if (name === 'edit') { return formatGenericOutput(input, outputStr); }
  if (name === 'write') { return formatGenericOutput(input, outputStr); }
  if (name === 'bash') { return formatGenericOutput(input, outputStr); }
  if (name === 'read') { return formatGenericOutput(input, outputStr); }
  if (name === 'glob') { return formatGenericOutput(input, outputStr); }
  if (name === 'grep') { return formatGenericOutput(input, outputStr); }
  if (name === 'question' || name === 'askuserquestion') { return formatGenericOutput(input, outputStr); }
  if (name === 'list' || name === 'ls') { return formatGenericOutput(input, outputStr); }
  if (name === 'task') { return formatGenericOutput(input, outputStr); }
  if (name === 'webfetch') { return formatGenericOutput(input, outputStr); }
  if (name === 'todowrite' || name === 'todoread') { return formatGenericOutput(input, outputStr); }

  return formatGenericOutput(input, outputStr);
}

module.exports = { formatToolOutput };
