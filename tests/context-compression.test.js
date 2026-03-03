/**
 * Context Compression Module Tests
 *
 * Tests token estimation, preamble building, and context compression
 * for sidecar sessions.
 */

const {
  estimateTokenCount,
  buildPreamble,
  compressContext,
  DEFAULT_TOKEN_LIMIT
} = require('../src/context-compression');

describe('Context Compression', () => {
  describe('estimateTokenCount', () => {
    it('should return >0 and <10 for "Hello world"', () => {
      const count = estimateTokenCount('Hello world');
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokenCount('')).toBe(0);
    });

    it('should return 0 for null', () => {
      expect(estimateTokenCount(null)).toBe(0);
    });

    it('should return 0 for undefined', () => {
      expect(estimateTokenCount(undefined)).toBe(0);
    });

    it('should use Math.ceil(text.length / 4) heuristic', () => {
      // 12 chars -> Math.ceil(12/4) = 3
      expect(estimateTokenCount('abcdefghijkl')).toBe(3);
      // 13 chars -> Math.ceil(13/4) = 4
      expect(estimateTokenCount('abcdefghijklm')).toBe(4);
    });

    it('should return a number', () => {
      const result = estimateTokenCount('some text here');
      expect(typeof result).toBe('number');
    });
  });

  describe('buildPreamble', () => {
    it('should include the cwd path', () => {
      const preamble = buildPreamble('/home/user/project');
      expect(preamble).toContain('/home/user/project');
    });

    it('should start with "You are working in"', () => {
      const preamble = buildPreamble('/some/path');
      expect(preamble).toMatch(/^You are working in/);
    });

    it('should end with double newline for separation', () => {
      const preamble = buildPreamble('/test');
      expect(preamble).toMatch(/\n\n$/);
    });

    it('should contain "conversation" in the output', () => {
      const preamble = buildPreamble('/test');
      expect(preamble).toContain('conversation');
    });
  });

  describe('compressContext', () => {
    it('should return compressed=false when under token limit', () => {
      const shortText = 'Short context text.';
      const result = compressContext(shortText);

      expect(result.compressed).toBe(false);
      expect(result.needsModelCompression).toBe(false);
    });

    it('should include preamble in text when under limit', () => {
      const shortText = 'Some context.';
      const result = compressContext(shortText, { cwd: '/my/project' });

      expect(result.text).toContain('You are working in /my/project');
      expect(result.text).toContain('Some context.');
    });

    it('should return compressed=true and needsModelCompression=true when over limit', () => {
      // Create text that exceeds the default token limit
      // Default limit is 30000 tokens, heuristic is len/4
      // So we need text with length > 120000
      const longText = 'x'.repeat(120001);
      const result = compressContext(longText);

      expect(result.compressed).toBe(true);
      expect(result.needsModelCompression).toBe(true);
    });

    it('should work with custom tokenLimit set very low', () => {
      const shortText = 'Hello world';
      const result = compressContext(shortText, { tokenLimit: 1 });

      // "Hello world" is 11 chars -> ceil(11/4) = 3 tokens
      // Plus preamble tokens, easily exceeds limit of 1
      expect(result.compressed).toBe(true);
      expect(result.needsModelCompression).toBe(true);
    });

    it('should have default tokenLimit of 30000', () => {
      expect(DEFAULT_TOKEN_LIMIT).toBe(30000);
    });

    it('should include estimatedTokens in the result', () => {
      const text = 'Some text here';
      const result = compressContext(text);

      expect(result).toHaveProperty('estimatedTokens');
      expect(typeof result.estimatedTokens).toBe('number');
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it('should use process.cwd() as default cwd', () => {
      const result = compressContext('test');
      expect(result.text).toContain(process.cwd());
    });

    it('should include the full context text in the result even when over limit', () => {
      const longText = 'x'.repeat(120001);
      const result = compressContext(longText);

      // The actual text is still included - caller handles compression
      expect(result.text).toContain(longText);
    });
  });
});
