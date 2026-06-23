'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadPreviousSession } = require('../../src/sidecar/continue');

describe('Continue Operations session boundary validation', () => {
  let projectDir;
  let otherProjectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-continue-project-'));
    otherProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-continue-other-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(otherProjectDir, { recursive: true, force: true });
  });

  function writeSession(sessionDir, metadataProject) {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
      taskId: 'old-task',
      project: metadataProject,
      projectDir: metadataProject,
      briefing: 'external secret briefing',
      status: 'complete',
      createdAt: new Date().toISOString()
    }));
    fs.writeFileSync(path.join(sessionDir, 'summary.md'), 'external secret summary');
    fs.writeFileSync(path.join(sessionDir, 'conversation.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'external secret conversation' }) + '\n');
  }

  test('loadPreviousSession rejects a task directory symlink that escapes the project sessions root', () => {
    const externalSessionDir = path.join(otherProjectDir, '.claude', 'sidecar_sessions', 'old-task');
    writeSession(externalSessionDir, fs.realpathSync(otherProjectDir));

    const sessionsRoot = path.join(projectDir, '.claude', 'sidecar_sessions');
    fs.mkdirSync(sessionsRoot, { recursive: true });
    fs.symlinkSync(externalSessionDir, path.join(sessionsRoot, 'old-task'), 'dir');

    expect(() => loadPreviousSession('old-task', projectDir)).toThrow(/outside|session root/i);
  });

  test('loadPreviousSession rejects metadata bound to a different project before reading prior context', () => {
    const sessionDir = path.join(projectDir, '.claude', 'sidecar_sessions', 'old-task');
    writeSession(sessionDir, fs.realpathSync(otherProjectDir));

    expect(() => loadPreviousSession('old-task', projectDir)).toThrow(/project/i);
  });

  test('loadPreviousSession rejects a summary file symlink that escapes the session directory', () => {
    const sessionDir = path.join(projectDir, '.claude', 'sidecar_sessions', 'old-task');
    const outsideSummary = path.join(otherProjectDir, 'summary.md');
    writeSession(sessionDir, fs.realpathSync(projectDir));
    fs.writeFileSync(outsideSummary, 'external secret summary');
    fs.unlinkSync(path.join(sessionDir, 'summary.md'));
    fs.symlinkSync(outsideSummary, path.join(sessionDir, 'summary.md'));

    expect(() => loadPreviousSession('old-task', projectDir)).toThrow(/outside|session directory/i);
  });

  test('loadPreviousSession rejects a conversation file symlink that escapes the session directory', () => {
    const sessionDir = path.join(projectDir, '.claude', 'sidecar_sessions', 'old-task');
    const outsideConversation = path.join(otherProjectDir, 'conversation.jsonl');
    writeSession(sessionDir, fs.realpathSync(projectDir));
    fs.writeFileSync(outsideConversation,
      JSON.stringify({ role: 'assistant', content: 'external secret conversation' }) + '\n');
    fs.unlinkSync(path.join(sessionDir, 'conversation.jsonl'));
    fs.symlinkSync(outsideConversation, path.join(sessionDir, 'conversation.jsonl'));

    expect(() => loadPreviousSession('old-task', projectDir)).toThrow(/outside|session directory/i);
  });

  test('createContinueSessionMetadata enforces private directory and metadata modes for existing paths', () => {
    const { createContinueSessionMetadata } = require('../../src/sidecar/continue');
    const sessionDir = path.join(projectDir, '.claude', 'sidecar_sessions', 'new-task');
    const metaPath = path.join(sessionDir, 'metadata.json');
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o755 });
    fs.chmodSync(sessionDir, 0o755);
    fs.writeFileSync(metaPath, '{}', { mode: 0o644 });
    fs.chmodSync(metaPath, 0o644);

    createContinueSessionMetadata('new-task', projectDir, {
      model: 'google/gemini-test',
      briefing: 'follow up',
      headless: true,
      agent: 'build'
    }, 'old-task');

    expect(fs.statSync(sessionDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(metaPath).mode & 0o777).toBe(0o600);
  });
});
