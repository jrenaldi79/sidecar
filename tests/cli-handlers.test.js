/**
 * CLI Handlers Module Tests
 *
 * Tests for handleAutoSkills and argument validation.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('CLI Handlers Module', () => {
  let tempDir;
  let originalEnv;
  let originalExit;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-handlers-test-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tempDir;
    originalExit = process.exit;
    process.exit = jest.fn();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeConfig(data) {
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify(data, null, 2)
    );
  }

  describe('handleAutoSkills', () => {
    test('shows status when no flags provided', () => {
      writeConfig({});
      const { handleAutoSkills } = require('../src/cli-handlers');
      handleAutoSkills({ _: ['auto-skills'] });
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Auto-skills:'));
    });

    test('enables master switch with --on', () => {
      writeConfig({ autoSkills: { enabled: false } });
      const { handleAutoSkills } = require('../src/cli-handlers');
      handleAutoSkills({ _: ['auto-skills'], on: true });
      expect(consoleLogSpy).toHaveBeenCalledWith('Auto-skills enabled.');
      const config = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8'));
      expect(config.autoSkills.enabled).toBe(true);
    });

    test('disables master switch with --off', () => {
      writeConfig({});
      const { handleAutoSkills } = require('../src/cli-handlers');
      handleAutoSkills({ _: ['auto-skills'], off: true });
      expect(consoleLogSpy).toHaveBeenCalledWith('Auto-skills disabled.');
    });

    test('enables specific skill with --on and skill name', () => {
      writeConfig({ autoSkills: { security: { enabled: false } } });
      const { handleAutoSkills } = require('../src/cli-handlers');
      handleAutoSkills({ _: ['auto-skills', 'security'], on: true });
      expect(consoleLogSpy).toHaveBeenCalledWith('auto-security: enabled.');
    });

    test('rejects --on and --off together', () => {
      const { handleAutoSkills } = require('../src/cli-handlers');
      handleAutoSkills({ _: ['auto-skills'], on: true, off: true });
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: --on and --off cannot be used together');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('rejects positional args without --on/--off', () => {
      const { handleAutoSkills } = require('../src/cli-handlers');
      handleAutoSkills({ _: ['auto-skills', 'review'] });
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: specify --on or --off with skill names');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('rejects unknown skill names', () => {
      const { handleAutoSkills } = require('../src/cli-handlers');
      handleAutoSkills({ _: ['auto-skills', 'nonexistent'], on: true });
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown skill(s)'));
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
