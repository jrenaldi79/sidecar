/**
 * Session Manager Tests
 *
 * Spec Reference: Section 8.1 What Gets Persisted, Section 7.4 Metadata Tracking
 * Tests session persistence for sidecar sessions.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Module under test
const {
  createSession,
  updateSession,
  getSession,
  saveConversation,
  saveSummary,
  getSessionDir,
  SESSION_STATUS,
  // Sub-agent functions
  getSubagentDir,
  createSubagentSession,
  updateSubagentSession,
  getSubagentSession,
  listSubagents,
  saveSubagentSummary
} = require('../src/session-manager');

describe('Session Manager', () => {
  let tempDir;
  let projectDir;

  beforeEach(() => {
    // Create temporary project directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-session-mgr-test-'));
    projectDir = tempDir;
  });

  afterEach(() => {
    // Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getSessionDir', () => {
    it('should return the session directory path', () => {
      const taskId = 'abc123';
      const result = getSessionDir(projectDir, taskId);

      expect(result).toBe(path.join(projectDir, '.claude', 'sidecar_sessions', taskId));
    });
  });

  describe('createSession', () => {
    it('should create session directory structure per spec §8.1', () => {
      const taskId = 'abc123';
      const metadata = {
        model: 'google/gemini-2.5',
        project: projectDir,
        briefing: 'Debug auth issue'
      };

      createSession(projectDir, taskId, metadata);

      // Check directory exists
      const sessionDir = path.join(projectDir, '.claude', 'sidecar_sessions', taskId);
      expect(fs.existsSync(sessionDir)).toBe(true);
    });

    it('should create metadata.json with required fields per spec §7.4', () => {
      const taskId = 'abc123';
      const metadata = {
        model: 'google/gemini-2.5',
        project: projectDir,
        briefing: 'Debug auth issue'
      };

      createSession(projectDir, taskId, metadata);

      const metaPath = path.join(projectDir, '.claude', 'sidecar_sessions', taskId, 'metadata.json');
      expect(fs.existsSync(metaPath)).toBe(true);

      const savedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      // Spec §7.4 required fields
      expect(savedMeta.taskId).toBe(taskId);
      expect(savedMeta.model).toBe('google/gemini-2.5');
      expect(savedMeta.project).toBe(projectDir);
      expect(savedMeta.status).toBe('running');
      expect(savedMeta.createdAt).toBeDefined();
      expect(new Date(savedMeta.createdAt)).toBeInstanceOf(Date);
    });

    it('should initialize empty arrays for file tracking', () => {
      const taskId = 'abc123';
      createSession(projectDir, taskId, { model: 'test/model', project: projectDir });

      const metaPath = path.join(projectDir, '.claude', 'sidecar_sessions', taskId, 'metadata.json');
      const savedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      expect(savedMeta.filesRead).toEqual([]);
      expect(savedMeta.filesWritten).toEqual([]);
      expect(savedMeta.conflicts).toEqual([]);
    });

    it('should create empty conversation.jsonl file', () => {
      const taskId = 'abc123';
      createSession(projectDir, taskId, { model: 'test/model', project: projectDir });

      const convPath = path.join(projectDir, '.claude', 'sidecar_sessions', taskId, 'conversation.jsonl');
      expect(fs.existsSync(convPath)).toBe(true);
      expect(fs.readFileSync(convPath, 'utf-8')).toBe('');
    });

    it('should throw if session already exists', () => {
      const taskId = 'abc123';
      createSession(projectDir, taskId, { model: 'test/model', project: projectDir });

      expect(() => {
        createSession(projectDir, taskId, { model: 'test/model', project: projectDir });
      }).toThrow(/already exists/);
    });

    it('should save thinking level in metadata', () => {
      const taskId = 'thinking-test';
      createSession(projectDir, taskId, {
        model: 'google/gemini-3-pro',
        project: projectDir,
        thinking: 'low'
      });

      const metaPath = path.join(projectDir, '.claude', 'sidecar_sessions', taskId, 'metadata.json');
      const savedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      expect(savedMeta.thinking).toBe('low');
    });

    it('should default thinking level to medium', () => {
      const taskId = 'thinking-default';
      createSession(projectDir, taskId, {
        model: 'google/gemini-3-pro',
        project: projectDir
      });

      const metaPath = path.join(projectDir, '.claude', 'sidecar_sessions', taskId, 'metadata.json');
      const savedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      expect(savedMeta.thinking).toBe('medium');
    });
  });

  describe('updateSession', () => {
    beforeEach(() => {
      createSession(projectDir, 'abc123', {
        model: 'google/gemini-2.5',
        project: projectDir,
        briefing: 'Test task'
      });
    });

    it('should update metadata fields', () => {
      updateSession(projectDir, 'abc123', {
        status: 'complete',
        completedAt: new Date().toISOString()
      });

      const session = getSession(projectDir, 'abc123');
      expect(session.status).toBe('complete');
      expect(session.completedAt).toBeDefined();
    });

    it('should add to filesRead array', () => {
      updateSession(projectDir, 'abc123', {
        filesRead: ['src/auth/TokenManager.ts', 'src/api/client.ts']
      });

      const session = getSession(projectDir, 'abc123');
      expect(session.filesRead).toContain('src/auth/TokenManager.ts');
      expect(session.filesRead).toContain('src/api/client.ts');
    });

    it('should add to filesWritten array', () => {
      updateSession(projectDir, 'abc123', {
        filesWritten: ['src/auth/TokenManager.ts']
      });

      const session = getSession(projectDir, 'abc123');
      expect(session.filesWritten).toContain('src/auth/TokenManager.ts');
    });

    it('should add conflicts per spec §7.4', () => {
      const conflict = {
        file: 'src/auth/TokenManager.ts',
        sidecarAction: 'write',
        externalMtime: new Date().toISOString()
      };

      updateSession(projectDir, 'abc123', {
        conflicts: [conflict]
      });

      const session = getSession(projectDir, 'abc123');
      expect(session.conflicts).toHaveLength(1);
      expect(session.conflicts[0].file).toBe('src/auth/TokenManager.ts');
    });

    it('should update contextDrift per spec §7.4', () => {
      const drift = {
        ageMinutes: 23,
        mainTurns: 15,
        isSignificant: true
      };

      updateSession(projectDir, 'abc123', { contextDrift: drift });

      const session = getSession(projectDir, 'abc123');
      expect(session.contextDrift).toEqual(drift);
    });

    it('should preserve existing fields when updating', () => {
      const originalSession = getSession(projectDir, 'abc123');
      const originalCreatedAt = originalSession.createdAt;

      updateSession(projectDir, 'abc123', { status: 'complete' });

      const updatedSession = getSession(projectDir, 'abc123');
      expect(updatedSession.createdAt).toBe(originalCreatedAt);
      expect(updatedSession.model).toBe('google/gemini-2.5');
    });

    it('should throw for non-existent session', () => {
      expect(() => {
        updateSession(projectDir, 'nonexistent', { status: 'complete' });
      }).toThrow(/not found/);
    });
  });

  describe('getSession', () => {
    beforeEach(() => {
      createSession(projectDir, 'abc123', {
        model: 'google/gemini-2.5',
        project: projectDir,
        briefing: 'Test task'
      });
    });

    it('should return session metadata', () => {
      const session = getSession(projectDir, 'abc123');

      expect(session.taskId).toBe('abc123');
      expect(session.model).toBe('google/gemini-2.5');
      expect(session.status).toBe('running');
    });

    it('should return null for non-existent session', () => {
      const session = getSession(projectDir, 'nonexistent');
      expect(session).toBeNull();
    });
  });

  describe('saveConversation', () => {
    beforeEach(() => {
      createSession(projectDir, 'abc123', {
        model: 'google/gemini-2.5',
        project: projectDir
      });
    });

    it('should append message to conversation.jsonl per spec §8.2', () => {
      const message = {
        role: 'user',
        content: 'Hello',
        timestamp: new Date().toISOString()
      };

      saveConversation(projectDir, 'abc123', message);

      const convPath = path.join(projectDir, '.claude', 'sidecar_sessions', 'abc123', 'conversation.jsonl');
      const content = fs.readFileSync(convPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.role).toBe('user');
      expect(parsed.content).toBe('Hello');
    });

    it('should append multiple messages', () => {
      saveConversation(projectDir, 'abc123', { role: 'user', content: 'Message 1', timestamp: new Date().toISOString() });
      saveConversation(projectDir, 'abc123', { role: 'assistant', content: 'Response 1', timestamp: new Date().toISOString() });
      saveConversation(projectDir, 'abc123', { role: 'user', content: 'Message 2', timestamp: new Date().toISOString() });

      const convPath = path.join(projectDir, '.claude', 'sidecar_sessions', 'abc123', 'conversation.jsonl');
      const content = fs.readFileSync(convPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(3);
    });

    it('should add timestamp if not provided', () => {
      saveConversation(projectDir, 'abc123', { role: 'user', content: 'No timestamp' });

      const convPath = path.join(projectDir, '.claude', 'sidecar_sessions', 'abc123', 'conversation.jsonl');
      const content = fs.readFileSync(convPath, 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.timestamp).toBeDefined();
    });

    it('should throw for non-existent session', () => {
      expect(() => {
        saveConversation(projectDir, 'nonexistent', { role: 'user', content: 'Test' });
      }).toThrow(/not found/);
    });
  });

  describe('saveSummary', () => {
    beforeEach(() => {
      createSession(projectDir, 'abc123', {
        model: 'google/gemini-2.5',
        project: projectDir
      });
    });

    it('should save summary to summary.md per spec §8.1', () => {
      const summary = `## Sidecar Results: Auth Fix

**Task:** Debug authentication issue

**Findings:**
- Race condition in TokenManager.ts
`;

      saveSummary(projectDir, 'abc123', summary);

      const summaryPath = path.join(projectDir, '.claude', 'sidecar_sessions', 'abc123', 'summary.md');
      expect(fs.existsSync(summaryPath)).toBe(true);

      const content = fs.readFileSync(summaryPath, 'utf-8');
      expect(content).toBe(summary);
    });

    it('should update status to complete', () => {
      saveSummary(projectDir, 'abc123', 'Test summary');

      const session = getSession(projectDir, 'abc123');
      expect(session.status).toBe('complete');
    });

    it('should set completedAt timestamp', () => {
      const beforeSave = new Date();
      saveSummary(projectDir, 'abc123', 'Test summary');

      const session = getSession(projectDir, 'abc123');
      expect(session.completedAt).toBeDefined();

      const completedAt = new Date(session.completedAt);
      expect(completedAt.getTime()).toBeGreaterThanOrEqual(beforeSave.getTime());
    });

    it('should overwrite existing summary', () => {
      saveSummary(projectDir, 'abc123', 'First summary');
      saveSummary(projectDir, 'abc123', 'Updated summary');

      const summaryPath = path.join(projectDir, '.claude', 'sidecar_sessions', 'abc123', 'summary.md');
      const content = fs.readFileSync(summaryPath, 'utf-8');
      expect(content).toBe('Updated summary');
    });

    it('should throw for non-existent session', () => {
      expect(() => {
        saveSummary(projectDir, 'nonexistent', 'Test summary');
      }).toThrow(/not found/);
    });
  });

  describe('SESSION_STATUS', () => {
    it('should export status constants', () => {
      expect(SESSION_STATUS.RUNNING).toBe('running');
      expect(SESSION_STATUS.COMPLETE).toBe('complete');
      expect(SESSION_STATUS.ERROR).toBe('error');
      expect(SESSION_STATUS.TIMEOUT).toBe('timeout');
    });
  });

  describe('Edge cases', () => {
    it('should handle special characters in taskId', () => {
      const taskId = 'abc-123_def';
      createSession(projectDir, taskId, { model: 'test/model', project: projectDir });

      const session = getSession(projectDir, taskId);
      expect(session.taskId).toBe(taskId);
    });

    it('should create parent directories if they do not exist', () => {
      const nestedProjectDir = path.join(tempDir, 'nested', 'project');
      fs.mkdirSync(nestedProjectDir, { recursive: true });

      createSession(nestedProjectDir, 'abc123', { model: 'test/model', project: nestedProjectDir });

      const sessionDir = path.join(nestedProjectDir, '.claude', 'sidecar_sessions', 'abc123');
      expect(fs.existsSync(sessionDir)).toBe(true);
    });
  });

  // Sub-agent session tests
  describe('Sub-agent Sessions', () => {
    const parentTaskId = 'parent-task-123';

    beforeEach(() => {
      // Create parent session first
      createSession(projectDir, parentTaskId, {
        model: 'test/model',
        project: projectDir
      });
    });

    describe('getSubagentDir', () => {
      it('should return the sub-agent directory path', () => {
        const result = getSubagentDir(projectDir, parentTaskId, 'subagent-xyz');
        expect(result).toBe(path.join(
          projectDir, '.claude', 'sidecar_sessions', parentTaskId, 'subagents', 'subagent-xyz'
        ));
      });
    });

    describe('createSubagentSession', () => {
      it('should create sub-agent directory structure', () => {
        const subagentId = 'subagent-abc';
        const subagentDir = createSubagentSession(projectDir, parentTaskId, subagentId, {
          agentType: 'explore',
          briefing: 'Find API endpoints'
        });

        expect(fs.existsSync(subagentDir)).toBe(true);
        expect(fs.existsSync(path.join(subagentDir, 'metadata.json'))).toBe(true);
        expect(fs.existsSync(path.join(subagentDir, 'conversation.jsonl'))).toBe(true);
      });

      it('should write correct metadata', () => {
        const subagentId = 'subagent-def';
        createSubagentSession(projectDir, parentTaskId, subagentId, {
          agentType: 'security',
          briefing: 'Audit authentication'
        });

        const metadata = getSubagentSession(projectDir, parentTaskId, subagentId);
        expect(metadata.subagentId).toBe(subagentId);
        expect(metadata.parentTaskId).toBe(parentTaskId);
        expect(metadata.agentType).toBe('security');
        expect(metadata.briefing).toBe('Audit authentication');
        expect(metadata.status).toBe(SESSION_STATUS.RUNNING);
      });
    });

    describe('updateSubagentSession', () => {
      it('should update sub-agent metadata', () => {
        const subagentId = 'subagent-update';
        createSubagentSession(projectDir, parentTaskId, subagentId, {
          agentType: 'general',
          briefing: 'Test task'
        });

        updateSubagentSession(projectDir, parentTaskId, subagentId, {
          status: SESSION_STATUS.COMPLETE,
          completedAt: '2024-01-01T12:00:00Z'
        });

        const metadata = getSubagentSession(projectDir, parentTaskId, subagentId);
        expect(metadata.status).toBe(SESSION_STATUS.COMPLETE);
        expect(metadata.completedAt).toBe('2024-01-01T12:00:00Z');
      });

      it('should throw if sub-agent not found', () => {
        expect(() => {
          updateSubagentSession(projectDir, parentTaskId, 'non-existent', {});
        }).toThrow('Sub-agent non-existent not found');
      });
    });

    describe('getSubagentSession', () => {
      it('should return sub-agent metadata', () => {
        const subagentId = 'subagent-get';
        createSubagentSession(projectDir, parentTaskId, subagentId, {
          agentType: 'test',
          briefing: 'Run tests'
        });

        const metadata = getSubagentSession(projectDir, parentTaskId, subagentId);
        expect(metadata).not.toBeNull();
        expect(metadata.agentType).toBe('test');
      });

      it('should return null if sub-agent not found', () => {
        const metadata = getSubagentSession(projectDir, parentTaskId, 'non-existent');
        expect(metadata).toBeNull();
      });
    });

    describe('listSubagents', () => {
      it('should return empty array if no sub-agents', () => {
        const subagents = listSubagents(projectDir, parentTaskId);
        expect(subagents).toEqual([]);
      });

      it('should list all sub-agents', () => {
        createSubagentSession(projectDir, parentTaskId, 'subagent-1', {
          agentType: 'general',
          briefing: 'Task 1'
        });
        createSubagentSession(projectDir, parentTaskId, 'subagent-2', {
          agentType: 'explore',
          briefing: 'Task 2'
        });

        const subagents = listSubagents(projectDir, parentTaskId);
        expect(subagents.length).toBe(2);
      });

      it('should filter by status', () => {
        createSubagentSession(projectDir, parentTaskId, 'subagent-a', {
          agentType: 'general',
          briefing: 'Task A'
        });
        createSubagentSession(projectDir, parentTaskId, 'subagent-b', {
          agentType: 'explore',
          briefing: 'Task B'
        });

        updateSubagentSession(projectDir, parentTaskId, 'subagent-a', {
          status: SESSION_STATUS.COMPLETE
        });

        const completed = listSubagents(projectDir, parentTaskId, { status: SESSION_STATUS.COMPLETE });
        expect(completed.length).toBe(1);
        expect(completed[0].subagentId).toBe('subagent-a');
      });

      it('should filter by agent type', () => {
        createSubagentSession(projectDir, parentTaskId, 'subagent-x', {
          agentType: 'general',
          briefing: 'Task X'
        });
        createSubagentSession(projectDir, parentTaskId, 'subagent-y', {
          agentType: 'explore',
          briefing: 'Task Y'
        });

        const explores = listSubagents(projectDir, parentTaskId, { agentType: 'explore' });
        expect(explores.length).toBe(1);
        expect(explores[0].agentType).toBe('explore');
      });
    });

    describe('saveSubagentSummary', () => {
      it('should save summary and update status', () => {
        const subagentId = 'subagent-summary';
        createSubagentSession(projectDir, parentTaskId, subagentId, {
          agentType: 'explore',
          briefing: 'Find endpoints'
        });

        saveSubagentSummary(projectDir, parentTaskId, subagentId, 'Found 10 API endpoints');

        const subagentDir = getSubagentDir(projectDir, parentTaskId, subagentId);
        const summaryContent = fs.readFileSync(path.join(subagentDir, 'summary.md'), 'utf-8');
        expect(summaryContent).toBe('Found 10 API endpoints');

        const metadata = getSubagentSession(projectDir, parentTaskId, subagentId);
        expect(metadata.status).toBe(SESSION_STATUS.COMPLETE);
        expect(metadata.completedAt).toBeDefined();
      });
    });
  });
});
