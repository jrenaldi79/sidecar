/**
 * Sidecar Config Module Tests
 *
 * Tests for config directory resolution, config file I/O,
 * model alias resolution, config hashing, and alias table formatting.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

describe('Sidecar Config Module', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-config-test-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tempDir;
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

  describe('getConfigDir', () => {
    it('should return SIDECAR_CONFIG_DIR when set', () => {
      const config = loadModule();
      expect(config.getConfigDir()).toBe(tempDir);
    });

    it('should return ~/.config/sidecar when env var is not set', () => {
      delete process.env.SIDECAR_CONFIG_DIR;
      jest.resetModules();
      const config = loadModule();
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      expect(config.getConfigDir()).toBe(path.join(homeDir, '.config', 'sidecar'));
    });
  });

  describe('getConfigPath', () => {
    it('should return config.json inside config dir', () => {
      const config = loadModule();
      expect(config.getConfigPath()).toBe(path.join(tempDir, 'config.json'));
    });
  });

  describe('loadConfig', () => {
    it('should return null when config file does not exist', () => {
      const config = loadModule();
      expect(config.loadConfig()).toBeNull();
    });

    it('should return null when config file contains invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'config.json'), 'not json {{{');
      const config = loadModule();
      expect(config.loadConfig()).toBeNull();
    });

    it('should return parsed config when file is valid JSON', () => {
      const data = { default: 'gemini', aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const result = config.loadConfig();
      expect(result).toEqual(data);
    });

    it('should return null for empty file', () => {
      fs.writeFileSync(path.join(tempDir, 'config.json'), '');
      const config = loadModule();
      expect(config.loadConfig()).toBeNull();
    });
  });

  describe('saveConfig', () => {
    it('should write config data as JSON to config path', () => {
      const config = loadModule();
      const data = { default: 'gemini', aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' } };
      config.saveConfig(data);

      const written = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8'));
      expect(written).toEqual(data);
    });

    it('should create the config directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'deep');
      process.env.SIDECAR_CONFIG_DIR = nestedDir;
      jest.resetModules();
      const config = loadModule();

      const data = { default: 'gpt' };
      config.saveConfig(data);

      expect(fs.existsSync(path.join(nestedDir, 'config.json'))).toBe(true);
      const written = JSON.parse(fs.readFileSync(path.join(nestedDir, 'config.json'), 'utf-8'));
      expect(written).toEqual(data);
    });

    it('should overwrite existing config', () => {
      const config = loadModule();
      config.saveConfig({ default: 'old' });
      config.saveConfig({ default: 'new' });

      const written = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8'));
      expect(written.default).toBe('new');
    });

    it('should write formatted JSON (2-space indent)', () => {
      const config = loadModule();
      const data = { default: 'gemini' };
      config.saveConfig(data);

      const raw = fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8');
      expect(raw).toBe(JSON.stringify(data, null, 2));
    });
  });

  describe('getDefaultAliases', () => {
    it('should return an object with expected alias keys', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();

      const expectedKeys = [
        'gemini', 'gemini-pro', 'gemini-3.1',
        'gpt', 'gpt-pro', 'codex',
        'claude', 'sonnet', 'opus', 'haiku',
        'deepseek',
        'qwen', 'qwen-coder', 'qwen-flash',
        'mistral', 'devstral',
        'glm', 'minimax', 'grok', 'kimi', 'seed'
      ];

      for (const key of expectedKeys) {
        // Use array path to avoid Jest interpreting dots as nested access
        expect(aliases).toHaveProperty([key]);
      }
    });

    it('should map gemini to openrouter/google/gemini-3-flash-preview', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.gemini).toBe('openrouter/google/gemini-3-flash-preview');
    });

    it('should map claude to openrouter/anthropic/claude-sonnet-4.6', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.claude).toBe('openrouter/anthropic/claude-sonnet-4.6');
    });

    it('should map opus to openrouter/anthropic/claude-opus-4.6', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.opus).toBe('openrouter/anthropic/claude-opus-4.6');
    });

    it('should map gpt to openrouter/openai/gpt-5.2-chat', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.gpt).toBe('openrouter/openai/gpt-5.2-chat');
    });

    it('should map deepseek to openrouter/deepseek/deepseek-v3.2', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.deepseek).toBe('openrouter/deepseek/deepseek-v3.2');
    });

    it('should map all qwen variants correctly', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.qwen).toBe('openrouter/qwen/qwen3.5-397b-a17b');
      expect(aliases['qwen-coder']).toBe('openrouter/qwen/qwen3-coder-next');
      expect(aliases['qwen-flash']).toBe('openrouter/qwen/qwen3.5-flash-02-23');
    });

    it('should map mistral and devstral correctly', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.mistral).toBe('openrouter/mistralai/mistral-large-2512');
      expect(aliases.devstral).toBe('openrouter/mistralai/devstral-2512');
    });

    it('should map remaining aliases correctly', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.glm).toBe('openrouter/z-ai/glm-5');
      expect(aliases.minimax).toBe('openrouter/minimax/minimax-m2.5');
      expect(aliases.grok).toBe('openrouter/x-ai/grok-4.1-fast');
      expect(aliases.kimi).toBe('openrouter/moonshotai/kimi-k2.5');
      expect(aliases.seed).toBe('openrouter/bytedance-seed/seed-2.0-mini');
    });
  });

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
      // 'gemini' has no slash, not in aliases -> throw mentioning sidecar setup
      expect(() => config.resolveModel('gemini')).toThrow(/sidecar setup/i);
    });
  });

  describe('computeConfigHash', () => {
    it('should return null when no config file exists', () => {
      const config = loadModule();
      expect(config.computeConfigHash()).toBeNull();
    });

    it('should return first 8 hex chars of SHA-256 hash', () => {
      const content = JSON.stringify({ default: 'gemini', aliases: { gemini: 'test' } }, null, 2);
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);
      const config = loadModule();

      const result = config.computeConfigHash();

      // Verify it's 8 hex characters
      expect(result).toMatch(/^[0-9a-f]{8}$/);

      // Verify it matches SHA-256
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
      expect(result).toBe(expectedHash);
    });

    it('should return different hashes for different configs', () => {
      const config = loadModule();

      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({ a: 1 }));
      jest.resetModules();
      const hash1 = loadModule().computeConfigHash();

      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({ b: 2 }));
      jest.resetModules();
      const hash2 = loadModule().computeConfigHash();

      expect(hash1).not.toBe(hash2);
    });

    it('should return same hash for same content', () => {
      const content = JSON.stringify({ test: true });
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);

      const config1 = loadModule();
      const hash1 = config1.computeConfigHash();
      jest.resetModules();
      const hash2 = loadModule().computeConfigHash();

      expect(hash1).toBe(hash2);
    });
  });

  describe('buildAliasTable', () => {
    it('should return a markdown table', () => {
      const data = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat'
        }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();

      const table = config.buildAliasTable();

      // Should have markdown table structure
      expect(table).toContain('|');
      expect(table).toContain('Alias');
      expect(table).toContain('Model');
    });

    it('should mark the default alias with (default)', () => {
      const data = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat'
        }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();

      const table = config.buildAliasTable();

      // The default alias should be marked
      expect(table).toContain('(default)');
      // gemini line should have (default)
      const lines = table.split('\n');
      const geminiLine = lines.find(l => l.includes('gemini') && l.includes('gemini-3-flash'));
      expect(geminiLine).toContain('(default)');
    });

    it('should include all aliases from config', () => {
      const data = {
        default: 'gpt',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat',
          claude: 'openrouter/anthropic/claude-sonnet-4.6'
        }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();

      const table = config.buildAliasTable();

      expect(table).toContain('gemini');
      expect(table).toContain('gpt');
      expect(table).toContain('claude');
    });

    it('should return empty string when no config exists', () => {
      const config = loadModule();
      const table = config.buildAliasTable();
      expect(table).toBe('');
    });

    it('should return empty string when config has no aliases', () => {
      const data = { default: 'gemini' };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const table = config.buildAliasTable();
      expect(table).toBe('');
    });
  });

  describe('checkConfigChanged', () => {
    it('should return changed: false when hash matches', () => {
      const content = JSON.stringify({ default: 'gemini', aliases: { gemini: 'test' } }, null, 2);
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);
      const config = loadModule();

      const currentHash = config.computeConfigHash();
      const result = config.checkConfigChanged(currentHash);

      expect(result.changed).toBe(false);
    });

    it('should return changed: true when hash differs', () => {
      const content = JSON.stringify({ default: 'gemini', aliases: { gemini: 'test' } }, null, 2);
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);
      const config = loadModule();

      const result = config.checkConfigChanged('00000000');

      expect(result.changed).toBe(true);
      expect(result).toHaveProperty('newHash');
      expect(result).toHaveProperty('updateData');
    });

    it('should return changed: true when no config exists and hash is provided', () => {
      const config = loadModule();
      const result = config.checkConfigChanged('abcdef12');

      // Config was removed so hash is null now, different from provided
      expect(result.changed).toBe(true);
      expect(result.newHash).toBeNull();
    });

    it('should return changed: false when no config exists and hash is null', () => {
      const config = loadModule();
      const result = config.checkConfigChanged(null);

      expect(result.changed).toBe(false);
    });

    it('should include newHash in result when changed', () => {
      const content = JSON.stringify({ default: 'gemini', aliases: { gemini: 'test' } }, null, 2);
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);
      const config = loadModule();

      const result = config.checkConfigChanged('oldoldhash');

      expect(result.newHash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should include updateData with hash comment and alias table when changed', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data, null, 2));
      const config = loadModule();

      const result = config.checkConfigChanged('oldoldhash');

      expect(result.changed).toBe(true);
      expect(result.updateData).toBeDefined();
      // updateData should contain the alias table
      expect(result.updateData).toContain('gemini');
      // updateData should contain the hash comment
      expect(result.updateData).toContain(result.newHash);
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
});
