/**
 * Config Change Detection Flow Tests
 *
 * Tests the end-to-end flow: config file modified → CLI detects hash mismatch
 * from CLAUDE.md → emits [SIDECAR_CONFIG_UPDATE] with update instructions
 * for the LLM to update CLAUDE.md.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

describe('Config change detection flow', () => {
  let tempDir;
  let configDir;
  let projectDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-config-flow-'));
    configDir = path.join(tempDir, 'config');
    projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = configDir;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function loadConfigModule() {
    return require('../../src/utils/config');
  }

  /**
   * Simulates the hash extraction logic from startSidecar (lines 249-256)
   * Reads CLAUDE.md in the project dir and extracts the stored config hash.
   */
  function extractHashFromClaudeMd() {
    const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      return null;
    }
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    const match = content.match(/<!-- sidecar-config-hash: ([0-9a-f]+) -->/);
    return match ? match[1] : null;
  }

  /**
   * Simulates the stderr output logic from startSidecar (lines 257-260)
   * Returns { emitted, output } indicating whether update was emitted.
   */
  function simulateConfigCheck() {
    const { checkConfigChanged } = loadConfigModule();
    const currentHash = extractHashFromClaudeMd();
    const configCheck = checkConfigChanged(currentHash);

    let output = null;
    if (configCheck.changed) {
      output = `\n[SIDECAR_CONFIG_UPDATE] Model configuration has changed.\nAction: Replace the "Model Aliases" section in CLAUDE.md (near the top, after the title) with the content below.\nIf no "Model Aliases" section exists, add it after the title line.\nThe hash comment tracks config changes — do not remove it.\n\n${configCheck.updateData}\n\n`;
    }
    return { emitted: configCheck.changed, output, configCheck };
  }

  /**
   * Writes a CLAUDE.md file with an embedded config hash.
   * Simulates what the LLM would do after receiving update instructions.
   */
  function writeClaudeMdWithHash(hash) {
    const content = `# CLAUDE.md\n<!-- sidecar-config-hash: ${hash} -->\nProject docs here.`;
    fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), content);
  }

  /**
   * Writes a config file and returns its hash.
   */
  function writeConfigAndGetHash(configData) {
    const { saveConfig, computeConfigHash } = loadConfigModule();
    saveConfig(configData);
    // Must reset modules to re-read the file
    jest.resetModules();
    return loadConfigModule().computeConfigHash();
  }

  // ─── Scenario 1: First run, no CLAUDE.md exists ──────────────────

  describe('first run (no CLAUDE.md)', () => {
    it('should detect change when config exists but CLAUDE.md does not', () => {
      writeConfigAndGetHash({
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      });
      jest.resetModules();

      const { emitted, output } = simulateConfigCheck();

      expect(emitted).toBe(true);
      expect(output).toContain('[SIDECAR_CONFIG_UPDATE]');
      expect(output).toContain('gemini');
    });

    it('should not detect change when neither config nor CLAUDE.md exist', () => {
      // No config file, no CLAUDE.md → both hashes are null → no change
      const { emitted } = simulateConfigCheck();
      expect(emitted).toBe(false);
    });
  });

  // ─── Scenario 2: Hash matches (no config modification) ──────────

  describe('config unchanged (hash matches)', () => {
    it('should not detect change when CLAUDE.md hash matches config hash', () => {
      const configData = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      const hash = writeConfigAndGetHash(configData);
      writeClaudeMdWithHash(hash);
      jest.resetModules();

      const { emitted } = simulateConfigCheck();
      expect(emitted).toBe(false);
    });

    it('should not emit [SIDECAR_CONFIG_UPDATE] to stderr', () => {
      const configData = {
        default: 'gpt',
        aliases: {
          gpt: 'openrouter/openai/gpt-5.2-chat',
          gemini: 'openrouter/google/gemini-3-flash-preview'
        }
      };
      const hash = writeConfigAndGetHash(configData);
      writeClaudeMdWithHash(hash);
      jest.resetModules();

      const { emitted, output } = simulateConfigCheck();

      expect(emitted).toBe(false);
      expect(output).toBeNull();
    });
  });

  // ─── Scenario 3: Alias added → config modified ──────────────────

  describe('alias added (config modified)', () => {
    it('should detect change when a new alias is added to config', () => {
      // Step 1: Initial config + matching hash in CLAUDE.md
      const initialConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      const initialHash = writeConfigAndGetHash(initialConfig);
      writeClaudeMdWithHash(initialHash);

      // Step 2: Add a new alias (simulates `sidecar setup --add-alias`)
      jest.resetModules();
      const config = loadConfigModule();
      const cfg = config.loadConfig();
      cfg.aliases.gpt = 'openrouter/openai/gpt-5.2-chat';
      config.saveConfig(cfg);

      // Step 3: CLI detects change on next start
      jest.resetModules();
      const { emitted, output } = simulateConfigCheck();

      expect(emitted).toBe(true);
      expect(output).toContain('[SIDECAR_CONFIG_UPDATE]');
      expect(output).toContain('gpt');
      expect(output).toContain('gemini');
    });

    it('should include the new hash in update data', () => {
      const initialConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      const initialHash = writeConfigAndGetHash(initialConfig);
      writeClaudeMdWithHash(initialHash);

      // Modify config
      jest.resetModules();
      const config = loadConfigModule();
      const cfg = config.loadConfig();
      cfg.aliases.opus = 'openrouter/anthropic/claude-opus-4.6';
      config.saveConfig(cfg);

      jest.resetModules();
      const newHash = loadConfigModule().computeConfigHash();
      const { configCheck } = simulateConfigCheck();

      expect(configCheck.newHash).toBe(newHash);
      expect(configCheck.updateData).toContain(`<!-- sidecar-config-hash: ${newHash} -->`);
    });
  });

  // ─── Scenario 4: Default model changed ──────────────────────────

  describe('default model changed', () => {
    it('should detect change when default model is switched', () => {
      const initialConfig = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat'
        }
      };
      const initialHash = writeConfigAndGetHash(initialConfig);
      writeClaudeMdWithHash(initialHash);

      // Change default from gemini to gpt
      jest.resetModules();
      const config = loadConfigModule();
      const cfg = config.loadConfig();
      cfg.default = 'gpt';
      config.saveConfig(cfg);

      jest.resetModules();
      const { emitted, output } = simulateConfigCheck();

      expect(emitted).toBe(true);
      expect(output).toContain('[SIDECAR_CONFIG_UPDATE]');
    });

    it('should mark the new default in the alias table', () => {
      const initialConfig = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat'
        }
      };
      const initialHash = writeConfigAndGetHash(initialConfig);
      writeClaudeMdWithHash(initialHash);

      // Switch default to gpt
      jest.resetModules();
      const config = loadConfigModule();
      const cfg = config.loadConfig();
      cfg.default = 'gpt';
      config.saveConfig(cfg);

      jest.resetModules();
      const { configCheck } = simulateConfigCheck();

      // The alias table should mark gpt as (default), not gemini
      expect(configCheck.updateData).toContain('gpt (default)');
      expect(configCheck.updateData).not.toMatch(/gemini \(default\)/);
    });
  });

  // ─── Scenario 5: Config file deleted ─────────────────────────────

  describe('config file deleted', () => {
    it('should detect change when config file is removed', () => {
      const initialConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      const initialHash = writeConfigAndGetHash(initialConfig);
      writeClaudeMdWithHash(initialHash);

      // Delete config file
      const configPath = path.join(configDir, 'config.json');
      fs.unlinkSync(configPath);

      jest.resetModules();
      const { emitted, configCheck } = simulateConfigCheck();

      expect(emitted).toBe(true);
      expect(configCheck.newHash).toBeNull();
    });
  });

  // ─── Scenario 6: Full round-trip (simulate LLM updating CLAUDE.md) ─

  describe('full round-trip with LLM update', () => {
    it('should not detect change after LLM updates CLAUDE.md with new hash', () => {
      // Step 1: Initial config
      const initialConfig = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      const initialHash = writeConfigAndGetHash(initialConfig);
      writeClaudeMdWithHash(initialHash);

      // Step 2: User adds alias via setup
      jest.resetModules();
      const config = loadConfigModule();
      const cfg = config.loadConfig();
      cfg.aliases.gpt = 'openrouter/openai/gpt-5.2-chat';
      config.saveConfig(cfg);

      // Step 3: CLI detects change
      jest.resetModules();
      const { emitted, configCheck } = simulateConfigCheck();
      expect(emitted).toBe(true);

      // Step 4: LLM updates CLAUDE.md with new hash (simulates LLM action)
      writeClaudeMdWithHash(configCheck.newHash);

      // Step 5: Next CLI run should NOT detect change
      jest.resetModules();
      const { emitted: emittedAgain } = simulateConfigCheck();
      expect(emittedAgain).toBe(false);
    });

    it('should handle multiple sequential config modifications', () => {
      // Step 1: Initial setup
      const config1 = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      const hash1 = writeConfigAndGetHash(config1);
      writeClaudeMdWithHash(hash1);

      // Step 2: First modification
      jest.resetModules();
      let config = loadConfigModule();
      let cfg = config.loadConfig();
      cfg.aliases.gpt = 'openrouter/openai/gpt-5.2-chat';
      config.saveConfig(cfg);

      jest.resetModules();
      let result = simulateConfigCheck();
      expect(result.emitted).toBe(true);

      // LLM updates CLAUDE.md
      writeClaudeMdWithHash(result.configCheck.newHash);

      // Step 3: Second modification
      jest.resetModules();
      config = loadConfigModule();
      cfg = config.loadConfig();
      cfg.aliases.opus = 'openrouter/anthropic/claude-opus-4.6';
      config.saveConfig(cfg);

      jest.resetModules();
      result = simulateConfigCheck();
      expect(result.emitted).toBe(true);
      expect(result.output).toContain('opus');

      // LLM updates again
      writeClaudeMdWithHash(result.configCheck.newHash);

      // Step 4: No more changes → stable
      jest.resetModules();
      result = simulateConfigCheck();
      expect(result.emitted).toBe(false);
    });
  });

  // ─── Scenario 7: Update data format validation ──────────────────

  describe('update data format', () => {
    it('should contain a sidecar-config-hash HTML comment', () => {
      const configData = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      writeConfigAndGetHash(configData);
      jest.resetModules();

      const { configCheck } = simulateConfigCheck();

      expect(configCheck.updateData).toMatch(/<!-- sidecar-config-hash: [0-9a-f]{8} -->/);
    });

    it('should contain a markdown alias table with header row', () => {
      const configData = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat'
        }
      };
      writeConfigAndGetHash(configData);
      jest.resetModules();

      const { configCheck } = simulateConfigCheck();

      expect(configCheck.updateData).toContain('| Alias | Model |');
      expect(configCheck.updateData).toContain('|-------|-------|');
    });

    it('should include all aliases in the update table', () => {
      const configData = {
        default: 'gemini',
        aliases: {
          gemini: 'openrouter/google/gemini-3-flash-preview',
          gpt: 'openrouter/openai/gpt-5.2-chat',
          opus: 'openrouter/anthropic/claude-opus-4.6'
        }
      };
      writeConfigAndGetHash(configData);
      jest.resetModules();

      const { configCheck } = simulateConfigCheck();

      expect(configCheck.updateData).toContain('gemini');
      expect(configCheck.updateData).toContain('gpt');
      expect(configCheck.updateData).toContain('opus');
    });

    it('should have empty updateData when config is deleted (no aliases)', () => {
      // Start with config + hash in CLAUDE.md
      const configData = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      const hash = writeConfigAndGetHash(configData);
      writeClaudeMdWithHash(hash);

      // Delete config
      fs.unlinkSync(path.join(configDir, 'config.json'));
      jest.resetModules();

      const { configCheck } = simulateConfigCheck();

      expect(configCheck.changed).toBe(true);
      expect(configCheck.newHash).toBeNull();
      // updateData should be undefined (no hash comment, no alias table)
      expect(configCheck.updateData).toBeUndefined();
    });
  });

  // ─── Scenario 8: CLAUDE.md hash comment format edge cases ───────

  describe('CLAUDE.md hash extraction edge cases', () => {
    it('should extract hash from CLAUDE.md with other HTML comments', () => {
      const content = [
        '# CLAUDE.md',
        '<!-- Last updated: 2026-03-03 -->',
        '<!-- sidecar-config-hash: abcd1234 -->',
        'More content'
      ].join('\n');
      fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), content);

      const hash = extractHashFromClaudeMd();
      expect(hash).toBe('abcd1234');
    });

    it('should return null when CLAUDE.md has no hash comment', () => {
      fs.writeFileSync(
        path.join(projectDir, 'CLAUDE.md'),
        '# CLAUDE.md\nNo hash here.'
      );

      const hash = extractHashFromClaudeMd();
      expect(hash).toBeNull();
    });

    it('should return null when CLAUDE.md does not exist', () => {
      const hash = extractHashFromClaudeMd();
      expect(hash).toBeNull();
    });

    it('should not match malformed hash comments', () => {
      const content = '<!-- sidecar-config-hash: ZZZZZZZZ -->';
      fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), content);

      const hash = extractHashFromClaudeMd();
      // Regex [0-9a-f]+ won't match uppercase Z
      expect(hash).toBeNull();
    });
  });

  // ─── Scenario 9: stderr output format ────────────────────────────

  describe('stderr output format', () => {
    it('should format [SIDECAR_CONFIG_UPDATE] message correctly', () => {
      const configData = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      writeConfigAndGetHash(configData);
      jest.resetModules();

      const { output } = simulateConfigCheck();

      expect(output).toMatch(/^\n\[SIDECAR_CONFIG_UPDATE\]/);
      expect(output).toContain('Model configuration has changed.');
      expect(output).toContain('Action: Replace the "Model Aliases" section in CLAUDE.md');
    });

    it('should write to stderr (not stdout) when using process.stderr.write', () => {
      const configData = {
        default: 'gemini',
        aliases: { gemini: 'openrouter/google/gemini-3-flash-preview' }
      };
      writeConfigAndGetHash(configData);
      jest.resetModules();

      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const { emitted, output } = simulateConfigCheck();
      if (emitted) {
        process.stderr.write(output);
      }

      expect(stderrSpy).toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    });
  });
});
