/**
 * Sidecar Config Module Tests - Hashing & Alias Table
 *
 * Tests for computeConfigHash, buildAliasTable, and checkConfigChanged.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

describe('Sidecar Config Module - Hashing & Alias Table', () => {
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

  describe('computeConfigHash', () => {
    it('should return null when no config file exists', () => {
      const config = loadModule();
      expect(config.computeConfigHash()).toBeNull();
    });

    it('should return first 8 hex chars of SHA-256 hash', () => {
      const content = JSON.stringify({ default: 'gemini', aliases: { gemini: 'test' } }, null, 2);
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);
      const config = loadModule();

      const result = config.computeConfigHash();

      // Verify it's 8 hex characters
      expect(result).toMatch(/^[0-9a-f]{8}$/);

      // Verify it matches SHA-256
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
      expect(result).toBe(expectedHash);
    });

    it('should return different hashes for different configs', () => {
      const config = loadModule();

      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({ a: 1 }));
      jest.resetModules();
      const hash1 = loadModule().computeConfigHash();

      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify({ b: 2 }));
      jest.resetModules();
      const hash2 = loadModule().computeConfigHash();

      expect(hash1).not.toBe(hash2);
    });

    it('should return same hash for same content', () => {
      const content = JSON.stringify({ test: true });
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);

      const config1 = loadModule();
      const hash1 = config1.computeConfigHash();
      jest.resetModules();
      const hash2 = loadModule().computeConfigHash();

      expect(hash1).toBe(hash2);
    });
  });

  describe('buildAliasTable', () => {
    it('should return a markdown table', () => {
      const data = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat'
        }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();

      const table = config.buildAliasTable();

      // Should have markdown table structure
      expect(table).toContain('|');
      expect(table).toContain('Alias');
      expect(table).toContain('Model');
    });

    it('should mark the default alias with (default)', () => {
      const data = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat'
        }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();

      const table = config.buildAliasTable();

      // The default alias should be marked
      expect(table).toContain('(default)');
      // gemini line should have (default)
      const lines = table.split('\n');
      const geminiLine = lines.find(l => l.includes('gemini') && l.includes('gemini-3-flash'));
      expect(geminiLine).toContain('(default)');
    });

    it('should include all aliases from config', () => {
      const data = {
        default: 'gpt',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat',
          claude: 'openrouter/anthropic/claude-sonnet-4.6'
        }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();

      const table = config.buildAliasTable();

      expect(table).toContain('gemini');
      expect(table).toContain('gpt');
      expect(table).toContain('claude');
    });

    it('should return empty string when no config exists', () => {
      const config = loadModule();
      const table = config.buildAliasTable();
      expect(table).toBe('');
    });

    it('should return empty string when config has no aliases', () => {
      const data = { default: 'gemini' };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data));
      const config = loadModule();
      const table = config.buildAliasTable();
      expect(table).toBe('');
    });
  });

  describe('checkConfigChanged', () => {
    it('should return changed: false when hash matches', () => {
      const content = JSON.stringify({ default: 'gemini', aliases: { gemini: 'test' } }, null, 2);
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);
      const config = loadModule();

      const currentHash = config.computeConfigHash();
      const result = config.checkConfigChanged(currentHash);

      expect(result.changed).toBe(false);
    });

    it('should return changed: true when hash differs', () => {
      const content = JSON.stringify({ default: 'gemini', aliases: { gemini: 'test' } }, null, 2);
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);
      const config = loadModule();

      const result = config.checkConfigChanged('00000000');

      expect(result.changed).toBe(true);
      expect(result).toHaveProperty('newHash');
      expect(result).toHaveProperty('updateData');
    });

    it('should return changed: true when no config exists and hash is provided', () => {
      const config = loadModule();
      const result = config.checkConfigChanged('abcdef12');

      // Config was removed so hash is null now, different from provided
      expect(result.changed).toBe(true);
      expect(result.newHash).toBeNull();
    });

    it('should return changed: false when no config exists and hash is null', () => {
      const config = loadModule();
      const result = config.checkConfigChanged(null);

      expect(result.changed).toBe(false);
    });

    it('should include newHash in result when changed', () => {
      const content = JSON.stringify({ default: 'gemini', aliases: { gemini: 'test' } }, null, 2);
      fs.writeFileSync(path.join(tempDir, 'config.json'), content);
      const config = loadModule();

      const result = config.checkConfigChanged('oldoldhash');

      expect(result.newHash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should include updateData with hash comment and alias table when changed', () => {
      const data = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      fs.writeFileSync(path.join(tempDir, 'config.json'), JSON.stringify(data, null, 2));
      const config = loadModule();

      const result = config.checkConfigChanged('oldoldhash');

      expect(result.changed).toBe(true);
      expect(result.updateData).toBeDefined();
      // updateData should contain the alias table
      expect(result.updateData).toContain('gemini');
      // updateData should contain the hash comment
      expect(result.updateData).toContain(result.newHash);
    });
  });
});
