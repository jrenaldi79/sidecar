'use strict';

const fs = require('fs');
const path = require('path');
const { validateTaskId } = require('./validators');

function realpathSync(targetPath) {
  return fs.realpathSync.native ? fs.realpathSync.native(targetPath) : fs.realpathSync(targetPath);
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalizeExistingDir(targetPath, label) {
  if (!fs.existsSync(targetPath)) { throw new Error(`${label} does not exist: ${targetPath}`); }
  const canonical = realpathSync(targetPath);
  const stat = fs.statSync(canonical);
  if (!stat.isDirectory()) { throw new Error(`${label} is not a directory: ${targetPath}`); }
  return canonical;
}

function rejectSymlink(targetPath, label) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') { return null; }
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} is a symbolic link and cannot be used safely inside the session directory: ${targetPath}`);
  }
  return stat;
}

function assertSafeSessionFilename(filename) {
  if (!filename || typeof filename !== 'string') { throw new Error('Session filename is required'); }
  if (filename.includes('\0') || filename.includes('/') || filename.includes('\\') || path.isAbsolute(filename)) {
    throw new Error(`Invalid session filename: ${filename}`);
  }
}

function assertTaskId(taskId) {
  const taskCheck = validateTaskId(taskId);
  if (!taskCheck.valid) { throw new Error(taskCheck.error); }
}

function ensureContainedDir(parentDir, dirname, label, options = {}) {
  assertSafeSessionFilename(dirname);
  const mode = options.mode === undefined ? 0o700 : options.mode;
  const dirPath = path.join(parentDir, dirname);
  if (!isPathInside(parentDir, path.resolve(dirPath))) {
    throw new Error(`${label} is outside the expected parent directory: ${dirPath}`);
  }

  const existing = rejectSymlink(dirPath, label);
  if (existing && !existing.isDirectory()) { throw new Error(`${label} is not a directory: ${dirPath}`); }
  if (existing && options.allowExisting === false) { throw new Error(`${label} already exists: ${dirPath}`); }
  if (!existing) { fs.mkdirSync(dirPath, { mode }); }

  const canonical = canonicalizeExistingDir(dirPath, label);
  if (!isPathInside(parentDir, canonical)) {
    throw new Error(`${label} is outside the expected parent directory: ${canonical}`);
  }
  return canonical;
}

function validateSidecarSessionsRoot(projectRoot) {
  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const sessionsRoot = path.join(canonicalProjectRoot, '.claude', 'sidecar_sessions');
  if (!fs.existsSync(sessionsRoot)) { throw new Error(`Sidecar sessions root does not exist: ${sessionsRoot}`); }

  rejectSymlink(sessionsRoot, 'Sidecar sessions root');
  const canonicalSessionsRoot = canonicalizeExistingDir(sessionsRoot, 'Sidecar sessions root');
  if (!isPathInside(canonicalProjectRoot, canonicalSessionsRoot)) {
    throw new Error(`Sidecar sessions root is outside the project root: ${canonicalSessionsRoot}`);
  }
  return canonicalSessionsRoot;
}

function ensureSidecarSessionsRoot(projectRoot) {
  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const claudeDir = ensureContainedDir(canonicalProjectRoot, '.claude', 'Claude metadata directory');
  const sessionsRoot = ensureContainedDir(claudeDir, 'sidecar_sessions', 'Sidecar sessions root');
  if (!isPathInside(canonicalProjectRoot, sessionsRoot)) {
    throw new Error(`Sidecar sessions root is outside the project root: ${sessionsRoot}`);
  }
  return sessionsRoot;
}

function ensureSidecarSessionDir(projectRoot, taskId, options = {}) {
  assertTaskId(taskId);
  const canonicalSessionsRoot = ensureSidecarSessionsRoot(projectRoot);
  const sessionDir = path.join(canonicalSessionsRoot, taskId);
  const existing = rejectSymlink(sessionDir, 'Session directory');
  if (existing && !existing.isDirectory()) { throw new Error(`Session path is not a directory: ${sessionDir}`); }
  if (existing && options.allowExisting === false) { throw new Error(`Session ${taskId} already exists`); }
  if (!existing) { fs.mkdirSync(sessionDir, { mode: options.mode === undefined ? 0o700 : options.mode }); }

  const canonicalSessionDir = canonicalizeExistingDir(sessionDir, 'Session directory');
  if (!isPathInside(canonicalSessionsRoot, canonicalSessionDir)) {
    throw new Error(`Session directory is outside the project session root: ${canonicalSessionDir}`);
  }
  return canonicalSessionDir;
}

function validateSidecarSessionDir(projectRoot, taskId) {
  assertTaskId(taskId);
  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const requestedSessionsRoot = path.join(canonicalProjectRoot, '.claude', 'sidecar_sessions');
  if (!fs.existsSync(requestedSessionsRoot)) { throw new Error(`Session ${taskId} not found`); }

  const canonicalSessionsRoot = validateSidecarSessionsRoot(projectRoot);
  const sessionDir = path.join(canonicalSessionsRoot, taskId);
  if (!fs.existsSync(sessionDir)) { throw new Error(`Session ${taskId} not found`); }

  const canonicalSessionDir = realpathSync(sessionDir);
  const stat = fs.statSync(canonicalSessionDir);
  if (!stat.isDirectory()) { throw new Error(`Session path is not a directory: ${sessionDir}`); }
  if (!isPathInside(canonicalSessionsRoot, canonicalSessionDir)) {
    throw new Error(`Session directory is outside the project session root: ${canonicalSessionDir}`);
  }
  return canonicalSessionDir;
}

function validateSidecarSubagentSessionDir(projectRoot, parentTaskId, subagentId) {
  assertTaskId(subagentId);
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
  if (!stat.isDirectory()) { throw new Error(`Sub-agent path is not a directory: ${subagentDir}`); }
  if (!isPathInside(canonicalSubagentsRoot, canonicalSubagentDir)) {
    throw new Error(`Sub-agent session directory is outside the parent session tree: ${canonicalSubagentDir}`);
  }
  return canonicalSubagentDir;
}

function validateSidecarSessionMetadata(metadata, projectRoot) {
  if (!metadata || typeof metadata !== 'object') { throw new Error('Session metadata is required'); }
  const metadataProject = metadata.projectDir || metadata.project || metadata.cwd;
  if (!metadataProject) { throw new Error('Session metadata is missing project binding'); }

  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const canonicalMetadataProject = canonicalizeExistingDir(path.resolve(metadataProject), 'Session metadata project');
  if (canonicalMetadataProject !== canonicalProjectRoot) {
    throw new Error(`Session metadata project does not match project root: ${canonicalMetadataProject}`);
  }
  return { ...metadata, project: canonicalProjectRoot, projectDir: canonicalProjectRoot };
}

function resolveContainedSessionFile(sessionDir, filename, options = {}) {
  assertSafeSessionFilename(filename);
  const canonicalSessionDir = canonicalizeExistingDir(path.resolve(sessionDir), 'Session directory');
  const filePath = path.join(canonicalSessionDir, filename);

  if (!fs.existsSync(filePath)) {
    if (options.optional) { return null; }
    throw new Error(`Session file not found: ${filename}`);
  }

  const canonicalFilePath = realpathSync(filePath);
  if (!isPathInside(canonicalSessionDir, canonicalFilePath)) {
    throw new Error(`Session file is outside the session directory: ${filename}`);
  }

  const stat = fs.statSync(canonicalFilePath);
  if (!stat.isFile()) { throw new Error(`Session file is not a regular file: ${filename}`); }
  return { path: canonicalFilePath, stat };
}

function readContainedSessionFile(sessionDir, filename, options = {}) {
  const resolved = resolveContainedSessionFile(sessionDir, filename, options);
  return resolved === null ? null : fs.readFileSync(resolved.path, 'utf-8');
}

function prepareContainedSessionFile(sessionDir, filename) {
  assertSafeSessionFilename(filename);
  const canonicalSessionDir = canonicalizeExistingDir(path.resolve(sessionDir), 'Session directory');
  const filePath = path.join(canonicalSessionDir, filename);
  if (!isPathInside(canonicalSessionDir, path.resolve(filePath))) {
    throw new Error(`Session file is outside the session directory: ${filename}`);
  }

  const existing = rejectSymlink(filePath, 'Session file');
  if (existing && !existing.isFile()) { throw new Error(`Session file is not a regular file: ${filename}`); }
  if (existing && !isPathInside(canonicalSessionDir, realpathSync(filePath))) {
    throw new Error(`Session file is outside the session directory: ${filename}`);
  }
  return filePath;
}

function openPreparedSessionFile(filePath, filename, flags, mode, action) {
  try {
    const fd = fs.openSync(filePath, flags, mode);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      fs.closeSync(fd);
      throw new Error(`Session file is not a regular file: ${filename}`);
    }
    return fd;
  } catch (err) {
    if (err && err.code === 'ELOOP') {
      throw new Error(`Session file is a symbolic link and cannot be ${action} safely inside the session directory: ${filename}`);
    }
    throw err;
  }
}

function normalizeWriteOptions(options) {
  if (typeof options === 'string') { return { encoding: options }; }
  const normalized = { ...options };
  delete normalized.flag;
  delete normalized.mode;
  return normalized;
}

function openContainedSessionFileForWrite(sessionDir, filename, options = {}) {
  const mode = options.mode === undefined ? 0o600 : options.mode;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
  return openPreparedSessionFile(prepareContainedSessionFile(sessionDir, filename), filename, flags, mode, 'written');
}

function writeContainedSessionFile(sessionDir, filename, data, options = {}) {
  const fd = openContainedSessionFileForWrite(sessionDir, filename, options);
  try {
    fs.writeFileSync(fd, data, normalizeWriteOptions(options));
  } finally {
    fs.closeSync(fd);
  }
}

function appendContainedSessionFile(sessionDir, filename, data, options = {}) {
  const mode = options.mode === undefined ? 0o600 : options.mode;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0);
  const fd = openPreparedSessionFile(prepareContainedSessionFile(sessionDir, filename), filename, flags, mode, 'appended');
  try {
    fs.writeFileSync(fd, data, normalizeWriteOptions(options));
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  validateSidecarSessionsRoot,
  ensureSidecarSessionDir,
  validateSidecarSessionDir,
  validateSidecarSubagentSessionDir,
  validateSidecarSessionMetadata,
  resolveContainedSessionFile,
  readContainedSessionFile,
  openContainedSessionFileForWrite,
  writeContainedSessionFile,
  appendContainedSessionFile
};
