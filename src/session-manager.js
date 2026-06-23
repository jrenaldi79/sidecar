/**
 * Session Manager Module
 *
 * Spec Reference: Section 8.1 What Gets Persisted, Section 7.4 Metadata Tracking
 * Manages persistence of sidecar session data.
 */

const fs = require('fs');
const path = require('path');
const {
  appendContainedSessionFile,
  ensureSidecarSessionDir,
  ensureSidecarSubagentSessionDir,
  readContainedSessionFile,
  validateSidecarSessionDir,
  validateSidecarSubagentSessionDir,
  writeContainedSessionFile
} = require('./utils/sidecar-session-boundaries');

/**
 * Session status constants
 */
const SESSION_STATUS = {
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  ABORTED: 'aborted',
  CRASHED: 'crashed'
};

/**
 * Get the session directory path for a task
 * Spec Reference: §8.1 Session directory structure
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Sidecar task ID
 * @returns {string} Path to the session directory
 *
 * @example
 * getSessionDir('/path/to/project', 'abc123')
 * // Returns: '/path/to/project/.claude/sidecar_sessions/abc123'
 */
function getSessionDir(projectDir, taskId) {
  return path.join(projectDir, '.claude', 'sidecar_sessions', taskId);
}

/**
 * Create a new sidecar session
 * Spec Reference: §8.1 What Gets Persisted
 *
 * Creates the session directory structure:
 * .claude/sidecar_sessions/<taskId>/
 * ├── metadata.json
 * └── conversation.jsonl
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Unique task identifier
 * @param {object} metadata - Session metadata
 * @param {string} metadata.model - Model being used (e.g., "google/gemini-2.5")
 * @param {string} metadata.project - Project path
 * @param {string} [metadata.briefing] - Task briefing
 * @param {string} [metadata.mode] - Mode: 'interactive' or 'headless'
 * @param {string} [metadata.thinking='medium'] - Thinking/reasoning intensity level
 * @throws {Error} If session already exists
 */
function createSession(projectDir, taskId, metadata) {
  const sessionDir = ensureSidecarSessionDir(projectDir, taskId, { allowExisting: false });

  // Build metadata per spec §7.4
  const sessionMetadata = {
    taskId,
    model: metadata.model,
    project: metadata.project || projectDir,
    briefing: metadata.briefing || '',
    mode: metadata.mode || 'interactive',
    thinking: metadata.thinking || 'medium',
    status: SESSION_STATUS.RUNNING,
    createdAt: new Date().toISOString(),
    completedAt: null,
    // File tracking per spec §7.4
    filesRead: [],
    filesWritten: [],
    conflicts: [],
    contextDrift: null
  };

  // Write metadata.json
  writeContainedSessionFile(
    sessionDir,
    'metadata.json',
    JSON.stringify(sessionMetadata, null, 2),
    { mode: 0o600 }
  );

  // Create empty conversation.jsonl
  writeContainedSessionFile(sessionDir, 'conversation.jsonl', '', { mode: 0o600 });
}

/**
 * Update session metadata
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Task identifier
 * @param {object} updates - Fields to update
 * @throws {Error} If session not found
 */
function updateSession(projectDir, taskId, updates) {
  const sessionDir = validateSidecarSessionDir(projectDir, taskId);
  const metadataText = readContainedSessionFile(sessionDir, 'metadata.json', { optional: true });

  if (metadataText === null) {
    throw new Error(`Session ${taskId} not found`);
  }

  // Read existing metadata
  const metadata = JSON.parse(metadataText);

  // Merge updates
  // For array fields, we append rather than replace
  if (updates.filesRead) {
    metadata.filesRead = [...new Set([...metadata.filesRead, ...updates.filesRead])];
    delete updates.filesRead;
  }
  if (updates.filesWritten) {
    metadata.filesWritten = [...new Set([...metadata.filesWritten, ...updates.filesWritten])];
    delete updates.filesWritten;
  }
  if (updates.conflicts) {
    metadata.conflicts = [...metadata.conflicts, ...updates.conflicts];
    delete updates.conflicts;
  }

  // Apply remaining updates
  Object.assign(metadata, updates);

  // Write updated metadata
  writeContainedSessionFile(sessionDir, 'metadata.json', JSON.stringify(metadata, null, 2), { mode: 0o600 });
}

/**
 * Get session metadata
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Task identifier
 * @returns {object|null} Session metadata or null if not found
 */
function getSession(projectDir, taskId) {
  let sessionDir;
  try {
    sessionDir = validateSidecarSessionDir(projectDir, taskId);
  } catch (err) {
    if (/not found/i.test(err.message)) {
      return null;
    }
    throw err;
  }

  const metadataText = readContainedSessionFile(sessionDir, 'metadata.json', { optional: true });
  return metadataText === null ? null : JSON.parse(metadataText);
}

/**
 * Save a message to the conversation log
 * Spec Reference: §8.2 Conversation Capture
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Task identifier
 * @param {object} message - Message to save
 * @param {string} message.role - Message role ('user', 'assistant', 'system')
 * @param {string} message.content - Message content
 * @param {string} [message.timestamp] - ISO timestamp (auto-generated if not provided)
 * @throws {Error} If session not found
 */
function saveConversation(projectDir, taskId, message) {
  const sessionDir = validateSidecarSessionDir(projectDir, taskId);

  // Ensure timestamp is present
  const messageWithTimestamp = {
    ...message,
    timestamp: message.timestamp || new Date().toISOString()
  };

  // Append to conversation.jsonl
  appendContainedSessionFile(
    sessionDir,
    'conversation.jsonl',
    JSON.stringify(messageWithTimestamp) + '\n',
    { mode: 0o600 }
  );
}

/**
 * Save the session summary
 * Spec Reference: §8.1 summary.md
 *
 * Also updates session status to complete with completedAt timestamp.
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Task identifier
 * @param {string} summary - Summary content (markdown)
 * @throws {Error} If session not found
 */
function saveSummary(projectDir, taskId, summary) {
  const sessionDir = validateSidecarSessionDir(projectDir, taskId);

  // Write summary file
  writeContainedSessionFile(sessionDir, 'summary.md', summary, { mode: 0o600 });

  // Update session status
  updateSession(projectDir, taskId, {
    status: SESSION_STATUS.COMPLETE,
    completedAt: new Date().toISOString()
  });
}

/**
 * Get the sub-agent session directory path
 *
 * @param {string} projectDir - Project directory path
 * @param {string} parentTaskId - Parent sidecar task ID
 * @param {string} subagentId - Sub-agent ID
 * @returns {string} Path to the sub-agent session directory
 *
 * @example
 * getSubagentDir('/path/to/project', 'abc123', 'subagent-xyz')
 * // Returns: '/path/to/project/.claude/sidecar_sessions/abc123/subagents/subagent-xyz'
 */
function getSubagentDir(projectDir, parentTaskId, subagentId) {
  return path.join(getSessionDir(projectDir, parentTaskId), 'subagents', subagentId);
}

/**
 * Create a sub-agent session
 *
 * Creates the sub-agent directory structure:
 * .claude/sidecar_sessions/<parentTaskId>/subagents/<subagentId>/
 * ├── metadata.json
 * └── conversation.jsonl
 *
 * @param {string} projectDir - Project directory path
 * @param {string} parentTaskId - Parent sidecar task ID
 * @param {string} subagentId - Sub-agent ID
 * @param {object} metadata - Sub-agent metadata
 * @param {string} metadata.agentType - Agent type (general, explore, security, test)
 * @param {string} metadata.briefing - Task briefing
 * @returns {string} Path to the created sub-agent directory
 */
function createSubagentSession(projectDir, parentTaskId, subagentId, metadata) {
  const subagentDir = ensureSidecarSubagentSessionDir(projectDir, parentTaskId, subagentId, {
    allowExisting: false
  });

  // Build sub-agent metadata
  const subagentMetadata = {
    subagentId,
    parentTaskId,
    agentType: metadata.agentType,
    briefing: metadata.briefing,
    backend: metadata.backend || 'unknown',
    status: metadata.status || SESSION_STATUS.RUNNING,
    sandboxMode: metadata.sandboxMode || null,
    pid: metadata.pid || null,
    exitCode: metadata.exitCode ?? null,
    reason: metadata.reason || null,
    createdAt: metadata.createdAt || new Date().toISOString(),
    completedAt: metadata.completedAt || null
  };

  // Write metadata
  writeContainedSessionFile(
    subagentDir,
    'metadata.json',
    JSON.stringify(subagentMetadata, null, 2),
    { mode: 0o600 }
  );

  // Initialize empty conversation file
  writeContainedSessionFile(subagentDir, 'conversation.jsonl', '', { mode: 0o600 });

  return subagentDir;
}

/**
 * Update a sub-agent session
 *
 * @param {string} projectDir - Project directory path
 * @param {string} parentTaskId - Parent sidecar task ID
 * @param {string} subagentId - Sub-agent ID
 * @param {object} updates - Fields to update
 */
function updateSubagentSession(projectDir, parentTaskId, subagentId, updates) {
  const subagentDir = validateSidecarSubagentSessionDir(projectDir, parentTaskId, subagentId);
  const metadataText = readContainedSessionFile(subagentDir, 'metadata.json', { optional: true });

  if (metadataText === null) {
    throw new Error(`Sub-agent ${subagentId} not found`);
  }

  const metadata = JSON.parse(metadataText);
  const updated = { ...metadata, ...updates };
  writeContainedSessionFile(
    subagentDir,
    'metadata.json',
    JSON.stringify(updated, null, 2),
    { mode: 0o600 }
  );
}

/**
 * Get a sub-agent session
 *
 * @param {string} projectDir - Project directory path
 * @param {string} parentTaskId - Parent sidecar task ID
 * @param {string} subagentId - Sub-agent ID
 * @returns {object|null} Sub-agent metadata or null if not found
 */
function getSubagentSession(projectDir, parentTaskId, subagentId) {
  let subagentDir;
  try {
    subagentDir = validateSidecarSubagentSessionDir(projectDir, parentTaskId, subagentId);
  } catch (err) {
    if (/not found/i.test(err.message)) {
      return null;
    }
    throw err;
  }

  const metadataText = readContainedSessionFile(subagentDir, 'metadata.json', { optional: true });
  if (metadataText === null) {
    return null;
  }

  return JSON.parse(metadataText);
}

/**
 * List all sub-agents for a parent session
 *
 * @param {string} projectDir - Project directory path
 * @param {string} parentTaskId - Parent sidecar task ID
 * @param {object} [filter] - Optional filter options
 * @param {string} [filter.status] - Filter by status
 * @param {string} [filter.agentType] - Filter by agent type
 * @returns {object[]} Array of sub-agent metadata
 */
function listSubagents(projectDir, parentTaskId, filter = {}) {
  let parentDir;
  try {
    parentDir = validateSidecarSessionDir(projectDir, parentTaskId);
  } catch {
    return [];
  }
  const subagentsDir = path.join(parentDir, 'subagents');

  if (!fs.existsSync(subagentsDir)) {
    return [];
  }

  let subagents = fs.readdirSync(subagentsDir).map(id => {
    try {
      return getSubagentSession(projectDir, parentTaskId, id);
    } catch {
      return null;
    }
  }).filter(Boolean);

  // Apply filters
  if (filter.status) {
    subagents = subagents.filter(s => s.status === filter.status);
  }
  if (filter.agentType) {
    subagents = subagents.filter(s => s.agentType === filter.agentType);
  }

  return subagents;
}

/**
 * Save sub-agent summary
 *
 * @param {string} projectDir - Project directory path
 * @param {string} parentTaskId - Parent sidecar task ID
 * @param {string} subagentId - Sub-agent ID
 * @param {string} summary - Summary content
 */
function saveSubagentSummary(projectDir, parentTaskId, subagentId, summary) {
  const subagentDir = validateSidecarSubagentSessionDir(projectDir, parentTaskId, subagentId);

  writeContainedSessionFile(subagentDir, 'summary.md', summary, { mode: 0o600 });

  // Update sub-agent status
  updateSubagentSession(projectDir, parentTaskId, subagentId, {
    status: SESSION_STATUS.COMPLETE,
    completedAt: new Date().toISOString()
  });
}

/**
 * Append a message to a sub-agent conversation log.
 *
 * @param {string} projectDir - Project directory path
 * @param {string} parentTaskId - Parent sidecar task ID
 * @param {string} subagentId - Sub-agent ID
 * @param {object} message - Message to append
 */
function appendSubagentConversation(projectDir, parentTaskId, subagentId, message) {
  const subagentDir = validateSidecarSubagentSessionDir(projectDir, parentTaskId, subagentId);

  const payload = {
    ...message,
    timestamp: message.timestamp || new Date().toISOString()
  };
  appendContainedSessionFile(
    subagentDir,
    'conversation.jsonl',
    JSON.stringify(payload) + '\n',
    { mode: 0o600 }
  );
}

module.exports = {
  createSession,
  updateSession,
  getSession,
  saveConversation,
  saveSummary,
  getSessionDir,
  SESSION_STATUS,
  // Sub-agent functions
  getSubagentDir,
  createSubagentSession,
  updateSubagentSession,
  getSubagentSession,
  listSubagents,
  saveSubagentSummary,
  appendSubagentConversation
};
