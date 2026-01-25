/**
 * JSONL Parser
 *
 * Spec Reference: §5.3 Context Filtering Algorithm, §5.3 Context Format
 * Parses Claude Code conversation JSONL files and formats them for context passing.
 */

const fs = require('fs');

/**
 * Parse a single line of JSONL content
 * @param {string} line - A single line from a JSONL file
 * @returns {object|null} Parsed JSON object or null if invalid
 */
function parseJSONLLine(line) {
  if (!line || !line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch (error) {
    return null;
  }
}

/**
 * Read and parse a JSONL file
 * @param {string} filePath - Path to the JSONL file
 * @returns {object[]} Array of parsed message objects
 * @throws {Error} If file cannot be read
 */
function readJSONL(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  return content
    .split('\n')
    .map(line => parseJSONLLine(line))
    .filter(Boolean);
}

/**
 * Extract timestamp from a message object
 * @param {object} message - Message object with optional timestamp field
 * @returns {Date|null} Date object or null if invalid/missing
 */
function extractTimestamp(message) {
  if (!message || !message.timestamp) {
    return null;
  }

  const date = new Date(message.timestamp);

  // Check if date is valid (invalid dates return NaN for getTime())
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * Format a timestamp for display (e.g., "10:30" or "10:30 AM")
 * @param {string} timestamp - ISO timestamp string
 * @returns {string} Formatted time string
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Extract text content from a message
 * Handles both string content and array content (Claude API format)
 * @param {object} message - Message object with content field
 * @returns {string} Extracted text content
 */
function extractContent(message) {
  if (!message || !message.message) {
    return '';
  }

  const content = message.message.content;

  if (!content) {
    return '';
  }

  // String content (simple format)
  if (typeof content === 'string') {
    return content;
  }

  // Array content (Claude API format with text blocks)
  if (Array.isArray(content)) {
    return content
      .map(block => block.text || '')
      .join('');
  }

  return '';
}

/**
 * Format a single message for context output
 * Spec Reference: §5.3 Context Format
 *
 * @param {object} message - Parsed message object
 * @returns {string} Formatted message string
 *
 * @example
 * // User message
 * formatMessage({ type: 'user', message: { content: 'Hello' }, timestamp: '2025-01-25T10:30:00Z' })
 * // Returns: "[User @ 10:30 AM] Hello"
 *
 * @example
 * // Tool use message
 * formatMessage({ type: 'tool_use', tool: 'Read', input: { path: 'file.ts' }, timestamp: '...' })
 * // Returns: "[Tool: Read file.ts]"
 */
function formatMessage(message) {
  if (!message || !message.type) {
    return '';
  }

  const time = message.timestamp ? formatTime(message.timestamp) : '';

  switch (message.type) {
    case 'user': {
      const content = extractContent(message);
      return `[User @ ${time}] ${content}`;
    }

    case 'assistant': {
      const content = extractContent(message);
      return `[Assistant @ ${time}] ${content}`;
    }

    case 'tool_use': {
      const toolName = message.tool || 'Unknown';
      const path = message.input?.path || '';
      return path ? `[Tool: ${toolName} ${path}]` : `[Tool: ${toolName}]`;
    }

    default:
      return '';
  }
}

/**
 * Format an array of messages into a context string
 * Spec Reference: §5.3 Context Format
 *
 * @param {object[]} messages - Array of parsed message objects
 * @returns {string} Formatted context string with messages separated by double newlines
 *
 * @example
 * // Format: [User @ 10:30] message\n\n[Assistant @ 10:31] response\n\n[Tool: Read path/file]
 */
function formatContext(messages) {
  if (!messages || messages.length === 0) {
    return '';
  }

  return messages
    .map(msg => formatMessage(msg))
    .filter(Boolean)
    .join('\n\n');
}

module.exports = {
  parseJSONLLine,
  readJSONL,
  extractTimestamp,
  formatMessage,
  formatContext
};
