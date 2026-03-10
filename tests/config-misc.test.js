/**
 * Sidecar Config Module Tests - Miscellaneous
 *
 * Tests for getEffectiveAliases, formatAliasNames, tryResolveModel,
 * edge cases, and buildProviderModels.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Sidecar Config Module - Miscellaneous', () => {
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

  describe('getEffectiveAliases', () => {
    it('should return defaults when no config exists', () => {
      const config = loadModule();
      const aliases = config.getEffectiveAliases();
      expect(aliases.gemini).toBe('openrouter/google/gemini-3.1-flash-lite-preview');
      expect(aliases.opus).toBe('openrouter/anthropic/claude-opus-4.6');
    });

    it('should merge user aliases with defaults (user wins)', () => {
      const data = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/custom-gemini',
          'my-model': 'openrouter/custom/model',
        },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const aliases = config.getEffectiveAliases();

      // User override wins
      expect(aliases.gemini).toBe('openrouter/google/custom-gemini');
      // User custom alias included
      expect(aliases['my-model']).toBe('openrouter/custom/model');
      // Defaults still present
      expect(aliases.opus).toBe('openrouter/anthropic/claude-opus-4.6');
    });
  });

  describe('formatAliasNames', () => {
    it('should return comma-separated alias names', () => {
      const config = loadModule();
      const names = config.formatAliasNames();
      expect(names).toContain('gemini');
      expect(names).toContain('opus');
      expect(names).toContain('codex');
      expect(names).toContain(', ');
    });
  });

  describe('tryResolveModel', () => {
    it('should return resolved model for valid alias', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.tryResolveModel('gemini');
      expect(result.model).toBe('openrouter/google/gemini-3-flash-preview');
      expect(result.error).toBeUndefined();
    });

    it('should return error for invalid alias', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.tryResolveModel('nonexistent');
      expect(result.model).toBeUndefined();
      expect(result.error).toContain('nonexistent');
      expect(result.error.toLowerCase()).toContain('sidecar setup');
    });

    it('should return error when no model and no default', () => {
      const config = loadModule();
      const result = config.tryResolveModel(undefined);
      expect(result.model).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it('should return resolved for full model ID with slashes', () => {
      const config = loadModule();
      const result = config.tryResolveModel('openrouter/google/gemini-3-flash-preview');
      expect(result.model).toBe('openrouter/google/gemini-3-flash-preview');
    });
  });

  describe('Edge cases', () => {
    it('should handle resolveModel with full model path containing multiple slashes', () => {
      const config = loadModule();
      const result = config.resolveModel('openrouter/google/gemini-3-flash-preview');
      expect(result).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should handle resolveModel with single slash in model arg', () => {
      const config = loadModule();
      const result = config.resolveModel('provider/model');
      expect(result).toBe('provider/model');
    });

    it('should handle computeConfigHash with large config file', () => {
      const largeAliases = {};
      for (let i = 0; i < 100; i++) {
        largeAliases[`alias${i}`] = `openrouter/provider/model-${i}`;
      }
      const data = { default: 'alias0', aliases: largeAliases };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data, null, 2));
      const config = loadModule();

      const hash = config.computeConfigHash();
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should handle saveConfig with special characters in values', () => {
      const config = loadModule();
      const data = {
        default: 'test',
        aliases: { test: 'provider/model-with-special_chars.v2' }
      };
      config.saveConfig(data);

      const loaded = config.loadConfig();
      expect(loaded.aliases.test).toBe('provider/model-with-special_chars.v2');
    });
  });

  describe('buildProviderModels', () => {
    it('should group aliases by provider with model IDs as keys', () => {
      const config = loadModule();
      const result = config.buildProviderModels();

      // All default aliases are openrouter, so we expect a single provider
      expect(result).toHaveProperty('openrouter');
      expect(result.openrouter).toHaveProperty('models');

      // grok alias -> openrouter/x-ai/grok-4.1-fast -> key should be x-ai/grok-4.1-fast
      expect(result.openrouter.models['x-ai/grok-4.1-fast']).toBeDefined();
      // gemini alias
      expect(result.openrouter.models['google/gemini-3.1-flash-lite-preview']).toBeDefined();
    });

    it('should include all default alias models', () => {
      const config = loadModule();
      const result = config.buildProviderModels();
      const modelKeys = Object.keys(result.openrouter.models);

      // Each unique model ID from defaults should be present
      expect(modelKeys).toContain('anthropic/claude-opus-4.6');
      expect(modelKeys).toContain('openai/gpt-5.3-codex');
      expect(modelKeys).toContain('deepseek/deepseek-v3.2');
    });

    it('should include user-configured aliases', () => {
      const data = {
        aliases: { 'my-model': 'openrouter/custom/my-special-model' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.buildProviderModels();

      expect(result.openrouter.models).toHaveProperty('custom/my-special-model');
    });

    it('should handle non-openrouter providers', () => {
      const data = {
        aliases: { 'direct-gemini': 'google/gemini-2.5-flash' },
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.buildProviderModels();

      expect(result).toHaveProperty('google');
      expect(result.google.models['gemini-2.5-flash']).toBeDefined();
    });

    it('should deduplicate models pointed to by multiple aliases', () => {
      // claude and sonnet both map to the same model
      const config = loadModule();
      const result = config.buildProviderModels();
      const modelKeys = Object.keys(result.openrouter.models);

      const sonnetCount = modelKeys.filter(k => k === 'anthropic/claude-sonnet-4.6').length;
      expect(sonnetCount).toBe(1);
    });
  });
});
