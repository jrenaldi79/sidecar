/**
 * Sidecar Progress Reader
 *
 * Reads conversation.jsonl and progress.json from a session directory
 * and returns progress info: message count, last activity time, latest action,
 * and lifecycle stage.
 */

const fs = require('fs');
const path = require('path');

/** Lifecycle stage labels */
const STAGE_LABELS = {
  initializing: 'Starting OpenCode server...',
  server_ready: 'Server ready, creating session...',
  session_created: 'Session created',
  prompt_sent: 'Briefing delivered, waiting for response...',
  receiving: 'Generating response...',
  complete: 'Complete'
};

/**
 * Extract the latest action description from parsed JSONL entries.
 *
 * @param {object[]} entries - Parsed JSONL entries
 * @returns {string} Short description of last assistant action
 */
function extractLatest(entries) {
  const assistantEntries = entries.filter(e => e.role === 'assistant');

  if (assistantEntries.length === 0) {
    return 'Starting up...';
  }

  const last = assistantEntries[assistantEntries.length - 1];

  // Tool use entry with name
  if (last.toolCall && last.toolCall.name) {
    return `Using ${last.toolCall.name}`;
  }

  // Text content: take first line, truncate to 80 chars
  if (last.content) {
    const firstLine = String(last.content).split('\n')[0];
    if (!firstLine) {
      return 'Working...';
    }
    if (firstLine.length > 80) {
      return firstLine.slice(0, 80) + '...';
    }
    return firstLine;
  }

  // Tool use entry without name (SDK may not populate part.name)
  if (last.type === 'tool_use' || last.toolCall) {
    return 'Executing tool call...';
  }

  // Assistant entry exists but has no recognizable content
  return 'Working...';
}

/**
 * Compute a relative time string from a file mtime.
 *
 * @param {Date|null|undefined} mtime - File modification time
 * @returns {string} Relative time (e.g., "12s ago", "3m ago", "2h ago", "never")
 */
function computeLastActivity(mtime) {
  if (!mtime) {
    return 'never';
  }

  const diffMs = Date.now() - mtime.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

/**
 * Write a progress update to progress.json.
 *
 * @param {string} sessionDir - Path to the session directory
 * @param {string} stage - Lifecycle stage name
 * @param {object} [extra={}] - Additional fields (e.g., messagesReceived)
 */
function writeProgress(sessionDir, stage, extra = {}) {
  const progressPath = path.join(sessionDir, 'progress.json');
  const data = {
    stage,
    stageLabel: STAGE_LABELS[stage] || stage,
    updatedAt: new Date().toISOString(),
    ...extra
  };
  fs.writeFileSync(progressPath, JSON.stringify(data), { mode: 0o600 });
}

/**
 * Read progress from a session's conversation.jsonl and progress.json files.
 *
 * @param {string} sessionDir - Path to the session directory
 * @returns {{ messages: number, lastActivity: string, latest: string, stage?: string }}
 */
function readProgress(sessionDir) {
  const convPath = path.join(sessionDir, 'conversation.jsonl');
  const progressPath = path.join(sessionDir, 'progress.json');

  let convStat = null;
  const entries = [];

  // Read conversation.jsonl if it exists
  if (fs.existsSync(convPath)) {
    convStat = fs.statSync(convPath);
    const content = fs.readFileSync(convPath, 'utf-8');

    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Count assistant messages from conversation.jsonl
  let messages = entries.filter(e => e.role === 'assistant').length;

  // Extract latest action from conversation.jsonl
  let latest = extractLatest(entries);

  // Determine lastActivity from conversation.jsonl mtime
  let lastActivity = convStat
    ? computeLastActivity(convStat.mtime)
    : 'never';

  // Read progress.json for lifecycle stage info and stall detection
  let stage;
  let lastActivityMs = null;
  if (convStat) {
    lastActivityMs = Date.now() - convStat.mtime.getTime();
  }

  if (fs.existsSync(progressPath)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
      stage = progress.stage;

      // Use progress stage label when no assistant entries exist yet
      if (messages === 0 && progress.stageLabel) {
        latest = progress.stageLabel;
      }

      // Use progress.json latestTool for better latest when extractLatest
      // returns a generic fallback (tool_use entries without name)
      if (messages > 0 && progress.latestTool && (latest === 'Working...' || latest === 'Executing tool call...')) {
        latest = `Calling tool: ${progress.latestTool}`;
      }

      // Use messagesReceived from progress when conversation has no assistant entries
      if (messages === 0 && progress.messagesReceived !== undefined) {
        messages = progress.messagesReceived;
      }

      // Use progress updatedAt for lastActivity/lastActivityMs if more recent
      if (progress.updatedAt) {
        const progressTime = new Date(progress.updatedAt);
        if (!isNaN(progressTime.getTime())) {
          if (!convStat || progressTime > convStat.mtime) {
            lastActivity = computeLastActivity(progressTime);
          }
          const progressMs = Date.now() - progressTime.getTime();
          if (lastActivityMs === null || progressMs < lastActivityMs) {
            lastActivityMs = progressMs;
          }
        }
      }
    } catch {
      // Ignore malformed progress file
    }
  }

  const result = { messages, lastActivity, latest, lastActivityMs };
  if (stage !== undefined) {
    result.stage = stage;
  }
  return result;
}

module.exports = {
  readProgress,
  writeProgress,
  extractLatest,
  computeLastActivity,
  STAGE_LABELS
};
