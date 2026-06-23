const os = require('os');
const fs = require('fs');
const path = require('path');

describe('getProjectDir', () => {
  const repoRoot = fs.realpathSync(path.resolve(__dirname, '..'));
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns explicit project path when it is under the current repo root', () => {
    const { getProjectDir } = require('../src/mcp-server');
    const result = getProjectDir(path.join(repoRoot, 'src'));
    expect(result).toBe(fs.realpathSync(path.join(repoRoot, 'src')));
  });

  test('ignores explicit project path when directory does not exist', () => {
    const { getProjectDir } = require('../src/mcp-server');
    const result = getProjectDir('/nonexistent/path/that/does/not/exist');
    expect(result).not.toBe('/nonexistent/path/that/does/not/exist');
  });

  test('rejects cwd root instead of falling back to $HOME', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/';
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      expect(() => getProjectDir()).toThrow(/unsafe/i);
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('uses cwd when it is the current repo root', () => {
    const originalCwd = process.cwd;
    process.cwd = () => repoRoot;
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir();
      expect(result).toBe(repoRoot);
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('rejects $HOME by default', () => {
    const { getProjectDir } = require('../src/mcp-server');
    expect(() => getProjectDir(os.homedir())).toThrow(/unsafe|not allowed/i);
  });

  test('rejects root when no explicit project and cwd is root', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/';
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      expect(() => getProjectDir(undefined)).toThrow(/unsafe/i);
    } finally {
      process.cwd = originalCwd;
    }
  });
});

describe('MCP handler dispatch passes input.project', () => {
  test('sidecar_list uses input.project when provided', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proj-'));
    const originalAllowedRoots = process.env.SIDECAR_ALLOWED_ROOTS;
    process.env.SIDECAR_ALLOWED_ROOTS = tmpDir;
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'test1');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'test1', status: 'complete', model: 'gemini',
      createdAt: new Date().toISOString(),
    }));

    try {
      const { handlers } = require('../src/mcp-server');
      // Pass project via input (simulating MCP tool call with no 2nd arg)
      const result = await handlers.sidecar_list({ project: tmpDir });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('test1');
    } finally {
      process.env.SIDECAR_ALLOWED_ROOTS = originalAllowedRoots;
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('sidecar_status uses input.project when no 2nd arg', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proj-'));
    const originalAllowedRoots = process.env.SIDECAR_ALLOWED_ROOTS;
    process.env.SIDECAR_ALLOWED_ROOTS = tmpDir;
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'stat1');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'stat1', status: 'running', model: 'gemini',
      createdAt: new Date().toISOString(),
    }));

    try {
      const { handlers } = require('../src/mcp-server');
      const result = await handlers.sidecar_status({ taskId: 'stat1', project: tmpDir });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe('stat1');
      expect(parsed.status).toBe('running');
    } finally {
      process.env.SIDECAR_ALLOWED_ROOTS = originalAllowedRoots;
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
