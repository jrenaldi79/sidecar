/**
 * Setup Wizard Tests
 *
 * Tests for the sidecar setup module: addAlias, createDefaultConfig,
 * detectApiKeys, and runInteractiveSetup.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Setup Wizard', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-setup-test-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_err) {
      // Ignore cleanup errors
    }
  });

  describe('addAlias', () => {
    it('should add alias to existing config', () => {
      // Pre-create a config with an existing alias
      const existingConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify(existingConfig, null, 2)
      );

      const { addAlias } = require('../../src/sidecar/setup');
      addAlias('my-model', 'openrouter/custom/model-v1');

      // Read back the config
      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.aliases['my-model']).toBe('openrouter/custom/model-v1');
      // Existing alias should still be there
      expect(saved.aliases.gemini).toBe('openrouter/google/gemini-3-flash-preview');
      // Default should be preserved
      expect(saved.default).toBe('gemini');
    });

    it('should create config when none exists', () => {
      // Ensure no config exists
      const configPath = path.join(tmpDir, 'config.json');
      expect(fs.existsSync(configPath)).toBe(false);

      const { addAlias } = require('../../src/sidecar/setup');
      addAlias('test-alias', 'openrouter/test/model');

      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.aliases['test-alias']).toBe('openrouter/test/model');
    });

    it('should overwrite existing alias with same name', () => {
      const existingConfig = {
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(
        path.join(tmpDir, 'config.json'),
        JSON.stringify(existingConfig, null, 2)
      );

      const { addAlias } = require('../../src/sidecar/setup');
      addAlias('gemini', 'openrouter/google/gemini-3-pro-preview');

      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.aliases.gemini).toBe('openrouter/google/gemini-3-pro-preview');
    });
  });

  describe('createDefaultConfig', () => {
    it('should create config with all default aliases and chosen default', () => {
      const { createDefaultConfig } = require('../../src/sidecar/setup');
      const cfg = createDefaultConfig('gemini');

      expect(cfg.default).toBe('gemini');
      expect(cfg.aliases).toBeDefined();
      expect(cfg.aliases.gemini).toBeDefined();
      expect(cfg.aliases['gemini-pro']).toBeDefined();
      expect(cfg.aliases.gpt).toBeDefined();
      expect(cfg.aliases.opus).toBeDefined();
      expect(cfg.aliases.deepseek).toBeDefined();

      // Verify it was saved to disk
      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('gemini');
      expect(saved.aliases).toEqual(cfg.aliases);
    });

    it('should have 21+ aliases', () => {
      const { createDefaultConfig } = require('../../src/sidecar/setup');
      const cfg = createDefaultConfig('gemini');

      const aliasCount = Object.keys(cfg.aliases).length;
      expect(aliasCount).toBeGreaterThanOrEqual(21);
    });

    it('should accept any string as default model', () => {
      const { createDefaultConfig } = require('../../src/sidecar/setup');
      const cfg = createDefaultConfig('openrouter/custom/my-model');

      expect(cfg.default).toBe('openrouter/custom/my-model');
    });
  });

  describe('detectApiKeys', () => {
    it('should detect OpenRouter key from auth.json', () => {
      // Create a fake auth.json
      const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-auth-'));
      const authData = {
        openrouter: { apiKey: 'sk-or-test-key' }
      };
      fs.writeFileSync(
        path.join(authDir, 'auth.json'),
        JSON.stringify(authData)
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys(authDir);

      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);

      // Clean up
      fs.rmSync(authDir, { recursive: true, force: true });
    });

    it('should detect Google key from auth.json', () => {
      const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-auth-'));
      const authData = {
        google: { apiKey: 'AIza-test-key' }
      };
      fs.writeFileSync(
        path.join(authDir, 'auth.json'),
        JSON.stringify(authData)
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys(authDir);

      expect(result.google).toBe(true);

      fs.rmSync(authDir, { recursive: true, force: true });
    });

    it('should detect OpenAI key from auth.json', () => {
      const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-auth-'));
      const authData = {
        openai: { apiKey: 'sk-test-key' }
      };
      fs.writeFileSync(
        path.join(authDir, 'auth.json'),
        JSON.stringify(authData)
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys(authDir);

      expect(result.openai).toBe(true);

      fs.rmSync(authDir, { recursive: true, force: true });
    });

    it('should detect env var keys (OPENROUTER_API_KEY)', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      // Pass a non-existent auth dir so only env vars are checked
      const result = detectApiKeys('/nonexistent/path');

      expect(result.openrouter).toBe(true);
    });

    it('should detect env var keys (GEMINI_API_KEY)', () => {
      process.env.GEMINI_API_KEY = 'AIza-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys('/nonexistent/path');

      expect(result.google).toBe(true);
    });

    it('should detect env var keys (OPENAI_API_KEY)', () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys('/nonexistent/path');

      expect(result.openai).toBe(true);
    });

    it('should detect env var keys (ANTHROPIC_API_KEY)', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys('/nonexistent/path');

      expect(result.anthropic).toBe(true);
    });

    it('should return all false when no keys found', () => {
      // Ensure no relevant env vars are set
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys('/nonexistent/path');

      expect(result.openrouter).toBe(false);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
    });

    it('should handle malformed auth.json gracefully', () => {
      const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-auth-'));
      fs.writeFileSync(path.join(authDir, 'auth.json'), 'not valid json');

      const { detectApiKeys } = require('../../src/sidecar/setup');
      // Should not throw
      const result = detectApiKeys(authDir);

      expect(result.openrouter).toBe(false);
      expect(result.google).toBe(false);

      fs.rmSync(authDir, { recursive: true, force: true });
    });

    it('should combine env vars and auth.json keys', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env';

      const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-auth-'));
      fs.writeFileSync(
        path.join(authDir, 'auth.json'),
        JSON.stringify({ google: { apiKey: 'AIza-test' } })
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys(authDir);

      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(true);

      fs.rmSync(authDir, { recursive: true, force: true });
    });
  });

  describe('runInteractiveSetup', () => {
    it('should be an async function', () => {
      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      expect(typeof runInteractiveSetup).toBe('function');
    });

    it('should create config when user picks option 1 (gemini)', async () => {
      const readline = require('readline');

      // Mock readline to simulate user input
      const mockInterface = {
        question: jest.fn(),
        close: jest.fn()
      };

      // Simulate user picking option "1"
      mockInterface.question.mockImplementation((_prompt, callback) => {
        callback('1');
      });

      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      const { runInteractiveSetup } = require('../../src/sidecar/setup');

      // Suppress console output during test
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runInteractiveSetup();

      logSpy.mockRestore();
      readline.createInterface.mockRestore();

      // Verify config was created with gemini as default
      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('gemini');
      expect(saved.aliases).toBeDefined();
    });

    it('should accept alias name as input (e.g., "opus")', async () => {
      const readline = require('readline');

      const mockInterface = {
        question: jest.fn(),
        close: jest.fn()
      };

      mockInterface.question.mockImplementation((_prompt, callback) => {
        callback('opus');
      });

      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runInteractiveSetup();

      logSpy.mockRestore();
      readline.createInterface.mockRestore();

      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('opus');
    });
  });
});
