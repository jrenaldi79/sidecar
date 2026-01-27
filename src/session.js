/**
 * Session Resolver
 *
 * Spec Reference: §5.1 Session Resolution, §5.2 Claude Code Conversation Storage
 * Resolves Claude Code session files using primary (explicit ID) and fallback (most recent) strategies.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Encode a project path for use as a directory name
 * Spec Reference: §5.2 Path Encoding
 *
 * @param {string} projectPath - Absolute project path (e.g., /Users/john/myproject)
 * @returns {string} Encoded path suitable for directory name (e.g., -Users-john-myproject)
 *
 * @example
 * encodeProjectPath('/Users/john/myproject')
 * // Returns: '-Users-john-myproject'
 */
function encodeProjectPath(projectPath) {
  // Replace slashes, backslashes, and underscores with dashes (matching Claude Code behavior)
  return projectPath.replace(/[/\\_]/g, '-');
}

/**
 * Decode an encoded path back to original format
 *
 * @param {string} encodedPath - Encoded path (e.g., -Users-john-myproject)
 * @returns {string} Decoded path with dashes converted back to slashes
 */
function decodeProjectPath(encodedPath) {
  // Replace dashes with slashes
  return encodedPath.replace(/-/g, '/');
}

/**
 * Get the session directory path for a project
 * Spec Reference: §5.2 Claude Code Conversation Storage
 *
 * @param {string} projectPath - Absolute project path
 * @param {string} [homeDir] - Optional home directory override (for testing)
 * @returns {string} Full path to the session directory
 *
 * @example
 * getSessionDirectory('/Users/john/myproject')
 * // Returns: '~/.claude/projects/-Users-john-myproject'
 */
function getSessionDirectory(projectPath, homeDir = os.homedir()) {
  const encodedPath = encodeProjectPath(projectPath);
  return path.join(homeDir, '.claude', 'projects', encodedPath);
}

/**
 * Extract session ID from a filename
 *
 * @param {string} filename - Session filename (e.g., abc123.jsonl or abc123)
 * @returns {string} Session ID without extension
 */
function getSessionId(filename) {
  return filename.replace(/\.jsonl$/, '');
}

/**
 * Resolve a Claude Code session file
 * Spec Reference: §5.1 Session Resolution (Primary + Fallback)
 *
 * Primary: Explicit session ID passed via --session
 * Fallback: Most recently modified .jsonl file
 *
 * @param {string} projectDir - Path to the session directory
 * @param {string} [sessionArg] - Session ID argument (explicit ID, 'current', or undefined)
 * @returns {{ path: string|null, method: string, warning?: string }}
 *
 * @example
 * // Explicit session
 * resolveSession('/path/to/sessions', 'abc123-def456')
 * // Returns: { path: '/path/to/sessions/abc123-def456.jsonl', method: 'explicit' }
 *
 * @example
 * // Fallback to most recent
 * resolveSession('/path/to/sessions', 'current')
 * // Returns: { path: '/path/to/sessions/most-recent.jsonl', method: 'fallback' }
 */
function resolveSession(projectDir, sessionArg) {
  // Check if directory exists
  if (!fs.existsSync(projectDir)) {
    return { path: null, method: 'error' };
  }

  // Primary: explicit session ID
  if (sessionArg && sessionArg !== 'current' && sessionArg !== '') {
    // Handle both full filename and just the UUID
    const filename = sessionArg.endsWith('.jsonl') ? sessionArg : `${sessionArg}.jsonl`;
    const sessionPath = path.join(projectDir, filename);

    if (fs.existsSync(sessionPath)) {
      return { path: sessionPath, method: 'explicit' };
    }

    // Explicit session not found, fall back to most recent with warning
    const fallback = findMostRecentSession(projectDir);
    if (fallback.path) {
      return {
        path: fallback.path,
        method: 'fallback',
        warning: `Session ${sessionArg} not found, falling back to most recent. For reliability, pass --session <id> explicitly.`
      };
    }

    return { path: null, method: 'error', warning: `Session ${sessionArg} not found and no fallback available.` };
  }

  // Fallback: most recently modified .jsonl file
  return findMostRecentSession(projectDir);
}

/**
 * Find the most recently modified .jsonl file in a directory
 * Also checks for ambiguity (multiple recent sessions)
 *
 * @param {string} projectDir - Path to the session directory
 * @returns {{ path: string|null, method: string, warning?: string }}
 */
function findMostRecentSession(projectDir) {
  let files;
  try {
    files = fs.readdirSync(projectDir);
  } catch (error) {
    return { path: null, method: 'error' };
  }

  // Get all .jsonl files with their modification times
  const sessions = files
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const filePath = path.join(projectDir, f);
      try {
        const stat = fs.statSync(filePath);
        return {
          name: f,
          path: filePath,
          mtime: stat.mtime.getTime()
        };
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime); // Sort by mtime descending

  if (sessions.length === 0) {
    return { path: null, method: 'fallback' };
  }

  // Check for ambiguity: multiple sessions modified in last 5 minutes
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const recentSessions = sessions.filter(s => s.mtime > fiveMinutesAgo);

  if (recentSessions.length > 1) {
    return {
      path: sessions[0].path,
      method: 'fallback',
      warning: `${recentSessions.length} active sessions detected. Using most recent. For reliability, pass --session <id> explicitly.`
    };
  }

  return { path: sessions[0].path, method: 'fallback' };
}

module.exports = {
  encodeProjectPath,
  decodeProjectPath,
  getSessionDirectory,
  getSessionId,
  resolveSession
};
