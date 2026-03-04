/**
 * Tests for src/sidecar/setup-window.js
 *
 * Tests the launchSetupWindow function that spawns Electron in setup mode.
 * Verifies enriched JSON result parsing (status, default model, keyCount).
 */

const { spawn } = require('child_process');
const path = require('path');

jest.mock('child_process');

const { launchSetupWindow } = require('../../src/sidecar/setup-window');

describe('setup-window', () => {
  let mockProcess;

  beforeEach(() => {
    mockProcess = {
      stdout: {
        on: jest.fn(),
        setEncoding: jest.fn()
      },
      stderr: {
        on: jest.fn(),
        setEncoding: jest.fn()
      },
      on: jest.fn()
    };
    spawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should spawn Electron with SIDECAR_MODE=setup', async () => {
    const promise = launchSetupWindow();

    const dataCallback = mockProcess.stdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataCallback('{"status":"complete","default":"gemini","keyCount":2}\n');

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    const result = await promise;

    expect(spawn).toHaveBeenCalled();
    const spawnArgs = spawn.mock.calls[0];
    expect(spawnArgs[1][0]).toContain('main.js');

    const env = spawnArgs[2].env;
    expect(env.SIDECAR_MODE).toBe('setup');

    expect(result.success).toBe(true);
  });

  it('should parse enriched JSON with default model and keyCount', async () => {
    const promise = launchSetupWindow();

    const dataCallback = mockProcess.stdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataCallback('{"status":"complete","default":"gemini-pro","keyCount":3}\n');

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.default).toBe('gemini-pro');
    expect(result.keyCount).toBe(3);
  });

  it('should handle legacy JSON without default/keyCount', async () => {
    const promise = launchSetupWindow();

    const dataCallback = mockProcess.stdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataCallback('{"status":"complete"}\n');

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.default).toBeUndefined();
    expect(result.keyCount).toBeUndefined();
  });

  it('should resolve with failure when Electron exits non-zero', async () => {
    const promise = launchSetupWindow();

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(1);

    const result = await promise;
    expect(result).toEqual({ success: false, error: 'Setup window closed without completing' });
  });

  it('should resolve with failure when Electron exits without output', async () => {
    const promise = launchSetupWindow();

    const closeCallback = mockProcess.on.mock.calls.find(c => c[0] === 'close')[1];
    closeCallback(0);

    const result = await promise;
    expect(result).toEqual({ success: false, error: 'Setup window closed without completing' });
  });

  it('should pass electron path from node_modules', () => {
    launchSetupWindow();

    const electronPath = spawn.mock.calls[0][0];
    expect(electronPath).toContain('node_modules');
    expect(electronPath).toContain('electron');
  });
});
