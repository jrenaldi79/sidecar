/**
 * Tests for src/utils/api-key-store.js — validation and endpoints
 *
 * Covers validateApiKey, VALIDATION_ENDPOINTS, and provider-specific
 * validation behavior.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// Mock https for validation tests
jest.mock('https');

const {
  validateApiKey,
  VALIDATION_ENDPOINTS
} = require('../src/utils/api-key-store');

describe('api-key-store validation', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-apikey-'));
    originalEnv = { ...process.env };
    // Point env dir to temp for test isolation
    process.env.SIDECAR_ENV_DIR = tmpDir;
    // Clear relevant env vars so they don't leak between tests
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validateApiKey', () => {
    it('should resolve valid for a successful API response', async () => {
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb(JSON.stringify({ data: [] })); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn() };
      });

      const result = await validateApiKey('openrouter', 'sk-or-valid');
      expect(result).toEqual({ valid: true });
    });

    it('should resolve invalid for 401 response', async () => {
      const mockResponse = {
        statusCode: 401,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb('Unauthorized'); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn() };
      });

      const result = await validateApiKey('openrouter', 'sk-or-bad');
      expect(result).toEqual({ valid: false, error: 'Invalid API key (401)' });
    });

    it('should resolve invalid for network error', async () => {
      https.get.mockImplementation((_url, _opts, _cb) => {
        const req = { on: jest.fn() };
        setTimeout(() => {
          const errCall = req.on.mock.calls.find(c => c[0] === 'error');
          if (errCall) { errCall[1](new Error('Network error')); }
        }, 0);
        return req;
      });

      const result = await validateApiKey('openrouter', 'sk-or-err');
      expect(result).toEqual({ valid: false, error: 'Network error' });
    });

    it('should reject empty key', async () => {
      const result = await validateApiKey('openrouter', '');
      expect(result).toEqual({ valid: false, error: 'API key is required' });
    });

    it('should reject whitespace-only key', async () => {
      const result = await validateApiKey('openrouter', '   ');
      expect(result).toEqual({ valid: false, error: 'API key is required' });
    });

    it('should reject unknown provider', async () => {
      const result = await validateApiKey('unknown-provider', 'some-key');
      expect(result).toEqual({ valid: false, error: 'Unknown provider: unknown-provider' });
    });

    it('should be aliased as validateOpenRouterKey for backwards compat', () => {
      const store = require('../src/utils/api-key-store');
      expect(store.validateOpenRouterKey).toBe(store.validateApiKey);
    });

    it('should handle 403 response as invalid', async () => {
      const mockResponse = {
        statusCode: 403,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb('Forbidden'); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn() };
      });

      const result = await validateApiKey('openrouter', 'sk-or-forbidden');
      expect(result).toEqual({ valid: false, error: 'Invalid API key (403)' });
    });

    it('should handle unexpected status code', async () => {
      const mockResponse = {
        statusCode: 500,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb('Internal error'); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn() };
      });

      const result = await validateApiKey('openrouter', 'sk-or-500');
      expect(result).toEqual({ valid: false, error: 'Unexpected response (500)' });
    });

    it('should treat anthropic non-401 response as valid', async () => {
      // Anthropic returns 400/405 for valid key with no body
      const mockResponse = {
        statusCode: 400,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb('Bad request'); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn() };
      });

      const result = await validateApiKey('anthropic', 'sk-ant-valid');
      expect(result).toEqual({ valid: true });
    });

    it('should treat anthropic 401 response as invalid', async () => {
      const mockResponse = {
        statusCode: 401,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb('Unauthorized'); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((_url, _opts, cb) => {
        cb(mockResponse);
        return { on: jest.fn() };
      });

      const result = await validateApiKey('anthropic', 'sk-ant-bad');
      expect(result).toEqual({ valid: false, error: 'Invalid API key (401)' });
    });

    it('should validate deepseek key using correct endpoint', async () => {
      let capturedUrl;
      let capturedHeaders;
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb('{}'); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((url, opts, cb) => {
        capturedUrl = url;
        capturedHeaders = opts.headers;
        cb(mockResponse);
        return { on: jest.fn() };
      });

      const result = await validateApiKey('deepseek', 'sk-deepseek-valid');
      expect(result).toEqual({ valid: true });
      expect(capturedUrl).toBe('https://api.deepseek.com/models');
      expect(capturedHeaders.Authorization).toBe('Bearer sk-deepseek-valid');
    });

    it('should use query param auth for google provider', async () => {
      let capturedUrl;
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event, cb) => {
          if (event === 'data') { cb('{}'); }
          if (event === 'end') { cb(); }
          return mockResponse;
        })
      };
      https.get.mockImplementation((url, _opts, cb) => {
        capturedUrl = url;
        cb(mockResponse);
        return { on: jest.fn() };
      });

      await validateApiKey('google', 'AIza-test-key');

      expect(capturedUrl).toContain('?key=AIza-test-key');
    });
  });

  describe('VALIDATION_ENDPOINTS', () => {
    it('should have endpoints for all known providers', () => {
      expect(VALIDATION_ENDPOINTS.openrouter).toBeDefined();
      expect(VALIDATION_ENDPOINTS.openai).toBeDefined();
      expect(VALIDATION_ENDPOINTS.anthropic).toBeDefined();
      expect(VALIDATION_ENDPOINTS.google).toBeDefined();
      expect(VALIDATION_ENDPOINTS.deepseek).toBeDefined();
    });

    it('should have url and authHeader for each endpoint', () => {
      for (const endpoint of Object.values(VALIDATION_ENDPOINTS)) {
        expect(typeof endpoint.url).toBe('string');
        expect(typeof endpoint.authHeader).toBe('function');
      }
    });

    it('should return Bearer auth for openrouter', () => {
      const headers = VALIDATION_ENDPOINTS.openrouter.authHeader('test-key');
      expect(headers.Authorization).toBe('Bearer test-key');
    });

    it('should return x-api-key for anthropic', () => {
      const headers = VALIDATION_ENDPOINTS.anthropic.authHeader('test-key');
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers['anthropic-version']).toBeDefined();
    });

    it('should return empty headers for google (uses query param)', () => {
      const headers = VALIDATION_ENDPOINTS.google.authHeader('test-key');
      expect(Object.keys(headers)).toHaveLength(0);
    });

    it('should have correct deepseek endpoint properties', () => {
      expect(VALIDATION_ENDPOINTS.deepseek.url).toBe('https://api.deepseek.com/models');
      const headers = VALIDATION_ENDPOINTS.deepseek.authHeader('test-key');
      expect(headers.Authorization).toBe('Bearer test-key');
    });
  });
});
