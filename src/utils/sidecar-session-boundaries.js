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

function validateSidecarSessionsRoot(projectRoot) {
  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const sessionsRoot = path.join(canonicalProjectRoot, '.claude', 'sidecar_sessions');

  if (!fs.existsSync(sessionsRoot)) {
    throw new Error(`Sidecar sessions root does not exist: ${sessionsRoot}`);
  }

  const canonicalSessionsRoot = canonicalizeExistingDir(sessionsRoot, 'Sidecar sessions root');
  if (!isPathInside(canonicalProjectRoot, canonicalSessionsRoot)) {
    throw new Error(`Sidecar sessions root is outside the project root: ${canonicalSessionsRoot}`);
  }

  return canonicalSessionsRoot;
}

function validateSidecarSessionDir(projectRoot, taskId) {
  const taskCheck = validateTaskId(taskId);
  if (!taskCheck.valid) {
    throw new Error(taskCheck.error);
  }

  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const requestedSessionsRoot = path.join(canonicalProjectRoot, '.claude', 'sidecar_sessions');
  if (!fs.existsSync(requestedSessionsRoot)) {
    throw new Error(`Session ${taskId} not found`);
  }

  const canonicalSessionsRoot = validateSidecarSessionsRoot(projectRoot);
  const sessionDir = path.join(canonicalSessionsRoot, taskId);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session ${taskId} not found`);
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

function validateSidecarSubagentSessionDir(projectRoot, parentTaskId, subagentId) {
  const subagentCheck = validateTaskId(subagentId);
  if (!subagentCheck.valid) {
    throw new Error(subagentCheck.error);
  }

  const canonicalParentSessionDir = validateSidecarSessionDir(projectRoot, parentTaskId);
  const subagentsRoot = path.join(canonicalParentSessionDir, 'subagents');
  if (!fs.existsSync(subagentsRoot)) {
    throw new Error(`Sub-agent ${subagentId} not found under parent ${parentTaskId}`);
  }

  const canonicalSubagentsRoot = canonicalizeExistingDir(subagentsRoot, 'Sub-agent sessions root');
  if (!isPathInside(canonicalParentSessionDir, canonicalSubagentsRoot)) {
    throw new Error(`Sub-agent sessions root is outside the parent session directory: ${canonicalSubagentsRoot}`);
  }

  const subagentDir = path.join(canonicalSubagentsRoot, subagentId);
  if (!fs.existsSync(subagentDir)) {
    throw new Error(`Sub-agent ${subagentId} not found under parent ${parentTaskId}`);
  }

  const canonicalSubagentDir = realpathSync(subagentDir);
  const stat = fs.statSync(canonicalSubagentDir);
  if (!stat.isDirectory()) {
    throw new Error(`Sub-agent path is not a directory: ${subagentDir}`);
  }
  if (!isPathInside(canonicalSubagentsRoot, canonicalSubagentDir)) {
    throw new Error(`Sub-agent session directory is outside the parent session tree: ${canonicalSubagentDir}`);
  }

  return canonicalSubagentDir;
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

function resolveContainedSessionFile(sessionDir, filename, options = {}) {
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

  return { path: canonicalFilePath, stat };
}

function readContainedSessionFile(sessionDir, filename, options = {}) {
  const resolved = resolveContainedSessionFile(sessionDir, filename, options);
  if (resolved === null) {
    return null;
  }

  return fs.readFileSync(resolved.path, 'utf-8');
}

function openContainedSessionFileForWrite(sessionDir, filename, options = {}) {
  assertSafeSessionFilename(filename);
  const canonicalSessionDir = canonicalizeExistingDir(path.resolve(sessionDir), 'Session directory');
  const filePath = path.join(canonicalSessionDir, filename);
  const mode = options.mode === undefined ? 0o600 : options.mode;
  const flags = fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    (fs.constants.O_NOFOLLOW || 0);

  try {
    return fs.openSync(filePath, flags, mode);
  } catch (err) {
    if (err && err.code === 'ELOOP') {
      throw new Error(`Session file is a symbolic link and cannot be written safely inside the session directory: ${filename}`);
    }
    throw err;
  }
}

function normalizeWriteOptions(options) {
  if (typeof options === 'string') {
    return { encoding: options };
  }
  const normalized = { ...options };
  delete normalized.flag;
  delete normalized.mode;
  return normalized;
}

function writeContainedSessionFile(sessionDir, filename, data, options = {}) {
  const fd = openContainedSessionFileForWrite(sessionDir, filename, options);
  try {
    fs.writeFileSync(fd, data, normalizeWriteOptions(options));
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  validateSidecarSessionsRoot,
  validateSidecarSessionDir,
  validateSidecarSubagentSessionDir,
  validateSidecarSessionMetadata,
  resolveContainedSessionFile,
  readContainedSessionFile,
  openContainedSessionFileForWrite,
  writeContainedSessionFile
};
