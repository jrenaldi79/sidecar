'use strict';

const RUNTIME_ENV_KEYS = new Set([
  'APPDATA',
  'CI',
  'COLORTERM',
  'ComSpec',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'LOG_LEVEL',
  'LOGNAME',
  'NODE_ENV',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'PWD',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME'
]);

function isSecretEnvKey(key) {
  return /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|AUTH)/i.test(key);
}

function shouldCopyEnvKey(key) {
  if (RUNTIME_ENV_KEYS.has(key)) {
    return true;
  }
  if (key.startsWith('LC_')) {
    return true;
  }
  if (key.startsWith('npm_') && !isSecretEnvKey(key)) {
    return true;
  }
  if (key.startsWith('SIDECAR_') && !isSecretEnvKey(key)) {
    return true;
  }
  return false;
}

function buildChildProcessEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && shouldCopyEnvKey(key)) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) {
      env[key] = String(value);
    }
  }
  return env;
}

function normalizeExtraEnv(extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
    return {};
  }
  return extra;
}

function buildMcpServerEnvironment(extra = {}) {
  const explicit = normalizeExtraEnv(extra);
  const env = buildChildProcessEnv(explicit);

  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      isSecretEnvKey(key) &&
      !Object.prototype.hasOwnProperty.call(explicit, key)
    ) {
      env[key] = '';
    }
  }

  return env;
}

module.exports = { buildChildProcessEnv, buildMcpServerEnvironment };
