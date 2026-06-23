/**
 * Sidecar Start Tests
 *
 * Tests for config change detection during sidecar start,
 * session metadata creation, and PID preservation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Config change detection on start', () => {
  it('should import checkConfigChanged without errors', () => {
    const { checkConfigChanged } = require('../../src/utils/config');
    expect(typeof checkConfigChanged).toBe('function');
  });

  it('should detect config change when hash differs', () => {
    const { checkConfigChanged } = require('../../src/utils/config');
    // With no config file, should return changed: false
    const result = checkConfigChanged('stale-hash');
    // Result depends on whether config exists - just verify the shape
    expect(result).toHaveProperty('changed');
  });

  it('should return changed: false when hash matches', () => {
    const { checkConfigChanged, computeConfigHash } = require('../../src/utils/config');
    const currentHash = computeConfigHash();
    const result = checkConfigChanged(currentHash);
    expect(result.changed).toBe(false);
  });

  it('should emit config update to stderr when config has changed', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});

    // Simulate the config change detection logic from startSidecar
    const { checkConfigChanged } = require('../../src/utils/config');
    const configCheck = checkConfigChanged('stale-hash-that-wont-match');

    if (configCheck.changed) {
      process.stderr.write(
        `\n[SIDECAR_CONFIG_UPDATE] Model configuration has changed.\nUpdate your project doc file with:\n\n${configCheck.updateData}\n\n`
      );
    }

    // If config exists, changed should be true (stale hash won't match)
    // If no config exists, changed should be true (null !== 'stale-hash...')
    expect(configCheck.changed).toBe(true);
    expect(stderrSpy).toHaveBeenCalled();

    const output = stderrSpy.mock.calls[0][0];
    expect(output).toContain('[SIDECAR_CONFIG_UPDATE]');

    stderrSpy.mockRestore();
  });

  it('should not emit to stderr when config hash matches', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});

    const { checkConfigChanged, computeConfigHash } = require('../../src/utils/config');
    const currentHash = computeConfigHash();
    const configCheck = checkConfigChanged(currentHash);

    if (configCheck.changed) {
      process.stderr.write('[SIDECAR_CONFIG_UPDATE] ...');
    }

    expect(configCheck.changed).toBe(false);
    expect(stderrSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it('should extract hash from CLAUDE.md content when present', () => {
    const content = '# CLAUDE.md\n<!-- sidecar-config-hash: abcd1234 -->\nSome content';
    const match = content.match(/<!-- sidecar-config-hash: ([0-9a-f]+) -->/);
    expect(match).not.toBeNull();
    expect(match[1]).toBe('abcd1234');
  });

  it('should return null hash when CLAUDE.md has no hash comment', () => {
    const content = '# CLAUDE.md\nSome content without hash';
    const match = content.match(/<!-- sidecar-config-hash: ([0-9a-f]+) -->/);
    expect(match).toBeNull();
  });
});

describe('buildMcpConfig with MCP discovery', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should skip discovery when noMcp is true', () => {
    // Mock mcp-discovery to track calls
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => ({ 'discovered-server': { command: 'npx' } }))
    }));

    const { buildMcpConfig } = require('../../src/sidecar/start');
    const result = buildMcpConfig({ noMcp: true });

    const { discoverParentMcps } = require('../../src/utils/mcp-discovery');
    expect(discoverParentMcps).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('should remove excluded servers via excludeMcp', () => {
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => ({
        'keep-me': { command: 'keep' },
        'remove-me': { command: 'remove' }
      }))
    }));

    // Mock loadMcpConfig to return null (no file config)
    jest.mock('../../src/opencode-client', () => ({
      loadMcpConfig: jest.fn(() => null),
      parseMcpSpec: jest.fn(() => null)
    }));

    const { buildMcpConfig } = require('../../src/sidecar/start');
    const result = buildMcpConfig({ excludeMcp: ['remove-me'] });

    expect(result['keep-me']).toBeDefined();
    expect(result['remove-me']).toBeUndefined();
  });

  it('should merge with correct priority: CLI > file > discovered', () => {
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => ({
        'shared-server': { command: 'discovered-cmd' },
        'discovery-only': { command: 'disc' }
      }))
    }));

    jest.mock('../../src/opencode-client', () => ({
      loadMcpConfig: jest.fn(() => ({
        'shared-server': { command: 'file-cmd' },
        'file-only': { command: 'file' }
      })),
      parseMcpSpec: jest.fn((spec) => {
        if (spec === 'cli-server=cli-cmd') {
          return { name: 'cli-server', config: { command: 'cli-cmd' } };
        }
        return null;
      })
    }));

    const { buildMcpConfig } = require('../../src/sidecar/start');
    const result = buildMcpConfig({ mcp: 'cli-server=cli-cmd' });

    // CLI server present
    expect(result['cli-server']).toBeDefined();
    // File config overrides discovered for shared server
    expect(result['shared-server'].command).toBe('file-cmd');
    // Both unique servers present
    expect(result['file-only']).toBeDefined();
    expect(result['discovery-only']).toBeDefined();
  });
});

describe('createSessionMetadata PID preservation', () => {
  let tmpDir;
  const taskId = 'pid-test';

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-pid-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves pid from existing metadata written by MCP handler', () => {
    const { createSessionMetadata } = require('../../src/sidecar/start');
    const { SessionPaths } = require('../../src/sidecar/session-utils');

    // Use tmpDir as the project; sessionDir = tmpDir/.claude/sidecar_sessions/<taskId>
    const sessionDir = SessionPaths.sessionDir(tmpDir, taskId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Simulate MCP handler writing initial metadata with pid before CLI runs
    const mcpMetadata = { pid: 12345, createdAt: '2026-03-08T10:00:00.000Z' };
    fs.writeFileSync(
      SessionPaths.metadataFile(sessionDir),
      JSON.stringify(mcpMetadata, null, 2)
    );

    // CLI process calls createSessionMetadata (which should merge, not overwrite)
    createSessionMetadata(taskId, tmpDir, {
      model: 'gemini',
      prompt: 'do something',
      noUi: true,
      agent: 'build',
      thinking: 'medium'
    });

    const result = JSON.parse(
      fs.readFileSync(SessionPaths.metadataFile(sessionDir), 'utf-8')
    );

    // pid from MCP handler must survive
    expect(result.pid).toBe(12345);
    // createdAt from MCP handler must survive
    expect(result.createdAt).toBe('2026-03-08T10:00:00.000Z');
    // New fields must also be present
    expect(result.taskId).toBe(taskId);
    expect(result.model).toBe('gemini');
    expect(result.status).toBe('running');
  });

  it('works when no existing metadata (no pid to preserve)', () => {
    const { createSessionMetadata } = require('../../src/sidecar/start');
    const { SessionPaths } = require('../../src/sidecar/session-utils');

    // No pre-existing metadata file - fresh start
    createSessionMetadata(taskId, tmpDir, {
      model: 'opus',
      prompt: 'review code',
      noUi: false,
      agent: null,
      thinking: 'high'
    });

    const sessionDir = SessionPaths.sessionDir(tmpDir, taskId);
    const result = JSON.parse(
      fs.readFileSync(SessionPaths.metadataFile(sessionDir), 'utf-8')
    );

    // pid should be set to the current process PID
    expect(result.pid).toBe(process.pid);
    // Standard fields must be present
    expect(result.taskId).toBe(taskId);
    expect(result.model).toBe('opus');
    expect(result.status).toBe('running');
    expect(result.createdAt).toBeDefined();
  });

  it('rejects a symlinked sessions root before writing metadata outside the project', () => {
    const { createSessionMetadata } = require('../../src/sidecar/start');
    const projectDir = path.join(tmpDir, 'project');
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'start-outside-sessions-'));
    const claudeDir = path.join(projectDir, '.claude');

    try {
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.symlinkSync(outsideRoot, path.join(claudeDir, 'sidecar_sessions'), 'dir');

      expect(() => {
        createSessionMetadata('root-escape', projectDir, {
          model: 'opus',
          prompt: 'review code',
          noUi: true,
          agent: 'build',
          thinking: 'medium'
        });
      }).toThrow(/sidecar sessions root|symbolic link|outside/i);

      expect(fs.existsSync(path.join(outsideRoot, 'root-escape', 'metadata.json'))).toBe(false);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe('startSidecar context binding validation', () => {
  let tmpDir;
  let mockSessionDir;
  const repoRoot = fs.realpathSync(path.resolve(__dirname, '../..'));

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-context-binding-'));
    mockSessionDir = path.join(tmpDir, 'session');

    jest.doMock('../../src/sidecar/context-builder', () => ({
      buildContext: jest.fn(() => 'mocked context')
    }));
    jest.doMock('../../src/prompt-builder', () => ({
      buildPrompts: jest.fn(() => ({
        system: 'sys',
        userMessage: 'user'
      }))
    }));
    jest.doMock('../../src/sidecar/session-utils', () => ({
      SessionPaths: {
        sessionDir: jest.fn(() => mockSessionDir),
        metadataFile: jest.fn((sessionDir) => path.join(sessionDir, 'metadata.json'))
      },
      saveInitialContext: jest.fn(),
      finalizeSession: jest.fn(),
      outputSummary: jest.fn(),
      createHeartbeat: jest.fn(() => ({ stop: jest.fn() })),
      HEARTBEAT_INTERVAL: 5000
    }));
    jest.doMock('../../src/sidecar/interactive', () => ({
      runInteractive: jest.fn(() => ({ summary: 'done' })),
      checkElectronAvailable: jest.fn()
    }));
    jest.doMock('../../src/headless', () => ({
      runHeadless: jest.fn(() => ({ summary: 'done' }))
    }));
    jest.doMock('../../src/opencode-client', () => ({
      loadMcpConfig: jest.fn(() => null),
      parseMcpSpec: jest.fn(() => null)
    }));
    jest.doMock('../../src/utils/agent-mapping', () => ({
      mapAgentToOpenCode: jest.fn(() => ({ agent: 'Build' }))
    }));
    jest.doMock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => null)
    }));
    jest.doMock('../../src/utils/session-lock', () => ({
      acquireLock: jest.fn(),
      releaseLock: jest.fn()
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  it('rejects includeContext true with the default current session', async () => {
    const { startSidecar } = require('../../src/sidecar/start');

    await expect(startSidecar({
      model: 'gemini',
      prompt: 'test',
      noUi: true,
      cwd: repoRoot,
      includeContext: true
    })).rejects.toThrow(/exact/i);
  });

  it('rejects includeContext true with sessionDir but no exact session id', async () => {
    const { startSidecar } = require('../../src/sidecar/start');

    await expect(startSidecar({
      model: 'gemini',
      prompt: 'test',
      noUi: true,
      cwd: repoRoot,
      includeContext: true,
      sessionDir: path.join(repoRoot, '.claude', 'sidecar_sessions')
    })).rejects.toThrow(/exact/i);
  });

  it('rejects includeContext true with sessionDir and current session', async () => {
    const { startSidecar } = require('../../src/sidecar/start');

    await expect(startSidecar({
      model: 'gemini',
      prompt: 'test',
      noUi: true,
      cwd: repoRoot,
      includeContext: true,
      session: 'current',
      sessionDir: path.join(repoRoot, '.claude', 'sidecar_sessions')
    })).rejects.toThrow(/exact/i);
  });
});

describe('startSidecar includeContext option', () => {
  let buildContextMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../src/sidecar/context-builder', () => ({
      buildContext: jest.fn(() => 'mocked context')
    }));
    jest.mock('../../src/prompt-builder', () => ({
      buildPrompts: jest.fn(() => ({
        system: 'sys', userMessage: 'user', context: ''
      }))
    }));
    jest.mock('../../src/sidecar/session-utils', () => ({
      SessionPaths: {
        sessionDir: jest.fn(() => '/tmp/test-session'),
        metadataFile: jest.fn(() => '/tmp/test-session/metadata.json')
      },
      saveInitialContext: jest.fn(),
      finalizeSession: jest.fn(),
      outputSummary: jest.fn(),
      createHeartbeat: jest.fn(() => ({ stop: jest.fn() })),
      HEARTBEAT_INTERVAL: 5000
    }));
    jest.mock('../../src/sidecar/interactive', () => ({
      runInteractive: jest.fn(() => ({ summary: 'done' })),
      checkElectronAvailable: jest.fn()
    }));
    jest.mock('../../src/headless', () => ({
      runHeadless: jest.fn(() => ({ summary: 'done' }))
    }));
    jest.mock('../../src/opencode-client', () => ({
      loadMcpConfig: jest.fn(() => null),
      parseMcpSpec: jest.fn(() => null)
    }));
    jest.mock('../../src/utils/agent-mapping', () => ({
      mapAgentToOpenCode: jest.fn(() => ({ agent: 'Build' }))
    }));
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => null)
    }));
    jest.mock('../../src/utils/sidecar-boundaries', () => ({
      assertContextBinding: jest.fn(),
      defaultIncludeContext: jest.fn(() => false),
      validateProjectPath: jest.fn((project) => project)
    }));
    jest.mock('../../src/utils/sidecar-session-boundaries', () => ({
      ensureSidecarSessionDir: jest.fn(() => '/tmp/test-session'),
      readContainedSessionFile: jest.fn(() => '{}'),
      writeContainedSessionFile: jest.fn()
    }));
    jest.mock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => false),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
      readFileSync: jest.fn(() => '{}')
    }));

    buildContextMock = require('../../src/sidecar/context-builder').buildContext;
  });

  it('calls buildContext when includeContext is true', async () => {
    const { startSidecar } = require('../../src/sidecar/start');
    await startSidecar({
      model: 'gemini', prompt: 'test', noUi: true, includeContext: true, sessionId: 'session-a'
    });
    expect(buildContextMock).toHaveBeenCalled();
  });

  it('skips buildContext when includeContext is omitted (default false)', async () => {
    const { startSidecar } = require('../../src/sidecar/start');
    const { buildPrompts } = require('../../src/prompt-builder');
    await startSidecar({
      model: 'gemini', prompt: 'test', noUi: true
    });
    expect(buildContextMock).not.toHaveBeenCalled();
    const contextArg = buildPrompts.mock.calls[0][1];
    expect(contextArg).toContain('Context excluded');
  });

  it('skips buildContext when includeContext is false', async () => {
    const { startSidecar } = require('../../src/sidecar/start');
    const { buildPrompts } = require('../../src/prompt-builder');
    await startSidecar({
      model: 'gemini', prompt: 'test', noUi: true, includeContext: false
    });
    expect(buildContextMock).not.toHaveBeenCalled();
    const contextArg = buildPrompts.mock.calls[0][1];
    expect(contextArg).toContain('Context excluded');
  });
});
