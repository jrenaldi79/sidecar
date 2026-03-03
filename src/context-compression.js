/**
 * Context Compression Module
 *
 * Provides token estimation and context compression utilities for
 * sidecar sessions. Determines whether context needs model-based
 * compression (delegated to the caller).
 *
 * @module context-compression
 */

const { logger } = require('./utils/logger');

/**
 * Default token limit for context compression
 * @type {number}
 */
const DEFAULT_TOKEN_LIMIT = 30000;

/**
 * Estimate the number of tokens in a text string.
 * Uses a simple heuristic: ceil(length / 4).
 *
 * @param {string|null|undefined} text - The text to estimate tokens for
 * @returns {number} Estimated token count (0 for empty/null/undefined)
 */
function estimateTokenCount(text) {
  if (!text) {
    return 0;
  }

  return Math.ceil(text.length / 4);
}

/**
 * Build a preamble string that identifies the working directory.
 *
 * @param {string} cwd - The current working directory path
 * @returns {string} Preamble string ending with double newline
 */
function buildPreamble(cwd) {
  return `You are working in ${cwd}. Here is the conversation:\n\n`;
}

/**
 * Compress context text for sidecar sessions.
 *
 * If the estimated token count is within the limit, returns the text
 * with a preamble prepended and compressed=false. If it exceeds the
 * limit, returns the full text with compressed=true and
 * needsModelCompression=true, signaling the caller to perform
 * model-based compression.
 *
 * @param {string} contextText - The raw context text to compress
 * @param {Object} [options] - Compression options
 * @param {string} [options.cwd=process.cwd()] - Working directory for preamble
 * @param {number} [options.tokenLimit=30000] - Maximum token threshold
 * @returns {Object} Compression result
 * @returns {string} result.text - Preamble + context text
 * @returns {boolean} result.compressed - Whether compression was triggered
 * @returns {boolean} result.needsModelCompression - Whether caller should run model compression
 * @returns {number} result.estimatedTokens - Estimated token count of the full text
 */
function compressContext(contextText, options = {}) {
  const { cwd = process.cwd(), tokenLimit = DEFAULT_TOKEN_LIMIT } = options;

  const preamble = buildPreamble(cwd);
  const fullText = preamble + contextText;
  const estimatedTokens = estimateTokenCount(fullText);

  if (estimatedTokens <= tokenLimit) {
    logger.debug('Context within token limit', {
      estimatedTokens,
      tokenLimit
    });

    return {
      text: fullText,
      compressed: false,
      needsModelCompression: false,
      estimatedTokens
    };
  }

  logger.info('Context exceeds token limit, model compression needed', {
    estimatedTokens,
    tokenLimit
  });

  return {
    text: fullText,
    compressed: true,
    needsModelCompression: true,
    estimatedTokens
  };
}

module.exports = {
  compressContext,
  estimateTokenCount,
  buildPreamble,
  DEFAULT_TOKEN_LIMIT
};
