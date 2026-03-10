/**
 * Tests for src/utils/api-key-store.js — hints, values, and removal
 *
 * Covers readApiKeyHints, readApiKeyValues, removeApiKey,
 * and saveApiKey error handling.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  readApiKeyHints,
  readApiKeyValues,
  saveApiKey,
  removeApiKey
} = require('../src/utils/api-key-store');

describe('api-key-store readwrite', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-apikey-'));
    originalEnv = { ...process.env };
    // Point env dir to temp for test isolation
    process.env.SIDECAR_ENV_DIR = tmpDir;
    // Clear relevant env vars so they don't leak between tests
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readApiKeyHints', () => {
    it('should return false for all providers when no keys exist', () => {
      const result = readApiKeyHints();
      expect(result.openrouter).toBe(false);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
      expect(result.deepseek).toBe(false);
    });

    it('should return masked key hints from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnop\n'
      );

      const result = readApiKeyHints();
      expect(result.openrouter).toBeTruthy();
      // First 8 chars visible
      expect(result.openrouter.startsWith('sk-or-v1')).toBe(true);
      // Contains bullet chars for masking
      expect(result.openrouter).toContain('\u2022');
    });

    it('should return masked key hints from process.env', () => {
      process.env.OPENAI_API_KEY = 'sk-proj-12345678abcdef';

      const result = readApiKeyHints();
      expect(result.openai).toBeTruthy();
      expect(result.openai.startsWith('sk-proj-')).toBe(true);
    });

    it('should handle short keys (< 8 chars) without masking', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'GEMINI_API_KEY=short\n'
      );

      const result = readApiKeyHints();
      expect(result.google).toBe('short');
    });

    it('should return hint for deepseek key', () => {
      process.env.DEEPSEEK_API_KEY = 'sk-deepseek-abcdefghij';

      const result = readApiKeyHints();
      expect(result.deepseek).toBeTruthy();
      expect(result.deepseek.startsWith('sk-deeps')).toBe(true);
      expect(result.deepseek).toContain('\u2022');
    });

    it('should mask keys with exactly 8 chars (no bullets)', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'GEMINI_API_KEY=12345678\n'
      );

      const result = readApiKeyHints();
      expect(result.google).toBe('12345678');
    });
  });

  describe('removeApiKey', () => {
    it('should remove a key from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-remove\nGEMINI_API_KEY=goog-keep\n'
      );

      const result = removeApiKey('openrouter');
      expect(result).toEqual({ success: true });

      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).not.toContain('OPENROUTER_API_KEY');
      expect(content).toContain('GEMINI_API_KEY=goog-keep');
    });

    it('should delete from process.env', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-remove';
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-env-remove\n'
      );

      removeApiKey('openrouter');
      expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
    });

    it('should return success when .env file does not exist', () => {
      const result = removeApiKey('openrouter');
      expect(result).toEqual({ success: true });
    });

    it('should return error for unknown provider', () => {
      const result = removeApiKey('unknown');
      expect(result).toEqual({ success: false, error: 'Unknown provider: unknown' });
    });

    it('should handle removing last key (empty file)', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-last\n'
      );

      removeApiKey('openrouter');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toBe('');
    });

    it('should preserve remaining content after removal', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        '# Comment\nOPENROUTER_API_KEY=sk-or-remove\nGEMINI_API_KEY=keep\n'
      );

      removeApiKey('openrouter');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('# Comment');
      expect(content).toContain('GEMINI_API_KEY=keep');
      expect(content).not.toContain('OPENROUTER_API_KEY');
    });
  });

  describe('readApiKeyValues', () => {
    it('should return empty object when no keys exist', () => {
      const result = readApiKeyValues();
      expect(result).toEqual({});
    });

    it('should return actual key strings from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-real-key\nGEMINI_API_KEY=AIza-real-key\n'
      );

      const result = readApiKeyValues();
      expect(result.openrouter).toBe('sk-or-real-key');
      expect(result.google).toBe('AIza-real-key');
      expect(result.openai).toBeUndefined();
      expect(result.anthropic).toBeUndefined();
    });

    it('should return key strings from process.env', () => {
      process.env.OPENAI_API_KEY = 'sk-from-env';

      const result = readApiKeyValues();
      expect(result.openai).toBe('sk-from-env');
    });

    it('should prefer .env file over process.env', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=from-file\n'
      );
      process.env.OPENROUTER_API_KEY = 'from-env';

      const result = readApiKeyValues();
      expect(result.openrouter).toBe('from-file');
    });

    it('should skip empty values', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=\n'
      );

      const result = readApiKeyValues();
      expect(result.openrouter).toBeUndefined();
    });
  });

  describe('saveApiKey error handling', () => {
    it('should return error for unknown provider', () => {
      const result = saveApiKey('unknown-provider', 'some-key');
      expect(result).toEqual({ success: false, error: 'Unknown provider: unknown-provider' });
    });
  });
});
