/**
 * Context Builder Tests
 *
 * Tests for buildContext() with multi-environment support.
 * Validates that context can be built from arbitrary session directories
 * (not just the default ~/.claude/projects/ path).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { buildContext, parseDuration, applyContextFilters } = require('../../src/sidecar/context-builder');

describe('Context Builder', () => {
  describe('parseDuration', () => {
    it('should parse minutes', () => {
      expect(parseDuration('30m')).toBe(30 * 60000);
    });

    it('should parse hours', () => {
      expect(parseDuration('2h')).toBe(2 * 3600000);
    });

    it('should parse days', () => {
      expect(parseDuration('1d')).toBe(86400000);
    });

    it('should return 0 for invalid input', () => {
      expect(parseDuration(null)).toBe(0);
      expect(parseDuration('')).toBe(0);
      expect(parseDuration('abc')).toBe(0);
      expect(parseDuration(123)).toBe(0);
    });
  });

  describe('applyContextFilters', () => {
    it('should return empty array for empty input', () => {
      expect(applyContextFilters([], {})).toEqual([]);
      expect(applyContextFilters(null, {})).toEqual([]);
    });

    it('should apply turn filter', () => {
      const messages = [
        { type: 'user', message: { content: 'msg1' } },
        { type: 'assistant', message: { content: 'reply1' } },
        { type: 'user', message: { content: 'msg2' } },
        { type: 'assistant', message: { content: 'reply2' } },
        { type: 'user', message: { content: 'msg3' } },
        { type: 'assistant', message: { content: 'reply3' } },
      ];

      const filtered = applyContextFilters(messages, { contextTurns: 2 });
      // Should keep last 2 user turns and their associated messages
      expect(filtered.length).toBe(4); // msg2, reply2, msg3, reply3
    });
  });

  describe('buildContext with multi-environment', () => {
    it('should accept sessionDir option for code-web client', () => {
      // Create a temp dir with a session file
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ctx-test-'));
      const sessionFile = path.join(tmpDir, 'web-session.jsonl');
      fs.writeFileSync(sessionFile, JSON.stringify({
        type: 'user',
        message: { content: 'hello from web' },
        timestamp: new Date().toISOString()
      }) + '\n');

      // Call buildContext with sessionDir - this should use the sessionDir directly
      const context = buildContext(tmpDir, 'web-session', { sessionDir: tmpDir });
      expect(context).not.toContain('No Claude Code conversation history');
      expect(context).toContain('hello from web');
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should accept client option without breaking', () => {
      // With client='code-local' and no sessionDir, should use default path resolution
      // The default path won't exist, so it should return the "no history" message
      const context = buildContext('/nonexistent-project-path-12345', null, { client: 'code-local' });
      // Should attempt to resolve using default paths (fails gracefully)
      expect(typeof context).toBe('string');
    });

    it('should use sessionDir over default path resolution when both could apply', () => {
      // Even with a real project path, sessionDir should take precedence
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ctx-test-'));
      const sessionFile = path.join(tmpDir, 'priority-session.jsonl');
      fs.writeFileSync(sessionFile, JSON.stringify({
        type: 'user',
        message: { content: 'from explicit session dir' },
        timestamp: new Date().toISOString()
      }) + '\n');

      const context = buildContext('/some/project', 'priority-session', { sessionDir: tmpDir });
      expect(context).toContain('from explicit session dir');
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should handle missing sessionDir gracefully', () => {
      const context = buildContext('/nonexistent', null, { sessionDir: '/nonexistent/session/dir' });
      expect(context).toContain('No Claude Code conversation history');
    });

    it('should handle empty session file in sessionDir', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ctx-test-'));
      const sessionFile = path.join(tmpDir, 'empty-session.jsonl');
      fs.writeFileSync(sessionFile, '');

      const context = buildContext(tmpDir, 'empty-session', { sessionDir: tmpDir });
      // Empty session should return empty session message
      expect(context).toContain('Empty Claude Code session');
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should apply context filters when using sessionDir', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ctx-test-'));
      const sessionFile = path.join(tmpDir, 'filtered-session.jsonl');

      // Write multiple user turns
      const messages = [];
      for (let i = 0; i < 5; i++) {
        messages.push(JSON.stringify({
          type: 'user',
          message: { content: `user message ${i}` },
          timestamp: new Date().toISOString()
        }));
        messages.push(JSON.stringify({
          type: 'assistant',
          message: { content: `assistant reply ${i}` },
          timestamp: new Date().toISOString()
        }));
      }
      fs.writeFileSync(sessionFile, messages.join('\n') + '\n');

      const context = buildContext(tmpDir, 'filtered-session', {
        sessionDir: tmpDir,
        contextTurns: 2
      });

      // Should contain last 2 user messages but not the first ones
      expect(context).toContain('user message 3');
      expect(context).toContain('user message 4');
      expect(context).not.toContain('user message 0');
      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('buildContext default behavior', () => {
    it('should return no-history message for nonexistent project', () => {
      const context = buildContext('/nonexistent/project/path/xyz', null, {});
      expect(context).toContain('No Claude Code conversation history');
    });
  });
});
