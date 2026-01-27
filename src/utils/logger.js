/**
 * Structured Logger Module
 *
 * Spec Reference: CLAUDE.md - Structured Logging Guidelines
 * Outputs JSON-formatted logs to stderr (stdout reserved for summary output).
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Get current log level from environment
 * @returns {number} Numeric log level
 */
function getCurrentLevel() {
  const levelName = process.env.LOG_LEVEL || 'info';
  return LOG_LEVELS[levelName] ?? LOG_LEVELS.info;
}

/**
 * Create a log entry and write to stderr
 * @param {string} level - Log level name
 * @param {string} msg - Log message
 * @param {object} ctx - Additional context fields
 */
function log(level, msg, ctx = {}) {
  const currentLevel = getCurrentLevel();
  const levelNum = LOG_LEVELS[level];

  if (levelNum > currentLevel) {
    return;
  }

  const entry = {
    level,
    msg,
    ...ctx,
    ts: new Date().toISOString()
  };

  console.error(JSON.stringify(entry));
}

/**
 * Structured logger with level-based filtering
 * @type {{error: Function, warn: Function, info: Function, debug: Function}}
 */
const logger = {
  /**
   * Log an error message
   * @param {string} msg - Error message
   * @param {object} [ctx] - Additional context
   */
  error: (msg, ctx = {}) => log('error', msg, ctx),

  /**
   * Log a warning message
   * @param {string} msg - Warning message
   * @param {object} [ctx] - Additional context
   */
  warn: (msg, ctx = {}) => log('warn', msg, ctx),

  /**
   * Log an info message
   * @param {string} msg - Info message
   * @param {object} [ctx] - Additional context
   */
  info: (msg, ctx = {}) => log('info', msg, ctx),

  /**
   * Log a debug message
   * @param {string} msg - Debug message
   * @param {object} [ctx] - Additional context
   */
  debug: (msg, ctx = {}) => log('debug', msg, ctx)
};

module.exports = { logger, LOG_LEVELS };
