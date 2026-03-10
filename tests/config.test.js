/**
 * Sidecar Config Module Tests
 *
 * Tests for config directory resolution, config file I/O,
 * and default alias definitions.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Sidecar Config Module', () => {
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
        'gemini', 'gemini-pro',
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

    it('should map gemini to openrouter/google/gemini-3.1-flash-lite-preview', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.gemini).toBe('openrouter/google/gemini-3.1-flash-lite-preview');
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

    it('should map gpt to openrouter/openai/gpt-5.4', () => {
      const config = loadModule();
      const aliases = config.getDefaultAliases();
      expect(aliases.gpt).toBe('openrouter/openai/gpt-5.4');
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
});
