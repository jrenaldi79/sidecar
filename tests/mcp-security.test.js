const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertContextBinding,
  parseAllowedRoots,
  validateProjectPath,
  validateSessionDir,
  validateSubagentParent,
  defaultIncludeContext,
  validateSubagentLaunchProject
} = require('../src/utils/sidecar-boundaries');
const { buildContext } = require('../src/sidecar/context-builder');
const { saveApiKey } = require('../src/utils/api-key-store');

describe('sidecar workspace boundaries', () => {
  const repoRoot = fs.realpathSync(path.resolve(__dirname, '..'));

  test('parseAllowedRoots rejects non-absolute roots', () => {
    expect(() => parseAllowedRoots('relative/path')).toThrow(/absolute/i);
  });

  test('validateProjectPath rejects broad system roots by default', () => {
    const options = { cwd: repoRoot, allowedRoots: [repoRoot] };

    expect(() => validateProjectPath('/tmp', options)).toThrow(/not allowed|unsafe/i);
    expect(() => validateProjectPath('/', options)).toThrow(/not allowed|unsafe/i);
    expect(() => validateProjectPath(os.homedir(), options)).toThrow(/not allowed|unsafe/i);
  });

  test('validateProjectPath accepts and canonicalizes a descendant of the repo root', () => {
    const expected = fs.realpathSync(path.join(repoRoot, 'src'));

    expect(validateProjectPath(path.join(repoRoot, 'src'), {
      cwd: repoRoot,
      allowedRoots: [repoRoot]
    })).toBe(expected);
  });

  test('validateProjectPath rejects descendants when cwd is root unless explicitly allowed', () => {
    expect(() => validateProjectPath(repoRoot, {
      cwd: '/',
      allowedRoots: []
    })).toThrow(/not allowed|unsafe/i);

    expect(validateProjectPath(repoRoot, {
      cwd: '/',
      allowedRoots: [repoRoot]
    })).toBe(repoRoot);
  });

  test('validateProjectPath rejects descendants when cwd is home unless explicitly allowed', () => {
    const homeDir = fs.realpathSync(os.homedir());
    if (!repoRoot.startsWith(homeDir + path.sep)) {
      return;
    }

    expect(() => validateProjectPath(repoRoot, {
      cwd: homeDir,
      allowedRoots: []
    })).toThrow(/not allowed|unsafe/i);
  });

  test('validateProjectPath allows broad cwd descendants with unsafe override only', () => {
    const original = process.env.SIDECAR_ALLOW_UNSAFE_PROJECT;
    try {
      process.env.SIDECAR_ALLOW_UNSAFE_PROJECT = '1';
      expect(validateProjectPath(repoRoot, {
        cwd: '/',
        allowedRoots: []
      })).toBe(repoRoot);
    } finally {
      if (original === undefined) {
        delete process.env.SIDECAR_ALLOW_UNSAFE_PROJECT;
      } else {
        process.env.SIDECAR_ALLOW_UNSAFE_PROJECT = original;
      }
    }
  });

  test('validateProjectPath rejects a symlink inside an allowed root resolving outside that root', () => {
    const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-allowed-'));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-outside-'));
    const escapeLink = path.join(allowedRoot, 'escape');

    try {
      fs.symlinkSync(outsideRoot, escapeLink);

      expect(() => validateProjectPath(escapeLink, {
        cwd: allowedRoot,
        allowedRoots: [allowedRoot]
      })).toThrow(/not allowed|outside/i);
    } finally {
      fs.rmSync(allowedRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test('defaultIncludeContext returns false', () => {
    expect(defaultIncludeContext()).toBe(false);
  });

  test('includeContext rejects missing, default, or current session bindings', () => {
    expect(() => assertContextBinding({})).toThrow(/includeContext/i);
    expect(() => assertContextBinding({ session: 'current' })).toThrow(/exact/i);
    expect(() => assertContextBinding({ sessionId: 'current' })).toThrow(/exact/i);
    expect(() => assertContextBinding({ parentSession: 'current' })).toThrow(/exact/i);
  });

  test('includeContext accepts exact session, sessionDir, or coworkProcess bindings', () => {
    expect(() => assertContextBinding({ session: 'session-a' })).not.toThrow();
    expect(() => assertContextBinding({ sessionDir: path.join(repoRoot, '.claude', 'sidecar_sessions', 'session-a') })).not.toThrow();
    expect(() => assertContextBinding({ client: 'cowork', coworkProcess: 'exact-process' })).not.toThrow();
  });

  test('validateSubagentLaunchProject rejects parent directories without metadata', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-subagent-parent-'));
    const parentTaskId = 'parent-task';
    const parentDir = path.join(tmpProject, '.claude', 'sidecar_sessions', parentTaskId);

    try {
      fs.mkdirSync(parentDir, { recursive: true });

      expect(() => validateSubagentLaunchProject({
        projectDir: tmpProject,
        parentTaskId,
        getSession: () => null,
        getSessionDir: () => parentDir
      })).toThrow(/metadata|parent session/i);
    } finally {
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });
});

describe('sidecar context boundaries', () => {
  const repoRoot = fs.realpathSync(path.resolve(__dirname, '..'));

  test('buildContext rejects cross-project context', () => {
    expect(() => buildContext('/other/project', 'session-a', {
      parentProject: repoRoot
    })).toThrow(/project/i);
  });

  test('buildContext rejects explicit code-web sessionDir outside the project root', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-codeweb-project-'));
    const externalSessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-codeweb-session-'));

    try {
      fs.writeFileSync(path.join(externalSessionDir, 'session-a.jsonl'), '');

      expect(() => buildContext(projectRoot, 'session-a', {
        client: 'code-web',
        sessionDir: externalSessionDir,
        parentProject: projectRoot
      })).toThrow(/outside|project root/i);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(externalSessionDir, { recursive: true, force: true });
    }
  });

  test('validateSessionDir rejects session directories outside the project root', () => {
    expect(() => validateSessionDir(
      path.join('/other/project', '.claude', 'sidecar_sessions', 'session-a'),
      repoRoot
    )).toThrow(/project|outside/i);
  });

  test('validateSubagentParent rejects parent metadata for a different project', () => {
    expect(() => validateSubagentParent({
      projectDir: '/other/project',
      parentTaskId: 'task-a'
    }, repoRoot)).toThrow(/project/i);
  });
});

describe('sidecar secret file permissions', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-secrets-'));
    originalEnv = { ...process.env };
    process.env.SIDECAR_ENV_DIR = path.join(tmpDir, 'config', 'sidecar');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('saving an API key creates env dir mode 0700 and .env mode 0600', () => {
    saveApiKey('openrouter', 'sk-or-test-secret');

    const envDir = process.env.SIDECAR_ENV_DIR;
    const envPath = path.join(envDir, '.env');

    expect(fs.statSync(envDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });
});
