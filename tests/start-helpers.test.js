/**
 * Start Helpers Module Tests
 *
 * Tests for resolveModelFromArgs and validateFallbackModel.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Start Helpers Module', () => {
  let tempDir;
  let originalEnv;
  let originalExit;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-start-helpers-test-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_CONFIG_DIR = tempDir;
    originalExit = process.exit;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exit = originalExit;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeConfig(data) {
    fs.writeFileSync(
      path.join(tempDir, 'config.json'),
      JSON.stringify(data, null, 2)
    );
  }

  describe('resolveModelFromArgs', () => {
    test('resolves a known alias to a model string', () => {
      writeConfig({ aliases: { gemini: 'google/gemini-2.0-flash' } });
      const { resolveModelFromArgs } = require('../src/utils/start-helpers');
      const result = resolveModelFromArgs({ model: 'gemini' });
      expect(result.model).toBe('google/gemini-2.0-flash');
      expect(result.alias).toBe('gemini');
    });

    test('passes through a full model ID', () => {
      writeConfig({});
      const { resolveModelFromArgs } = require('../src/utils/start-helpers');
      const result = resolveModelFromArgs({ model: 'openai/gpt-4o' });
      expect(result.model).toBe('openai/gpt-4o');
    });

    test('uses config default when no model specified', () => {
      writeConfig({ default: 'gemini', aliases: { gemini: 'google/gemini-2.0-flash' } });
      const { resolveModelFromArgs } = require('../src/utils/start-helpers');
      const result = resolveModelFromArgs({ model: undefined });
      expect(result.alias).toBe('gemini');
    });

    test('calls process.exit(1) on resolution error', () => {
      writeConfig({ aliases: {} });
      process.exit = jest.fn();
      const { resolveModelFromArgs } = require('../src/utils/start-helpers');
      resolveModelFromArgs({ model: '!!!invalid' });
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('validateFallbackModel', () => {
    test('returns model unchanged when --validate-model is not set', async () => {
      const { validateFallbackModel } = require('../src/utils/start-helpers');
      const result = await validateFallbackModel(
        { model: 'openai/gpt-4o', 'validate-model': false },
        'gpt4'
      );
      expect(result).toBe('openai/gpt-4o');
    });

    test('returns model unchanged when no alias provided', async () => {
      const { validateFallbackModel } = require('../src/utils/start-helpers');
      const result = await validateFallbackModel(
        { model: 'openai/gpt-4o', 'validate-model': true },
        undefined
      );
      expect(result).toBe('openai/gpt-4o');
    });
  });
});
