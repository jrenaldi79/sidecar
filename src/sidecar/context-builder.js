/**
 * Context Builder Module
 *
 * Handles building context from Claude Code sessions for sidecar operations.
 * Spec Reference: §5 Context Passing
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveSession, getSessionDirectory } = require('../session');
const { formatContext, readJSONL } = require('../jsonl-parser');
const { logger } = require('../utils/logger');

/**
 * Parse duration string (e.g., '2h', '30m', '1d')
 * @param {string} str - Duration string
 * @returns {number} Milliseconds
 */
function parseDuration(str) {
  if (!str || typeof str !== 'string') {
    return 0;
  }
  const match = str.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    return 0;
  }
  const multipliers = { m: 60000, h: 3600000, d: 86400000 };
  return parseInt(match[1], 10) * multipliers[match[2]];
}

/**
 * Resolve session file from session directory
 * @param {string} sessionDir - Session directory path
 * @param {string} session - Session ID or 'current'
 * @returns {{path: string|null, method: string, warning?: string}}
 */
function resolveSessionFile(sessionDir, session) {
  // Use the existing resolveSession function
  return resolveSession(sessionDir, session);
}

/**
 * Apply context filters to messages array
 * @param {Array} messages - Array of messages
 * @param {object} options - Filter options
 * @param {number} [options.contextTurns] - Max number of turns (user messages)
 * @param {string} [options.contextSince] - Time filter (e.g., '2h')
 * @param {number} [options._testCutoff] - Test-only: override time cutoff
 * @returns {Array} Filtered messages
 */
function applyContextFilters(messages, options) {
  if (!messages || messages.length === 0) {
    return [];
  }

  const { contextTurns, contextSince, _testCutoff } = options;
  let filtered = [...messages];

  // Apply time filter if specified (overrides turns)
  if (contextSince) {
    const cutoffMs = _testCutoff || (Date.now() - parseDuration(contextSince));
    filtered = filtered.filter(m => {
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      return ts >= cutoffMs;
    });
  } else if (contextTurns && contextTurns > 0) {
    // Apply turn filter - count user messages as turns
    const userIndices = filtered
      .map((m, i) => m.type === 'user' ? i : -1)
      .filter(i => i >= 0);

    if (userIndices.length > contextTurns) {
      const startIdx = userIndices[userIndices.length - contextTurns];
      filtered = filtered.slice(startIdx);
    }
  }

  return filtered;
}

/**
 * Build context from Claude Code session
 * Spec Reference: §5 Context Passing
 *
 * @param {string} project - Project directory
 * @param {string} session - Session ID or 'current'
 * @param {object} options - Context options
 * @param {number} [options.contextTurns=50] - Max conversation turns
 * @param {string} [options.contextSince] - Time filter (e.g., '2h')
 * @param {number} [options.contextMaxTokens=80000] - Max context tokens
 * @returns {string} Formatted context string
 */
function buildContext(project, session, options) {
  const { contextTurns = 50, contextSince, contextMaxTokens = 80000 } = options;

  // Get session directory for this project
  const sessionDir = getSessionDirectory(project, os.homedir());

  if (!fs.existsSync(sessionDir)) {
    logger.warn('No Claude Code conversation history found', { project });
    return '[No Claude Code conversation history found]';
  }

  // Resolve session file
  const resolution = resolveSessionFile(sessionDir, session);

  if (!resolution.path) {
    logger.warn('No Claude Code session found', { project, session });
    return '[No Claude Code conversation history found]';
  }

  if (resolution.warning) {
    logger.warn('Session resolution warning', { warning: resolution.warning });
  }

  logger.info('Using session', {
    session: path.basename(resolution.path),
    method: resolution.method
  });

  // Read and parse the session file
  let messages;
  try {
    messages = readJSONL(resolution.path);
  } catch (err) {
    logger.error('Error reading session', { error: err.message });
    return '[Error reading Claude Code session]';
  }

  if (messages.length === 0) {
    return '[Empty Claude Code session]';
  }

  // Apply filters
  messages = applyContextFilters(messages, { contextTurns, contextSince });

  // Format as context
  let context = formatContext(messages);

  // Truncate to token limit (~4 chars per token)
  const maxChars = contextMaxTokens * 4;
  if (context.length > maxChars) {
    context = '[Earlier context truncated...]\n\n' + context.slice(-maxChars);
  }

  return context || '[No relevant context found]';
}

module.exports = {
  buildContext,
  parseDuration,
  resolveSessionFile,
  applyContextFilters
};
