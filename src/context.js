/**
 * Context Filtering Module
 *
 * Spec Reference: Section 5.3 Context Filtering Algorithm
 * Extracts and filters context from Claude Code sessions for sidecar use.
 */

const { readJSONL, formatContext } = require('./jsonl-parser');

/**
 * Parse a duration string into milliseconds
 * Spec Reference: §4.1 --context-since option
 *
 * @param {string} durationStr - Duration string (e.g., "30m", "2h", "1d")
 * @returns {number} Duration in milliseconds, or 0 if invalid
 *
 * @example
 * parseDuration('30m') // Returns: 1800000 (30 * 60 * 1000)
 * parseDuration('2h')  // Returns: 7200000 (2 * 60 * 60 * 1000)
 * parseDuration('1d')  // Returns: 86400000 (24 * 60 * 60 * 1000)
 */
function parseDuration(durationStr) {
  if (!durationStr || typeof durationStr !== 'string') {
    return 0;
  }

  const match = durationStr.match(/^(\d+)([mhd])$/);
  if (!match) {
    return 0;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = {
    m: 60 * 1000,           // minutes to ms
    h: 60 * 60 * 1000,      // hours to ms
    d: 24 * 60 * 60 * 1000  // days to ms
  };

  return value * multipliers[unit];
}

/**
 * Estimate token count from text
 * Spec Reference: §5.3 "~4 chars per token"
 *
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  // Spec specifies ~4 chars per token
  return Math.floor(text.length / 4);
}

/**
 * Extract the last N user turns from messages
 * A "turn" is defined as a user message plus all subsequent messages until the next user message.
 *
 * @param {object[]} messages - Array of message objects
 * @param {number} n - Number of turns to keep
 * @returns {object[]} Messages from the last N turns
 *
 * @example
 * // Given messages: [user1, assistant1, user2, assistant2, user3, assistant3]
 * // takeLastNTurns(messages, 2) returns: [user2, assistant2, user3, assistant3]
 */
function takeLastNTurns(messages, n) {
  if (!messages || messages.length === 0 || n <= 0) {
    return [];
  }

  // Find indices of all user messages (turns)
  const userIndices = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].type === 'user') {
      userIndices.push(i);
    }
  }

  // If we have fewer turns than requested, return all messages
  if (userIndices.length <= n) {
    return messages;
  }

  // Get the starting index for the last N turns
  const startTurnIndex = userIndices.length - n;
  const startIdx = userIndices[startTurnIndex];

  // Return all messages from that point
  return messages.slice(startIdx);
}

/**
 * Filter messages by time
 *
 * @param {object[]} messages - Array of message objects
 * @param {number} sinceMs - Duration in milliseconds
 * @returns {object[]} Messages within the time window
 */
function filterByTime(messages, sinceMs) {
  const cutoff = Date.now() - sinceMs;

  return messages.filter(msg => {
    if (!msg.timestamp) {
      return false;
    }
    const msgTime = new Date(msg.timestamp).getTime();
    return msgTime >= cutoff;
  });
}

/**
 * Truncate context from start to fit within token limit
 * Spec Reference: §5.3 "Truncate from start if over limit, prepend [Earlier context truncated...]"
 *
 * @param {string} context - Formatted context string
 * @param {number} maxTokens - Maximum token limit
 * @returns {string} Truncated context with notice if needed
 */
function truncateToTokenLimit(context, maxTokens) {
  const maxChars = maxTokens * 4; // ~4 chars per token

  if (context.length <= maxChars) {
    return context;
  }

  // Truncate from start, keeping the end (most recent)
  const truncated = context.slice(-maxChars);

  // Prepend truncation notice
  return '[Earlier context truncated...]\n\n' + truncated;
}

/**
 * Filter context from a Claude Code session
 * Spec Reference: §5.3 Context Filtering Algorithm
 *
 * @param {string} sessionPath - Path to the session JSONL file
 * @param {object} options - Filtering options
 * @param {number} [options.turns=50] - Max conversation turns to include
 * @param {string} [options.since] - Time filter (e.g., "2h"). Overrides turns if specified.
 * @param {number} [options.maxTokens=80000] - Hard cap on context tokens
 * @returns {string} Filtered and formatted context string
 *
 * @throws {Error} If session file cannot be read
 *
 * @example
 * // Filter last 50 turns, max 80000 tokens
 * filterContext('/path/to/session.jsonl', { turns: 50, maxTokens: 80000 })
 *
 * @example
 * // Filter by time (last 2 hours), overrides turns
 * filterContext('/path/to/session.jsonl', { since: '2h', turns: 50, maxTokens: 80000 })
 */
function filterContext(sessionPath, options = {}) {
  const {
    turns = 50,
    since,
    maxTokens = 80000
  } = options;

  // Read and parse the session file
  let messages = readJSONL(sessionPath);

  if (messages.length === 0) {
    return '';
  }

  // Apply filtering: time-based filter takes precedence over turns
  if (since) {
    const sinceMs = parseDuration(since);
    if (sinceMs > 0) {
      messages = filterByTime(messages, sinceMs);
    }
  } else if (turns) {
    messages = takeLastNTurns(messages, turns);
  }

  // Format messages into context string
  let context = formatContext(messages);

  // Truncate to token limit if needed
  if (estimateTokens(context) > maxTokens) {
    context = truncateToTokenLimit(context, maxTokens);
  }

  return context;
}

module.exports = {
  filterContext,
  parseDuration,
  estimateTokens,
  takeLastNTurns
};
