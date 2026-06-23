const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseAllowedRoots,
  validateProjectPath,
  validateSessionDir,
  validateSubagentParent,
  defaultIncludeContext
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
});

describe('sidecar context boundaries', () => {
  const repoRoot = fs.realpathSync(path.resolve(__dirname, '..'));

  test('buildContext rejects cross-project context', () => {
    expect(() => buildContext('/other/project', 'session-a', {
      parentProject: repoRoot
    })).toThrow(/project/i);
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
