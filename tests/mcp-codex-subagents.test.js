'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('codex subagent MCP handlers', () => {
  let tempDir;
  let projectDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-codex-subagent-'));
    projectDir = tempDir;
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('start returns subagentId and running status', async () => {
    const runnerMock = jest.fn();

    await jest.isolateModulesAsync(async () => {
      jest.doMock('../src/subagents/codex-runner', () => ({
        startCodexSubagent: runnerMock
      }));

      const parentDir = path.join(projectDir, '.claude', 'sidecar_sessions', 'parent123');
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(path.join(parentDir, 'metadata.json'), JSON.stringify({
        taskId: 'parent123',
        status: 'running',
        createdAt: new Date().toISOString()
      }));

      const { handlers } = require('../src/mcp-server');
      const result = await handlers.sidecar_subagent_start({
        parentTaskId: 'parent123',
        prompt: 'Inspect auth flow',
        agentType: 'explore'
      }, projectDir);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.parentTaskId).toBe('parent123');
      expect(parsed.subagentId).toBeTruthy();
      expect(parsed.status).toBe('running');
      expect(parsed.backend).toBe('codex');
      expect(runnerMock).toHaveBeenCalledWith(expect.objectContaining({
        projectDir,
        parentTaskId: 'parent123',
        briefing: 'Inspect auth flow',
        agentType: 'explore'
      }));
    });
  });

  test('status reads subagent progress from the subagent directory', async () => {
    const subagentDir = path.join(
      projectDir, '.claude', 'sidecar_sessions', 'parent123', 'subagents', 'sub1'
    );
    fs.mkdirSync(subagentDir, { recursive: true });
    fs.writeFileSync(path.join(subagentDir, 'metadata.json'), JSON.stringify({
      subagentId: 'sub1',
      parentTaskId: 'parent123',
      agentType: 'plan',
      backend: 'codex',
      status: 'running',
      createdAt: new Date().toISOString()
    }));
    fs.writeFileSync(path.join(subagentDir, 'conversation.jsonl'),
      '{"role":"assistant","content":"Scanning files"}\n');
    fs.writeFileSync(path.join(subagentDir, 'progress.json'), JSON.stringify({
      stage: 'receiving',
      stageLabel: 'Codex is generating a response...',
      updatedAt: new Date().toISOString()
    }));

    const { handlers } = require('../src/mcp-server');
    const result = await handlers.sidecar_subagent_status({
      parentTaskId: 'parent123',
      subagentId: 'sub1'
    }, projectDir);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.parentTaskId).toBe('parent123');
    expect(parsed.subagentId).toBe('sub1');
    expect(parsed.status).toBe('running');
    expect(parsed.backend).toBe('codex');
    expect(parsed.stage).toBe('receiving');
    expect(parsed.latest).toContain('Scanning files');
  });

  test('read returns summary by default', async () => {
    const subagentDir = path.join(
      projectDir, '.claude', 'sidecar_sessions', 'parent123', 'subagents', 'sub2'
    );
    fs.mkdirSync(subagentDir, { recursive: true });
    fs.writeFileSync(path.join(subagentDir, 'metadata.json'), JSON.stringify({
      subagentId: 'sub2',
      parentTaskId: 'parent123',
      agentType: 'build',
      backend: 'codex',
      status: 'complete',
      createdAt: new Date().toISOString()
    }));
    fs.writeFileSync(path.join(subagentDir, 'summary.md'), 'Updated auth validation.');

    const { handlers } = require('../src/mcp-server');
    const result = await handlers.sidecar_subagent_read({
      parentTaskId: 'parent123',
      subagentId: 'sub2'
    }, projectDir);

    expect(result.content[0].text).toContain('Updated auth validation.');
  });

  test('abort marks subagent aborted and terminates pid', async () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const subagentDir = path.join(
      projectDir, '.claude', 'sidecar_sessions', 'parent123', 'subagents', 'sub3'
    );
    fs.mkdirSync(subagentDir, { recursive: true });
    fs.writeFileSync(path.join(subagentDir, 'metadata.json'), JSON.stringify({
      subagentId: 'sub3',
      parentTaskId: 'parent123',
      agentType: 'general',
      backend: 'codex',
      status: 'running',
      pid: 43210,
      createdAt: new Date().toISOString()
    }));

    const { handlers } = require('../src/mcp-server');
    const result = await handlers.sidecar_subagent_abort({
      parentTaskId: 'parent123',
      subagentId: 'sub3'
    }, projectDir);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('aborted');
    expect(killSpy).toHaveBeenCalledWith(43210, 'SIGTERM');

    const metadata = JSON.parse(fs.readFileSync(path.join(subagentDir, 'metadata.json'), 'utf-8'));
    expect(metadata.status).toBe('aborted');
    expect(metadata.pid).toBeNull();
  });
});
