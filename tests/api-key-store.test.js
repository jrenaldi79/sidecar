/**
 * Tests for src/utils/api-key-store.js
 *
 * API key persistence using .env files: reading, saving, validation,
 * and process.env integration.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// Mock https for validation tests
jest.mock('https');

const {
  readApiKeys,
  readApiKeyHints,
  readApiKeyValues,
  saveApiKey,
  removeApiKey,
  validateApiKey,
  getEnvPath,
  PROVIDER_ENV_MAP,
  VALIDATION_ENDPOINTS
} = require('../src/utils/api-key-store');

describe('api-key-store', () => {
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
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('PROVIDER_ENV_MAP', () => {
    it('should map provider IDs to env var names', () => {
      expect(PROVIDER_ENV_MAP.openrouter).toBe('OPENROUTER_API_KEY');
      expect(PROVIDER_ENV_MAP.google).toBe('GEMINI_API_KEY');
      expect(PROVIDER_ENV_MAP.openai).toBe('OPENAI_API_KEY');
      expect(PROVIDER_ENV_MAP.anthropic).toBe('ANTHROPIC_API_KEY');
    });

    it('should have exactly 4 providers', () => {
      expect(Object.keys(PROVIDER_ENV_MAP)).toHaveLength(4);
    });
  });

  describe('getEnvPath', () => {
    it('should return path inside SIDECAR_ENV_DIR when set', () => {
      const result = getEnvPath();
      expect(result).toBe(path.join(tmpDir, '.env'));
    });

    it('should default to ~/.config/sidecar/.env', () => {
      delete process.env.SIDECAR_ENV_DIR;
      const result = getEnvPath();
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      expect(result).toBe(path.join(homeDir, '.config', 'sidecar', '.env'));
    });
  });

  describe('readApiKeys', () => {
    it('should return all false when .env does not exist', () => {
      const result = readApiKeys();
      expect(result).toEqual({
        openrouter: false,
        google: false,
        openai: false,
        anthropic: false
      });
    });

    it('should detect keys from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-test-123\nGEMINI_API_KEY=AIza-test\n'
      );

      const result = readApiKeys();
      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(true);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
    });

    it('should detect keys from process.env', () => {
      process.env.OPENAI_API_KEY = 'sk-test-from-env';

      const result = readApiKeys();
      expect(result.openai).toBe(true);
    });

    it('should combine .env file and process.env', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-test\n'
      );
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

      const result = readApiKeys();
      expect(result.openrouter).toBe(true);
      expect(result.anthropic).toBe(true);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
    });

    it('should handle empty .env file', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), '');
      const result = readApiKeys();
      expect(result).toEqual({
        openrouter: false,
        google: false,
        openai: false,
        anthropic: false
      });
    });

    it('should ignore comments and blank lines in .env', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        '# Sidecar API Keys\n\nOPENROUTER_API_KEY=sk-or-test\n\n# More comments\n'
      );

      const result = readApiKeys();
      expect(result.openrouter).toBe(true);
      expect(result.google).toBe(false);
    });

    it('should ignore keys with empty values', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=\n'
      );

      const result = readApiKeys();
      expect(result.openrouter).toBe(false);
    });
  });

  describe('saveApiKey', () => {
    it('should create .env file with the key', () => {
      saveApiKey('openrouter', 'sk-or-test-456');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('OPENROUTER_API_KEY=sk-or-test-456');
    });

    it('should create directory if it does not exist', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'dir');
      process.env.SIDECAR_ENV_DIR = nestedDir;
      saveApiKey('openrouter', 'sk-or-test-789');
      const envPath = path.join(nestedDir, '.env');
      expect(fs.existsSync(envPath)).toBe(true);
      const content = fs.readFileSync(envPath, 'utf-8');
      expect(content).toContain('OPENROUTER_API_KEY=sk-or-test-789');
    });

    it('should preserve existing keys when adding a new provider', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'GEMINI_API_KEY=goog-key\n'
      );

      saveApiKey('openrouter', 'sk-or-new');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('GEMINI_API_KEY=goog-key');
      expect(content).toContain('OPENROUTER_API_KEY=sk-or-new');
    });

    it('should overwrite existing key for same provider', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=old-key\n'
      );

      saveApiKey('openrouter', 'new-key');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('OPENROUTER_API_KEY=new-key');
      expect(content).not.toContain('old-key');
    });

    it('should set file permissions to 0o600', () => {
      saveApiKey('openrouter', 'sk-or-perms');
      const envPath = path.join(tmpDir, '.env');
      const stats = fs.statSync(envPath);
      // Check owner read+write only (0o600 = 384 decimal, masked to lower 9 bits)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('should set process.env after saving', () => {
      saveApiKey('openrouter', 'sk-or-env-set');
      expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-env-set');
    });

    it('should return success result', () => {
      const result = saveApiKey('openrouter', 'sk-or-result');
      expect(result).toEqual({ success: true });
    });

    it('should preserve comments in .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        '# Sidecar API Keys\nOPENROUTER_API_KEY=old-key\n'
      );

      saveApiKey('openrouter', 'new-key');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('# Sidecar API Keys');
      expect(content).toContain('OPENROUTER_API_KEY=new-key');
    });

    it('should map provider to correct env var name', () => {
      saveApiKey('google', 'AIza-test');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('GEMINI_API_KEY=AIza-test');
    });
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
  });

  describe('readApiKeyHints', () => {
    it('should return false for all providers when no keys exist', () => {
      const result = readApiKeyHints();
      expect(result.openrouter).toBe(false);
      expect(result.google).toBe(false);
      expect(result.openai).toBe(false);
      expect(result.anthropic).toBe(false);
    });

    it('should return masked key hints from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnop\n'
      );

      const result = readApiKeyHints();
      expect(result.openrouter).toBeTruthy();
      // First 8 chars visible
      expect(result.openrouter.startsWith('sk-or-v1')).toBe(true);
      // Contains bullet chars for masking
      expect(result.openrouter).toContain('\u2022');
    });

    it('should return masked key hints from process.env', () => {
      process.env.OPENAI_API_KEY = 'sk-proj-12345678abcdef';

      const result = readApiKeyHints();
      expect(result.openai).toBeTruthy();
      expect(result.openai.startsWith('sk-proj-')).toBe(true);
    });

    it('should handle short keys (< 8 chars) without masking', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'GEMINI_API_KEY=short\n'
      );

      const result = readApiKeyHints();
      expect(result.google).toBe('short');
    });

    it('should mask keys with exactly 8 chars (no bullets)', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'GEMINI_API_KEY=12345678\n'
      );

      const result = readApiKeyHints();
      expect(result.google).toBe('12345678');
    });
  });

  describe('removeApiKey', () => {
    it('should remove a key from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-remove\nGEMINI_API_KEY=goog-keep\n'
      );

      const result = removeApiKey('openrouter');
      expect(result).toEqual({ success: true });

      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).not.toContain('OPENROUTER_API_KEY');
      expect(content).toContain('GEMINI_API_KEY=goog-keep');
    });

    it('should delete from process.env', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-remove';
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-env-remove\n'
      );

      removeApiKey('openrouter');
      expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
    });

    it('should return success when .env file does not exist', () => {
      const result = removeApiKey('openrouter');
      expect(result).toEqual({ success: true });
    });

    it('should return error for unknown provider', () => {
      const result = removeApiKey('unknown');
      expect(result).toEqual({ success: false, error: 'Unknown provider: unknown' });
    });

    it('should handle removing last key (empty file)', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-last\n'
      );

      removeApiKey('openrouter');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toBe('');
    });

    it('should preserve remaining content after removal', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        '# Comment\nOPENROUTER_API_KEY=sk-or-remove\nGEMINI_API_KEY=keep\n'
      );

      removeApiKey('openrouter');
      const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('# Comment');
      expect(content).toContain('GEMINI_API_KEY=keep');
      expect(content).not.toContain('OPENROUTER_API_KEY');
    });
  });

  describe('readApiKeyValues', () => {
    it('should return empty object when no keys exist', () => {
      const result = readApiKeyValues();
      expect(result).toEqual({});
    });

    it('should return actual key strings from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-real-key\nGEMINI_API_KEY=AIza-real-key\n'
      );

      const result = readApiKeyValues();
      expect(result.openrouter).toBe('sk-or-real-key');
      expect(result.google).toBe('AIza-real-key');
      expect(result.openai).toBeUndefined();
      expect(result.anthropic).toBeUndefined();
    });

    it('should return key strings from process.env', () => {
      process.env.OPENAI_API_KEY = 'sk-from-env';

      const result = readApiKeyValues();
      expect(result.openai).toBe('sk-from-env');
    });

    it('should prefer .env file over process.env', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=from-file\n'
      );
      process.env.OPENROUTER_API_KEY = 'from-env';

      const result = readApiKeyValues();
      expect(result.openrouter).toBe('from-file');
    });

    it('should skip empty values', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=\n'
      );

      const result = readApiKeyValues();
      expect(result.openrouter).toBeUndefined();
    });
  });

  describe('saveApiKey error handling', () => {
    it('should return error for unknown provider', () => {
      const result = saveApiKey('unknown-provider', 'some-key');
      expect(result).toEqual({ success: false, error: 'Unknown provider: unknown-provider' });
    });
  });
});
