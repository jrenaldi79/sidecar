/**
 * Auto-Skills Config Module Tests
 *
 * Tests for auto-skill enable/disable, status reporting, and name resolution.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Auto-Skills Config Module', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-autoskills-test-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function loadModule() {
    return require('../src/utils/auto-skills-config');
  }

  function writeConfig(data) {
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify(data, null, 2)
    );
  }

  describe('getAutoSkillsConfig', () => {
    test('returns all enabled by default when no config exists', () => {
      const { getAutoSkillsConfig } = loadModule();
      const config = getAutoSkillsConfig();
      expect(config.enabled).toBe(true);
      expect(config.review.enabled).toBe(true);
      expect(config.unblock.enabled).toBe(true);
      expect(config.security.enabled).toBe(true);
      expect(config.bmadMethodCheck.enabled).toBe(true);
    });

    test('respects master disable', () => {
      writeConfig({ autoSkills: { enabled: false } });
      const { getAutoSkillsConfig } = loadModule();
      const config = getAutoSkillsConfig();
      expect(config.enabled).toBe(false);
    });

    test('respects per-skill disable', () => {
      writeConfig({ autoSkills: { security: { enabled: false } } });
      const { getAutoSkillsConfig } = loadModule();
      const config = getAutoSkillsConfig();
      expect(config.enabled).toBe(true);
      expect(config.security.enabled).toBe(false);
      expect(config.review.enabled).toBe(true);
    });
  });

  describe('isSkillEnabled', () => {
    test('returns true when no config', () => {
      const { isSkillEnabled } = loadModule();
      expect(isSkillEnabled('review')).toBe(true);
    });

    test('returns false when master is off', () => {
      writeConfig({ autoSkills: { enabled: false } });
      const { isSkillEnabled } = loadModule();
      expect(isSkillEnabled('review')).toBe(false);
    });

    test('returns false when per-skill is off', () => {
      writeConfig({ autoSkills: { review: { enabled: false } } });
      const { isSkillEnabled } = loadModule();
      expect(isSkillEnabled('review')).toBe(false);
      expect(isSkillEnabled('security')).toBe(true);
    });

    test('returns false when both master and per-skill are off', () => {
      writeConfig({ autoSkills: { enabled: false, review: { enabled: false } } });
      const { isSkillEnabled } = loadModule();
      expect(isSkillEnabled('review')).toBe(false);
    });
  });

  describe('isMonitoringEnabled', () => {
    test('returns true when no config', () => {
      const { isMonitoringEnabled } = loadModule();
      expect(isMonitoringEnabled()).toBe(true);
    });

    test('returns false when monitoring disabled', () => {
      writeConfig({ monitoring: { enabled: false } });
      const { isMonitoringEnabled } = loadModule();
      expect(isMonitoringEnabled()).toBe(false);
    });
  });

  describe('setAutoSkillsEnabled', () => {
    test('sets master switch off', () => {
      const { setAutoSkillsEnabled, getAutoSkillsConfig } = loadModule();
      setAutoSkillsEnabled(false);
      const config = getAutoSkillsConfig();
      expect(config.enabled).toBe(false);
    });

    test('sets master switch on', () => {
      writeConfig({ autoSkills: { enabled: false } });
      const { setAutoSkillsEnabled, getAutoSkillsConfig } = loadModule();
      setAutoSkillsEnabled(true);
      const config = getAutoSkillsConfig();
      expect(config.enabled).toBe(true);
    });

    test('disables specific skills', () => {
      const { setAutoSkillsEnabled, isSkillEnabled } = loadModule();
      setAutoSkillsEnabled(false, ['review', 'security']);
      expect(isSkillEnabled('review')).toBe(false);
      expect(isSkillEnabled('security')).toBe(false);
      expect(isSkillEnabled('unblock')).toBe(true);
    });

    test('enables specific skills', () => {
      writeConfig({ autoSkills: { review: { enabled: false } } });
      const { setAutoSkillsEnabled, isSkillEnabled } = loadModule();
      setAutoSkillsEnabled(true, ['review']);
      expect(isSkillEnabled('review')).toBe(true);
    });

    test('creates config file if missing', () => {
      const { setAutoSkillsEnabled } = loadModule();
      const result = setAutoSkillsEnabled(false, ['unblock']);
      expect(result).toBe(true);
      const raw = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8'));
      expect(raw.autoSkills.unblock.enabled).toBe(false);
    });

    test('returns false when saveConfig fails', () => {
      // Make config dir read-only so writeFileSync fails
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, '{}');
      fs.chmodSync(configPath, 0o444);
      fs.chmodSync(tempDir, 0o555);
      const { setAutoSkillsEnabled } = loadModule();
      const result = setAutoSkillsEnabled(true);
      expect(result).toBe(false);
      // Restore permissions for cleanup
      fs.chmodSync(tempDir, 0o755);
      fs.chmodSync(configPath, 0o644);
    });
  });

  describe('getAutoSkillsStatus', () => {
    test('shows all enabled by default', () => {
      const { getAutoSkillsStatus } = loadModule();
      const status = getAutoSkillsStatus();
      expect(status).toContain('Auto-skills: enabled');
      expect(status).toContain('auto-review: enabled');
      expect(status).toContain('auto-security: enabled');
    });

    test('shows master off with per-skill detail', () => {
      writeConfig({ autoSkills: { enabled: false } });
      const { getAutoSkillsStatus } = loadModule();
      const status = getAutoSkillsStatus();
      expect(status).toContain('Auto-skills: disabled');
      expect(status).toContain('disabled (master off)');
    });

    test('shows per-skill disabled', () => {
      writeConfig({ autoSkills: { security: { enabled: false } } });
      const { getAutoSkillsStatus } = loadModule();
      const status = getAutoSkillsStatus();
      expect(status).toContain('auto-security: disabled (per-skill)');
    });
  });

  describe('resolveSkillNames', () => {
    test('resolves canonical names', () => {
      const { resolveSkillNames } = loadModule();
      const result = resolveSkillNames(['review', 'security']);
      expect(result.valid).toEqual(['review', 'security']);
      expect(result.invalid).toEqual([]);
    });

    test('resolves display names (auto- prefix)', () => {
      const { resolveSkillNames } = loadModule();
      const result = resolveSkillNames(['auto-review', 'auto-unblock']);
      expect(result.valid).toEqual(['review', 'unblock']);
    });

    test('resolves bmad shorthand', () => {
      const { resolveSkillNames } = loadModule();
      const result = resolveSkillNames(['bmad']);
      expect(result.valid).toEqual(['bmadMethodCheck']);
    });

    test('resolves camelCase config key (bmadMethodCheck)', () => {
      const { resolveSkillNames } = loadModule();
      const result = resolveSkillNames(['bmadMethodCheck']);
      expect(result.valid).toEqual(['bmadMethodCheck']);
    });

    test('resolves case-insensitively', () => {
      const { resolveSkillNames } = loadModule();
      const result = resolveSkillNames(['REVIEW', 'Auto-Security']);
      expect(result.valid).toEqual(['review', 'security']);
    });

    test('reports invalid names', () => {
      const { resolveSkillNames } = loadModule();
      const result = resolveSkillNames(['review', 'nonexistent']);
      expect(result.valid).toEqual(['review']);
      expect(result.invalid).toEqual(['nonexistent']);
    });
  });
});
