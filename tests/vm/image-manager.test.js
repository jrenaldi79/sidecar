const fs = require('fs');
const path = require('path');
const os = require('os');
const { ImageManager } = require('../../src/vm/image-manager');

describe('ImageManager', () => {
  let tmpDir;
  let mgr;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-img-test-'));
    mgr = new ImageManager({ vmDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('ensureDirs', () => {
    test('creates base, derived, and overlay directories', () => {
      mgr.ensureDirs();
      expect(fs.existsSync(path.join(tmpDir, 'base'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'derived'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'overlay'))).toBe(true);
    });
  });

  describe('createSessionOverlay', () => {
    test('creates overlay from derived image', async () => {
      // Create a fake derived image
      const derivedDir = path.join(tmpDir, 'derived');
      fs.mkdirSync(derivedDir, { recursive: true });
      fs.writeFileSync(path.join(derivedDir, 'sidecar-provision.img'), 'fake-image-data');

      const overlayPath = await mgr.createSessionOverlay('test-task-id');
      expect(fs.existsSync(overlayPath)).toBe(true);
      expect(overlayPath).toContain('test-task-id');
      expect(fs.readFileSync(overlayPath, 'utf-8')).toBe('fake-image-data');
    });

    test('throws when derived image does not exist', async () => {
      await expect(mgr.createSessionOverlay('test-task')).rejects.toThrow('Derived image not found');
    });
  });

  describe('deleteSessionOverlay', () => {
    test('removes the overlay file', () => {
      const overlayDir = path.join(tmpDir, 'overlay');
      fs.mkdirSync(overlayDir, { recursive: true });
      const overlayPath = path.join(overlayDir, 'test-task.img');
      fs.writeFileSync(overlayPath, 'fake');

      mgr.deleteSessionOverlay('test-task');
      expect(fs.existsSync(overlayPath)).toBe(false);
    });

    test('does not throw when file does not exist', () => {
      expect(() => mgr.deleteSessionOverlay('nonexistent')).not.toThrow();
    });
  });

  describe('createDerivedImage', () => {
    test('creates derived image from source', async () => {
      const sourcePath = path.join(tmpDir, 'source.img');
      fs.writeFileSync(sourcePath, 'cowork-image-data');

      const derivedPath = await mgr.createDerivedImage(sourcePath);
      expect(fs.existsSync(derivedPath)).toBe(true);
      expect(fs.readFileSync(derivedPath, 'utf-8')).toBe('cowork-image-data');
    });

    test('overwrites existing derived image', async () => {
      const sourcePath = path.join(tmpDir, 'source.img');
      fs.writeFileSync(sourcePath, 'new-data');

      const derivedDir = path.join(tmpDir, 'derived');
      fs.mkdirSync(derivedDir, { recursive: true });
      fs.writeFileSync(path.join(derivedDir, 'sidecar-provision.img'), 'old-data');

      const derivedPath = await mgr.createDerivedImage(sourcePath);
      expect(fs.readFileSync(derivedPath, 'utf-8')).toBe('new-data');
    });
  });

  describe('version tracking', () => {
    test('storeOriginHash writes and getStoredOriginHash reads', () => {
      mgr.storeOriginHash('abc123');
      expect(mgr.getStoredOriginHash()).toBe('abc123');
    });

    test('storeProvisionVersion writes and getStoredProvisionVersion reads', () => {
      mgr.storeProvisionVersion('1.2.3');
      expect(mgr.getStoredProvisionVersion()).toBe('1.2.3');
    });

    test('getStoredOriginHash returns null when not set', () => {
      expect(mgr.getStoredOriginHash()).toBeNull();
    });

    test('getStoredProvisionVersion returns null when not set', () => {
      expect(mgr.getStoredProvisionVersion()).toBeNull();
    });
  });
});
