/**
 * Sidecar Config Module Tests - Model Resolution
 *
 * Tests for resolveModel, resolveModel direct API fallback,
 * and detectFallback.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Sidecar Config Module - Model Resolution', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-config-test-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tempDir;
    // Clear API keys to ensure deterministic fallback behavior
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: require the config module fresh (after jest.resetModules)
   */
  function loadModule() {
    return require('../src/utils/config');
  }

  describe('resolveModel', () => {
    it('should return modelArg as-is when it contains a slash', () => {
      const config = loadModule();
      const result = config.resolveModel('openrouter/google/gemini-3-flash-preview');
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should resolve an alias from config.aliases', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel('gemini');
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should throw Error mentioning sidecar setup for unknown alias', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      expect(() => config.resolveModel('unknownmodel')).toThrow(/sidecar setup/i);
    });

    it('should resolve default alias when modelArg is undefined', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should throw Error when modelArg is undefined and no default is configured', () => {
      const data = { aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      expect(() => config.resolveModel(undefined)).toThrow();
    });

    it('should throw Error when modelArg is undefined and no config exists', () => {
      const config = loadModule();
      expect(() => config.resolveModel(undefined)).toThrow();
    });

    it('should handle default that is itself a full model string with slashes', () => {
      const data = {
        default: 'openrouter/openai/gpt-5.2-chat',
        aliases: {}
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      // default contains slash, so it should be returned as-is
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/openai/gpt-5.2-chat');
    });

    it('should resolve default when default is an alias key', () => {
      const data = {
        default: 'gpt',
        aliases: { gpt: 'openrouter/openai/gpt-5.2-chat' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/openai/gpt-5.2-chat');
    });

    it('should handle config with empty aliases object', () => {
      const data = { default: 'gemini', aliases: {} };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      // 'gemini' is in DEFAULT_ALIASES so should resolve even with empty user aliases
      const result = config.resolveModel('gemini');
      expect(result).toBe(config.getDefaultAliases().gemini);
    });

    it('should resolve default alias (grok) when not in user config but exists in defaults', () => {
      const data = { default: 'gemini', aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel('grok');
      expect(result).toBe('openrouter/x-ai/grok-4.1-fast');
    });

    it('should resolve default alias (grok) with no config file at all', () => {
      const config = loadModule();
      const result = config.resolveModel('grok');
      expect(result).toBe('openrouter/x-ai/grok-4.1-fast');
    });

    it('should resolve default from DEFAULT_ALIASES when user config default points to a built-in alias', () => {
      const data = { default: 'grok', aliases: {} };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/x-ai/grok-4.1-fast');
    });

    it('should still throw for truly unknown aliases not in defaults or user config', () => {
      const config = loadModule();
      expect(() => config.resolveModel('notamodel')).toThrow(/sidecar setup/i);
    });
  });

  describe('resolveModel - all default aliases resolve without config file', () => {
    it.each(Object.entries(require('../src/utils/config').getDefaultAliases()))(
      'resolves "%s" → "%s"',
      (alias, expectedModel) => {
        const config = loadModule();
        // No config file written — relies entirely on DEFAULT_ALIASES fallback
        expect(config.resolveModel(alias)).toBe(expectedModel);
      }
    );
  });

  describe('resolveModel - direct API fallback', () => {
    let stderrSpy;
    beforeEach(() => {
      stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(() => {
      stderrSpy.mockRestore();
    });

    it('should fall back to google/ when GEMINI_API_KEY is set but OPENROUTER_API_KEY is not', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('gemini');
      expect(result).toBe('google/gemini-3.1-flash-lite-preview');
    });

    it('should fall back to openai/ when OPENAI_API_KEY is set but OPENROUTER_API_KEY is not', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('gpt');
      expect(result).toBe('openai/gpt-5.4');
    });

    it('should fall back to anthropic/ when ANTHROPIC_API_KEY is set but OPENROUTER_API_KEY is not', () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('opus');
      expect(result).toBe('anthropic/claude-opus-4.6');
    });

    it('should fall back to deepseek/ when DEEPSEEK_API_KEY is set but OPENROUTER_API_KEY is not', () => {
      process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('deepseek');
      expect(result).toBe('deepseek/deepseek-v3.2');
    });

    it('should prefer OpenRouter when both OPENROUTER_API_KEY and direct key are set', () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('gemini');
      expect(result).toBe('openrouter/google/gemini-3.1-flash-lite-preview');
    });

    it('should return openrouter path when neither key is set', () => {
      const config = loadModule();
      const result = config.resolveModel('gemini');
      expect(result).toBe('openrouter/google/gemini-3.1-flash-lite-preview');
    });

    it('should not apply fallback to explicit model strings with slash', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel('openrouter/google/gemini-3.1-flash-lite-preview');
      expect(result).toBe('openrouter/google/gemini-3.1-flash-lite-preview');
    });

    it('should not apply fallback for providers without direct key mapping', () => {
      const config = loadModule();
      const result = config.resolveModel('qwen');
      expect(result).toBe('openrouter/qwen/qwen3.5-397b-a17b');
    });

    it('should apply fallback to default alias resolution', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const data = { default: 'gemini', aliases: {} };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('google/gemini-3.1-flash-lite-preview');
    });

    it('should not apply fallback to explicit default model strings', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const data = { default: 'openrouter/google/gemini-3.1-flash-lite-preview', aliases: {} };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      jest.resetModules();
      const config = loadModule();
      const result = config.resolveModel(undefined);
      expect(result).toBe('openrouter/google/gemini-3.1-flash-lite-preview');
    });
  });

  describe('detectFallback', () => {
    it('should return true when alias resolved via fallback', () => {
      process.env.GEMINI_API_KEY = 'test-key';
      jest.resetModules();
      const config = loadModule();
      expect(config.detectFallback('gemini', 'google/gemini-3.1-flash-lite-preview')).toBe(true);
    });

    it('should return false when alias resolved via OpenRouter', () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      jest.resetModules();
      const config = loadModule();
      expect(config.detectFallback('gemini', 'openrouter/google/gemini-3.1-flash-lite-preview')).toBe(false);
    });

    it('should return false for explicit model strings with slash', () => {
      const config = loadModule();
      expect(config.detectFallback('openrouter/google/gemini', 'openrouter/google/gemini')).toBe(false);
    });

    it('should return false for unknown aliases', () => {
      const config = loadModule();
      expect(config.detectFallback('nonexistent', 'some/model')).toBe(false);
    });

    it('should return false when alias is undefined', () => {
      const config = loadModule();
      expect(config.detectFallback(undefined, 'google/gemini')).toBe(false);
    });
  });
});
