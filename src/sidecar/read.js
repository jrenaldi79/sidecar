/**
 * Sidecar Read Operations Module
 *
 * Handles reading and listing sidecar sessions.
 * Spec Reference: §4.2, §4.5
 */

const fs = require('fs');
const path = require('path');

/**
 * Format a timestamp as relative age
 * @param {string} dateStr - ISO date string
 * @returns {string} Relative age (e.g., "30m ago", "5h ago", "3d ago")
 */
function formatAge(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * List previous sidecar sessions
 * Spec Reference: §4.2
 *
 * @param {object} options
 * @param {string} [options.status] - Filter by status (all, running, complete)
 * @param {boolean} [options.json] - Output as JSON
 * @param {string} [options.project] - Project directory
 */
async function listSidecars(options) {
  const { status, json, project = process.cwd() } = options;

  const sessionsDir = path.join(project, '.claude', 'sidecar_sessions');

  if (!fs.existsSync(sessionsDir)) {
    console.log('No sidecar sessions found.');
    return;
  }

  let sessions = fs.readdirSync(sessionsDir)
    .filter(d => {
      const metaPath = path.join(sessionsDir, d, 'metadata.json');
      return fs.existsSync(metaPath);
    })
    .map(d => {
      const meta = JSON.parse(
        fs.readFileSync(path.join(sessionsDir, d, 'metadata.json'), 'utf-8')
      );
      return { ...meta, id: d };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Filter by status if specified
  if (status && status !== 'all') {
    sessions = sessions.filter(s => s.status === status);
  }

  if (sessions.length === 0) {
    console.log('No sidecar sessions found.');
    return;
  }

  if (json) {
    console.log(JSON.stringify(sessions, null, 2));
  } else {
    console.log('ID        MODEL                  STATUS     AGE         BRIEFING');
    console.log('─'.repeat(80));
    sessions.forEach(s => {
      const age = formatAge(s.createdAt);
      const briefingShort = (s.briefing || '').slice(0, 30) +
        ((s.briefing?.length > 30) ? '...' : '');
      console.log(
        `${(s.id || '').padEnd(10)}` +
        `${(s.model || '').padEnd(23)}` +
        `${(s.status || 'unknown').padEnd(11)}` +
        `${age.padEnd(12)}` +
        `${briefingShort}`
      );
    });
  }
}

/**
 * Read sidecar session data
 * Spec Reference: §4.5
 *
 * @param {object} options
 * @param {string} options.taskId - Task ID to read
 * @param {boolean} [options.conversation] - Read conversation
 * @param {boolean} [options.metadata] - Read metadata
 * @param {string} [options.project] - Project directory
 */
async function readSidecar(options) {
  const { taskId, conversation, metadata, project = process.cwd() } = options;

  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  if (conversation) {
    const convPath = path.join(sessionDir, 'conversation.jsonl');
    if (fs.existsSync(convPath)) {
      const lines = fs.readFileSync(convPath, 'utf-8').split('\n').filter(Boolean);
      lines.forEach(line => {
        try {
          const msg = JSON.parse(line);
          const time = new Date(msg.timestamp).toLocaleTimeString();
          console.log(`[${msg.role} @ ${time}] ${msg.content}\n`);
        } catch {
          // Skip malformed lines
        }
      });
    } else {
      console.log('No conversation recorded.');
    }
  } else if (metadata) {
    const metaPath = path.join(sessionDir, 'metadata.json');
    console.log(fs.readFileSync(metaPath, 'utf-8'));
  } else {
    // Default: show summary
    const summaryPath = path.join(sessionDir, 'summary.md');
    if (fs.existsSync(summaryPath)) {
      console.log(fs.readFileSync(summaryPath, 'utf-8'));
    } else {
      console.log('No summary available (session may not have been folded).');
    }
  }
}

module.exports = {
  formatAge,
  listSidecars,
  readSidecar
};
