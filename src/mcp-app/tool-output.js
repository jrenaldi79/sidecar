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
 * Map of tool name (lowercase) to formatter function.
 * Aliases (ls, askuserquestion, todoread) point to the same handler.
 * Imported by the tool-coverage integration test to detect drift.
 *
 * Note: formatEditDiff only uses its first argument (input). The uniform
 * dispatch pattern passes (input, outputStr) to all handlers. JavaScript
 * silently ignores the extra argument. This is intentional -- keeping a
 * uniform interface is simpler than special-casing edit.
 * @type {Record<string, (input: object, output: string) => string>}
 */
const TOOL_HANDLERS = {
  edit: formatEditDiff,
  write: formatWriteOutput,
  bash: formatBashOutput,
  read: formatFileOutput,
  glob: formatGlobOutput,
  grep: formatGrepOutput,
  question: formatQuestionOutput,
  askuserquestion: formatQuestionOutput,
  list: formatListOutput,
  ls: formatListOutput,
  task: formatTaskOutput,
  webfetch: formatWebfetchOutput,
  todowrite: formatTodoOutput,
  todoread: formatTodoOutput,
};

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
  const handler = TOOL_HANDLERS[name];
  if (handler) { return handler(input, outputStr); }
  if (typeof console !== 'undefined') {
    console.warn(`[tool-output] No renderer for tool: "${name}" -- using generic fallback`); // eslint-disable-line no-console
  }
  return formatGenericOutput(input, outputStr);
}

module.exports = { formatToolOutput, TOOL_HANDLERS };
