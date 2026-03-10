/**
 * Model Validator Tests — normalizeModelId and config save behavior
 *
 * Tests for model ID normalization and prompt selection saving.
 */

jest.mock('../src/utils/model-fetcher');
jest.mock('../src/utils/api-key-store');
jest.mock('../src/utils/config');
jest.mock('../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

describe('Model Validator — normalize', () => {
  let validateDirectModel;
  let normalizeModelId;
  const origIsTTY = process.stdin.isTTY;

  afterAll(() => {
    process.stdin.isTTY = origIsTTY;
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Re-require after reset to get fresh module with mocks
    jest.mock('../src/utils/model-fetcher');
    jest.mock('../src/utils/api-key-store');
    jest.mock('../src/utils/config');
    jest.mock('../src/utils/logger', () => ({
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));

    const validator = require('../src/utils/model-validator');
    validateDirectModel = validator.validateDirectModel;
    normalizeModelId = validator.normalizeModelId;

    const fetcher = require('../src/utils/model-fetcher');
    const keyStore = require('../src/utils/api-key-store');
    const config = require('../src/utils/config');

    keyStore.readApiKeyValues.mockReturnValue({ google: 'test-key' });
    config.loadConfig.mockReturnValue({ aliases: {} });
    config.saveConfig.mockImplementation(() => {});
    config.getConfigPath.mockReturnValue('/tmp/sidecar-test-config.json');
    fetcher.fetchModelsFromProvider.mockResolvedValue([
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    ]);

    // Default to TTY for interactive tests
    process.stdin.isTTY = true;
  });

  describe('normalizeModelId', () => {
    it('should prepend provider when id lacks prefix', () => {
      expect(normalizeModelId('google', 'gemini-3-flash')).toBe('google/gemini-3-flash');
    });

    it('should return as-is when id already has provider prefix', () => {
      expect(normalizeModelId('google', 'google/gemini-3-flash')).toBe('google/gemini-3-flash');
    });

    it('should handle nested model ids (provider/org/model)', () => {
      expect(normalizeModelId('openai', 'openai/gpt-4o')).toBe('openai/gpt-4o');
    });

    it('should prepend provider for bare model name', () => {
      expect(normalizeModelId('anthropic', 'claude-sonnet-4.6')).toBe('anthropic/claude-sonnet-4.6');
    });
  });

  describe('normalize in headless error output', () => {
    it('should normalize model IDs in headless error output', async () => {
      const fetcher = require('../src/utils/model-fetcher');
      // Models returned WITHOUT provider prefix (simulating provider API)
      fetcher.fetchModelsFromProvider.mockResolvedValue([
        { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
        { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
      ]);

      try {
        await validateDirectModel('google/gemini-old', 'gemini', { headless: true });
        throw new Error('Should have thrown');
      } catch (err) {
        // Available models list should have provider prefix
        expect(err.message).toContain('google/gemini-3-flash');
        // Fix command suggestion should have provider prefix
        expect(err.message).toMatch(/--add-alias gemini=google\/gemini-/);
      }
    });
  });

  describe('promptModelSelection saves normalized id', () => {
    it('should normalize model id before saving to config', async () => {
      const config = require('../src/utils/config');
      const fetcher = require('../src/utils/model-fetcher');
      const keyStore = require('../src/utils/api-key-store');

      keyStore.readApiKeyValues.mockReturnValue({ google: 'test-key' });
      // Models returned WITHOUT provider prefix (simulating provider API)
      fetcher.fetchModelsFromProvider.mockResolvedValue([
        { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
        { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
      ]);

      const mockRl = { question: jest.fn(), close: jest.fn() };
      mockRl.question.mockImplementation((_prompt, cb) => cb('1'));
      jest.spyOn(require('readline'), 'createInterface').mockReturnValue(mockRl);
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      await validateDirectModel('google/gemini-old', 'gemini');

      // Should save with provider prefix even though selected.id was bare
      expect(config.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          aliases: expect.objectContaining({
            gemini: 'google/gemini-3-flash',
          }),
        })
      );

      process.stderr.write.mockRestore();
    });
  });
});
