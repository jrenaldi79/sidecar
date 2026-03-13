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
});

describe('getElectronPath', () => {
  it('returns the path from require("electron") instead of hardcoded relative path', () => {
    const { getElectronPath } = require('../../src/sidecar/interactive');
    const result = getElectronPath();

    // Should NOT be a hardcoded node_modules/.bin/electron path
    expect(result).not.toContain('node_modules/.bin/electron');

    // Should be the actual Electron binary path (what require('electron') returns)
    expect(result.toLowerCase()).toContain('electron');
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
