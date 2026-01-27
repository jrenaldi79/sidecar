/**
 * Context Drift Detection Module
 *
 * Spec Reference: Section 7.3 Context Drift Indicator
 * Detects and reports context staleness in sidecar sessions.
 */

const fs = require('fs');
const { readJSONL } = require('./jsonl-parser');

/**
 * Count user turns in a session since a given time
 * A "turn" is defined as a user message.
 *
 * @param {string} sessionPath - Path to the session JSONL file
 * @param {Date|string} sinceTime - Count turns after this time
 * @returns {number} Number of user turns since the specified time
 */
function countTurnsSince(sessionPath, sinceTime) {
  // Handle non-existent file
  if (!fs.existsSync(sessionPath)) {
    return 0;
  }

  // Normalize time to Date
  const since = sinceTime instanceof Date ? sinceTime : new Date(sinceTime);

  let messages;
  try {
    messages = readJSONL(sessionPath);
  } catch (error) {
    return 0;
  }

  // Count user messages after sinceTime
  let count = 0;
  for (const msg of messages) {
    if (msg.type !== 'user') {
      continue;
    }

    // Skip messages without timestamps
    if (!msg.timestamp) {
      continue;
    }

    const msgTime = new Date(msg.timestamp);
    if (msgTime > since) {
      count++;
    }
  }

  return count;
}

/**
 * Check if drift is significant
 * Spec Reference: §7.3 "Significant threshold: >10 min OR >5 turns"
 *
 * @param {number} ageMinutes - Age of the sidecar session in minutes
 * @param {number} mainTurns - Number of turns in main session since sidecar started
 * @returns {boolean} True if drift is significant
 */
function isDriftSignificant(ageMinutes, mainTurns) {
  // Spec §7.3: isSignificant: ageMinutes > 10 || mainTurns > 5
  return ageMinutes > 10 || mainTurns > 5;
}

/**
 * Calculate context drift for a sidecar session
 * Spec Reference: §7.3 Context Drift Indicator
 *
 * @param {Date|string} sessionStartTime - When the sidecar session started
 * @param {string} mainSessionPath - Path to the main Claude Code session JSONL
 * @returns {object} Drift information
 * @returns {number} returns.ageMinutes - Minutes since sidecar started
 * @returns {number} returns.mainTurns - Turns in main session since sidecar started
 * @returns {boolean} returns.isSignificant - Whether drift exceeds thresholds
 *
 * @example
 * const drift = calculateDrift(sessionStartTime, '/path/to/main-session.jsonl');
 * // Returns: { ageMinutes: 23, mainTurns: 15, isSignificant: true }
 */
function calculateDrift(sessionStartTime, mainSessionPath) {
  // Normalize session start time
  const startTime = sessionStartTime instanceof Date
    ? sessionStartTime
    : new Date(sessionStartTime);

  // Calculate age in minutes
  const ageMs = Date.now() - startTime.getTime();
  const ageMinutes = Math.round(ageMs / 60000);

  // Count turns in main session since sidecar started
  const mainTurns = countTurnsSince(mainSessionPath, startTime);

  // Determine if drift is significant per spec §7.3
  const isSignificant = isDriftSignificant(ageMinutes, mainTurns);

  return {
    ageMinutes,
    mainTurns,
    isSignificant
  };
}

/**
 * Format drift warning for summary output
 * Spec Reference: §7.3 Context Drift Indicator format
 *
 * @param {object} drift - Drift object from calculateDrift
 * @returns {string} Formatted drift indicator string
 *
 * @example
 * formatDriftWarning({ ageMinutes: 23, mainTurns: 15, isSignificant: true })
 * // Returns:
 * // 📍 **Context Age:** 23 minutes (15 conversation turns in main session)
 * //
 * // ⚠️ **Drift Warning:** Main session has continued significantly since this
 * // sidecar started. Verify recommendations against current project state.
 */
function formatDriftWarning(drift) {
  if (!drift) {
    return '';
  }

  const lines = [
    `\uD83D\uDCCD **Context Age:** ${drift.ageMinutes} minutes (${drift.mainTurns} conversation turns in main session)`
  ];

  if (drift.isSignificant) {
    lines.push('');
    lines.push('\u26A0\uFE0F **Drift Warning:** Main session has continued significantly since this sidecar started. Verify recommendations against current project state.');
  }

  return lines.join('\n');
}

module.exports = {
  calculateDrift,
  formatDriftWarning,
  countTurnsSince,
  isDriftSignificant
};
