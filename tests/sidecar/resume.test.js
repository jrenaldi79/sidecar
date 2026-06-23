/**
 * Sidecar Resume Tests
 *
 * Tests for session resumption, including OpenCode session reconnection,
 * file drift detection, and metadata handling.
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

const {
  loadSessionMetadata,
  loadInitialContext,
  checkFileDrift,
  buildDriftWarning,
  updateSessionStatus,
  buildResumeUserMessage
} = require('../../src/sidecar/resume');

describe('Resume Operations', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-resume-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadSessionMetadata', () => {
    it('should load metadata from session directory', () => {
      const meta = {
        taskId: 'abc123',
        model: 'openrouter/google/gemini-3-flash-preview',
        status: 'complete',
        opencodeSessionId: 'ses_test123'
      };
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(meta));

      const loaded = loadSessionMetadata(tmpDir);
      expect(loaded.taskId).toBe('abc123');
      expect(loaded.opencodeSessionId).toBe('ses_test123');
    });

    it('should throw if metadata file missing', () => {
      expect(() => loadSessionMetadata('/nonexistent/path'))
        .toThrow('Session metadata not found');
    });
  });

  describe('loadInitialContext', () => {
    it('should load initial context from file', () => {
      fs.writeFileSync(path.join(tmpDir, 'initial_context.md'), '# System Prompt\nTest prompt');

      const context = loadInitialContext(tmpDir);
      expect(context).toContain('Test prompt');
    });

    it('should return empty string if file missing', () => {
      const context = loadInitialContext(tmpDir);
      expect(context).toBe('');
    });
  });

  describe('checkFileDrift', () => {
    it('should detect changed files', () => {
      const testFile = path.join(tmpDir, 'test.js');
      fs.writeFileSync(testFile, 'content');

      const metadata = {
        filesRead: ['test.js'],
        completedAt: new Date(Date.now() - 60000).toISOString()
      };

      const drift = checkFileDrift(metadata, tmpDir);
      expect(drift.hasChanges).toBe(true);
      expect(drift.changedFiles).toContain('test.js');
    });

    it('should not detect drift when no files changed', () => {
      const metadata = {
        filesRead: ['nonexistent.js'],
        completedAt: new Date().toISOString()
      };

      const drift = checkFileDrift(metadata, tmpDir);
      expect(drift.hasChanges).toBe(false);
    });

    it('should handle empty filesRead', () => {
      const metadata = {
        filesRead: [],
        completedAt: new Date().toISOString()
      };

      const drift = checkFileDrift(metadata, tmpDir);
      expect(drift.hasChanges).toBe(false);
    });
  });

  describe('buildDriftWarning', () => {
    it('should format drift warning with changed files', () => {
      const warning = buildDriftWarning(['src/index.js', 'src/utils.js'], Date.now() - 7200000);
      expect(warning).toContain('RESUME NOTICE');
      expect(warning).toContain('src/index.js');
      expect(warning).toContain('src/utils.js');
    });
  });

  describe('updateSessionStatus', () => {
    it('should update session status and add resumedAt', () => {
      const meta = { taskId: 'abc123', status: 'complete' };
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(meta));

      const updated = updateSessionStatus(tmpDir, 'running');
      expect(updated.status).toBe('running');
      expect(updated.resumedAt).toBeDefined();
    });
  });

  describe('buildResumeUserMessage', () => {
    it('should include conversation excerpt and briefing', () => {
      const briefing = 'Debug the auth issue';
      const conversation = '[assistant @ 10:00] Analyzing code\n[assistant @ 10:01] Found the bug in auth.js';

      const result = buildResumeUserMessage(briefing, conversation);

      expect(result).toContain('PREVIOUS CONVERSATION');
      expect(result).toContain('Analyzing code');
      expect(result).toContain('Found the bug in auth.js');
      expect(result).toContain('Debug the auth issue');
    });

    it('should skip conversation section when conversation is empty', () => {
      const result = buildResumeUserMessage('Fix the tests', '');

      expect(result).toContain('Fix the tests');
      expect(result).not.toContain('PREVIOUS CONVERSATION');
    });

    it('should include resume instruction', () => {
      const result = buildResumeUserMessage('Task', 'some conversation');

      // Should tell the model to continue from where it left off
      expect(result).toMatch(/continue|resume|pick up/i);
    });

    it('should work with no briefing', () => {
      const result = buildResumeUserMessage('', 'conversation data');

      expect(result).toContain('PREVIOUS CONVERSATION');
      expect(result).toContain('conversation data');
    });
  });

  describe('OpenCode session ID in metadata', () => {
    it('should persist opencodeSessionId when stored in metadata', () => {
      const meta = {
        taskId: 'test123',
        model: 'openrouter/google/gemini-3-flash-preview',
        status: 'complete',
        opencodeSessionId: 'ses_abc123def456'
      };
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(meta));

      const loaded = loadSessionMetadata(tmpDir);
      expect(loaded.opencodeSessionId).toBe('ses_abc123def456');
    });

    it('should handle metadata without opencodeSessionId (legacy sessions)', () => {
      const meta = {
        taskId: 'old123',
        model: 'openrouter/google/gemini-2.5-flash',
        status: 'complete'
      };
      fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(meta));

      const loaded = loadSessionMetadata(tmpDir);
      expect(loaded.opencodeSessionId).toBeUndefined();
    });
  });

  describe('resumeSidecar session boundary validation', () => {
    let projectDir;
    let otherProjectDir;

    beforeEach(() => {
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-resume-project-'));
      otherProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-resume-other-'));
    });

    afterEach(() => {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(otherProjectDir, { recursive: true, force: true });
      jest.resetModules();
    });

    function writeSession(sessionDir, metadataProject) {
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({
        taskId: 'resume-task',
        project: metadataProject,
        projectDir: metadataProject,
        model: 'google/gemini-test',
        agent: 'build',
        briefing: 'resume external secret',
        status: 'complete',
        pid: null,
        createdAt: new Date().toISOString()
      }));
      fs.writeFileSync(path.join(sessionDir, 'initial_context.md'), 'external secret context');
      fs.writeFileSync(path.join(sessionDir, 'conversation.jsonl'),
        JSON.stringify({ role: 'assistant', content: 'external secret conversation' }) + '\n');
    }

    async function expectResumeRejected(expectedPattern) {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('../../src/sidecar/start', () => ({
          runInteractive: jest.fn(async () => ({ summary: 'done' })),
          buildMcpConfig: jest.fn(() => null)
        }));
        jest.doMock('../../src/headless', () => ({
          runHeadless: jest.fn(async () => ({ summary: 'done' }))
        }));
        jest.doMock('../../src/utils/session-lock', () => ({
          acquireLock: jest.fn(),
          releaseLock: jest.fn()
        }));

        const { resumeSidecar } = require('../../src/sidecar/resume');
        await expect(resumeSidecar({
          taskId: 'resume-task',
          project: projectDir,
          headless: true
        })).rejects.toThrow(expectedPattern);
      });
    }

    it('rejects a task directory symlink that escapes the project sessions root', async () => {
      const externalSessionDir = path.join(otherProjectDir, '.claude', 'sidecar_sessions', 'resume-task');
      writeSession(externalSessionDir, fs.realpathSync(otherProjectDir));

      const sessionsRoot = path.join(projectDir, '.claude', 'sidecar_sessions');
      fs.mkdirSync(sessionsRoot, { recursive: true });
      fs.symlinkSync(externalSessionDir, path.join(sessionsRoot, 'resume-task'), 'dir');

      await expectResumeRejected(/outside|session root/i);
    });

    it('rejects metadata bound to a different project before loading prior context', async () => {
      const sessionDir = path.join(projectDir, '.claude', 'sidecar_sessions', 'resume-task');
      writeSession(sessionDir, fs.realpathSync(otherProjectDir));

      await expectResumeRejected(/project/i);
    });
  });
});
