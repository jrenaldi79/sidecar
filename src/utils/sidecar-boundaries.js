'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateTaskId } = require('./validators');

function realpathSync(targetPath) {
  return fs.realpathSync.native
    ? fs.realpathSync.native(targetPath)
    : fs.realpathSync(targetPath);
}

function assertAbsolutePath(targetPath, label) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error(`${label} is required`);
  }
  if (targetPath.includes('\0')) {
    throw new Error(`${label} cannot contain null bytes`);
  }
  if (!path.isAbsolute(targetPath)) {
    throw new Error(`${label} must be an absolute path`);
  }
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalizeExistingDir(targetPath, label) {
  assertAbsolutePath(targetPath, label);
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

function canonicalizeContainingPath(targetPath, label) {
  assertAbsolutePath(targetPath, label);

  let current = path.resolve(targetPath);
  const missingParts = [];
  while (!fs.existsSync(current)) {
    const next = path.dirname(current);
    if (next === current) {
      throw new Error(`${label} does not exist: ${targetPath}`);
    }
    missingParts.unshift(path.basename(current));
    current = next;
  }

  const canonicalBase = realpathSync(current);
  return missingParts.length > 0
    ? path.join(canonicalBase, ...missingParts)
    : canonicalBase;
}

function parseAllowedRoots(value) {
  if (!value) {
    return [];
  }
  const roots = Array.isArray(value)
    ? value
    : String(value).split(path.delimiter).filter(Boolean);

  return roots.map((root) => canonicalizeExistingDir(root, 'Allowed root'));
}

function restrictedRootSet() {
  const roots = new Set();
  for (const candidate of ['/', os.homedir(), os.tmpdir(), '/tmp']) {
    try {
      roots.add(realpathSync(candidate));
    } catch {
      roots.add(path.resolve(candidate));
    }
  }
  return roots;
}

function defaultIncludeContext() {
  return false;
}

function validateProjectPath(project, options = {}) {
  const cwd = options.cwd || process.cwd();
  const canonicalCwd = canonicalizeExistingDir(path.resolve(cwd), 'Current working directory');
  const requestedProject = path.resolve(project || canonicalCwd);
  const canonicalProject = canonicalizeExistingDir(requestedProject, 'Project path');

  if (process.env.SIDECAR_ALLOW_UNSAFE_PROJECT === '1' || options.allowUnsafe === true) {
    return canonicalProject;
  }

  if (restrictedRootSet().has(canonicalProject)) {
    throw new Error(`Project path is unsafe by default: ${canonicalProject}`);
  }

  const configuredRoots = options.allowedRoots !== undefined
    ? parseAllowedRoots(options.allowedRoots)
    : parseAllowedRoots(process.env.SIDECAR_ALLOWED_ROOTS);
  const allowedRoots = [canonicalCwd, ...configuredRoots];

  if (!allowedRoots.some((root) => isPathInside(root, canonicalProject))) {
    throw new Error(`Project path is not allowed: ${canonicalProject}`);
  }

  return canonicalProject;
}

function validateSessionDir(sessionDir, projectRoot) {
  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const canonicalSessionDir = canonicalizeContainingPath(path.resolve(sessionDir), 'Session directory');

  if (!isPathInside(canonicalProjectRoot, canonicalSessionDir)) {
    throw new Error(`Session directory is outside the project root: ${canonicalSessionDir}`);
  }

  return canonicalSessionDir;
}

function validateSubagentParent(metadata, projectRoot) {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Parent session metadata is required');
  }

  const parentTaskId = metadata.parentTaskId || metadata.taskId;
  const taskCheck = validateTaskId(parentTaskId);
  if (!taskCheck.valid) {
    throw new Error(taskCheck.error);
  }

  const metadataProject = metadata.projectDir || metadata.project || metadata.cwd;
  if (!metadataProject) {
    throw new Error('Parent session metadata is missing project binding');
  }

  const canonicalProjectRoot = canonicalizeExistingDir(path.resolve(projectRoot), 'Project root');
  const canonicalMetadataProject = canonicalizeExistingDir(path.resolve(metadataProject), 'Parent project');
  if (canonicalMetadataProject !== canonicalProjectRoot) {
    throw new Error(`Parent session project does not match project root: ${canonicalMetadataProject}`);
  }

  return {
    ...metadata,
    projectDir: canonicalMetadataProject,
    parentTaskId
  };
}

function hasContextBinding(options = {}) {
  return Boolean(
    options.parentSession ||
    options.sessionId ||
    options.session ||
    options.sessionDir ||
    options.coworkProcess
  );
}

function assertContextBinding(options = {}) {
  if (!hasContextBinding(options)) {
    throw new Error('includeContext requires parentSession, session, sessionDir, or coworkProcess');
  }
  if (options.client === 'cowork' && !options.sessionDir && !options.coworkProcess) {
    throw new Error('Cowork context requires coworkProcess for exact session matching');
  }
}

function resolveContextSessionScope({ project, parentProject, sessionDir, homeDir, getSessionDirectory }) {
  const validatedProject = parentProject
    ? validateProjectPath(path.resolve(project), { cwd: parentProject, allowedRoots: [parentProject] })
    : project;
  const resolvedSessionDir = sessionDir
    ? validateSessionDir(path.resolve(sessionDir), validatedProject)
    : getSessionDirectory(validatedProject, homeDir);

  return { validatedProject, resolvedSessionDir };
}

function validateSubagentLaunchProject({ projectDir, parentTaskId, getSession, getSessionDir }) {
  const validatedProjectDir = validateProjectPath(path.resolve(projectDir), {
    cwd: path.resolve(projectDir),
    allowedRoots: [path.resolve(projectDir)]
  });
  const parentDir = getSessionDir(validatedProjectDir, parentTaskId);
  if (!fs.existsSync(parentDir)) {
    throw new Error(`Parent session ${parentTaskId} not found`);
  }
  const parentMetadata = getSession(validatedProjectDir, parentTaskId) || {
    taskId: parentTaskId,
    projectDir: validatedProjectDir
  };
  validateSubagentParent({
    ...parentMetadata,
    taskId: parentMetadata.taskId || parentTaskId,
    projectDir: parentMetadata.projectDir || parentMetadata.project || validatedProjectDir
  }, validatedProjectDir);

  return validatedProjectDir;
}

module.exports = {
  parseAllowedRoots,
  validateProjectPath,
  validateSessionDir,
  validateSubagentParent,
  defaultIncludeContext,
  hasContextBinding,
  assertContextBinding,
  resolveContextSessionScope,
  validateSubagentLaunchProject,
  isPathInside
};
