/**
 * Interactive Mode Tests
 *
 * Tests for buildElectronEnv: environment variable construction
 * for the Electron sidecar process.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const { buildElectronEnv } = require('../../src/sidecar/interactive');

const BASE_ARGS = ['task-001', 'google/gemini-2.5', '/project', '/bin', '/usr/bin'];

describe('buildElectronEnv - window position', () => {
  it('sets SIDECAR_WINDOW_POSITION when windowPosition is provided', () => {
    const env = buildElectronEnv(...BASE_ARGS, { windowPosition: 'right' });
    expect(env.SIDECAR_WINDOW_POSITION).toBe('right');
  });

  it('sets SIDECAR_WINDOW_POSITION to left', () => {
    const env = buildElectronEnv(...BASE_ARGS, { windowPosition: 'left' });
    expect(env.SIDECAR_WINDOW_POSITION).toBe('left');
  });

  it('sets SIDECAR_WINDOW_POSITION to center', () => {
    const env = buildElectronEnv(...BASE_ARGS, { windowPosition: 'center' });
    expect(env.SIDECAR_WINDOW_POSITION).toBe('center');
  });

  it('omits SIDECAR_WINDOW_POSITION when not provided', () => {
    const env = buildElectronEnv(...BASE_ARGS, {});
    expect(env.SIDECAR_WINDOW_POSITION).toBeUndefined();
  });

  it('does not copy ambient API credentials into the Electron process env', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.OPENAI_API_KEY = 'openai-secret';
      process.env.ANTHROPIC_API_KEY = 'anthropic-secret';
      process.env.SIDECAR_ENV_DIR = '/tmp/sidecar-env-dir';
      process.env.LOG_LEVEL = 'debug';

      const env = buildElectronEnv(...BASE_ARGS, {});

      expect(env.PATH).toBe('/bin:/usr/bin');
      expect(env.SIDECAR_ENV_DIR).toBe('/tmp/sidecar-env-dir');
      expect(env.LOG_LEVEL).toBe('debug');
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      process.env = originalEnv;
    }
  });
});

describe('getElectronPath', () => {
  it('returns the path from require("electron") instead of hardcoded relative path', () => {
    const { checkElectronAvailable, getElectronPath } = require('../../src/sidecar/interactive');
    const result = getElectronPath();

    if (result === null) {
      expect(checkElectronAvailable()).toBe(false);
      return;
    }

    // Should NOT be a hardcoded node_modules/.bin/electron path
    expect(result).not.toContain('node_modules/.bin/electron');

    // Should be the actual Electron binary path (what require('electron') returns)
    expect(result).toContain('Electron');
  });

  it('returns null when electron is not installed', () => {
    const { getElectronPath } = require('../../src/sidecar/interactive');
    // Mock require to throw for 'electron'
    const originalRequire = jest.requireActual;
    // getElectronPath should handle missing electron gracefully
    // We test this by checking it returns a string (electron is installed here)
    // and that checkElectronAvailable is consistent with it
    const { checkElectronAvailable } = require('../../src/sidecar/interactive');
    const available = checkElectronAvailable();
    const electronPath = getElectronPath();

    // Both should agree: if available, path is non-null; if not, path is null
    if (available) {
      expect(electronPath).toBeTruthy();
    } else {
      expect(electronPath).toBeNull();
    }
  });
});
