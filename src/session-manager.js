/**
 * Session Manager Module
 *
 * Spec Reference: Section 8.1 What Gets Persisted, Section 7.4 Metadata Tracking
 * Manages persistence of sidecar session data.
 */

const fs = require('fs');
const path = require('path');

/**
 * Session status constants
 */
const SESSION_STATUS = {
  RUNNING: 'running',
  COMPLETE: 'complete',
  ERROR: 'error',
  TIMEOUT: 'timeout'
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
  const sessionDir = getSessionDir(projectDir, taskId);

  // Check if session already exists
  if (fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} already exists`);
  }

  // Create session directory
  fs.mkdirSync(sessionDir, { recursive: true });

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
  fs.writeFileSync(
    path.join(sessionDir, 'metadata.json'),
    JSON.stringify(sessionMetadata, null, 2)
  );

  // Create empty conversation.jsonl
  fs.writeFileSync(path.join(sessionDir, 'conversation.jsonl'), '');
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
  const sessionDir = getSessionDir(projectDir, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // Read existing metadata
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

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
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

/**
 * Get session metadata
 *
 * @param {string} projectDir - Project directory path
 * @param {string} taskId - Task identifier
 * @returns {object|null} Session metadata or null if not found
 */
function getSession(projectDir, taskId) {
  const sessionDir = getSessionDir(projectDir, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
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
  const sessionDir = getSessionDir(projectDir, taskId);
  const convPath = path.join(sessionDir, 'conversation.jsonl');

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // Ensure timestamp is present
  const messageWithTimestamp = {
    ...message,
    timestamp: message.timestamp || new Date().toISOString()
  };

  // Append to conversation.jsonl
  fs.appendFileSync(convPath, JSON.stringify(messageWithTimestamp) + '\n');
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
  const sessionDir = getSessionDir(projectDir, taskId);
  const summaryPath = path.join(sessionDir, 'summary.md');

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  // Write summary file
  fs.writeFileSync(summaryPath, summary);

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
  const subagentDir = getSubagentDir(projectDir, parentTaskId, subagentId);

  // Create sub-agent directory
  fs.mkdirSync(subagentDir, { recursive: true });

  // Build sub-agent metadata
  const subagentMetadata = {
    subagentId,
    parentTaskId,
    agentType: metadata.agentType,
    briefing: metadata.briefing,
    status: SESSION_STATUS.RUNNING,
    createdAt: new Date().toISOString(),
    completedAt: null
  };

  // Write metadata
  fs.writeFileSync(
    path.join(subagentDir, 'metadata.json'),
    JSON.stringify(subagentMetadata, null, 2)
  );

  // Initialize empty conversation file
  fs.writeFileSync(path.join(subagentDir, 'conversation.jsonl'), '');

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
  const subagentDir = getSubagentDir(projectDir, parentTaskId, subagentId);
  const metadataPath = path.join(subagentDir, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Sub-agent ${subagentId} not found`);
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  const updated = { ...metadata, ...updates };
  fs.writeFileSync(metadataPath, JSON.stringify(updated, null, 2));
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
  const metadataPath = path.join(getSubagentDir(projectDir, parentTaskId, subagentId), 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
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
  const subagentsDir = path.join(getSessionDir(projectDir, parentTaskId), 'subagents');

  if (!fs.existsSync(subagentsDir)) {
    return [];
  }

  const subagentIds = fs.readdirSync(subagentsDir).filter(name => {
    const stat = fs.statSync(path.join(subagentsDir, name));
    return stat.isDirectory();
  });

  let subagents = subagentIds.map(id => {
    const metadata = getSubagentSession(projectDir, parentTaskId, id);
    return metadata;
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
  const subagentDir = getSubagentDir(projectDir, parentTaskId, subagentId);
  const summaryPath = path.join(subagentDir, 'summary.md');

  fs.writeFileSync(summaryPath, summary);

  // Update sub-agent status
  updateSubagentSession(projectDir, parentTaskId, subagentId, {
    status: SESSION_STATUS.COMPLETE,
    completedAt: new Date().toISOString()
  });
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
  saveSubagentSummary
};
