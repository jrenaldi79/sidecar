/**
 * CLI-to-Handler Integration Tests
 *
 * Tests that CLI commands dispatched through the real binary produce
 * correct filesystem state. Creates sessions on disk, runs the CLI
 * as a real process, and verifies outcomes. No mocks.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SIDECAR_BIN = path.join(__dirname, '..', 'bin', 'sidecar.js');
const NODE = process.execPath;

/** Helper: run sidecar CLI and return { stdout, stderr, code } */
function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...opts.env };
    execFile(NODE, [SIDECAR_BIN, ...args], { env, timeout: 10000, ...opts }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err ? err.code : 0,
      });
    });
  });
}

describe('CLI Handler Integration: list + read + abort workflow', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-handler-int-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full workflow: create session on disk -> list -> read -> abort', async () => {
    // Setup: create two sessions on disk
    const sessionsBase = path.join(tmpDir, '.claude', 'sidecar_sessions');

    const completeDir = path.join(sessionsBase, 'handler-complete-001');
    fs.mkdirSync(completeDir, { recursive: true });
    fs.writeFileSync(path.join(completeDir, 'metadata.json'), JSON.stringify({
      taskId: 'handler-complete-001', model: 'google/gemini-2.5-flash',
      status: 'complete', briefing: 'Completed analysis task',
      createdAt: '2026-03-04T12:00:00Z',
    }));
    fs.writeFileSync(path.join(completeDir, 'summary.md'),
      '## Analysis Complete\nFound 3 critical issues in auth module.');

    const runningDir = path.join(sessionsBase, 'handler-running-001');
    fs.mkdirSync(runningDir, { recursive: true });
    fs.writeFileSync(path.join(runningDir, 'metadata.json'), JSON.stringify({
      taskId: 'handler-running-001', model: 'openai/gpt-4o',
      status: 'running', briefing: 'Long-running code review',
      createdAt: '2026-03-04T13:00:00Z',
    }));

    // Step 1: List all sessions
    const listResult = await runCli(['list', '--cwd', tmpDir]);
    expect(listResult.code).toBe(0);
    expect(listResult.stdout).toContain('handler-complete-001');
    expect(listResult.stdout).toContain('handler-running-001');

    // Step 2: List with status filter
    const runningResult = await runCli(['list', '--cwd', tmpDir, '--status', 'running']);
    expect(runningResult.code).toBe(0);
    expect(runningResult.stdout).toContain('handler-running-001');
    expect(runningResult.stdout).not.toContain('handler-complete-001');

    // Step 3: Read summary of completed session
    const readResult = await runCli(['read', 'handler-complete-001', '--cwd', tmpDir]);
    expect(readResult.code).toBe(0);
    expect(readResult.stdout).toContain('Analysis Complete');
    expect(readResult.stdout).toContain('3 critical issues');

    // Step 4: Abort running session
    const abortResult = await runCli(['abort', 'handler-running-001', '--cwd', tmpDir]);
    expect(abortResult.code).toBe(0);

    // Step 5: Verify abort updated metadata on disk
    const meta = JSON.parse(fs.readFileSync(
      path.join(runningDir, 'metadata.json'), 'utf-8'
    ));
    expect(meta.status).toBe('aborted');
    expect(meta.abortedAt).toBeDefined();

    // Step 6: List again - should show aborted status
    const finalList = await runCli(['list', '--cwd', tmpDir, '--status', 'running']);
    expect(finalList.code).toBe(0);
    // No more running sessions
    expect(finalList.stdout).not.toContain('handler-running-001');
  });

  it('read with --conversation flag shows conversation data', async () => {
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'conv-test-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'conv-test-001', model: 'gemini', status: 'complete',
      createdAt: '2026-03-04T00:00:00Z',
    }));
    fs.writeFileSync(path.join(sessDir, 'summary.md'), 'Summary text here');
    fs.writeFileSync(path.join(sessDir, 'conversation.jsonl'),
      '{"role":"user","content":"Debug the auth bug"}\n' +
      '{"role":"assistant","content":"Found the issue in token.js"}\n'
    );

    // Default read returns summary
    const summaryResult = await runCli(['read', 'conv-test-001', '--cwd', tmpDir]);
    expect(summaryResult.stdout).toContain('Summary text here');

    // --conversation returns conversation
    const convResult = await runCli(['read', 'conv-test-001', '--cwd', tmpDir, '--conversation']);
    expect(convResult.stdout).toContain('Debug the auth bug');
    expect(convResult.stdout).toContain('Found the issue');
  });

  it('list --json outputs valid JSON array', async () => {
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'json-test-001');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'json-test-001', model: 'gemini', status: 'complete',
      briefing: 'JSON output test', createdAt: '2026-03-04T00:00:00Z',
    }));

    const { stdout, code } = await runCli(['list', '--cwd', tmpDir, '--json']);
    expect(code).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].id).toBe('json-test-001');
    expect(parsed[0].status).toBe('complete');
  });

  it('abort does not affect other sessions', async () => {
    const sessionsBase = path.join(tmpDir, '.claude', 'sidecar_sessions');

    // Create two running sessions
    for (const id of ['keep-running', 'to-abort']) {
      const dir = path.join(sessionsBase, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
        taskId: id, model: 'gemini', status: 'running',
        briefing: `Task ${id}`, createdAt: '2026-03-04T00:00:00Z',
      }));
    }

    // Abort only one
    await runCli(['abort', 'to-abort', '--cwd', tmpDir]);

    // Verify the other is still running
    const keepMeta = JSON.parse(fs.readFileSync(
      path.join(sessionsBase, 'keep-running', 'metadata.json'), 'utf-8'
    ));
    expect(keepMeta.status).toBe('running');

    const abortMeta = JSON.parse(fs.readFileSync(
      path.join(sessionsBase, 'to-abort', 'metadata.json'), 'utf-8'
    ));
    expect(abortMeta.status).toBe('aborted');
  });

  it('read returns error for nonexistent session', async () => {
    const { stderr, code } = await runCli(['read', 'ghost-task', '--cwd', tmpDir]);
    // readSidecar throws for missing sessions, caught in main() -> exit(1)
    expect(code).toBe(1);
    expect(stderr.toLowerCase()).toMatch(/not found|no.*session/);
  });
});

describe('CLI Handler Integration: path traversal safety', () => {
  it('rejects path traversal in task ID for abort', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-safety-'));
    try {
      const { stderr, code } = await runCli(['abort', '../../../etc', '--cwd', tmpDir]);
      expect(code).toBe(1);
      // Should reject before any filesystem operation
      expect(stderr.toLowerCase()).toMatch(/invalid|traversal|task/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects path traversal in task ID for read', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-safety-'));
    try {
      const { stderr, code } = await runCli(['read', '../../../etc', '--cwd', tmpDir]);
      expect(code).toBe(1);
      expect(stderr.toLowerCase()).toMatch(/invalid|traversal|task/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
