/**
 * Model Validator Tests
 *
 * Tests for direct-API model validation, filtering, and user prompting.
 */

jest.mock('../src/utils/model-fetcher');
jest.mock('../src/utils/api-key-store');
jest.mock('../src/utils/config');
jest.mock('../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const { fetchModelsFromProvider } = require('../src/utils/model-fetcher');
const { readApiKeyValues } = require('../src/utils/api-key-store');
const { loadConfig, saveConfig, getConfigPath } = require('../src/utils/config');

const MOCK_GOOGLE_MODELS = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'google/gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'google/text-embedding-004', name: 'Text Embedding 004' },
];

const MOCK_OPENAI_MODELS = [
  { id: 'openai/gpt-4o', name: 'gpt-4o' },
  { id: 'openai/gpt-4-turbo', name: 'gpt-4-turbo' },
  { id: 'openai/o3-mini', name: 'o3-mini' },
];

describe('Model Validator', () => {
  let validateDirectModel;
  let filterRelevantModels;
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
    filterRelevantModels = validator.filterRelevantModels;

    const fetcher = require('../src/utils/model-fetcher');
    const keyStore = require('../src/utils/api-key-store');
    const config = require('../src/utils/config');

    keyStore.readApiKeyValues.mockReturnValue({ google: 'test-key' });
    config.loadConfig.mockReturnValue({ aliases: {} });
    config.saveConfig.mockImplementation(() => {});
    config.getConfigPath.mockReturnValue('/tmp/sidecar-test-config.json');
    fetcher.fetchModelsFromProvider.mockResolvedValue(MOCK_GOOGLE_MODELS);

    // Default to TTY for interactive tests; non-TTY tests override this
    process.stdin.isTTY = true;
  });

  describe('validateDirectModel', () => {
    it('should return silently when model exists on provider', async () => {
      const result = await validateDirectModel('google/gemini-2.5-flash', 'gemini');
      expect(result).toBe('google/gemini-2.5-flash');
    });

    it('should return model as-is when no provider key is available', async () => {
      const keyStore = require('../src/utils/api-key-store');
      keyStore.readApiKeyValues.mockReturnValue({});

      const result = await validateDirectModel('google/gemini-old', 'gemini');
      expect(result).toBe('google/gemini-old');
    });

    it('should return model as-is when fetch fails (network error)', async () => {
      const fetcher = require('../src/utils/model-fetcher');
      fetcher.fetchModelsFromProvider.mockRejectedValue(new Error('Network error'));

      const result = await validateDirectModel('google/gemini-old', 'gemini');
      expect(result).toBe('google/gemini-old');
    });

    it('should return model as-is when fetch returns empty list', async () => {
      const fetcher = require('../src/utils/model-fetcher');
      fetcher.fetchModelsFromProvider.mockResolvedValue([]);

      const result = await validateDirectModel('google/gemini-old', 'gemini');
      expect(result).toBe('google/gemini-old');
    });

    it('should return model as-is for malformed model string', async () => {
      const result = await validateDirectModel('noSlash', 'gemini');
      expect(result).toBe('noSlash');
    });

    it('should throw in headless mode when model not found', async () => {
      await expect(
        validateDirectModel('google/gemini-old-deprecated', 'gemini', { headless: true })
      ).rejects.toThrow(/not found on google API/i);
    });

    it('should include available models in headless error', async () => {
      await expect(
        validateDirectModel('google/gemini-old-deprecated', 'gemini', { headless: true })
      ).rejects.toThrow(/gemini-2\.5-flash/);
    });

    it('should include fix command in headless error', async () => {
      await expect(
        validateDirectModel('google/gemini-old-deprecated', 'gemini', { headless: true })
      ).rejects.toThrow(/sidecar setup --add-alias/);
    });

    it('should throw when stdin is not a TTY (non-interactive)', async () => {
      process.stdin.isTTY = false;

      await expect(
        validateDirectModel('google/gemini-old-deprecated', 'gemini')
      ).rejects.toThrow(/not found on google API/i);
    });

    it('should prompt user in interactive mode when model not found', async () => {
      // Mock readline to simulate user selecting option 1
      const mockRl = { question: jest.fn(), close: jest.fn() };
      mockRl.question.mockImplementation((_prompt, cb) => cb('1'));
      jest.spyOn(require('readline'), 'createInterface').mockReturnValue(mockRl);

      // Suppress stderr output during test
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const result = await validateDirectModel('google/gemini-old', 'gemini');

      // filterRelevantModels sorts by name, so first match is Gemini 1.5 Pro
      expect(result).toMatch(/^google\/gemini-/);
      expect(mockRl.question).toHaveBeenCalled();
      expect(mockRl.close).toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it('should save selected model to config', async () => {
      const config = require('../src/utils/config');
      const mockRl = { question: jest.fn(), close: jest.fn() };
      mockRl.question.mockImplementation((_prompt, cb) => cb('1'));
      jest.spyOn(require('readline'), 'createInterface').mockReturnValue(mockRl);
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      await validateDirectModel('google/gemini-old', 'gemini');

      expect(config.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          aliases: expect.objectContaining({
            gemini: expect.stringMatching(/^google\/gemini-/)
          })
        })
      );

      process.stderr.write.mockRestore();
    });

    it('should throw when config file exists but is malformed', async () => {
      const config = require('../src/utils/config');
      const fs = require('fs');

      config.loadConfig.mockReturnValue(null);
      config.getConfigPath.mockReturnValue('/tmp/sidecar-test-config.json');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const mockRl = { question: jest.fn(), close: jest.fn() };
      mockRl.question.mockImplementation((_prompt, cb) => cb('1'));
      jest.spyOn(require('readline'), 'createInterface').mockReturnValue(mockRl);
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      await expect(
        validateDirectModel('google/gemini-old', 'gemini')
      ).rejects.toThrow(/malformed/i);

      expect(config.saveConfig).not.toHaveBeenCalled();

      process.stderr.write.mockRestore();
      fs.existsSync.mockRestore();
    });

    it('should create new config when no config file exists', async () => {
      const config = require('../src/utils/config');
      const fs = require('fs');

      config.loadConfig.mockReturnValue(null);
      config.getConfigPath.mockReturnValue('/tmp/sidecar-nonexistent-config.json');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const mockRl = { question: jest.fn(), close: jest.fn() };
      mockRl.question.mockImplementation((_prompt, cb) => cb('1'));
      jest.spyOn(require('readline'), 'createInterface').mockReturnValue(mockRl);
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const result = await validateDirectModel('google/gemini-old', 'gemini');

      expect(result).toMatch(/^google\/gemini-/);
      expect(config.saveConfig).toHaveBeenCalled();

      process.stderr.write.mockRestore();
      fs.existsSync.mockRestore();
    });

    it('should throw when user cancels (empty input)', async () => {
      const mockRl = { question: jest.fn(), close: jest.fn() };
      mockRl.question.mockImplementation((_prompt, cb) => cb(''));
      jest.spyOn(require('readline'), 'createInterface').mockReturnValue(mockRl);
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      await expect(
        validateDirectModel('google/gemini-old', 'gemini')
      ).rejects.toThrow(/cancelled/i);

      process.stderr.write.mockRestore();
    });

    it('should throw when user enters invalid number', async () => {
      const mockRl = { question: jest.fn(), close: jest.fn() };
      mockRl.question.mockImplementation((_prompt, cb) => cb('999'));
      jest.spyOn(require('readline'), 'createInterface').mockReturnValue(mockRl);
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      await expect(
        validateDirectModel('google/gemini-old', 'gemini')
      ).rejects.toThrow(/cancelled/i);

      process.stderr.write.mockRestore();
    });
  });

  describe('filterRelevantModels', () => {
    it('should filter google models by gemini alias', () => {
      const result = filterRelevantModels(MOCK_GOOGLE_MODELS, 'gemini');
      expect(result.every(m => m.id.includes('gemini'))).toBe(true);
      expect(result.length).toBe(4);
    });

    it('should filter openai models by gpt alias', () => {
      const result = filterRelevantModels(MOCK_OPENAI_MODELS, 'gpt');
      expect(result.every(m => m.id.includes('gpt'))).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should return all models when alias has no matches', () => {
      const result = filterRelevantModels(MOCK_GOOGLE_MODELS, 'unknownalias');
      expect(result.length).toBe(MOCK_GOOGLE_MODELS.length);
    });

    it('should sort results by name', () => {
      const result = filterRelevantModels(MOCK_GOOGLE_MODELS, 'gemini');
      for (let i = 1; i < result.length; i++) {
        expect(result[i].name.localeCompare(result[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should limit results to 15', () => {
      const manyModels = Array.from({ length: 30 }, (_, i) => ({
        id: `google/gemini-model-${i}`, name: `Gemini Model ${i}`
      }));
      const result = filterRelevantModels(manyModels, 'gemini');
      expect(result.length).toBe(15);
    });

    it('should use alias search term mapping for opus → claude', () => {
      const anthropicModels = [
        { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
        { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
        { id: 'anthropic/some-other-model', name: 'Other Model' },
      ];
      const result = filterRelevantModels(anthropicModels, 'opus');
      expect(result.every(m => m.id.includes('claude'))).toBe(true);
    });
  });
});
