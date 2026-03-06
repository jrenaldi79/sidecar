/**
 * Updater Module Tests
 *
 * Tests for self-update functionality: checking for updates,
 * notifying users, and performing updates via npm.
 */

// Store original env
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.SIDECAR_MOCK_UPDATE;
  jest.resetModules();
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env = { ...originalEnv };
});

describe('Updater Module', () => {

  describe('getUpdateInfo()', () => {
    it('should return null before initUpdateCheck is called', () => {
      const updater = require('../src/utils/updater');
      const info = updater.getUpdateInfo();
      expect(info).toBeNull();
    });

    it('should return null when no update is available', () => {
      jest.doMock('update-notifier', () => {
        return jest.fn(() => ({
          update: undefined,
          notify: jest.fn()
        }));
      });
      const updater = require('../src/utils/updater');

      updater.initUpdateCheck();
      const info = updater.getUpdateInfo();
      expect(info).toBeNull();
    });

    it('should return update info when update is available', () => {
      jest.doMock('update-notifier', () => {
        return jest.fn(() => ({
          update: { current: '0.3.0', latest: '1.0.0' },
          notify: jest.fn()
        }));
      });
      const updater = require('../src/utils/updater');

      updater.initUpdateCheck();
      const info = updater.getUpdateInfo();

      expect(info).not.toBeNull();
      expect(info).toHaveProperty('current', '0.3.0');
      expect(info).toHaveProperty('latest', '1.0.0');
      expect(info).toHaveProperty('hasUpdate', true);
    });
  });

  describe('notifyUpdate()', () => {
    it('should call notifier.notify()', () => {
      const mockNotify = jest.fn();
      jest.doMock('update-notifier', () => {
        return jest.fn(() => ({
          update: { current: '0.3.0', latest: '1.0.0' },
          notify: mockNotify
        }));
      });
      const updater = require('../src/utils/updater');

      updater.initUpdateCheck();
      updater.notifyUpdate();

      expect(mockNotify).toHaveBeenCalled();
    });

    it('should not throw if called before init', () => {
      const updater = require('../src/utils/updater');
      expect(() => updater.notifyUpdate()).not.toThrow();
    });
  });

  describe('initUpdateCheck()', () => {
    it('should initialize with package info', () => {
      const mockConstructor = jest.fn(() => ({
        update: undefined,
        notify: jest.fn()
      }));
      jest.doMock('update-notifier', () => mockConstructor);
      const updater = require('../src/utils/updater');

      updater.initUpdateCheck();

      expect(mockConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          pkg: expect.objectContaining({
            name: 'claude-sidecar',
            version: expect.any(String)
          })
        })
      );
    });

    it('should skip initialization in mock mode', () => {
      const mockConstructor = jest.fn(() => ({
        update: undefined,
        notify: jest.fn()
      }));
      jest.doMock('update-notifier', () => mockConstructor);

      process.env.SIDECAR_MOCK_UPDATE = 'available';
      const updater = require('../src/utils/updater');

      updater.initUpdateCheck();

      // Should NOT call the real update-notifier in mock mode
      expect(mockConstructor).not.toHaveBeenCalled();
    });
  });

  describe('performUpdate()', () => {
    it('should resolve with success on exit code 0', async () => {
      const EventEmitter = require('events');
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        })
      }));
      const updater = require('../src/utils/updater');

      const result = await updater.performUpdate();

      expect(result).toHaveProperty('success', true);
    });

    it('should resolve with failure on non-zero exit', async () => {
      const EventEmitter = require('events');
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          process.nextTick(() => {
            proc.stderr.emit('data', Buffer.from('permission denied'));
            proc.emit('close', 1);
          });
          return proc;
        })
      }));
      const updater = require('../src/utils/updater');

      const result = await updater.performUpdate();

      expect(result).toHaveProperty('success', false);
      expect(result).toHaveProperty('error');
    });

    it('should handle spawn errors', async () => {
      const EventEmitter = require('events');
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          process.nextTick(() => proc.emit('error', new Error('ENOENT')));
          return proc;
        })
      }));
      const updater = require('../src/utils/updater');

      const result = await updater.performUpdate();

      expect(result).toHaveProperty('success', false);
      expect(result.error).toContain('ENOENT');
    });
  });

  describe('SIDECAR_MOCK_UPDATE env var', () => {
    describe('mode: "available"', () => {
      it('should return fake update info from getUpdateInfo', () => {
        process.env.SIDECAR_MOCK_UPDATE = 'available';
        const updater = require('../src/utils/updater');

        updater.initUpdateCheck();
        const info = updater.getUpdateInfo();

        expect(info).not.toBeNull();
        expect(info.hasUpdate).toBe(true);
        expect(info.latest).toBe('99.0.0');
        expect(info.current).toBe('0.3.0');
      });
    });

    describe('mode: "success"', () => {
      it('should make performUpdate resolve immediately with success', async () => {
        process.env.SIDECAR_MOCK_UPDATE = 'success';
        const updater = require('../src/utils/updater');

        const result = await updater.performUpdate();

        expect(result).toHaveProperty('success', true);
      });

      it('should return fake update info from getUpdateInfo', () => {
        process.env.SIDECAR_MOCK_UPDATE = 'success';
        const updater = require('../src/utils/updater');

        updater.initUpdateCheck();
        const info = updater.getUpdateInfo();

        expect(info).not.toBeNull();
        expect(info.hasUpdate).toBe(true);
      });
    });

    describe('mode: "error"', () => {
      it('should make performUpdate return failure', async () => {
        process.env.SIDECAR_MOCK_UPDATE = 'error';
        const updater = require('../src/utils/updater');

        const result = await updater.performUpdate();

        expect(result).toHaveProperty('success', false);
        expect(result).toHaveProperty('error');
      });
    });

    describe('mode: "updating"', () => {
      it('should return fake update info from getUpdateInfo', () => {
        process.env.SIDECAR_MOCK_UPDATE = 'updating';
        const updater = require('../src/utils/updater');

        updater.initUpdateCheck();
        const info = updater.getUpdateInfo();

        expect(info).not.toBeNull();
        expect(info.hasUpdate).toBe(true);
        expect(info.latest).toBe('99.0.0');
      });
    });
  });
});
