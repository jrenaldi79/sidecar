/**
 * Tests for src/utils/model-fetcher.js
 *
 * Model list fetching from provider APIs for the dropdown selector.
 */

const https = require('https');

jest.mock('https');

const {
  fetchModelsFromProvider,
  fetchAllModels,
  groupModelsByFamily,
  ANTHROPIC_MODELS
} = require('../src/utils/model-fetcher');

describe('model-fetcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ANTHROPIC_MODELS', () => {
    it('should be a non-empty array of { id, name } objects', () => {
      expect(Array.isArray(ANTHROPIC_MODELS)).toBe(true);
      expect(ANTHROPIC_MODELS.length).toBeGreaterThan(0);
      ANTHROPIC_MODELS.forEach(m => {
        expect(m).toHaveProperty('id');
        expect(m).toHaveProperty('name');
        expect(typeof m.id).toBe('string');
        expect(typeof m.name).toBe('string');
      });
    });
  });

  describe('fetchModelsFromProvider', () => {
    function mockHttpsGet(statusCode, body) {
      const mockResponse = {
        statusCode,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb(typeof body === 'string' ? body : JSON.stringify(body)); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn(), destroy: jest.fn() };
      });
    }

    it('should fetch and normalize OpenRouter models', async () => {
      mockHttpsGet(200, {
        data: [
          { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
          { id: 'openai/gpt-5', name: 'GPT-5' }
        ]
      });

      const result = await fetchModelsFromProvider('openrouter', 'sk-or-test');
      expect(result).toEqual([
        { id: 'openrouter/google/gemini-3-flash', name: 'Gemini 3 Flash' },
        { id: 'openrouter/openai/gpt-5', name: 'GPT-5' }
      ]);
    });

    it('should fetch and normalize Google models', async () => {
      mockHttpsGet(200, {
        models: [
          { name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash' },
          { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro' }
        ]
      });

      const result = await fetchModelsFromProvider('google', 'AIza-test');
      expect(result).toEqual([
        { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
        { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro' }
      ]);
    });

    it('should fetch and normalize OpenAI models', async () => {
      mockHttpsGet(200, {
        data: [
          { id: 'gpt-5', name: 'GPT-5' },
          { id: 'o3', name: 'O3' }
        ]
      });

      const result = await fetchModelsFromProvider('openai', 'sk-test');
      expect(result).toEqual([
        { id: 'openai/gpt-5', name: 'gpt-5' },
        { id: 'openai/o3', name: 'o3' }
      ]);
    });

    it('should return hardcoded models for anthropic (no API call)', async () => {
      const result = await fetchModelsFromProvider('anthropic', 'sk-ant-test');
      expect(result).toEqual(ANTHROPIC_MODELS);
      expect(https.get).not.toHaveBeenCalled();
    });

    it('should return empty array on network error', async () => {
      https.get.mockImplementation((_url, _opts, _cb) => {
        const req = {
          on: jest.fn((event, cb) => {
            if (event === 'error') { cb(new Error('ECONNREFUSED')); }
          }),
          destroy: jest.fn()
        };
        return req;
      });

      const result = await fetchModelsFromProvider('openrouter', 'sk-or-test');
      expect(result).toEqual([]);
    });

    it('should return empty array on 401 response', async () => {
      mockHttpsGet(401, 'Unauthorized');

      const result = await fetchModelsFromProvider('openrouter', 'sk-or-bad');
      expect(result).toEqual([]);
    });

    it('should return empty array for unknown provider', async () => {
      const result = await fetchModelsFromProvider('unknown', 'key');
      expect(result).toEqual([]);
    });

    it('should return empty array on malformed JSON', async () => {
      mockHttpsGet(200, 'not json{{{');

      const result = await fetchModelsFromProvider('openrouter', 'sk-or-test');
      expect(result).toEqual([]);
    });
  });

  describe('fetchAllModels', () => {
    function mockHttpsGet(statusCode, body) {
      const mockResponse = {
        statusCode,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb(typeof body === 'string' ? body : JSON.stringify(body)); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn(), destroy: jest.fn() };
      });
    }

    it('should always include anthropic models even with no keys', async () => {
      const result = await fetchAllModels({});
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(m => m.id.startsWith('anthropic/'))).toBe(true);
    });

    it('should fetch only from providers with keys', async () => {
      mockHttpsGet(200, { data: [{ id: 'google/gemini', name: 'Gemini' }] });

      const result = await fetchAllModels({ openrouter: 'sk-or-test' });
      // Should have anthropic + openrouter models
      expect(result.some(m => m.id.startsWith('anthropic/'))).toBe(true);
      expect(result.some(m => m.id.startsWith('openrouter/'))).toBe(true);
    });

    it('should handle all providers failing gracefully', async () => {
      https.get.mockImplementation((_url, _opts, _cb) => {
        const req = {
          on: jest.fn((event, cb) => {
            if (event === 'error') { cb(new Error('fail')); }
          }),
          destroy: jest.fn()
        };
        return req;
      });

      const result = await fetchAllModels({
        openrouter: 'key', google: 'key', openai: 'key'
      });
      // Should still have anthropic models at minimum
      expect(result.length).toBe(ANTHROPIC_MODELS.length);
    });
  });

  describe('groupModelsByFamily', () => {
    it('should group models by provider prefix', () => {
      const models = [
        { id: 'openrouter/google/gemini-3-flash', name: 'Gemini 3 Flash' },
        { id: 'openrouter/openai/gpt-5', name: 'GPT-5' },
        { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet' },
        { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro' }
      ];

      const groups = groupModelsByFamily(models);
      expect(Array.isArray(groups)).toBe(true);
      expect(groups.length).toBeGreaterThan(0);
      groups.forEach(g => {
        expect(g).toHaveProperty('family');
        expect(g).toHaveProperty('models');
        expect(Array.isArray(g.models)).toBe(true);
      });
    });

    it('should have correct family names', () => {
      const models = [
        { id: 'openrouter/google/gemini', name: 'Gemini' },
        { id: 'anthropic/claude', name: 'Claude' },
        { id: 'google/gemini-pro', name: 'Gemini Pro' },
        { id: 'openai/gpt-5', name: 'GPT-5' }
      ];

      const groups = groupModelsByFamily(models);
      const families = groups.map(g => g.family);
      expect(families).toContain('OpenRouter');
      expect(families).toContain('Anthropic');
      expect(families).toContain('Google');
      expect(families).toContain('OpenAI');
    });

    it('should return empty array for empty input', () => {
      expect(groupModelsByFamily([])).toEqual([]);
    });

    it('should preserve all models in groups', () => {
      const models = [
        { id: 'openrouter/a', name: 'A' },
        { id: 'openrouter/b', name: 'B' },
        { id: 'anthropic/c', name: 'C' }
      ];

      const groups = groupModelsByFamily(models);
      const totalModels = groups.reduce((sum, g) => sum + g.models.length, 0);
      expect(totalModels).toBe(3);
    });
  });
});
