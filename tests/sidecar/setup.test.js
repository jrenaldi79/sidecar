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

// Mock setup-window to prevent Electron spawn in tests
jest.mock('../../src/sidecar/setup-window', () => ({
  launchSetupWindow: jest.fn().mockResolvedValue({ success: true })
}));

describe('Setup Wizard', () => {
  let tmpDir;
  let envDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-setup-test-'));
    envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-env-test-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tmpDir;
    process.env.SIDECAR_ENV_DIR = envDir;
    // Clear API key env vars
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(envDir, { recursive: true, force: true });
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
    it('should detect OpenRouter key from .env file', () => {
      fs.writeFileSync(
        path.join(envDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-test-key\n'
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
    });

    it('should detect Google key from .env file', () => {
      fs.writeFileSync(
        path.join(envDir, '.env'),
        'GEMINI_API_KEY=AIza-test-key\n'
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.google).toBe(true);
    });

    it('should detect OpenAI key from .env file', () => {
      fs.writeFileSync(
        path.join(envDir, '.env'),
        'OPENAI_API_KEY=sk-test-key\n'
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openai).toBe(true);
    });

    it('should detect env var keys (OPENROUTER_API_KEY)', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(true);
    });

    it('should detect env var keys (GEMINI_API_KEY)', () => {
      process.env.GEMINI_API_KEY = 'AIza-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.google).toBe(true);
    });

    it('should detect env var keys (OPENAI_API_KEY)', () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openai).toBe(true);
    });

    it('should detect env var keys (ANTHROPIC_API_KEY)', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key';

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.anthropic).toBe(true);
    });

    it('should return all false when no keys found', () => {
      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(false);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
    });

    it('should handle malformed .env file gracefully', () => {
      fs.writeFileSync(path.join(envDir, '.env'), 'not a valid env format without equals');

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(false);
      expect(result.google).toBe(false);
    });

    it('should combine env vars and .env file keys', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env';

      fs.writeFileSync(
        path.join(envDir, '.env'),
        'GEMINI_API_KEY=AIza-test\n'
      );

      const { detectApiKeys } = require('../../src/sidecar/setup');
      const result = detectApiKeys();

      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(true);
    });
  });

  describe('runReadlineSetup', () => {
    it('should be an exported async function', () => {
      const { runReadlineSetup } = require('../../src/sidecar/setup');
      expect(typeof runReadlineSetup).toBe('function');
    });

    it('should create config when user picks option 1 (gemini)', async () => {
      const readline = require('readline');

      const mockInterface = {
        question: jest.fn(),
        close: jest.fn()
      };

      mockInterface.question.mockImplementation((_prompt, callback) => {
        callback('1');
      });

      jest.spyOn(readline, 'createInterface').mockReturnValue(mockInterface);

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runReadlineSetup();

      logSpy.mockRestore();
      readline.createInterface.mockRestore();

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

      const { runReadlineSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runReadlineSetup();

      logSpy.mockRestore();
      readline.createInterface.mockRestore();

      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('opus');
    });
  });

  describe('runInteractiveSetup (Electron-first)', () => {
    it('should be an async function', () => {
      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      expect(typeof runInteractiveSetup).toBe('function');
    });

    it('should attempt to launch Electron wizard first', async () => {
      const { launchSetupWindow } = require('../../src/sidecar/setup-window');
      launchSetupWindow.mockResolvedValue({
        success: true, default: 'gemini', keyCount: 1
      });

      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runInteractiveSetup();

      logSpy.mockRestore();

      expect(launchSetupWindow).toHaveBeenCalled();
    });

    it('should create config from Electron wizard result', async () => {
      const { launchSetupWindow } = require('../../src/sidecar/setup-window');
      launchSetupWindow.mockResolvedValue({
        success: true, default: 'gemini-pro', keyCount: 2
      });

      const { runInteractiveSetup } = require('../../src/sidecar/setup');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runInteractiveSetup();

      logSpy.mockRestore();

      // Config should have been created with the wizard's chosen default
      const saved = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')
      );
      expect(saved.default).toBe('gemini-pro');
    });

    it('should fall back to readline when Electron fails', async () => {
      const { launchSetupWindow } = require('../../src/sidecar/setup-window');
      launchSetupWindow.mockRejectedValue(new Error('Electron not available'));

      const readline = require('readline');
      const mockInterface = {
        question: jest.fn(),
        close: jest.fn()
      };
      mockInterface.question.mockImplementation((_prompt, callback) => {
        callback('3'); // pick gpt
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
      expect(saved.default).toBe('gpt');
    });
  });
});
