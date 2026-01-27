/**
 * Session Resolver Tests
 *
 * Spec Reference: §5.1 Session Resolution, §5.2 Claude Code Conversation Storage
 * Tests the resolution of Claude Code session files.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Module under test - will be created after tests fail
const {
  encodeProjectPath,
  decodeProjectPath,
  getSessionDirectory,
  resolveSession,
  getSessionId
} = require('../src/session');

describe('Session Resolver', () => {
  describe('encodeProjectPath', () => {
    it('should encode project path by replacing slashes with dashes', () => {
      // Spec §5.2: /Users/john/myproject → -Users-john-myproject
      const result = encodeProjectPath('/Users/john/myproject');
      expect(result).toBe('-Users-john-myproject');
    });

    it('should handle root path', () => {
      const result = encodeProjectPath('/');
      expect(result).toBe('-');
    });

    it('should handle paths with multiple consecutive slashes', () => {
      const result = encodeProjectPath('/Users//john///myproject');
      expect(result).toBe('-Users--john---myproject');
    });

    it('should handle paths without leading slash', () => {
      const result = encodeProjectPath('Users/john/myproject');
      expect(result).toBe('Users-john-myproject');
    });

    it('should handle Windows-style paths (backslashes)', () => {
      // On Windows, paths may use backslashes
      const result = encodeProjectPath('C:\\Users\\john\\myproject');
      // Should convert backslashes to dashes as well
      expect(result).toBe('C:-Users-john-myproject');
    });

    it('should convert underscores to dashes (matching Claude Code behavior)', () => {
      const result = encodeProjectPath('/Users/john/my-project_v2');
      expect(result).toBe('-Users-john-my-project-v2');
    });
  });

  describe('decodeProjectPath', () => {
    it('should decode encoded path back to original', () => {
      const encoded = '-Users-john-myproject';
      const result = decodeProjectPath(encoded);
      expect(result).toBe('/Users/john/myproject');
    });

    it('should handle paths without leading dash', () => {
      const encoded = 'Users-john-myproject';
      const result = decodeProjectPath(encoded);
      expect(result).toBe('Users/john/myproject');
    });
  });

  describe('getSessionDirectory', () => {
    it('should return the session directory path for a project', () => {
      const projectPath = '/Users/john/myproject';
      const result = getSessionDirectory(projectPath);

      // Should be: ~/.claude/projects/-Users-john-myproject
      const expectedDir = path.join(
        os.homedir(),
        '.claude',
        'projects',
        '-Users-john-myproject'
      );
      expect(result).toBe(expectedDir);
    });

    it('should handle custom home directory override', () => {
      const projectPath = '/Users/john/myproject';
      const customHome = '/custom/home';
      const result = getSessionDirectory(projectPath, customHome);

      const expectedDir = path.join(
        customHome,
        '.claude',
        'projects',
        '-Users-john-myproject'
      );
      expect(result).toBe(expectedDir);
    });
  });

  describe('getSessionId', () => {
    it('should extract session ID from filename', () => {
      const filename = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl';
      const result = getSessionId(filename);
      expect(result).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('should handle filename without extension', () => {
      const filename = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const result = getSessionId(filename);
      expect(result).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });
  });

  describe('resolveSession', () => {
    let tempDir;
    let tempProjectDir;

    beforeEach(() => {
      // Create a mock session directory structure
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-session-test-'));
      tempProjectDir = path.join(tempDir, '.claude', 'projects', '-test-project');
      fs.mkdirSync(tempProjectDir, { recursive: true });
    });

    afterEach(() => {
      // Clean up temp files
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('Primary Resolution: Explicit Session ID', () => {
      it('should resolve explicit session ID to file path', () => {
        const sessionId = 'abc123-def456-789';
        const sessionFile = path.join(tempProjectDir, `${sessionId}.jsonl`);
        fs.writeFileSync(sessionFile, '{}');

        const result = resolveSession(tempProjectDir, sessionId);
        expect(result.path).toBe(sessionFile);
        expect(result.method).toBe('explicit');
      });

      it('should handle session ID with .jsonl extension', () => {
        const sessionId = 'abc123-def456-789.jsonl';
        const sessionFile = path.join(tempProjectDir, sessionId);
        fs.writeFileSync(sessionFile, '{}');

        const result = resolveSession(tempProjectDir, sessionId);
        expect(result.path).toBe(sessionFile);
        expect(result.method).toBe('explicit');
      });

      it('should fall back to most recent if explicit session not found', () => {
        const validSession = path.join(tempProjectDir, 'valid-session.jsonl');
        fs.writeFileSync(validSession, '{}');

        // Request a non-existent session
        const result = resolveSession(tempProjectDir, 'nonexistent-session');

        expect(result.path).toBe(validSession);
        expect(result.method).toBe('fallback');
        expect(result.warning).toContain('not found');
      });
    });

    describe('Fallback Resolution: Most Recent File', () => {
      it('should resolve "current" to most recently modified .jsonl file', () => {
        // Create two session files with different mtimes
        const session1 = path.join(tempProjectDir, 'session1.jsonl');
        const session2 = path.join(tempProjectDir, 'session2.jsonl');

        fs.writeFileSync(session1, '{}');

        // Add delay to ensure different mtime
        const now = Date.now();
        fs.utimesSync(session1, now / 1000 - 100, now / 1000 - 100);

        fs.writeFileSync(session2, '{}');

        const result = resolveSession(tempProjectDir, 'current');
        expect(result.path).toBe(session2);
        expect(result.method).toBe('fallback');
      });

      it('should resolve undefined session to most recently modified file', () => {
        const session = path.join(tempProjectDir, 'only-session.jsonl');
        fs.writeFileSync(session, '{}');

        const result = resolveSession(tempProjectDir, undefined);
        expect(result.path).toBe(session);
        expect(result.method).toBe('fallback');
      });

      it('should return null if no sessions found', () => {
        const result = resolveSession(tempProjectDir, 'current');
        expect(result.path).toBeNull();
      });

      it('should only consider .jsonl files', () => {
        // Create non-jsonl files that should be ignored
        fs.writeFileSync(path.join(tempProjectDir, 'metadata.json'), '{}');
        fs.writeFileSync(path.join(tempProjectDir, 'session.txt'), 'text');

        // Create actual session file
        const session = path.join(tempProjectDir, 'session.jsonl');
        fs.writeFileSync(session, '{}');

        const result = resolveSession(tempProjectDir, 'current');
        expect(result.path).toBe(session);
      });
    });

    describe('Ambiguity Warning: Multiple Recent Sessions', () => {
      it('should warn if multiple sessions modified in last 5 minutes', () => {
        // Create multiple session files with recent mtimes
        const session1 = path.join(tempProjectDir, 'session1.jsonl');
        const session2 = path.join(tempProjectDir, 'session2.jsonl');

        fs.writeFileSync(session1, '{}');
        fs.writeFileSync(session2, '{}');

        // Both files have current mtime (within 5 minutes)
        const result = resolveSession(tempProjectDir, 'current');

        expect(result.path).toBeTruthy();
        expect(result.warning).toContain('active sessions');
        expect(result.warning).toContain('--session');
      });

      it('should not warn if only one session is recent', () => {
        const recentSession = path.join(tempProjectDir, 'recent.jsonl');
        const oldSession = path.join(tempProjectDir, 'old.jsonl');

        fs.writeFileSync(oldSession, '{}');
        // Set old session mtime to 10 minutes ago
        const tenMinutesAgo = Date.now() / 1000 - 600;
        fs.utimesSync(oldSession, tenMinutesAgo, tenMinutesAgo);

        fs.writeFileSync(recentSession, '{}');

        const result = resolveSession(tempProjectDir, 'current');

        expect(result.path).toBe(recentSession);
        expect(result.warning).toBeUndefined();
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty project directory', () => {
        const result = resolveSession(tempProjectDir, 'current');
        expect(result.path).toBeNull();
      });

      it('should handle non-existent project directory', () => {
        const result = resolveSession('/nonexistent/path', 'current');
        expect(result.path).toBeNull();
      });

      it('should handle empty string session ID', () => {
        const session = path.join(tempProjectDir, 'session.jsonl');
        fs.writeFileSync(session, '{}');

        const result = resolveSession(tempProjectDir, '');
        expect(result.path).toBe(session);
        expect(result.method).toBe('fallback');
      });
    });
  });
});
