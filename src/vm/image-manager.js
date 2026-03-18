'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { logger } = require('../utils/logger');

/**
 * Manages CoW disk images for VM sessions.
 *
 * Layout:
 *   vmDir/base/rootfs.img       -> symlink to Cowork image (read-only)
 *   vmDir/derived/sidecar-provision.img  -> provisioned base
 *   vmDir/overlay/<task-id>.img -> per-session writable layer
 */
class ImageManager {
  /**
   * @param {object} opts
   * @param {string} opts.vmDir - Root directory for VM images
   */
  constructor({ vmDir }) {
    this.vmDir = vmDir;
    this.baseDir = path.join(vmDir, 'base');
    this.derivedDir = path.join(vmDir, 'derived');
    this.overlayDir = path.join(vmDir, 'overlay');
  }

  /** Ensure all directories exist */
  ensureDirs() {
    for (const dir of [this.baseDir, this.derivedDir, this.overlayDir]) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Create a CoW snapshot of the derived image for this session.
   * Uses cp -c for APFS clone (instant, zero-copy).
   * Falls back to regular copy if cloning not supported.
   *
   * @param {string} taskId - Session task ID
   * @returns {Promise<string>} Path to the session overlay image
   */
  async createSessionOverlay(taskId) {
    this.ensureDirs();
    const derivedPath = path.join(this.derivedDir, 'sidecar-provision.img');
    const overlayPath = path.join(this.overlayDir, `${taskId}.img`);

    if (!fs.existsSync(derivedPath)) {
      throw new Error('Derived image not found. Run provisioning first.');
    }

    // APFS clone (CoW copy) - instant and uses no extra disk space
    try {
      execFileSync('cp', ['-c', derivedPath, overlayPath]);
    } catch {
      // -c (clone) not supported on this filesystem, fall back to regular copy
      execFileSync('cp', [derivedPath, overlayPath]);
    }

    logger.debug('Created session overlay', { taskId, path: overlayPath });
    return overlayPath;
  }

  /**
   * Delete the session overlay image.
   * Called at session end for clean slate.
   *
   * @param {string} taskId - Session task ID
   */
  deleteSessionOverlay(taskId) {
    const overlayPath = path.join(this.overlayDir, `${taskId}.img`);
    try {
      fs.unlinkSync(overlayPath);
      logger.debug('Deleted session overlay', { taskId });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn('Failed to delete session overlay', { taskId, error: err.message });
      }
    }
  }

  /**
   * Create the derived (provisioned) image from the Cowork base.
   * This creates a CoW clone that can then be booted and provisioned.
   *
   * @param {string} coworkImagePath - Path to Cowork's rootfs.img
   * @returns {string} Path to the derived image
   */
  async createDerivedImage(coworkImagePath) {
    this.ensureDirs();
    const derivedPath = path.join(this.derivedDir, 'sidecar-provision.img');

    // Remove old derived image if it exists
    try { fs.unlinkSync(derivedPath); } catch { /* ignore ENOENT */ }

    // APFS clone of Cowork base
    try {
      execFileSync('cp', ['-c', coworkImagePath, derivedPath]);
    } catch {
      execFileSync('cp', [coworkImagePath, derivedPath]);
    }

    logger.info('Created derived image from Cowork base', { path: derivedPath });
    return derivedPath;
  }

  /**
   * Store the Cowork origin hash for change detection.
   * @param {string} hash
   */
  storeOriginHash(hash) {
    this.ensureDirs();
    fs.writeFileSync(path.join(this.vmDir, '.origin-hash'), hash, { mode: 0o600 });
  }

  /**
   * Store the sidecar provision version for change detection.
   * @param {string} version
   */
  storeProvisionVersion(version) {
    this.ensureDirs();
    fs.writeFileSync(path.join(this.vmDir, '.provision-version'), version, { mode: 0o600 });
  }

  /**
   * Read stored origin hash, or null if not found.
   * @returns {string|null}
   */
  getStoredOriginHash() {
    try {
      return fs.readFileSync(path.join(this.vmDir, '.origin-hash'), 'utf-8').trim();
    } catch {
      return null;
    }
  }

  /**
   * Read stored provision version, or null if not found.
   * @returns {string|null}
   */
  getStoredProvisionVersion() {
    try {
      return fs.readFileSync(path.join(this.vmDir, '.provision-version'), 'utf-8').trim();
    } catch {
      return null;
    }
  }
}

module.exports = { ImageManager };
