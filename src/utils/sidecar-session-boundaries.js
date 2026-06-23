'use strict';

const fs = require('fs');
const path = require('path');
const { validateTaskId } = require('./validators');

function realpathSync(targetPath) {
  return fs.realpathSync.native
    ? fs.realpathSync.native(targetPath)
    : fs.realpathSync(targetPath);
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalizeExistingDir(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} does not exist: ${targetPath}`);
  }
  const canonical = realpathSync(targetPath);
  const stat = fs.statSync(canonical);
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${targetPath}`);
  }
  return canonical;
}

function validateSidecarSessionDir(projectRoot, taskId) {
  const taskCheck = validateTaskId(taskId);
  if (!taskCheck.valid) {
    throw new Error(taskCheck.error);
  }

  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const sessionsRoot = path.join(canonicalProjectRoot, '.claude', 'sidecar_sessions');
  const sessionDir = path.join(sessionsRoot, taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
  }

  const canonicalSessionsRoot = canonicalizeExistingDir(sessionsRoot, 'Sidecar sessions root');
  if (!isPathInside(canonicalProjectRoot, canonicalSessionsRoot)) {
    throw new Error(`Sidecar sessions root is outside the project root: ${canonicalSessionsRoot}`);
  }

  const canonicalSessionDir = realpathSync(sessionDir);
  const stat = fs.statSync(canonicalSessionDir);
  if (!stat.isDirectory()) {
    throw new Error(`Session path is not a directory: ${sessionDir}`);
  }
  if (!isPathInside(canonicalSessionsRoot, canonicalSessionDir)) {
    throw new Error(`Session directory is outside the project session root: ${canonicalSessionDir}`);
  }

  return canonicalSessionDir;
}

function validateSidecarSessionMetadata(metadata, projectRoot) {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Session metadata is required');
  }

  const metadataProject = metadata.projectDir || metadata.project || metadata.cwd;
  if (!metadataProject) {
    throw new Error('Session metadata is missing project binding');
  }

  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const canonicalMetadataProject = canonicalizeExistingDir(path.resolve(metadataProject), 'Session metadata project');
  if (canonicalMetadataProject !== canonicalProjectRoot) {
    throw new Error(`Session metadata project does not match project root: ${canonicalMetadataProject}`);
  }

  return {
    ...metadata,
    project: canonicalProjectRoot,
    projectDir: canonicalProjectRoot
  };
}

function assertSafeSessionFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Session filename is required');
  }
  if (filename.includes('\0') || filename.includes('/') || filename.includes('\\') || path.isAbsolute(filename)) {
    throw new Error(`Invalid session filename: ${filename}`);
  }
}

function readContainedSessionFile(sessionDir, filename, options = {}) {
  assertSafeSessionFilename(filename);
  const canonicalSessionDir = canonicalizeExistingDir(path.resolve(sessionDir), 'Session directory');
  const filePath = path.join(canonicalSessionDir, filename);

  if (!fs.existsSync(filePath)) {
    if (options.optional) {
      return null;
    }
    throw new Error(`Session file not found: ${filename}`);
  }

  const canonicalFilePath = realpathSync(filePath);
  if (!isPathInside(canonicalSessionDir, canonicalFilePath)) {
    throw new Error(`Session file is outside the session directory: ${filename}`);
  }

  const stat = fs.statSync(canonicalFilePath);
  if (!stat.isFile()) {
    throw new Error(`Session file is not a regular file: ${filename}`);
  }

  return fs.readFileSync(canonicalFilePath, 'utf-8');
}

module.exports = {
  validateSidecarSessionDir,
  validateSidecarSessionMetadata,
  readContainedSessionFile
};
