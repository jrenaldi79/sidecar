/**
 * File Conflict Detection Tests
 *
 * Spec Reference: Section 7.2 File Conflict Detection
 * Tests detection of file conflicts between sidecar and external modifications.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Module under test
const {
  detectConflicts,
  formatConflictWarning
} = require('../src/conflict');

describe('File Conflict Detection', () => {
  let tempDir;
  let projectDir;

  beforeEach(() => {
    // Create temporary project directory with some files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-conflict-test-'));
    projectDir = tempDir;

    // Create project file structure
    fs.mkdirSync(path.join(projectDir, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src', 'api'), { recursive: true });
  });

  afterEach(() => {
    // Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectConflicts', () => {
    it('should detect no conflicts when files unchanged since session start', () => {
      // Create file before session
      const filePath = path.join(projectDir, 'src', 'auth', 'TokenManager.ts');
      fs.writeFileSync(filePath, 'original content');

      // Set mtime to before session start
      const beforeSession = Date.now() / 1000 - 300; // 5 minutes ago
      fs.utimesSync(filePath, beforeSession, beforeSession);

      // Session started after file was last modified
      const sessionStartTime = new Date(Date.now() - 60 * 1000); // 1 minute ago

      const sidecarFiles = {
        written: ['src/auth/TokenManager.ts']
      };

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      expect(conflicts).toHaveLength(0);
    });

    it('should detect conflict when file modified after session start per spec §7.2', () => {
      // Session started 5 minutes ago
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000);

      // Create file with recent mtime (after session start)
      const filePath = path.join(projectDir, 'src', 'auth', 'TokenManager.ts');
      fs.writeFileSync(filePath, 'modified content');

      const sidecarFiles = {
        written: ['src/auth/TokenManager.ts']
      };

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].file).toBe('src/auth/TokenManager.ts');
      expect(conflicts[0].sidecarAction).toBe('write');
      expect(conflicts[0].externalMtime).toBeDefined();
    });

    it('should return conflict object with required fields per spec §7.2', () => {
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000);

      const filePath = path.join(projectDir, 'src', 'api', 'client.ts');
      fs.writeFileSync(filePath, 'content');

      const sidecarFiles = { written: ['src/api/client.ts'] };
      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);

      // Spec §7.2: { file, sidecarAction, externalMtime }
      expect(conflicts[0]).toHaveProperty('file');
      expect(conflicts[0]).toHaveProperty('sidecarAction');
      expect(conflicts[0]).toHaveProperty('externalMtime');
    });

    it('should detect multiple conflicts', () => {
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000);

      // Create multiple files
      fs.writeFileSync(path.join(projectDir, 'src', 'auth', 'TokenManager.ts'), 'content1');
      fs.writeFileSync(path.join(projectDir, 'src', 'api', 'client.ts'), 'content2');

      const sidecarFiles = {
        written: ['src/auth/TokenManager.ts', 'src/api/client.ts']
      };

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);

      expect(conflicts).toHaveLength(2);
      expect(conflicts.map(c => c.file)).toContain('src/auth/TokenManager.ts');
      expect(conflicts.map(c => c.file)).toContain('src/api/client.ts');
    });

    it('should ignore files not in written list', () => {
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000);

      // Create file that was modified but not in sidecar's written list
      fs.writeFileSync(path.join(projectDir, 'src', 'auth', 'other.ts'), 'content');

      const sidecarFiles = {
        written: ['src/auth/TokenManager.ts'] // Different file
      };

      // TokenManager doesn't exist, so no conflict
      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      expect(conflicts).toHaveLength(0);
    });

    it('should handle files that do not exist (new files created by sidecar)', () => {
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000);

      const sidecarFiles = {
        written: ['src/new-file.ts'] // File doesn't exist
      };

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      expect(conflicts).toHaveLength(0);
    });

    it('should handle empty written files list', () => {
      const sessionStartTime = new Date();
      const sidecarFiles = { written: [] };

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      expect(conflicts).toHaveLength(0);
    });

    it('should handle undefined written files', () => {
      const sessionStartTime = new Date();
      const sidecarFiles = {};

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      expect(conflicts).toHaveLength(0);
    });

    it('should use Date object for sessionStartTime', () => {
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000);
      const filePath = path.join(projectDir, 'src', 'auth', 'TokenManager.ts');
      fs.writeFileSync(filePath, 'content');

      const sidecarFiles = { written: ['src/auth/TokenManager.ts'] };

      // Should not throw when sessionStartTime is a Date
      expect(() => {
        detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      }).not.toThrow();
    });

    it('should handle timestamp as ISO string', () => {
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const filePath = path.join(projectDir, 'src', 'auth', 'TokenManager.ts');
      fs.writeFileSync(filePath, 'content');

      const sidecarFiles = { written: ['src/auth/TokenManager.ts'] };

      // Should handle ISO string
      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      expect(conflicts).toHaveLength(1);
    });
  });

  describe('formatConflictWarning', () => {
    it('should format warning per spec §7.2', () => {
      const conflicts = [
        {
          file: 'src/auth/TokenManager.ts',
          sidecarAction: 'write',
          externalMtime: new Date(Date.now() - 5 * 60 * 1000)
        }
      ];

      const warning = formatConflictWarning(conflicts);

      // Spec §7.2: format as "FILE CONFLICT WARNING"
      expect(warning).toContain('FILE CONFLICT WARNING');
      expect(warning).toContain('src/auth/TokenManager.ts');
    });

    it('should include relative time for each conflict', () => {
      const conflicts = [
        {
          file: 'src/auth/TokenManager.ts',
          sidecarAction: 'write',
          externalMtime: new Date(Date.now() - 5 * 60 * 1000)
        }
      ];

      const warning = formatConflictWarning(conflicts);

      // Should include something like "5 min ago"
      expect(warning).toMatch(/\d+ min ago|\d+ hour/);
    });

    it('should list all conflicting files', () => {
      const conflicts = [
        {
          file: 'src/auth/TokenManager.ts',
          sidecarAction: 'write',
          externalMtime: new Date(Date.now() - 5 * 60 * 1000)
        },
        {
          file: 'src/api/client.ts',
          sidecarAction: 'write',
          externalMtime: new Date(Date.now() - 2 * 60 * 1000)
        }
      ];

      const warning = formatConflictWarning(conflicts);

      expect(warning).toContain('src/auth/TokenManager.ts');
      expect(warning).toContain('src/api/client.ts');
    });

    it('should include review instruction per spec §7.2', () => {
      const conflicts = [
        {
          file: 'src/auth/TokenManager.ts',
          sidecarAction: 'write',
          externalMtime: new Date()
        }
      ];

      const warning = formatConflictWarning(conflicts);

      // Spec §7.2: "Review these changes carefully before accepting."
      expect(warning).toContain('Review');
    });

    it('should return empty string for no conflicts', () => {
      const warning = formatConflictWarning([]);
      expect(warning).toBe('');
    });

    it('should use emoji warning indicator', () => {
      const conflicts = [
        {
          file: 'test.ts',
          sidecarAction: 'write',
          externalMtime: new Date()
        }
      ];

      const warning = formatConflictWarning(conflicts);

      // Spec §7.2: Warning format starts with WARNING emoji
      expect(warning).toContain('\u26A0\uFE0F'); // Warning emoji
    });
  });

  describe('Edge cases', () => {
    it('should handle deeply nested file paths', () => {
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000);

      const nestedDir = path.join(projectDir, 'src', 'very', 'deep', 'nested');
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(nestedDir, 'file.ts'), 'content');

      const sidecarFiles = {
        written: ['src/very/deep/nested/file.ts']
      };

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].file).toBe('src/very/deep/nested/file.ts');
    });

    it('should handle files with special characters in name', () => {
      const sessionStartTime = new Date(Date.now() - 5 * 60 * 1000);

      const filePath = path.join(projectDir, 'src', 'file-with-dashes_and_underscores.ts');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'content');

      const sidecarFiles = {
        written: ['src/file-with-dashes_and_underscores.ts']
      };

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      expect(conflicts).toHaveLength(1);
    });

    it('should handle concurrent modifications', () => {
      // Simulate rapid modifications
      const sessionStartTime = new Date(Date.now() - 1000); // 1 second ago

      const filePath = path.join(projectDir, 'src', 'auth', 'TokenManager.ts');
      fs.writeFileSync(filePath, 'first write');
      fs.writeFileSync(filePath, 'second write'); // Overwrite

      const sidecarFiles = { written: ['src/auth/TokenManager.ts'] };

      const conflicts = detectConflicts(sidecarFiles, projectDir, sessionStartTime);
      // Should still detect as a single conflict
      expect(conflicts).toHaveLength(1);
    });
  });
});
