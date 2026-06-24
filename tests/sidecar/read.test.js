'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { listSidecars, readSidecar } = require('../../src/sidecar/read');

describe('sidecar read/list boundaries', () => {
  let tmpDir;
  let outsideDir;
  let logSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-read-test-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-read-outside-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  test('readSidecar rejects a symlinked task directory before printing outside summary', async () => {
    const sessionsDir = path.join(tmpDir, '.claude', 'sidecar_sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'metadata.json'), JSON.stringify({
      taskId: 'leak',
      status: 'complete',
      createdAt: '2026-03-04T00:00:00Z'
    }));
    fs.writeFileSync(path.join(outsideDir, 'summary.md'), 'outside secret summary');
    fs.symlinkSync(outsideDir, path.join(sessionsDir, 'leak'), 'dir');

    await expect(readSidecar({ taskId: 'leak', project: tmpDir }))
      .rejects.toThrow(/outside|session root|session directory/i);

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('outside secret summary'));
  });

  test('readSidecar rejects a symlinked conversation file before printing outside content', async () => {
    const sessDir = path.join(tmpDir, '.claude', 'sidecar_sessions', 'convleak');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'metadata.json'), JSON.stringify({
      taskId: 'convleak',
      status: 'complete',
      createdAt: '2026-03-04T00:00:00Z'
    }));
    const outsideConversation = path.join(outsideDir, 'conversation.jsonl');
    fs.writeFileSync(
      outsideConversation,
      JSON.stringify({ role: 'assistant', content: 'outside secret conversation' }) + '\n'
    );
    fs.symlinkSync(outsideConversation, path.join(sessDir, 'conversation.jsonl'));

    await expect(readSidecar({ taskId: 'convleak', project: tmpDir, conversation: true }))
      .rejects.toThrow(/outside|session directory/i);

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('outside secret conversation'));
  });

  test('listSidecars skips symlinked task directories instead of printing outside metadata', async () => {
    const sessionsDir = path.join(tmpDir, '.claude', 'sidecar_sessions');
    const validDir = path.join(sessionsDir, 'valid-task');
    fs.mkdirSync(validDir, { recursive: true });
    fs.writeFileSync(path.join(validDir, 'metadata.json'), JSON.stringify({
      taskId: 'valid-task',
      model: 'gemini',
      status: 'complete',
      briefing: 'inside session',
      createdAt: '2026-03-04T00:00:00Z'
    }));
    fs.writeFileSync(path.join(outsideDir, 'metadata.json'), JSON.stringify({
      taskId: 'leak',
      model: 'outside-model',
      status: 'complete',
      briefing: 'outside secret briefing',
      createdAt: '2026-03-05T00:00:00Z'
    }));
    fs.symlinkSync(outsideDir, path.join(sessionsDir, 'leak'), 'dir');

    await listSidecars({ project: tmpDir, json: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.map(s => s.id)).toEqual(['valid-task']);
    expect(logSpy.mock.calls[0][0]).not.toContain('outside secret briefing');
    expect(logSpy.mock.calls[0][0]).not.toContain('outside-model');
  });
});
