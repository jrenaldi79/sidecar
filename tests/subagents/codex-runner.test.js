'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('codex-runner', () => {
  let tempDir;
  let projectDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-codex-runner-'));
    projectDir = tempDir;
    fs.mkdirSync(path.join(projectDir, '.claude', 'sidecar_sessions', 'parent-task'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('maps plan to read-only sandbox', () => {
    const { resolveSandboxMode } = require('../../src/subagents/codex-runner');
    expect(resolveSandboxMode('plan')).toBe('read-only');
  });

  test('maps explore to read-only sandbox', () => {
    const { resolveSandboxMode } = require('../../src/subagents/codex-runner');
    expect(resolveSandboxMode('explore')).toBe('read-only');
  });

  test('maps build to workspace-write sandbox', () => {
    const { resolveSandboxMode } = require('../../src/subagents/codex-runner');
    expect(resolveSandboxMode('build')).toBe('workspace-write');
  });

  test('maps general to workspace-write sandbox', () => {
    const { resolveSandboxMode } = require('../../src/subagents/codex-runner');
    expect(resolveSandboxMode('general')).toBe('workspace-write');
  });

  test('rejects chat because codex exec is non-interactive', () => {
    const { resolveSandboxMode } = require('../../src/subagents/codex-runner');
    expect(() => resolveSandboxMode('chat')).toThrow(/interactive chat/i);
  });

  test('prepends the expected role adder to the briefing', () => {
    const { addRolePreamble } = require('../../src/subagents/codex-runner');
    expect(addRolePreamble('plan', 'Check auth race')).toContain('ROLE: Plan.');
    expect(addRolePreamble('build', 'Fix auth race')).toContain('ROLE: Build.');
  });

  test('spawns codex exec with the expected args for explore', async () => {
    let capturedArgs;

    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn((cmd, args) => {
          capturedArgs = [cmd, ...args];
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdin = { end: jest.fn() };
          process.nextTick(() => child.emit('close', 1));
          return child;
        }),
        execFile: jest.fn((cmd, args, cb) => cb(null, '', '')),
      }));

      jest.doMock('readline', () => ({
        createInterface: jest.fn(() => ({
          [Symbol.asyncIterator]: async function* () {}
        }))
      }));

      const { runCodexSubagent } = require('../../src/subagents/codex-runner');
      await runCodexSubagent({
        projectDir,
        parentTaskId: 'parent-task',
        subagentId: 'subagent-1',
        briefing: 'Inspect auth flow',
        agentType: 'explore'
      });
    });

    expect(capturedArgs).toEqual(expect.arrayContaining([
      'codex', 'exec', '--json', '--sandbox', 'read-only', '-C', fs.realpathSync(projectDir), '-'
    ]));
  });

  test('writes summary.md and marks metadata complete on a successful final event', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdin = { end: jest.fn() };
          process.nextTick(() => {
            child.stdout.emit('data', Buffer.from('{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}\n'));
            child.emit('close', 0);
          });
          return child;
        }),
        execFile: jest.fn((cmd, args, cb) => cb(null, '', '')),
      }));

      const { runCodexSubagent } = require('../../src/subagents/codex-runner');
      await runCodexSubagent({
        projectDir,
        parentTaskId: 'parent-task',
        subagentId: 'subagent-2',
        briefing: 'Inspect auth flow',
        agentType: 'plan'
      });
    });

    const summaryPath = path.join(
      projectDir, '.claude', 'sidecar_sessions', 'parent-task', 'subagents', 'subagent-2', 'summary.md'
    );
    const metadataPath = path.join(
      projectDir, '.claude', 'sidecar_sessions', 'parent-task', 'subagents', 'subagent-2', 'metadata.json'
    );

    expect(fs.readFileSync(summaryPath, 'utf-8')).toContain('done');
    expect(JSON.parse(fs.readFileSync(metadataPath, 'utf-8')).status).toBe('complete');
  });

  test('marks metadata error when codex exits non-zero', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdin = { end: jest.fn() };
          process.nextTick(() => {
            child.stderr.emit('data', Buffer.from('codex failed'));
            child.emit('close', 1);
          });
          return child;
        }),
        execFile: jest.fn((cmd, args, cb) => cb(null, '', '')),
      }));

      const { runCodexSubagent } = require('../../src/subagents/codex-runner');
      await runCodexSubagent({
        projectDir,
        parentTaskId: 'parent-task',
        subagentId: 'subagent-3',
        briefing: 'Fix auth flow',
        agentType: 'build'
      });
    });

    const metadataPath = path.join(
      projectDir, '.claude', 'sidecar_sessions', 'parent-task', 'subagents', 'subagent-3', 'metadata.json'
    );

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.status).toBe('error');
    expect(metadata.reason).toContain('codex failed');
  });
});
