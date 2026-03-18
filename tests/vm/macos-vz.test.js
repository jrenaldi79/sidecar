const path = require('path');
const fs = require('fs');
const os = require('os');
const { MacOSProvider } = require('../../src/vm/macos-vz');

describe('MacOSProvider', () => {
  describe('isAvailable', () => {
    test('returns false when Cowork image does not exist', async () => {
      const p = new MacOSProvider({ imagePath: '/nonexistent/rootfs.img' });
      expect(await p.isAvailable()).toBe(false);
    });
  });

  describe('needsProvisioning', () => {
    test('returns true when sidecar VM dir does not exist', async () => {
      const p = new MacOSProvider({ vmDir: '/tmp/sidecar-test-nonexistent-' + Date.now() });
      expect(await p.needsProvisioning()).toBe(true);
    });

    test('returns true when origin hash does not match', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-vm-test-'));
      fs.writeFileSync(path.join(tmpDir, '.origin-hash'), 'oldhash');
      const p = new MacOSProvider({ vmDir: tmpDir, originPath: '/nonexistent' });
      expect(await p.needsProvisioning()).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });

    test('returns true when provision version does not match', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-vm-test-'));
      // Create a fake origin file to match
      const fakeOriginPath = path.join(tmpDir, 'fake-origin');
      fs.writeFileSync(fakeOriginPath, 'matchhash');
      fs.writeFileSync(path.join(tmpDir, '.origin-hash'), 'matchhash');
      fs.writeFileSync(path.join(tmpDir, '.provision-version'), '0.0.0-old');

      const p = new MacOSProvider({ vmDir: tmpDir, originPath: fakeOriginPath });
      expect(await p.needsProvisioning()).toBe(true);
      fs.rmSync(tmpDir, { recursive: true });
    });

    test('returns false when both hashes match', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-vm-test-'));
      const fakeOriginPath = path.join(tmpDir, 'fake-origin');
      const pkg = require('../../package.json');

      fs.writeFileSync(fakeOriginPath, 'matchhash');
      fs.writeFileSync(path.join(tmpDir, '.origin-hash'), 'matchhash');
      fs.writeFileSync(path.join(tmpDir, '.provision-version'), pkg.version);

      const p = new MacOSProvider({ vmDir: tmpDir, originPath: fakeOriginPath });
      expect(await p.needsProvisioning()).toBe(false);
      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('validateMountPath', () => {
    test('rejects home directory', () => {
      expect(() => MacOSProvider.validateMountPath(os.homedir())).toThrow('too broad');
    });

    test('rejects root', () => {
      expect(() => MacOSProvider.validateMountPath('/')).toThrow('too broad');
    });

    test('rejects /Users', () => {
      expect(() => MacOSProvider.validateMountPath('/Users')).toThrow('too broad');
    });

    test('rejects /tmp', () => {
      expect(() => MacOSProvider.validateMountPath('/tmp')).toThrow('too broad');
    });

    test('accepts a project subdirectory', () => {
      expect(() => MacOSProvider.validateMountPath('/Users/test/projects/myapp')).not.toThrow();
    });

    test('accepts a nested workspace path', () => {
      expect(() => MacOSProvider.validateMountPath('/Users/test/code/sidecar')).not.toThrow();
    });
  });
});
