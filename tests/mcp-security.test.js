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
  resolveExactSessionFile,
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

  test('validateProjectPath rejects broad user and volume roots by default', () => {
    for (const broadRoot of ['/Users', '/Volumes']) {
      if (!fs.existsSync(broadRoot)) {
        continue;
      }

      expect(() => validateProjectPath(broadRoot, {
        cwd: repoRoot,
        allowedRoots: [broadRoot]
      })).toThrow(/not allowed|unsafe|broad/i);
    }
  });

  test('validateProjectPath does not let a broad parent root authorize descendants', () => {
    const usersRoot = '/Users';
    if (!fs.existsSync(usersRoot) || !repoRoot.startsWith(`${usersRoot}${path.sep}`)) {
      return;
    }

    expect(() => validateProjectPath(repoRoot, {
      cwd: usersRoot,
      allowedRoots: [usersRoot]
    })).toThrow(/not allowed|unsafe|broad/i);
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
    expect(() => assertContextBinding({ sessionDir: path.join(repoRoot, '.claude', 'sidecar_sessions') })).toThrow(/exact/i);
    expect(() => assertContextBinding({
      session: 'current',
      sessionDir: path.join(repoRoot, '.claude', 'sidecar_sessions')
    })).toThrow(/exact/i);
  });

  test('includeContext accepts exact session, exact session plus sessionDir, or coworkProcess bindings', () => {
    expect(() => assertContextBinding({ session: 'session-a' })).not.toThrow();
    expect(() => assertContextBinding({
      session: 'session-a',
      sessionDir: path.join(repoRoot, '.claude', 'sidecar_sessions')
    })).not.toThrow();
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

  test('validateSubagentLaunchProject rejects symlinked parent sessions outside the project sessions root', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-subagent-project-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-subagent-outside-'));
    const parentTaskId = 'parent-task';
    const sessionsRoot = path.join(tmpProject, '.claude', 'sidecar_sessions');
    const parentLink = path.join(sessionsRoot, parentTaskId);
    const outsideParent = path.join(outsideDir, 'outside-session');

    try {
      fs.mkdirSync(sessionsRoot, { recursive: true });
      fs.mkdirSync(outsideParent, { recursive: true });
      fs.writeFileSync(path.join(outsideParent, 'metadata.json'), JSON.stringify({
        taskId: parentTaskId,
        project: fs.realpathSync(tmpProject),
        projectDir: fs.realpathSync(tmpProject),
        status: 'running'
      }));
      fs.symlinkSync(outsideParent, parentLink, 'dir');

      expect(() => validateSubagentLaunchProject({
        projectDir: tmpProject,
        parentTaskId,
        getSession: (_projectDir, taskId) => JSON.parse(fs.readFileSync(
          path.join(tmpProject, '.claude', 'sidecar_sessions', taskId, 'metadata.json'),
          'utf-8'
        )),
        getSessionDir: (_projectDir, taskId) => path.join(
          tmpProject, '.claude', 'sidecar_sessions', taskId
        )
      })).toThrow(/outside|session root/i);
    } finally {
      fs.rmSync(tmpProject, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('sidecar MCP handler boundaries', () => {
  let tmpProject;
  let outsideDir;

  beforeEach(() => {
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-mcp-project-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-mcp-outside-'));
  });

  afterEach(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function linkOutsideSession(metadata) {
    const sessionsRoot = path.join(tmpProject, '.claude', 'sidecar_sessions');
    const outsideSession = path.join(outsideDir, 'outside-session');
    fs.mkdirSync(sessionsRoot, { recursive: true });
    fs.mkdirSync(outsideSession, { recursive: true });
    fs.writeFileSync(path.join(outsideSession, 'metadata.json'), JSON.stringify(metadata));
    fs.writeFileSync(path.join(outsideSession, 'summary.md'), 'external secret summary');
    fs.writeFileSync(path.join(outsideSession, 'conversation.jsonl'), 'external secret conversation\n');
    fs.symlinkSync(outsideSession, path.join(sessionsRoot, 'leak'), 'dir');
    return outsideSession;
  }

  test('sidecar_read rejects a task directory symlink before reading outside content', async () => {
    linkOutsideSession({ taskId: 'leak', status: 'complete' });

    const { handlers } = require('../src/mcp-server');
    const result = await handlers.sidecar_read({ taskId: 'leak' }, tmpProject);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside|session root/i);
    expect(result.content[0].text).not.toContain('external secret summary');
  });

  test('sidecar_abort rejects a task directory symlink before signaling the outside pid', async () => {
    const outsideSession = linkOutsideSession({
      taskId: 'leak',
      status: 'running',
      pid: 424242,
      createdAt: new Date().toISOString()
    });
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});

    const { handlers } = require('../src/mcp-server');
    const result = await handlers.sidecar_abort({ taskId: 'leak' }, tmpProject);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside|session root/i);
    expect(killSpy).not.toHaveBeenCalled();
    const outsideMetadata = JSON.parse(fs.readFileSync(path.join(outsideSession, 'metadata.json'), 'utf-8'));
    expect(outsideMetadata.status).toBe('running');
  });

  test('sidecar_start rejects a symlinked sessions root before spawning or writing outside metadata', async () => {
    const originalSharedServer = process.env.SIDECAR_SHARED_SERVER;
    const claudeDir = path.join(tmpProject, '.claude');
    const outsideRoot = path.join(outsideDir, 'outside-sessions-root');
    let spawnMock;

    try {
      process.env.SIDECAR_SHARED_SERVER = '0';
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.mkdirSync(outsideRoot, { recursive: true });
      fs.symlinkSync(outsideRoot, path.join(claudeDir, 'sidecar_sessions'), 'dir');

      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 12345, unref: jest.fn() })),
        }));
        jest.doMock('../src/sidecar/start', () => ({
          generateTaskId: jest.fn(() => 'root-escape')
        }));

        const { handlers } = require('../src/mcp-server');
        const result = await handlers.sidecar_start({
          prompt: 'test task',
          noUi: true,
          model: 'google/gemini-test'
        }, tmpProject);
        spawnMock = require('child_process').spawn;

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/sidecar sessions root|symbolic link|outside/i);
      });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(outsideRoot, 'root-escape', 'metadata.json'))).toBe(false);
    } finally {
      if (originalSharedServer === undefined) {
        delete process.env.SIDECAR_SHARED_SERVER;
      } else {
        process.env.SIDECAR_SHARED_SERVER = originalSharedServer;
      }
    }
  });

  test('sidecar_continue rejects a preexisting symlinked new task directory before stderr capture', async () => {
    const originalSharedServer = process.env.SIDECAR_SHARED_SERVER;
    const sessionsRoot = path.join(tmpProject, '.claude', 'sidecar_sessions');
    const outsideSession = path.join(outsideDir, 'outside-new-session');
    let spawnMock;

    try {
      process.env.SIDECAR_SHARED_SERVER = '0';
      fs.mkdirSync(sessionsRoot, { recursive: true });
      fs.mkdirSync(outsideSession, { recursive: true });
      fs.symlinkSync(outsideSession, path.join(sessionsRoot, 'new-task'), 'dir');

      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(() => ({ pid: 12345, unref: jest.fn() })),
        }));
        jest.doMock('../src/sidecar/start', () => ({
          generateTaskId: jest.fn(() => 'new-task')
        }));

        const { handlers } = require('../src/mcp-server');
        const result = await handlers.sidecar_continue({
          taskId: 'old-task',
          prompt: 'follow up'
        }, tmpProject);
        spawnMock = require('child_process').spawn;

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/session directory|symbolic link|outside/i);
      });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(outsideSession, 'debug.log'))).toBe(false);
    } finally {
      if (originalSharedServer === undefined) {
        delete process.env.SIDECAR_SHARED_SERVER;
      } else {
        process.env.SIDECAR_SHARED_SERVER = originalSharedServer;
      }
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

  test('resolveExactSessionFile rejects symlinked session files that escape the session directory', () => {
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-exact-session-'));
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-exact-outside-'));
    const externalSession = path.join(externalDir, 'target.jsonl');

    try {
      fs.writeFileSync(externalSession, '{"type":"user","message":{"content":"outside"}}\n');
      fs.symlinkSync(externalSession, path.join(sessionDir, 'escape.jsonl'));

      expect(() => resolveExactSessionFile(sessionDir, 'escape'))
        .toThrow(/outside|session directory/i);
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  });

  test('resolveExactSessionFile rejects exact session targets that are not regular files', () => {
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-exact-session-'));

    try {
      fs.mkdirSync(path.join(sessionDir, 'directory-session.jsonl'));

      expect(() => resolveExactSessionFile(sessionDir, 'directory-session'))
        .toThrow(/regular file/i);
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
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
