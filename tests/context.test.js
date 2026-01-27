/**
 * Context Filtering Tests
 *
 * Spec Reference: Section 5.3 Context Filtering Algorithm
 * Tests the context extraction and filtering from Claude Code sessions.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Module under test
const {
  filterContext,
  parseDuration,
  estimateTokens,
  takeLastNTurns
} = require('../src/context');

describe('Context Filtering', () => {
  let tempDir;
  let sessionFile;

  beforeEach(() => {
    // Create temporary directory and session file for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-context-test-'));
    sessionFile = path.join(tempDir, 'test-session.jsonl');
  });

  afterEach(() => {
    // Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseDuration', () => {
    it('should parse minutes (m)', () => {
      expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    });

    it('should parse hours (h)', () => {
      expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
    });

    it('should parse days (d)', () => {
      expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
    });

    it('should return 0 for invalid format', () => {
      expect(parseDuration('invalid')).toBe(0);
      expect(parseDuration('30')).toBe(0);
      expect(parseDuration('')).toBe(0);
    });

    it('should handle larger numbers', () => {
      expect(parseDuration('120m')).toBe(120 * 60 * 1000);
      expect(parseDuration('48h')).toBe(48 * 60 * 60 * 1000);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens at ~4 chars per token', () => {
      // Spec Reference: §5.3 "~4 chars per token"
      const text = 'a'.repeat(400);
      expect(estimateTokens(text)).toBe(100);
    });

    it('should handle empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should round down token count', () => {
      const text = 'a'.repeat(10); // 10 chars = 2.5 tokens -> 2
      expect(estimateTokens(text)).toBe(2);
    });
  });

  describe('takeLastNTurns', () => {
    it('should return last N user turns with associated messages', () => {
      const messages = [
        { type: 'user', message: { content: 'Turn 1' }, timestamp: '2025-01-25T10:00:00Z' },
        { type: 'assistant', message: { content: 'Response 1' }, timestamp: '2025-01-25T10:01:00Z' },
        { type: 'user', message: { content: 'Turn 2' }, timestamp: '2025-01-25T10:02:00Z' },
        { type: 'assistant', message: { content: 'Response 2' }, timestamp: '2025-01-25T10:03:00Z' },
        { type: 'user', message: { content: 'Turn 3' }, timestamp: '2025-01-25T10:04:00Z' },
        { type: 'assistant', message: { content: 'Response 3' }, timestamp: '2025-01-25T10:05:00Z' }
      ];

      const result = takeLastNTurns(messages, 2);

      // Should include last 2 user turns (Turn 2 and Turn 3) and their responses
      expect(result.length).toBe(4);
      expect(result[0].message.content).toBe('Turn 2');
      expect(result[1].message.content).toBe('Response 2');
      expect(result[2].message.content).toBe('Turn 3');
      expect(result[3].message.content).toBe('Response 3');
    });

    it('should return all messages if fewer turns than requested', () => {
      const messages = [
        { type: 'user', message: { content: 'Turn 1' }, timestamp: '2025-01-25T10:00:00Z' },
        { type: 'assistant', message: { content: 'Response 1' }, timestamp: '2025-01-25T10:01:00Z' }
      ];

      const result = takeLastNTurns(messages, 50);
      expect(result).toEqual(messages);
    });

    it('should handle empty messages array', () => {
      const result = takeLastNTurns([], 10);
      expect(result).toEqual([]);
    });

    it('should include tool_use messages between turns', () => {
      const messages = [
        { type: 'user', message: { content: 'Turn 1' }, timestamp: '2025-01-25T10:00:00Z' },
        { type: 'tool_use', tool: 'Read', input: { path: 'file.ts' }, timestamp: '2025-01-25T10:01:00Z' },
        { type: 'assistant', message: { content: 'Response 1' }, timestamp: '2025-01-25T10:02:00Z' },
        { type: 'user', message: { content: 'Turn 2' }, timestamp: '2025-01-25T10:03:00Z' },
        { type: 'assistant', message: { content: 'Response 2' }, timestamp: '2025-01-25T10:04:00Z' }
      ];

      const result = takeLastNTurns(messages, 1);

      // Should only include last turn (Turn 2)
      expect(result.length).toBe(2);
      expect(result[0].message.content).toBe('Turn 2');
    });
  });

  describe('filterContext', () => {
    beforeEach(() => {
      // Create a test session file with multiple messages
      const messages = [
        { type: 'user', message: { content: 'First message' }, timestamp: '2025-01-25T10:00:00Z' },
        { type: 'assistant', message: { content: 'First response' }, timestamp: '2025-01-25T10:01:00Z' },
        { type: 'user', message: { content: 'Second message' }, timestamp: '2025-01-25T10:30:00Z' },
        { type: 'assistant', message: { content: 'Second response' }, timestamp: '2025-01-25T10:31:00Z' },
        { type: 'tool_use', tool: 'Read', input: { path: 'file.ts' }, timestamp: '2025-01-25T10:32:00Z' },
        { type: 'user', message: { content: 'Third message' }, timestamp: '2025-01-25T11:00:00Z' },
        { type: 'assistant', message: { content: 'Third response' }, timestamp: '2025-01-25T11:01:00Z' }
      ];

      const content = messages.map(m => JSON.stringify(m)).join('\n');
      fs.writeFileSync(sessionFile, content);
    });

    describe('Turn-based filtering', () => {
      it('should filter by number of turns (default 50)', () => {
        const result = filterContext(sessionFile, { turns: 50, maxTokens: 80000 });

        // Should include all messages since we have fewer than 50 turns
        expect(result).toContain('First message');
        expect(result).toContain('Third message');
      });

      it('should filter to last N turns', () => {
        const result = filterContext(sessionFile, { turns: 1, maxTokens: 80000 });

        // Should only include last turn
        expect(result).not.toContain('First message');
        expect(result).not.toContain('Second message');
        expect(result).toContain('Third message');
      });

      it('should count user messages as turns', () => {
        const result = filterContext(sessionFile, { turns: 2, maxTokens: 80000 });

        // Should include last 2 user turns (Second and Third)
        expect(result).not.toContain('First message');
        expect(result).toContain('Second message');
        expect(result).toContain('Third message');
      });
    });

    describe('Time-based filtering (--context-since)', () => {
      it('should override turns when since is specified', () => {
        // Create a session with recent timestamps
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

        const messages = [
          { type: 'user', message: { content: 'Old message' }, timestamp: twoHoursAgo.toISOString() },
          { type: 'assistant', message: { content: 'Old response' }, timestamp: twoHoursAgo.toISOString() },
          { type: 'user', message: { content: 'Recent message' }, timestamp: oneHourAgo.toISOString() },
          { type: 'assistant', message: { content: 'Recent response' }, timestamp: oneHourAgo.toISOString() }
        ];

        const recentFile = path.join(tempDir, 'recent-session.jsonl');
        fs.writeFileSync(recentFile, messages.map(m => JSON.stringify(m)).join('\n'));

        // Filter to last 90 minutes - should include recent but not old
        const result = filterContext(recentFile, { since: '90m', turns: 50, maxTokens: 80000 });

        expect(result).toContain('Recent message');
        expect(result).not.toContain('Old message');
      });

      it('should include all messages within time window', () => {
        const now = new Date();
        const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

        const messages = [
          { type: 'user', message: { content: 'Message 1' }, timestamp: thirtyMinAgo.toISOString() },
          { type: 'assistant', message: { content: 'Response 1' }, timestamp: thirtyMinAgo.toISOString() },
          { type: 'user', message: { content: 'Message 2' }, timestamp: fifteenMinAgo.toISOString() },
          { type: 'assistant', message: { content: 'Response 2' }, timestamp: fifteenMinAgo.toISOString() }
        ];

        const timeFile = path.join(tempDir, 'time-session.jsonl');
        fs.writeFileSync(timeFile, messages.map(m => JSON.stringify(m)).join('\n'));

        const result = filterContext(timeFile, { since: '1h', turns: 1, maxTokens: 80000 });

        // Should include all (since overrides turns)
        expect(result).toContain('Message 1');
        expect(result).toContain('Message 2');
      });
    });

    describe('Token truncation', () => {
      it('should truncate from start if over maxTokens limit', () => {
        // Create a long message that exceeds token limit
        const longContent = 'a'.repeat(1000); // 250 tokens
        const messages = [
          { type: 'user', message: { content: longContent }, timestamp: '2025-01-25T10:00:00Z' },
          { type: 'assistant', message: { content: 'Short response' }, timestamp: '2025-01-25T10:01:00Z' }
        ];

        const longFile = path.join(tempDir, 'long-session.jsonl');
        fs.writeFileSync(longFile, messages.map(m => JSON.stringify(m)).join('\n'));

        // Set very low token limit
        const result = filterContext(longFile, { turns: 50, maxTokens: 50 });

        // Should be truncated and include truncation notice
        expect(result).toContain('[Earlier context truncated...]');
      });

      it('should prepend truncation notice when truncating', () => {
        const longContent = 'x'.repeat(2000);
        const messages = [
          { type: 'user', message: { content: longContent }, timestamp: '2025-01-25T10:00:00Z' }
        ];

        const truncFile = path.join(tempDir, 'trunc-session.jsonl');
        fs.writeFileSync(truncFile, messages.map(m => JSON.stringify(m)).join('\n'));

        const result = filterContext(truncFile, { turns: 50, maxTokens: 100 });

        // Spec §5.3: prepend "[Earlier context truncated...]"
        expect(result.startsWith('[Earlier context truncated...]')).toBe(true);
      });

      it('should not truncate if under token limit', () => {
        const result = filterContext(sessionFile, { turns: 50, maxTokens: 80000 });

        expect(result).not.toContain('[Earlier context truncated...]');
      });
    });

    describe('Edge cases', () => {
      it('should handle empty session file', () => {
        const emptyFile = path.join(tempDir, 'empty.jsonl');
        fs.writeFileSync(emptyFile, '');

        const result = filterContext(emptyFile, { turns: 50, maxTokens: 80000 });
        expect(result).toBe('');
      });

      it('should handle session file with only invalid JSON', () => {
        const invalidFile = path.join(tempDir, 'invalid.jsonl');
        fs.writeFileSync(invalidFile, 'not json\nalso not json');

        const result = filterContext(invalidFile, { turns: 50, maxTokens: 80000 });
        expect(result).toBe('');
      });

      it('should throw for non-existent file', () => {
        expect(() => {
          filterContext('/nonexistent/file.jsonl', { turns: 50, maxTokens: 80000 });
        }).toThrow();
      });

      it('should handle messages without timestamps gracefully', () => {
        const noTimeMessages = [
          { type: 'user', message: { content: 'No timestamp message' } }
        ];

        const noTimeFile = path.join(tempDir, 'notime.jsonl');
        fs.writeFileSync(noTimeFile, noTimeMessages.map(m => JSON.stringify(m)).join('\n'));

        const result = filterContext(noTimeFile, { turns: 50, maxTokens: 80000 });
        expect(result).toContain('No timestamp message');
      });
    });

    describe('Output format', () => {
      it('should format context per spec §5.3', () => {
        const result = filterContext(sessionFile, { turns: 50, maxTokens: 80000 });

        // Should contain formatted messages
        expect(result).toMatch(/\[User @ \d{1,2}:\d{2}/);
        expect(result).toMatch(/\[Assistant @ \d{1,2}:\d{2}/);
        expect(result).toContain('[Tool: Read file.ts]');
      });

      it('should separate messages with double newlines', () => {
        const result = filterContext(sessionFile, { turns: 50, maxTokens: 80000 });
        expect(result).toContain('\n\n');
      });
    });
  });
});
