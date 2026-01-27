/**
 * File Conflict Detection Module
 *
 * Spec Reference: Section 7.2 File Conflict Detection
 * Detects conflicts between sidecar file modifications and external changes.
 */

const fs = require('fs');
const path = require('path');

/**
 * Format a relative time string (e.g., "5 min ago")
 *
 * @param {Date|string} date - Date to format
 * @returns {string} Relative time string
 */
function formatRelativeTime(date) {
  const dateObj = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - dateObj.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) {
    return 'just now';
  }
  if (diffMins < 60) {
    return `${diffMins} min ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

/**
 * Detect file conflicts between sidecar and external modifications
 * Spec Reference: §7.2 File Conflict Detection
 *
 * Compares files written by the sidecar against their current modification times.
 * A conflict exists when a file was modified externally after the sidecar session started.
 *
 * @param {object} sidecarFiles - Object containing file tracking info
 * @param {string[]} sidecarFiles.written - Array of relative file paths written by sidecar
 * @param {string} projectDir - Project directory path
 * @param {Date|string} sessionStartTime - When the sidecar session started
 * @returns {object[]} Array of conflict objects
 *
 * @example
 * const conflicts = detectConflicts(
 *   { written: ['src/auth/TokenManager.ts'] },
 *   '/path/to/project',
 *   new Date(Date.now() - 5 * 60 * 1000)
 * );
 * // Returns: [{ file: 'src/auth/TokenManager.ts', sidecarAction: 'write', externalMtime: Date }]
 */
function detectConflicts(sidecarFiles, projectDir, sessionStartTime) {
  const conflicts = [];

  // Handle missing or empty written files list
  const writtenFiles = sidecarFiles?.written || [];
  if (writtenFiles.length === 0) {
    return conflicts;
  }

  // Normalize session start time to Date object
  const startTime = sessionStartTime instanceof Date
    ? sessionStartTime
    : new Date(sessionStartTime);

  for (const file of writtenFiles) {
    const filePath = path.join(projectDir, file);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      // File doesn't exist - no conflict (sidecar created it or it was deleted)
      continue;
    }

    try {
      const stat = fs.statSync(filePath);

      // Check if file was modified after session started
      if (stat.mtime > startTime) {
        conflicts.push({
          file,
          sidecarAction: 'write',
          externalMtime: stat.mtime
        });
      }
    } catch (error) {
      // Skip files we can't stat
      continue;
    }
  }

  return conflicts;
}

/**
 * Format conflict warning for summary output
 * Spec Reference: §7.2 Conflict Warning in Summary
 *
 * @param {object[]} conflicts - Array of conflict objects
 * @returns {string} Formatted warning string or empty string if no conflicts
 *
 * @example
 * formatConflictWarning([
 *   { file: 'src/auth/TokenManager.ts', sidecarAction: 'write', externalMtime: new Date() }
 * ]);
 * // Returns:
 * // ⚠️ **FILE CONFLICT WARNING**
 * // The following files were modified by both this sidecar AND externally:
 * // - src/auth/TokenManager.ts (external change: 5 min ago)
 * //
 * // **Review these changes carefully before accepting.**
 */
function formatConflictWarning(conflicts) {
  if (!conflicts || conflicts.length === 0) {
    return '';
  }

  const lines = [
    '\u26A0\uFE0F **FILE CONFLICT WARNING**',
    'The following files were modified by both this sidecar AND externally:'
  ];

  for (const conflict of conflicts) {
    const relativeTime = formatRelativeTime(conflict.externalMtime);
    lines.push(`- ${conflict.file} (external change: ${relativeTime})`);
  }

  lines.push('');
  lines.push('**Review these changes carefully before accepting.**');

  return lines.join('\n');
}

module.exports = {
  detectConflicts,
  formatConflictWarning
};
