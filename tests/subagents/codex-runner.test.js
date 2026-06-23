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

  function writeParentMetadata() {
    fs.writeFileSync(
      path.join(projectDir, '.claude', 'sidecar_sessions', 'parent-task', 'metadata.json'),
      JSON.stringify({
        taskId: 'parent-task',
        project: fs.realpathSync(projectDir),
        projectDir: fs.realpathSync(projectDir),
        status: 'running'
      })
    );
  }

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
    writeParentMetadata();

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
        execFile: jest.fn((cmd, args, options, cb) => {
          const callback = typeof options === 'function' ? options : cb;
          callback(null, '', '');
        }),
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

  test('spawns codex with sanitized env instead of inheriting ambient secrets', async () => {
    const originalEnv = { ...process.env };
    let capturedEnv;
    writeParentMetadata();

    try {
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
      process.env.OPENAI_API_KEY = 'openai-secret';
      process.env.ANTHROPIC_API_KEY = 'anthropic-secret';
      process.env.SIDECAR_ENV_DIR = path.join(os.tmpdir(), 'sidecar-env-dir');

      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn((cmd, args, options) => {
            capturedEnv = options.env;
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.stdin = { end: jest.fn() };
            process.nextTick(() => child.emit('close', 1));
            return child;
          }),
          execFile: jest.fn((cmd, args, options, cb) => {
            const callback = typeof options === 'function' ? options : cb;
            callback(null, '', '');
          }),
        }));

        const { runCodexSubagent } = require('../../src/subagents/codex-runner');
        await runCodexSubagent({
          projectDir,
          parentTaskId: 'parent-task',
          subagentId: 'subagent-env',
          briefing: 'Inspect auth flow',
          agentType: 'explore'
        });
      });

      expect(capturedEnv).toBeDefined();
      expect(capturedEnv.PATH).toBe(process.env.PATH);
      expect(capturedEnv.HOME).toBe(process.env.HOME);
      expect(capturedEnv.SIDECAR_ENV_DIR).toBe(process.env.SIDECAR_ENV_DIR);
      expect(capturedEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(capturedEnv.OPENAI_API_KEY).toBeUndefined();
      expect(capturedEnv.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      process.env = originalEnv;
    }
  });

  test('checks codex availability with sanitized env instead of ambient secrets', async () => {
    const originalEnv = { ...process.env };
    let capturedOptions;

    try {
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
      process.env.OPENAI_API_KEY = 'openai-secret';
      process.env.SIDECAR_ENV_DIR = path.join(os.tmpdir(), 'sidecar-env-dir');

      await jest.isolateModulesAsync(async () => {
        jest.doMock('child_process', () => ({
          spawn: jest.fn(),
          execFile: jest.fn((_cmd, _args, options, cb) => {
            capturedOptions = options;
            const callback = typeof options === 'function' ? options : cb;
            callback(null, '', '');
          }),
        }));

        const { assertCodexAvailable } = require('../../src/subagents/codex-runner');
        await assertCodexAvailable();
      });

      expect(capturedOptions).toEqual(expect.objectContaining({
        env: expect.any(Object)
      }));
      expect(capturedOptions.env.PATH).toBe(process.env.PATH);
      expect(capturedOptions.env.SIDECAR_ENV_DIR).toBe(process.env.SIDECAR_ENV_DIR);
      expect(capturedOptions.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(capturedOptions.env.OPENAI_API_KEY).toBeUndefined();
    } finally {
      process.env = originalEnv;
    }
  });

  test('rejects parent session directories without metadata', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdin = { end: jest.fn() };
          return child;
        }),
        execFile: jest.fn((cmd, args, options, cb) => {
          const callback = typeof options === 'function' ? options : cb;
          callback(null, '', '');
        }),
      }));

      const { startCodexSubagent } = require('../../src/subagents/codex-runner');
      await expect(startCodexSubagent({
        projectDir,
        parentTaskId: 'parent-task',
        subagentId: 'subagent-no-parent-metadata',
        briefing: 'Inspect auth flow',
        agentType: 'explore'
      })).rejects.toThrow(/metadata|parent session/i);
    });
  });

  test('writes summary.md and marks metadata complete on a successful final event', async () => {
    writeParentMetadata();

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
        execFile: jest.fn((cmd, args, options, cb) => {
          const callback = typeof options === 'function' ? options : cb;
          callback(null, '', '');
        }),
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
    writeParentMetadata();

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
        execFile: jest.fn((cmd, args, options, cb) => {
          const callback = typeof options === 'function' ? options : cb;
          callback(null, '', '');
        }),
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

  test('does not append codex stderr through a symlinked stderr log', async () => {
    writeParentMetadata();
    const outsideTarget = path.join(tempDir, 'outside-codex-stderr.log');
    fs.writeFileSync(outsideTarget, 'outside-original');

    await jest.isolateModulesAsync(async () => {
      jest.doMock('child_process', () => ({
        spawn: jest.fn(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdin = { end: jest.fn() };
          process.nextTick(() => {
            const stderrPath = path.join(
              projectDir,
              '.claude',
              'sidecar_sessions',
              'parent-task',
              'subagents',
              'subagent-stderr-symlink',
              'codex-stderr.log'
            );
            fs.symlinkSync(outsideTarget, stderrPath);
            child.stderr.emit('data', Buffer.from('codex failed'));
            child.emit('close', 1);
          });
          return child;
        }),
        execFile: jest.fn((cmd, args, options, cb) => {
          const callback = typeof options === 'function' ? options : cb;
          callback(null, '', '');
        }),
      }));

      const { runCodexSubagent } = require('../../src/subagents/codex-runner');
      await runCodexSubagent({
        projectDir,
        parentTaskId: 'parent-task',
        subagentId: 'subagent-stderr-symlink',
        briefing: 'Fix auth flow',
        agentType: 'build'
      });
    });

    const metadataPath = path.join(
      projectDir,
      '.claude',
      'sidecar_sessions',
      'parent-task',
      'subagents',
      'subagent-stderr-symlink',
      'metadata.json'
    );

    expect(fs.readFileSync(outsideTarget, 'utf-8')).toBe('outside-original');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.status).toBe('error');
    expect(metadata.reason).toContain('codex failed');
  });
});
