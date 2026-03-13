const { formatGenericOutput } = require('./tools/generic');
const { formatBashOutput } = require('./tools/bash');
const { formatEditDiff } = require('./tools/edit');
const { formatFileOutput } = require('./tools/read');
const { formatWriteOutput } = require('./tools/write');
const { formatGrepOutput } = require('./tools/grep');
const { formatGlobOutput } = require('./tools/glob');
const { formatQuestionOutput } = require('./tools/question');
const { formatListOutput } = require('./tools/list');
const { formatTodoOutput } = require('./tools/todo');
const { formatWebfetchOutput } = require('./tools/webfetch');
const { formatTaskOutput } = require('./tools/task');

/**
 * Routes a tool call to the appropriate HTML formatter.
 *
 * @param {string} toolName - Name of the tool (case-insensitive).
 * @param {object} input - Tool input parameters.
 * @param {*} output - Raw tool output.
 * @returns {string} HTML string suitable for injection into the chat UI.
 */
function formatToolOutput(toolName, input, output) {
  const name = toolName.toLowerCase();
  const outputStr = output !== null && output !== undefined ? String(output) : '';

  if (name === 'edit') { return formatEditDiff(input); }
  if (name === 'write') { return formatWriteOutput(input, outputStr); }
  if (name === 'bash') { return formatBashOutput(input, outputStr); }
  if (name === 'read') { return formatFileOutput(input, outputStr); }
  if (name === 'glob') { return formatGlobOutput(input, outputStr); }
  if (name === 'grep') { return formatGrepOutput(input, outputStr); }
  if (name === 'question' || name === 'askuserquestion') { return formatQuestionOutput(input, outputStr); }
  if (name === 'list' || name === 'ls') { return formatListOutput(input, outputStr); }
  if (name === 'task') { return formatTaskOutput(input, outputStr); }
  if (name === 'webfetch') { return formatWebfetchOutput(input, outputStr); }
  if (name === 'todowrite' || name === 'todoread') { return formatTodoOutput(input, outputStr); }

  return formatGenericOutput(input, outputStr);
}

module.exports = { formatToolOutput };
