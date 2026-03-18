'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { VMProvider } = require('./provider');
const { logger } = require('../utils/logger');

const COWORK_BUNDLE = path.join(
  os.homedir(), 'Library', 'Application Support', 'Claude',
  'vm_bundles', 'claudevm.bundle'
);
const COWORK_IMAGE_PATH = path.join(COWORK_BUNDLE, 'rootfs.img');
const COWORK_ORIGIN_PATH = path.join(COWORK_BUNDLE, '.rootfs.img.origin');
const COWORK_EFIVARS_PATH = path.join(COWORK_BUNDLE, 'efivars.fd');

const DEFAULT_VM_DIR = path.join(os.homedir(), '.config', 'sidecar', 'vm');
const DEFAULT_RAM_GB = parseInt(process.env.SIDECAR_VM_RAM || '2', 10);
const DEFAULT_CPUS = parseInt(process.env.SIDECAR_VM_CPUS || '2', 10);

/**
 * macOS VM provider using Virtualization.framework via sidecar-vm Swift CLI.
 * Boots ARM64 Linux from a CoW overlay of the Cowork VM image.
 */
class MacOSProvider extends VMProvider {
  /**
   * @param {object} [opts]
   * @param {string} [opts.imagePath] - Override Cowork image path (for testing)
   * @param {string} [opts.originPath] - Override origin hash path (for testing)
   * @param {string} [opts.efivarsPath] - Override efivars path (for testing)
   * @param {string} [opts.vmDir] - Override sidecar VM directory (for testing)
   */
  constructor(opts = {}) {
    super();
    this.imagePath = opts.imagePath || COWORK_IMAGE_PATH;
    this.originPath = opts.originPath || COWORK_ORIGIN_PATH;
    this.efivarsPath = opts.efivarsPath || COWORK_EFIVARS_PATH;
    this.vmDir = opts.vmDir || DEFAULT_VM_DIR;
    this.ramGB = DEFAULT_RAM_GB;
    this.cpus = DEFAULT_CPUS;
    this._vmProcess = null;
  }

  /** Check if Cowork VM image and sidecar-vm CLI are available */
  async isAvailable() {
    if (!fs.existsSync(this.imagePath)) {
      logger.debug('Cowork VM image not found', { path: this.imagePath });
      return false;
    }
    // TODO: Check for sidecar-vm binary in PATH
    return true;
  }

  /** Check if provisioning (derived image creation) is needed */
  async needsProvisioning() {
    const originHashPath = path.join(this.vmDir, '.origin-hash');
    const provisionVersionPath = path.join(this.vmDir, '.provision-version');

    // No origin hash file yet means never provisioned
    if (!fs.existsSync(originHashPath)) { return true; }

    // Check origin hash matches Cowork image
    try {
      const currentOrigin = fs.readFileSync(this.originPath, 'utf-8').trim();
      const storedOrigin = fs.readFileSync(originHashPath, 'utf-8').trim();
      if (currentOrigin !== storedOrigin) {
        logger.info('Cowork image updated, re-provisioning needed');
        return true;
      }
    } catch {
      return true;
    }

    // Check provision version matches sidecar version
    try {
      const pkg = require('../../package.json');
      const storedVersion = fs.readFileSync(provisionVersionPath, 'utf-8').trim();
      if (storedVersion !== pkg.version) {
        logger.info('Sidecar version changed, re-provisioning needed');
        return true;
      }
    } catch {
      return true;
    }

    return false;
  }

  /**
   * Validate mount path is not too broad.
   * Prevents accidentally exposing home directory, root, etc.
   *
   * @param {string} hostPath - Host directory to mount into VM
   * @throws {Error} If the path is too broad
   */
  static validateMountPath(hostPath) {
    const resolved = path.resolve(hostPath);
    const dangerous = [os.homedir(), '/', '/Users', '/var', '/etc', '/tmp'];
    if (dangerous.includes(resolved)) {
      throw new Error(
        `Refusing to mount ${resolved} - too broad. Mount a specific project directory.`
      );
    }
  }

  async provision() {
    // TODO: Implement CoW image creation + opencode installation
    throw new Error('Not yet implemented');
  }

  async boot(_options) {
    // TODO: Implement VM boot via Swift CLI + VSOCK connection
    throw new Error('Not yet implemented');
  }

  async shutdown() {
    // TODO: Implement VM shutdown via Swift CLI
    if (this._vmProcess) {
      this._vmProcess.kill();
      this._vmProcess = null;
    }
  }

  async reconcileOrphans() {
    // TODO: List running VMs via sidecar-vm list, kill orphans
  }
}

module.exports = {
  MacOSProvider,
  COWORK_IMAGE_PATH,
  COWORK_ORIGIN_PATH,
  COWORK_EFIVARS_PATH,
  SIDECAR_VM_DIR: DEFAULT_VM_DIR,
};
