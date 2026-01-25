/**
 * JSONL Parser Tests
 *
 * Spec Reference: §5.3 Context Filtering Algorithm, §5.3 Context Format
 * Tests the parsing of Claude Code conversation JSONL files.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Module under test - will be created after tests fail
const {
  readJSONL,
  parseJSONLLine,
  formatMessage,
  formatContext,
  extractTimestamp
} = require('../src/jsonl-parser');

describe('JSONL Parser', () => {
  describe('parseJSONLLine', () => {
    it('should parse a valid JSON line', () => {
      const line = '{"type":"user","message":{"content":"Hello"},"timestamp":"2025-01-25T10:30:00Z"}';
      const result = parseJSONLLine(line);
      expect(result).toEqual({
        type: 'user',
        message: { content: 'Hello' },
        timestamp: '2025-01-25T10:30:00Z'
      });
    });

    it('should return null for invalid JSON', () => {
      const line = 'not valid json {{{';
      const result = parseJSONLLine(line);
      expect(result).toBeNull();
    });

    it('should return null for empty line', () => {
      const result = parseJSONLLine('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only line', () => {
      const result = parseJSONLLine('   \t\n');
      expect(result).toBeNull();
    });

    it('should handle nested JSON objects', () => {
      const line = '{"type":"assistant","message":{"content":[{"type":"text","text":"Response"}]},"timestamp":"2025-01-25T10:31:00Z"}';
      const result = parseJSONLLine(line);
      expect(result.message.content).toEqual([{ type: 'text', text: 'Response' }]);
    });
  });

  describe('readJSONL', () => {
    let tempDir;
    let tempFile;

    beforeEach(() => {
      // Create a temporary directory and file for testing
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-test-'));
      tempFile = path.join(tempDir, 'test-session.jsonl');
    });

    afterEach(() => {
      // Clean up temp files
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    });

    it('should read and parse a JSONL file', () => {
      const content = [
        '{"type":"user","message":{"content":"Hello"},"timestamp":"2025-01-25T10:30:00Z"}',
        '{"type":"assistant","message":{"content":"Hi there"},"timestamp":"2025-01-25T10:31:00Z"}'
      ].join('\n');

      fs.writeFileSync(tempFile, content);

      const result = readJSONL(tempFile);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('user');
      expect(result[1].type).toBe('assistant');
    });

    it('should skip invalid lines and continue parsing', () => {
      const content = [
        '{"type":"user","message":{"content":"Hello"},"timestamp":"2025-01-25T10:30:00Z"}',
        'invalid json line',
        '{"type":"assistant","message":{"content":"Hi"},"timestamp":"2025-01-25T10:31:00Z"}'
      ].join('\n');

      fs.writeFileSync(tempFile, content);

      const result = readJSONL(tempFile);
      expect(result).toHaveLength(2);
    });

    it('should handle empty file', () => {
      fs.writeFileSync(tempFile, '');

      const result = readJSONL(tempFile);
      expect(result).toEqual([]);
    });

    it('should handle file with only empty lines', () => {
      fs.writeFileSync(tempFile, '\n\n\n');

      const result = readJSONL(tempFile);
      expect(result).toEqual([]);
    });

    it('should throw error for non-existent file', () => {
      expect(() => {
        readJSONL('/nonexistent/path/file.jsonl');
      }).toThrow();
    });

    it('should handle trailing newline', () => {
      const content = '{"type":"user","message":{"content":"Hello"},"timestamp":"2025-01-25T10:30:00Z"}\n';

      fs.writeFileSync(tempFile, content);

      const result = readJSONL(tempFile);
      expect(result).toHaveLength(1);
    });
  });

  describe('extractTimestamp', () => {
    it('should extract timestamp from message object', () => {
      const message = { timestamp: '2025-01-25T10:30:00Z' };
      const result = extractTimestamp(message);
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2025-01-25T10:30:00.000Z');
    });

    it('should return null for missing timestamp', () => {
      const message = { type: 'user' };
      const result = extractTimestamp(message);
      expect(result).toBeNull();
    });

    it('should return null for invalid timestamp', () => {
      const message = { timestamp: 'not-a-date' };
      const result = extractTimestamp(message);
      expect(result).toBeNull();
    });
  });

  describe('formatMessage', () => {
    it('should format user message per spec §5.3', () => {
      const message = {
        type: 'user',
        message: { content: 'Can you look at the auth service?' },
        timestamp: '2025-01-25T10:30:00Z'
      };

      const result = formatMessage(message);
      expect(result).toMatch(/\[User @ \d{1,2}:\d{2}( [AP]M)?\]/);
      expect(result).toContain('Can you look at the auth service?');
    });

    it('should format assistant message with text content', () => {
      const message = {
        type: 'assistant',
        message: { content: 'I\'ll examine the authentication flow...' },
        timestamp: '2025-01-25T10:31:00Z'
      };

      const result = formatMessage(message);
      expect(result).toMatch(/\[Assistant @ \d{1,2}:\d{2}( [AP]M)?\]/);
      expect(result).toContain('I\'ll examine the authentication flow...');
    });

    it('should format assistant message with array content (Claude API format)', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Part one. ' },
            { type: 'text', text: 'Part two.' }
          ]
        },
        timestamp: '2025-01-25T10:31:00Z'
      };

      const result = formatMessage(message);
      expect(result).toContain('Part one.');
      expect(result).toContain('Part two.');
    });

    it('should format tool_use message per spec §5.3', () => {
      const message = {
        type: 'tool_use',
        tool: 'Read',
        input: { path: 'src/auth/TokenManager.ts' },
        timestamp: '2025-01-25T10:32:00Z'
      };

      const result = formatMessage(message);
      expect(result).toBe('[Tool: Read src/auth/TokenManager.ts]');
    });

    it('should handle tool_use without input path', () => {
      const message = {
        type: 'tool_use',
        tool: 'Bash',
        input: { command: 'npm test' },
        timestamp: '2025-01-25T10:32:00Z'
      };

      const result = formatMessage(message);
      expect(result).toBe('[Tool: Bash]');
    });

    it('should return empty string for unknown message type', () => {
      const message = {
        type: 'unknown',
        timestamp: '2025-01-25T10:30:00Z'
      };

      const result = formatMessage(message);
      expect(result).toBe('');
    });

    it('should handle missing message content gracefully', () => {
      const message = {
        type: 'user',
        timestamp: '2025-01-25T10:30:00Z'
      };

      const result = formatMessage(message);
      expect(result).toMatch(/\[User @ \d{1,2}:\d{2}/);
    });
  });

  describe('formatContext', () => {
    it('should format multiple messages into context string', () => {
      const messages = [
        {
          type: 'user',
          message: { content: 'Can you look at the auth service?' },
          timestamp: '2025-01-25T10:30:00Z'
        },
        {
          type: 'assistant',
          message: { content: 'I\'ll examine the authentication flow...' },
          timestamp: '2025-01-25T10:31:00Z'
        },
        {
          type: 'tool_use',
          tool: 'Read',
          input: { path: 'src/auth/TokenManager.ts' },
          timestamp: '2025-01-25T10:32:00Z'
        }
      ];

      const result = formatContext(messages);

      expect(result).toContain('[User @');
      expect(result).toContain('Can you look at the auth service?');
      expect(result).toContain('[Assistant @');
      expect(result).toContain('I\'ll examine the authentication flow...');
      expect(result).toContain('[Tool: Read src/auth/TokenManager.ts]');
    });

    it('should separate messages with double newlines', () => {
      const messages = [
        {
          type: 'user',
          message: { content: 'Hello' },
          timestamp: '2025-01-25T10:30:00Z'
        },
        {
          type: 'assistant',
          message: { content: 'Hi' },
          timestamp: '2025-01-25T10:31:00Z'
        }
      ];

      const result = formatContext(messages);
      expect(result).toContain('\n\n');
    });

    it('should filter out empty formatted messages', () => {
      const messages = [
        {
          type: 'user',
          message: { content: 'Hello' },
          timestamp: '2025-01-25T10:30:00Z'
        },
        {
          type: 'unknown', // This should be filtered out
          timestamp: '2025-01-25T10:31:00Z'
        },
        {
          type: 'assistant',
          message: { content: 'Hi' },
          timestamp: '2025-01-25T10:32:00Z'
        }
      ];

      const result = formatContext(messages);
      // Should only have 2 messages separated by one double newline
      const parts = result.split('\n\n').filter(p => p.trim());
      expect(parts).toHaveLength(2);
    });

    it('should return empty string for empty messages array', () => {
      const result = formatContext([]);
      expect(result).toBe('');
    });
  });
});
