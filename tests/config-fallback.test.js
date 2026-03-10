/**
 * Config Direct API Fallback Tests
 *
 * Tests that applyDirectApiFallback checks both process.env
 * and persisted keys from api-key-store.
 */

jest.mock('../src/utils/api-key-store', () => ({
  PROVIDER_ENV_MAP: {
    openrouter: 'OPENROUTER_API_KEY',
    google: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  },
  readApiKeyValues: jest.fn(),
}));
jest.mock('../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('applyDirectApiFallback with persisted keys', () => {
  let tempDir;
  let originalEnv;
  let resolveModel;
  let readApiKeyValues;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fallback-test-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tempDir;

    // Clear all relevant env vars
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    // Write a config with aliases
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      default: 'gemini',
      aliases: { gemini: 'openrouter/google/gemini-3-flash' },
    }));

    const store = require('../src/utils/api-key-store');
    readApiKeyValues = store.readApiKeyValues;
    readApiKeyValues.mockReturnValue({});

    // Re-require config to pick up env changes
    jest.resetModules();
    jest.mock('../src/utils/api-key-store', () => ({
      PROVIDER_ENV_MAP: {
        openrouter: 'OPENROUTER_API_KEY',
        google: 'GEMINI_API_KEY',
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        deepseek: 'DEEPSEEK_API_KEY',
      },
      readApiKeyValues: jest.fn(),
    }));
    jest.mock('../src/utils/logger', () => ({
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));

    const config = require('../src/utils/config');
    resolveModel = config.resolveModel;
    readApiKeyValues = require('../src/utils/api-key-store').readApiKeyValues;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return openrouter model when OPENROUTER_API_KEY is in persisted keys', () => {
    // Persisted key for openrouter but not in process.env
    readApiKeyValues.mockReturnValue({ openrouter: 'sk-or-persisted-key' });

    const result = resolveModel('gemini');
    // Should NOT strip the openrouter/ prefix since openrouter key exists in store
    expect(result).toBe('openrouter/google/gemini-3-flash');
  });

  it('should fallback to direct API when provider key is in persisted keys', () => {
    // No openrouter key anywhere, but google key in persisted store
    readApiKeyValues.mockReturnValue({ google: 'google-persisted-key' });

    // Suppress stderr
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = resolveModel('gemini');
    spy.mockRestore();

    // Should strip openrouter/ prefix and use direct google API
    expect(result).toBe('google/gemini-3-flash');
  });

  it('should still check process.env for OPENROUTER_API_KEY', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env-key';
    readApiKeyValues.mockReturnValue({});

    const result = resolveModel('gemini');
    expect(result).toBe('openrouter/google/gemini-3-flash');
  });

  it('should still check process.env for provider key fallback', () => {
    process.env.GEMINI_API_KEY = 'google-env-key';
    readApiKeyValues.mockReturnValue({});

    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = resolveModel('gemini');
    spy.mockRestore();

    expect(result).toBe('google/gemini-3-flash');
  });

  it('should return model unchanged when neither env nor persisted keys exist', () => {
    readApiKeyValues.mockReturnValue({});

    const result = resolveModel('gemini');
    expect(result).toBe('openrouter/google/gemini-3-flash');
  });
});

describe('applyDirectApiFallback un-mocked integration', () => {
  let tempDir;
  let tempEnvDir;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fallback-int-'));
    tempEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-env-int-'));

    // Clear all relevant env vars
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    process.env.SIDECAR_CONFIG_DIR = tempDir;
    process.env.SIDECAR_ENV_DIR = tempEnvDir;

    // Write a config with aliases
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash' },
      })
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(tempEnvDir, { recursive: true, force: true });
  });

  it('should fallback to direct API using real .env file with persisted key', () => {
    // Write a real .env file with a Google API key (no openrouter key)
    fs.writeFileSync(
      path.join(tempEnvDir, '.env'),
      'GEMINI_API_KEY=real-google-key-from-env-file\n'
    );

    // Reset modules and unmock api-key-store so the real implementation runs
    jest.resetModules();
    jest.unmock('../src/utils/api-key-store');
    jest.mock('../src/utils/logger', () => ({
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));
    const config = require('../src/utils/config');

    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = config.resolveModel('gemini');
    spy.mockRestore();

    // Real loadEnvEntries() -> resolveKeyValue() chain should detect
    // the persisted google key and strip the openrouter/ prefix
    expect(result).toBe('google/gemini-3-flash');
  });
});
