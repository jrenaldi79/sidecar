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
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ctx-test-'));
      const sessionFile = path.join(tmpDir, 'priority-session.jsonl');
      fs.writeFileSync(sessionFile, JSON.stringify({
        type: 'user',
        message: { content: 'from explicit session dir' },
        timestamp: new Date().toISOString()
      }) + '\n');

      const context = buildContext(tmpDir, 'priority-session', { sessionDir: tmpDir });
      expect(context).toContain('from explicit session dir');
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should reject missing sessionDir when explicitly provided', () => {
      expect(() => buildContext('/nonexistent', null, {
        sessionDir: '/nonexistent/session/dir'
      })).toThrow(/project root|session directory/i);
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

  describe('findCoworkSession', () => {
    const { findCoworkSession } = require('../../src/sidecar/context-builder');

    it('should return null when local-agent-mode-sessions dir does not exist', () => {
      const result = findCoworkSession('/nonexistent/home/dir');
      expect(result).toBeNull();
    });

    it('should return null when no sessions have audit.jsonl', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      const sessRoot = path.join(tmpHome, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
      const sessionDir = path.join(sessRoot, 'org-1', 'user-1', 'local_empty-session');
      fs.mkdirSync(sessionDir, { recursive: true });
      // No audit.jsonl

      const result = findCoworkSession(tmpHome);
      expect(result).toBeNull();
      fs.rmSync(tmpHome, { recursive: true });
    });

    it('should return the most recently modified audit.jsonl', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      const sessRoot = path.join(tmpHome, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');

      // Create old session
      const oldDir = path.join(sessRoot, 'org-1', 'user-1', 'local_old-session');
      fs.mkdirSync(oldDir, { recursive: true });
      const oldAudit = path.join(oldDir, 'audit.jsonl');
      fs.writeFileSync(oldAudit, '{"type":"user"}\n');
      const pastTime = new Date(Date.now() - 60000);
      fs.utimesSync(oldAudit, pastTime, pastTime);

      // Create new session
      const newDir = path.join(sessRoot, 'org-1', 'user-1', 'local_new-session');
      fs.mkdirSync(newDir, { recursive: true });
      const newAudit = path.join(newDir, 'audit.jsonl');
      fs.writeFileSync(newAudit, '{"type":"user"}\n');

      const result = findCoworkSession(tmpHome);
      expect(result).toBe(newAudit);
      fs.rmSync(tmpHome, { recursive: true });
    });

    it('should match by coworkProcess when provided', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      const sessRoot = path.join(tmpHome, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
      const userDir = path.join(sessRoot, 'org-1', 'user-1');

      // Create two sessions with different processNames
      const sessA = path.join(userDir, 'local_session-a');
      const sessB = path.join(userDir, 'local_session-b');
      fs.mkdirSync(sessA, { recursive: true });
      fs.mkdirSync(sessB, { recursive: true });

      // Session A: older but matches processName
      const auditA = path.join(sessA, 'audit.jsonl');
      fs.writeFileSync(auditA, '{"type":"user"}\n');
      const pastTime = new Date(Date.now() - 60000);
      fs.utimesSync(auditA, pastTime, pastTime);
      fs.writeFileSync(path.join(userDir, 'local_session-a.json'),
        JSON.stringify({ processName: 'target-process', sessionId: 'local_session-a' }));

      // Session B: newer but different processName
      const auditB = path.join(sessB, 'audit.jsonl');
      fs.writeFileSync(auditB, '{"type":"user"}\n');
      fs.writeFileSync(path.join(userDir, 'local_session-b.json'),
        JSON.stringify({ processName: 'other-process', sessionId: 'local_session-b' }));

      // Without coworkProcess: should return the newer one (B)
      const resultNoMatch = findCoworkSession(tmpHome);
      expect(resultNoMatch).toBe(auditB);

      // With coworkProcess: should return the matching one (A)
      const resultMatch = findCoworkSession(tmpHome, 'target-process');
      expect(resultMatch).toBe(auditA);

      fs.rmSync(tmpHome, { recursive: true });
    });

    it('should return null when coworkProcess does not match any session', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      const sessRoot = path.join(tmpHome, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
      const sessDir = path.join(sessRoot, 'org-1', 'user-1', 'local_session-x');
      fs.mkdirSync(sessDir, { recursive: true });
      fs.writeFileSync(path.join(sessDir, 'audit.jsonl'), '{"type":"user"}\n');
      fs.writeFileSync(path.join(sessRoot, 'org-1', 'user-1', 'local_session-x.json'),
        JSON.stringify({ processName: 'wrong-process' }));

      const result = findCoworkSession(tmpHome, 'nonexistent-process');
      expect(result).toBeNull();
      fs.rmSync(tmpHome, { recursive: true });
    });

    it('should only scan local_ prefixed directories', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      const sessRoot = path.join(tmpHome, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');

      // Create non-session dir with audit.jsonl (should be skipped)
      const skipDir = path.join(sessRoot, 'org-1', 'user-1', 'debug');
      fs.mkdirSync(skipDir, { recursive: true });
      fs.writeFileSync(path.join(skipDir, 'audit.jsonl'), '{"type":"user"}\n');

      // Create real session
      const sessDir = path.join(sessRoot, 'org-1', 'user-1', 'local_real-session');
      fs.mkdirSync(sessDir, { recursive: true });
      const realAudit = path.join(sessDir, 'audit.jsonl');
      fs.writeFileSync(realAudit, '{"type":"user"}\n');

      const result = findCoworkSession(tmpHome);
      expect(result).toBe(realAudit);
      fs.rmSync(tmpHome, { recursive: true });
    });
  });

  describe('normalizeCoworkMessages', () => {
    const { normalizeCoworkMessages } = require('../../src/sidecar/context-builder');

    it('should filter to user and assistant messages only', () => {
      const messages = [
        { type: 'user', message: { content: 'hello' } },
        { type: 'system', message: { content: 'sys' } },
        { type: 'assistant', message: { content: 'hi' } },
        { type: 'result', subtype: 'done' },
        { type: 'rate_limit_event' },
      ];
      const result = normalizeCoworkMessages(messages);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('user');
      expect(result[1].type).toBe('assistant');
    });

    it('should map _audit_timestamp to timestamp', () => {
      const ts = '2026-03-09T00:23:00.000Z';
      const messages = [
        { type: 'user', message: { content: 'hello' }, _audit_timestamp: ts },
      ];
      const result = normalizeCoworkMessages(messages);
      expect(result[0].timestamp).toBe(ts);
    });

    it('should preserve existing timestamp over _audit_timestamp', () => {
      const messages = [
        { type: 'user', message: { content: 'hello' }, timestamp: 'existing', _audit_timestamp: 'audit' },
      ];
      const result = normalizeCoworkMessages(messages);
      expect(result[0].timestamp).toBe('existing');
    });
  });

  describe('buildContext with cowork client', () => {
    it('should read from Cowork local-agent-mode-sessions', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      const sessRoot = path.join(tmpHome, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
      const sessDir = path.join(sessRoot, 'org-1', 'user-1', 'local_test-session');
      fs.mkdirSync(sessDir, { recursive: true });

      // Write audit.jsonl with Cowork format
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'cowork parent context' }, _audit_timestamp: new Date().toISOString() }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'model reply' }] }, _audit_timestamp: new Date().toISOString() }),
        JSON.stringify({ type: 'rate_limit_event', _audit_timestamp: new Date().toISOString() }),
      ];
      fs.writeFileSync(path.join(sessDir, 'audit.jsonl'), lines.join('\n') + '\n');
      fs.writeFileSync(path.join(sessRoot, 'org-1', 'user-1', 'local_test-session.json'),
        JSON.stringify({ processName: 'target-process' }));

      const context = buildContext('/Users/john_renaldi', null, {
        client: 'cowork',
        coworkProcess: 'target-process',
        _homeDir: tmpHome
      });
      expect(context).toContain('cowork parent context');
      expect(context).toContain('model reply');
      expect(context).not.toContain('rate_limit');
      fs.rmSync(tmpHome, { recursive: true });
    });

    it('should return no-history when no Cowork sessions exist', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      // Don't create local-agent-mode-sessions at all

      const context = buildContext('/Users/john_renaldi', null, {
        client: 'cowork',
        coworkProcess: 'missing-process',
        _homeDir: tmpHome
      });
      expect(context).toContain('No Claude Code conversation history');
      fs.rmSync(tmpHome, { recursive: true });
    });

    it('should match correct session when coworkProcess is provided', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      const sessRoot = path.join(tmpHome, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
      const userDir = path.join(sessRoot, 'org-1', 'user-1');

      // Create two sessions
      const sessA = path.join(userDir, 'local_sess-a');
      const sessB = path.join(userDir, 'local_sess-b');
      fs.mkdirSync(sessA, { recursive: true });
      fs.mkdirSync(sessB, { recursive: true });

      fs.writeFileSync(path.join(sessA, 'audit.jsonl'),
        JSON.stringify({ type: 'user', message: { content: 'from target session' }, _audit_timestamp: new Date().toISOString() }) + '\n');
      fs.writeFileSync(path.join(userDir, 'local_sess-a.json'),
        JSON.stringify({ processName: 'my-target', sessionId: 'local_sess-a' }));

      fs.writeFileSync(path.join(sessB, 'audit.jsonl'),
        JSON.stringify({ type: 'user', message: { content: 'from other session' }, _audit_timestamp: new Date().toISOString() }) + '\n');
      fs.writeFileSync(path.join(userDir, 'local_sess-b.json'),
        JSON.stringify({ processName: 'other-sess', sessionId: 'local_sess-b' }));

      const context = buildContext('/Users/john_renaldi', null, {
        client: 'cowork',
        coworkProcess: 'my-target',
        _homeDir: tmpHome
      });
      expect(context).toContain('from target session');
      expect(context).not.toContain('from other session');
      fs.rmSync(tmpHome, { recursive: true });
    });

    it('should apply context filters to Cowork sessions', () => {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cowork-'));
      const sessRoot = path.join(tmpHome, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
      const sessDir = path.join(sessRoot, 'org-1', 'user-1', 'local_test-session');
      fs.mkdirSync(sessDir, { recursive: true });

      // Write 5 user turns
      const lines = [];
      for (let i = 0; i < 5; i++) {
        lines.push(JSON.stringify({ type: 'user', message: { content: `user msg ${i}` }, _audit_timestamp: new Date().toISOString() }));
        lines.push(JSON.stringify({ type: 'assistant', message: { content: `reply ${i}` }, _audit_timestamp: new Date().toISOString() }));
      }
      fs.writeFileSync(path.join(sessDir, 'audit.jsonl'), lines.join('\n') + '\n');
      fs.writeFileSync(path.join(sessRoot, 'org-1', 'user-1', 'local_test-session.json'),
        JSON.stringify({ processName: 'filter-target' }));

      const context = buildContext('/Users/john_renaldi', null, {
        client: 'cowork',
        coworkProcess: 'filter-target',
        _homeDir: tmpHome,
        contextTurns: 2
      });
      expect(context).toContain('user msg 3');
      expect(context).toContain('user msg 4');
      expect(context).not.toContain('user msg 0');
      fs.rmSync(tmpHome, { recursive: true });
    });
  });
});
