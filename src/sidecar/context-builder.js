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
const { resolveExactSessionFile, resolveContextSessionScope } = require('../utils/sidecar-boundaries');

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

/** Resolve a session file, optionally requiring an exact match. */
function resolveSessionFile(sessionDir, session, options = {}) {
  if (options.exactSession) {
    return resolveExactSessionFile(sessionDir, session);
  }
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
 * Get the Cowork local-agent-mode-sessions root for the current platform.
 * @param {string} [homeDir] - Home directory override (for testing)
 * @returns {string} Path to local-agent-mode-sessions directory
 */
function getCoworkSessionsRoot(homeDir = os.homedir()) {
  // Cowork stores session data inside Claude Desktop's Application Support:
  // ~/Library/Application Support/Claude/local-agent-mode-sessions/<org>/<user>/local_<id>/audit.jsonl
  return path.join(homeDir, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
}

/**
 * Find a Cowork session's audit.jsonl by process name or fall back to most recent.
 * Scans ~/Library/Application Support/Claude/local-agent-mode-sessions/
 *
 * When coworkProcess is provided, matches the session metadata JSON file
 * whose processName matches. This is the reliable path for parallel sessions.
 * Falls back to most recently modified audit.jsonl when no process name given.
 *
 * @param {string} [homeDir] - Home directory override (for testing)
 * @param {string} [coworkProcess] - Cowork VM process name (e.g., 'modest-laughing-goodall')
 * @returns {string|null} Path to the matching audit.jsonl, or null
 */
function findCoworkSession(homeDir = os.homedir(), coworkProcess = null) {
  const root = getCoworkSessionsRoot(homeDir);
  if (!fs.existsSync(root)) {
    return null;
  }

  let bestPath = null;
  let bestMtime = 0;

  // Structure: root/<org-id>/<user-id>/local_<session-id>/audit.jsonl
  // Metadata: root/<org-id>/<user-id>/local_<session-id>.json (has processName)
  try {
    for (const org of fs.readdirSync(root)) {
      const orgPath = path.join(root, org);
      try { if (!fs.statSync(orgPath).isDirectory()) { continue; } } catch { continue; }

      for (const user of fs.readdirSync(orgPath)) {
        const userPath = path.join(orgPath, user);
        try { if (!fs.statSync(userPath).isDirectory()) { continue; } } catch { continue; }

        for (const session of fs.readdirSync(userPath)) {
          if (!session.startsWith('local_')) { continue; }
          const auditPath = path.join(userPath, session, 'audit.jsonl');

          // If matching by process name, check the metadata JSON
          if (coworkProcess) {
            const metaPath = path.join(userPath, `${session}.json`);
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
              if (meta.processName === coworkProcess) {
                logger.info('Matched Cowork session by processName', { coworkProcess, session });
                return fs.existsSync(auditPath) ? auditPath : null;
              }
            } catch {
              continue;
            }
            continue; // Skip mtime check when matching by process name
          }

          // Fallback: track most recent audit.jsonl
          try {
            const mtime = fs.statSync(auditPath).mtime.getTime();
            if (mtime > bestMtime) {
              bestMtime = mtime;
              bestPath = auditPath;
            }
          } catch {
            continue;
          }
        }
      }
    }
  } catch {
    return null;
  }

  return bestPath;
}

/**
 * Normalize Cowork audit.jsonl messages to match Claude Code JSONL format.
 * Maps _audit_timestamp → timestamp and filters to user/assistant messages.
 *
 * @param {Array} messages - Raw parsed audit.jsonl entries
 * @returns {Array} Normalized messages compatible with formatContext/applyContextFilters
 */
function normalizeCoworkMessages(messages) {
  return messages
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .map(m => ({
      ...m,
      timestamp: m.timestamp || m._audit_timestamp || null
    }));
}

/** Build context from Claude Code or Cowork session history. */
function buildContext(project, session, options = {}) {
  const {
    contextTurns = 50,
    contextSince,
    contextMaxTokens = 80000,
    sessionDir: sessionDirOverride,
    client,
    coworkProcess,
    parentProject,
    exactSession = false,
    _homeDir
  } = options;
  const homeDir = _homeDir || os.homedir();
  const { validatedProject, resolvedSessionDir } = resolveContextSessionScope({
    project,
    parentProject,
    sessionDir: sessionDirOverride,
    homeDir,
    getSessionDirectory
  });

  // Cowork context comes from Claude Desktop's host-side audit log.
  if (client === 'cowork' && !sessionDirOverride) {
    if (!coworkProcess) {
      throw new Error('Cowork context requires coworkProcess for exact session matching');
    }
    const auditPath = findCoworkSession(homeDir, coworkProcess);
    if (!auditPath) {
      logger.warn('No Cowork session found in local-agent-mode-sessions', { project: validatedProject });
      return '[No Claude Code conversation history found]';
    }

    logger.info('Using Cowork session', { auditPath });

    let messages;
    try {
      messages = readJSONL(auditPath);
    } catch (err) {
      logger.error('Error reading Cowork session', { error: err.message });
      return '[Error reading Claude Code session]';
    }

    messages = normalizeCoworkMessages(messages);
    if (messages.length === 0) {
      return '[Empty Claude Code session]';
    }

    messages = applyContextFilters(messages, { contextTurns, contextSince });
    let context = formatContext(messages);
    const maxChars = contextMaxTokens * 4;
    if (context.length > maxChars) {
      context = '[Earlier context truncated...]\n\n' + context.slice(-maxChars);
    }
    return context || '[No relevant context found]';
  }

  if (!fs.existsSync(resolvedSessionDir)) {
    if (exactSession) {
      throw new Error(`Exact session ${session} not found`);
    }
    logger.warn('No Claude Code conversation history found', { project, sessionDir: resolvedSessionDir, client });
    return '[No Claude Code conversation history found]';
  }

  // Resolve session file
  const resolution = resolveSessionFile(resolvedSessionDir, session, { exactSession });

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
  resolveExactSessionFile,
  applyContextFilters,
  findCoworkSession,
  normalizeCoworkMessages,
  getCoworkSessionsRoot
};
