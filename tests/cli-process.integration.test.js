/**
 * CLI Process Integration Tests
 *
 * Spawns the actual `node bin/sidecar.js` binary and asserts on
 * exit codes, stdout, and stderr. No mocks — tests the real CLI entry point.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SIDECAR_BIN = path.join(__dirname, '..', 'bin', 'sidecar.js');
const NODE = process.execPath;
const VERSION = require('../package.json').version;

/** Helper: run sidecar CLI and return { stdout, stderr, code } */
function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const { env: extraEnv, ...execOpts } = opts;
    const env = { ...process.env, ...extraEnv };
    execFile(NODE, [SIDECAR_BIN, ...args], { env, timeout: 10000, ...execOpts }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err ? err.code : 0,
      });
    });
  });
}

describe('CLI Process: --version', () => {
  it('prints version and exits 0', async () => {
    const { stdout, code } = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toContain(`claude-sidecar v${VERSION}`);
  });
});

describe('CLI Process: --help', () => {
  it('prints usage text and exits 0', async () => {
    const { stdout, code } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('start');
    expect(stdout).toContain('list');
    expect(stdout).toContain('read');
    expect(stdout).toContain('mcp');
  });

  it('prints usage when no command given', async () => {
    const { stdout, code } = await runCli([]);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
  });
});

describe('CLI Process: unknown command', () => {
  it('exits 1 with error message', async () => {
    const { stderr, code } = await runCli(['bogus-command']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown command');
  });
});

describe('CLI Process: start validation errors', () => {
  it('exits 1 when --prompt is missing', async () => {
    const { stderr, code } = await runCli(['start', '--model', 'google/gemini-2.5-flash'], {
      env: { OPENROUTER_API_KEY: 'test', GEMINI_API_KEY: 'test' },
    });
    expect(code).toBe(1);
    expect(stderr).toContain('--prompt');
  });

  it('exits 1 when model format is invalid', async () => {
    const { stderr, code } = await runCli(['start', '--model', 'badmodel', '--prompt', 'test'], {
      env: { OPENROUTER_API_KEY: 'test' },
    });
    expect(code).toBe(1);
    // resolveModel rejects unknown aliases before format validation
    expect(stderr.toLowerCase()).toMatch(/unknown model|provider\/model|alias/);
  });
});

describe('CLI Process: list with empty project', () => {
  it('shows no sessions message for a fresh temp directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    try {
      const { stdout, code } = await runCli(['list', '--cwd', tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain('No sidecar sessions');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('CLI Process: list with sessions on disk', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'integ-test-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'integ-test-001',
      model: 'google/gemini-2.5-flash',
      status: 'complete',
      briefing: 'Integration test task',
      createdAt: '2026-03-04T00:00:00Z',
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists sessions from the project directory', async () => {
    const { stdout, code } = await runCli(['list', '--cwd', tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain('integ-test-001');
    expect(stdout).toContain('complete');
  });

  it('outputs JSON when --json flag is used', async () => {
    const { stdout, code } = await runCli(['list', '--cwd', tmpDir, '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe('integ-test-001');
  });

  it('filters by status', async () => {
    // Add a running session
    const runDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'integ-test-002');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify({
      taskId: 'integ-test-002', model: 'openai/gpt-4o', status: 'running',
      briefing: 'Running task', createdAt: '2026-03-04T01:00:00Z',
    }));

    const { stdout, code } = await runCli(['list', '--cwd', tmpDir, '--status', 'running']);
    expect(code).toBe(0);
    expect(stdout).toContain('integ-test-002');
    expect(stdout).not.toContain('integ-test-001');
  });
});

describe('CLI Process: read command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'read-test-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'read-test-001', model: 'gemini', status: 'complete',
      createdAt: '2026-03-04T00:00:00Z',
    }));
    fs.writeFileSync(path.join(sessDir, 'summary.md'), '## Auth Bug Fix\nFixed the token refresh race condition.');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 1 when task_id is missing', async () => {
    const { stderr, code } = await runCli(['read']);
    expect(code).toBe(1);
    expect(stderr).toContain('task_id is required');
  });

  it('reads summary for a valid task', async () => {
    const { stdout, code } = await runCli(['read', 'read-test-001', '--cwd', tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain('Auth Bug Fix');
    expect(stdout).toContain('token refresh');
  });
});

describe('CLI Process: abort command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-cli-int-'));
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'abort-integ-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'abort-integ-001', model: 'gemini', status: 'running',
      briefing: 'Task to abort', createdAt: '2026-03-04T00:00:00Z',
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 1 when task_id is missing', async () => {
    const { stderr, code } = await runCli(['abort']);
    expect(code).toBe(1);
    expect(stderr).toContain('task_id is required');
  });

  it('aborts a running session and updates metadata on disk', async () => {
    const { stdout, code } = await runCli(['abort', 'abort-integ-001', '--cwd', tmpDir]);
    expect(code).toBe(0);
    expect(stdout).toContain('aborted');

    // Verify metadata was updated on disk
    const meta = JSON.parse(fs.readFileSync(
      path.join(tmpDir, '.claude', 'sidecar_sessions', 'abort-integ-001', 'metadata.json'), 'utf-8'
    ));
    expect(meta.status).toBe('aborted');
    expect(meta.abortedAt).toBeDefined();
  });

  it('exits 1 for nonexistent session', async () => {
    const { stderr, code } = await runCli(['abort', 'nonexistent', '--cwd', tmpDir]);
    expect(code).toBe(1);
    expect(stderr).toContain('not found');
  });
});

describe('CLI Process: resume/continue validation', () => {
  it('resume exits 1 without task_id', async () => {
    const { stderr, code } = await runCli(['resume']);
    expect(code).toBe(1);
    expect(stderr).toContain('task_id is required');
  });

  it('continue exits 1 without task_id', async () => {
    const { stderr, code } = await runCli(['continue']);
    expect(code).toBe(1);
    expect(stderr).toContain('task_id is required');
  });

  it('continue exits 1 without --prompt', async () => {
    const { stderr, code } = await runCli(['continue', 'some-task']);
    expect(code).toBe(1);
    expect(stderr).toContain('--prompt');
  });
});
