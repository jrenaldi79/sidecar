/**
 * Tests for src/utils/server-setup.js
 *
 * Port management: getPortPid, isPortInUse, killPortProcess, ensurePortAvailable.
 * Uses mocked execFileSync and process.kill to avoid real port operations.
 */

const { execFileSync } = require('child_process');

jest.mock('child_process', () => ({
  execFileSync: jest.fn()
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const {
  getPortPid,
  isPortInUse,
  killPortProcess,
  ensurePortAvailable,
  DEFAULT_PORT
} = require('../src/utils/server-setup');

describe('server-setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DEFAULT_PORT', () => {
    it('should be 4096', () => {
      expect(DEFAULT_PORT).toBe(4096);
    });
  });

  describe('getPortPid', () => {
    it('should return PID when lsof finds a process', () => {
      execFileSync.mockReturnValue('12345\n');
      const pid = getPortPid(4096);
      expect(pid).toBe(12345);
      expect(execFileSync).toHaveBeenCalledWith(
        'lsof', ['-ti', ':4096'],
        expect.objectContaining({ encoding: 'utf8' })
      );
    });

    it('should return null when lsof returns non-numeric output', () => {
      execFileSync.mockReturnValue('not-a-number\n');
      expect(getPortPid(4096)).toBeNull();
    });

    it('should return null when lsof throws (no process on port)', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit code 1'); });
      expect(getPortPid(4096)).toBeNull();
    });

    it('should return null for empty lsof output', () => {
      execFileSync.mockReturnValue('');
      expect(getPortPid(4096)).toBeNull();
    });
  });

  describe('isPortInUse', () => {
    it('should return true when a process is on the port', () => {
      execFileSync.mockReturnValue('9999\n');
      expect(isPortInUse(4096)).toBe(true);
    });

    it('should return false when no process is on the port', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      expect(isPortInUse(4096)).toBe(false);
    });
  });

  describe('killPortProcess', () => {
    let killSpy;

    beforeEach(() => {
      killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
    });

    afterEach(() => {
      killSpy.mockRestore();
    });

    it('should return true when port is already free', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      expect(killPortProcess(4096)).toBe(true);
      expect(killSpy).not.toHaveBeenCalled();
    });

    it('should kill the process and return true on success', () => {
      execFileSync.mockReturnValue('7777\n');
      expect(killPortProcess(4096)).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(7777, 'SIGTERM');
    });

    it('should return false when process.kill throws', () => {
      execFileSync.mockReturnValue('7777\n');
      killSpy.mockImplementation(() => { throw new Error('EPERM'); });
      expect(killPortProcess(4096)).toBe(false);
    });
  });

  describe('ensurePortAvailable', () => {
    let killSpy;

    beforeEach(() => {
      killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
    });

    afterEach(() => {
      killSpy.mockRestore();
    });

    it('should return true immediately when port is free', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      expect(ensurePortAvailable()).toBe(true);
    });

    it('should default to port 4096', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      ensurePortAvailable();
      expect(execFileSync).toHaveBeenCalledWith(
        'lsof', ['-ti', ':4096'],
        expect.anything()
      );
    });

    it('should accept a custom port', () => {
      execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
      ensurePortAvailable(8080);
      expect(execFileSync).toHaveBeenCalledWith(
        'lsof', ['-ti', ':8080'],
        expect.anything()
      );
    });

    it('should kill stale process and return true when port is freed', () => {
      let callCount = 0;
      execFileSync.mockImplementation(() => {
        callCount++;
        // First two calls: port in use (getPortPid for isPortInUse + killPortProcess)
        // After kill, port is free
        if (callCount <= 2) {
          return '5555\n';
        }
        throw new Error('exit 1'); // port is now free
      });

      expect(ensurePortAvailable(4096)).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(5555, 'SIGTERM');
    });

    it('should return false when kill fails and port stays occupied', () => {
      // Port always occupied, kill fails
      execFileSync.mockReturnValue('5555\n');
      killSpy.mockImplementation(() => { throw new Error('EPERM'); });
      expect(ensurePortAvailable(4096)).toBe(false);
    });
  });
});
