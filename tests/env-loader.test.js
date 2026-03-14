/**
 * Tests for src/utils/env-loader.js
 *
 * Verifies credential loading from multiple sources into process.env
 * with deterministic priority: process.env > sidecar .env > auth.json
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// Must require AFTER setting env vars in beforeEach
let loadCredentials;

describe('env-loader', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-envloader-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_ENV_DIR = tmpDir;
    // Clear all provider keys
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;
    // Fresh require each test to avoid module caching
    jest.resetModules();
    loadCredentials = require('../src/utils/env-loader').loadCredentials;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should load keys from sidecar .env into process.env', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'OPENROUTER_API_KEY=sk-or-from-file\n',
      { mode: 0o600 }
    );

    loadCredentials();

    expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-from-file');
  });

  it('should NOT overwrite existing process.env values', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-from-env';
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'OPENROUTER_API_KEY=sk-or-from-file\n',
      { mode: 0o600 }
    );

    loadCredentials();

    expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-from-env');
  });

  it('should load keys from auth.json when not in .env', () => {
    jest.resetModules();
    jest.doMock('../src/utils/auth-json', () => ({
      readAuthJsonKeys: () => ({ openrouter: 'sk-or-from-auth' }),
      AUTH_JSON_PATH: '/tmp/fake/auth.json',
      KNOWN_PROVIDERS: ['openrouter', 'google', 'openai', 'anthropic', 'deepseek']
    }));
    loadCredentials = require('../src/utils/env-loader').loadCredentials;

    loadCredentials();

    expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-from-auth');
  });

  it('should prefer .env over auth.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'OPENROUTER_API_KEY=sk-or-from-file\n',
      { mode: 0o600 }
    );

    jest.resetModules();
    jest.doMock('../src/utils/auth-json', () => ({
      readAuthJsonKeys: () => ({ openrouter: 'sk-or-from-auth' }),
      AUTH_JSON_PATH: '/tmp/fake/auth.json',
      KNOWN_PROVIDERS: ['openrouter', 'google', 'openai', 'anthropic', 'deepseek']
    }));
    loadCredentials = require('../src/utils/env-loader').loadCredentials;

    loadCredentials();

    expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-from-file');
  });

  it('should merge keys from different sources per-provider', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'OPENROUTER_API_KEY=sk-or-from-file\n',
      { mode: 0o600 }
    );

    jest.resetModules();
    jest.doMock('../src/utils/auth-json', () => ({
      readAuthJsonKeys: () => ({ google: 'goog-from-auth' }),
      AUTH_JSON_PATH: '/tmp/fake/auth.json',
      KNOWN_PROVIDERS: ['openrouter', 'google', 'openai', 'anthropic', 'deepseek']
    }));
    loadCredentials = require('../src/utils/env-loader').loadCredentials;

    loadCredentials();

    expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-from-file');
    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe('goog-from-auth');
  });

  it('should handle missing .env file gracefully', () => {
    expect(() => loadCredentials()).not.toThrow();
  });

  it('should handle missing auth.json gracefully', () => {
    jest.resetModules();
    jest.doMock('../src/utils/auth-json', () => ({
      readAuthJsonKeys: () => ({}),
      AUTH_JSON_PATH: '/nonexistent/auth.json',
      KNOWN_PROVIDERS: ['openrouter', 'google', 'openai', 'anthropic', 'deepseek']
    }));
    loadCredentials = require('../src/utils/env-loader').loadCredentials;

    expect(() => loadCredentials()).not.toThrow();
  });

  it('should migrate legacy GEMINI_API_KEY from process.env', () => {
    process.env.GEMINI_API_KEY = 'legacy-key';

    loadCredentials();

    expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe('legacy-key');
  });

  it('should be idempotent (safe to call multiple times)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'OPENROUTER_API_KEY=sk-or-from-file\n',
      { mode: 0o600 }
    );

    loadCredentials();
    loadCredentials();

    expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-from-file');
  });

  describe('integration with validateApiKey', () => {
    it('should pass validation when key comes from .env file', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env'),
        'OPENROUTER_API_KEY=sk-or-from-file\n',
        { mode: 0o600 }
      );

      loadCredentials();

      const { validateApiKey } = require('../src/utils/validators');
      const result = validateApiKey('openrouter/google/gemini-2.5-flash');
      expect(result.valid).toBe(true);
    });

    it('should fail with actionable error when key is truly missing', () => {
      loadCredentials();

      const { validateApiKey } = require('../src/utils/validators');
      const result = validateApiKey('openrouter/google/gemini-2.5-flash');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('OPENROUTER_API_KEY not found');
      expect(result.error).toContain('sidecar setup');
      expect(result.error).toContain('~/.zshenv');
    });
  });
});
