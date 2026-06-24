'use strict';

/**
 * Parse a single Codex JSONL line.
 *
 * @param {string} line
 * @returns {object|null}
 */
function parseCodexJsonLine(line) {
  if (!line || !line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid Codex JSON line: ${error.message}`);
  }
}

/**
 * Normalize observed Codex event shapes into Sidecar-style records.
 *
 * @param {object} event
 * @returns {object|null}
 */
function normalizeCodexEvent(event) {
  if (!event || event.type !== 'item.completed' || !event.item) {
    return null;
  }

  if (event.item.type === 'agent_message' && event.item.text) {
    return {
      kind: 'assistant_text',
      content: event.item.text
    };
  }

  if (event.item.type === 'command_execution' && event.item.command) {
    return {
      kind: 'tool_use',
      toolCall: {
        name: 'command_execution',
        input: {
          command: event.item.command,
          exitCode: event.item.exit_code,
          status: event.item.status
        }
      }
    };
  }

  return null;
}

/**
 * Extract a final summary string from an event, if present.
 *
 * @param {object} event
 * @returns {string|null}
 */
function getFinalSummary(event) {
  const normalized = normalizeCodexEvent(event);
  if (normalized && normalized.kind === 'assistant_text') {
    return normalized.content;
  }
  return null;
}

module.exports = {
  parseCodexJsonLine,
  normalizeCodexEvent,
  getFinalSummary
};
