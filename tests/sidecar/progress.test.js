/**
 * Progress Reader Tests
 *
 * Tests for readProgress, extractLatest, computeLastActivity.
 * Reads conversation.jsonl from a session directory and returns
 * { messages, lastActivity, latest }.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  readProgress,
  extractLatest,
  computeLastActivity,
  writeProgress
} = require('../../src/sidecar/progress');

describe('Progress Reader', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readProgress', () => {
    it('returns defaults when conversation.jsonl does not exist', () => {
      const result = readProgress(tmpDir);

      expect(result).toMatchObject({
        messages: 0,
        lastActivity: 'never',
        latest: 'Starting up...',
        lastActivityMs: null
      });
    });

    it('returns defaults when conversation.jsonl is empty', () => {
      fs.writeFileSync(path.join(tmpDir, 'conversation.jsonl'), '');

      const result = readProgress(tmpDir);

      expect(result).toMatchObject({
        messages: 0,
        lastActivity: expect.any(String),
        latest: 'Starting up...'
      });
      expect(result.lastActivityMs).toEqual(expect.any(Number));
    });

    it('counts assistant messages and skips system/tool roles', () => {
      const lines = [
        JSON.stringify({ role: 'system', content: 'You are a helper' }),
        JSON.stringify({ role: 'assistant', content: 'Hello there' }),
        JSON.stringify({ role: 'user', content: 'Do something' }),
        JSON.stringify({ role: 'assistant', content: 'Sure thing' }),
        JSON.stringify({ role: 'tool', content: 'result data' }),
        JSON.stringify({ role: 'assistant', content: 'Done' })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      const result = readProgress(tmpDir);

      expect(result.messages).toBe(3);
    });

    it('extracts latest from assistant text', () => {
      const lines = [
        JSON.stringify({ role: 'assistant', content: 'I will analyze the code now' })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      const result = readProgress(tmpDir);

      expect(result.latest).toBe('I will analyze the code now');
    });

    it('truncates latest to 80 chars', () => {
      const longText = 'A'.repeat(100);
      const lines = [
        JSON.stringify({ role: 'assistant', content: longText })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      const result = readProgress(tmpDir);

      expect(result.latest).toBe('A'.repeat(80) + '...');
      expect(result.latest.length).toBe(83);
    });

    it('extracts latest from tool_use entry', () => {
      const lines = [
        JSON.stringify({
          role: 'assistant',
          toolCall: { name: 'Read' }
        })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      const result = readProgress(tmpDir);

      expect(result.latest).toBe('Using Read');
    });

    it('uses last entry for latest, not first', () => {
      const lines = [
        JSON.stringify({ role: 'assistant', content: 'First message' }),
        JSON.stringify({ role: 'assistant', content: 'Second message' }),
        JSON.stringify({ role: 'assistant', content: 'Third and final' })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      const result = readProgress(tmpDir);

      expect(result.latest).toBe('Third and final');
    });

    it('computes relative lastActivity from file mtime', () => {
      const convPath = path.join(tmpDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'assistant', content: 'hi' }));

      // Touch the file to set mtime to ~2 seconds ago
      const twoSecondsAgo = new Date(Date.now() - 2000);
      fs.utimesSync(convPath, twoSecondsAgo, twoSecondsAgo);

      const result = readProgress(tmpDir);

      // Should be something like "2s ago" or "3s ago" (timing flexibility)
      expect(result.lastActivity).toMatch(/^\d+s ago$/);
    });

    it('handles malformed JSONL lines gracefully', () => {
      const lines = [
        '{ invalid json',
        JSON.stringify({ role: 'assistant', content: 'Valid line' }),
        'another bad line {{',
        '',
        JSON.stringify({ role: 'assistant', toolCall: { name: 'Bash' } })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      const result = readProgress(tmpDir);

      // Should count only valid assistant entries
      expect(result.messages).toBe(2);
      // Should use last valid assistant entry
      expect(result.latest).toBe('Using Bash');
    });

    it('ignores symlinked progress inputs that resolve outside the session directory', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-outside-'));
      try {
        fs.writeFileSync(
          path.join(outsideDir, 'conversation.jsonl'),
          JSON.stringify({ role: 'assistant', content: 'outside secret progress' }) + '\n'
        );
        fs.writeFileSync(
          path.join(outsideDir, 'progress.json'),
          JSON.stringify({
            stage: 'receiving',
            stageLabel: 'outside secret stage',
            updatedAt: new Date().toISOString()
          })
        );
        fs.symlinkSync(path.join(outsideDir, 'conversation.jsonl'), path.join(tmpDir, 'conversation.jsonl'));
        fs.symlinkSync(path.join(outsideDir, 'progress.json'), path.join(tmpDir, 'progress.json'));

        const result = readProgress(tmpDir);

        expect(result).toMatchObject({
          messages: 0,
          lastActivity: 'never',
          latest: 'Starting up...',
          lastActivityMs: null
        });
        expect(result.stage).toBeUndefined();
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('extractLatest', () => {
    it('returns "Starting up..." for empty entries array', () => {
      expect(extractLatest([])).toBe('Starting up...');
    });

    it('returns "Starting up..." when no assistant entries exist', () => {
      const entries = [
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'Init' }
      ];
      expect(extractLatest(entries)).toBe('Starting up...');
    });

    it('returns tool_use format for toolCall entries', () => {
      const entries = [
        { role: 'assistant', toolCall: { name: 'Write' } }
      ];
      expect(extractLatest(entries)).toBe('Using Write');
    });

    it('returns first line of text content', () => {
      const entries = [
        { role: 'assistant', content: 'First line\nSecond line\nThird line' }
      ];
      expect(extractLatest(entries)).toBe('First line');
    });

    it('truncates text longer than 80 chars', () => {
      const entries = [
        { role: 'assistant', content: 'B'.repeat(90) }
      ];
      expect(extractLatest(entries)).toBe('B'.repeat(80) + '...');
    });

    it('uses the last assistant entry', () => {
      const entries = [
        { role: 'assistant', content: 'Old' },
        { role: 'user', content: 'Question' },
        { role: 'assistant', toolCall: { name: 'Grep' } }
      ];
      expect(extractLatest(entries)).toBe('Using Grep');
    });

    it('returns "Executing tool call..." for tool_use entry with no toolCall.name', () => {
      const entries = [
        { role: 'assistant', type: 'tool_use', toolCall: { id: 'tool-1' } }
      ];
      expect(extractLatest(entries)).toBe('Executing tool call...');
    });

    it('returns "Executing tool call..." for tool_use entry with undefined name', () => {
      const entries = [
        { role: 'assistant', type: 'tool_use', toolCall: { id: 'tool-1', name: undefined } }
      ];
      expect(extractLatest(entries)).toBe('Executing tool call...');
    });

    it('returns "Working..." for assistant entry with no content or toolCall', () => {
      // Entry exists but has neither content nor toolCall (edge case)
      const entries = [
        { role: 'assistant', timestamp: '2026-03-09T00:00:00Z' }
      ];
      expect(extractLatest(entries)).toBe('Working...');
    });

    it('handles content that is only whitespace', () => {
      const entries = [
        { role: 'assistant', content: '\n' }
      ];
      // firstLine would be '' after split, should not return empty string
      expect(extractLatest(entries)).toBe('Working...');
    });
  });

  describe('readProgress with progress.json', () => {
    it('uses progress.json stage label when no assistant entries exist', () => {
      // Only system/user messages in conversation.jsonl
      const lines = [
        JSON.stringify({ role: 'system', content: 'System prompt' }),
        JSON.stringify({ role: 'user', content: 'User message' })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      // Progress file indicates prompt was sent
      fs.writeFileSync(
        path.join(tmpDir, 'progress.json'),
        JSON.stringify({
          stage: 'prompt_sent',
          stageLabel: 'Briefing delivered, waiting for response...',
          updatedAt: new Date().toISOString()
        })
      );

      const result = readProgress(tmpDir);

      expect(result.latest).toBe('Briefing delivered, waiting for response...');
      expect(result.stage).toBe('prompt_sent');
    });

    it('uses progress.json when conversation.jsonl does not exist', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'progress.json'),
        JSON.stringify({
          stage: 'initializing',
          stageLabel: 'Starting OpenCode server...',
          updatedAt: new Date().toISOString()
        })
      );

      const result = readProgress(tmpDir);

      expect(result.latest).toBe('Starting OpenCode server...');
      expect(result.stage).toBe('initializing');
      expect(result.messages).toBe(0);
    });

    it('prefers assistant entries over progress.json for latest', () => {
      const lines = [
        JSON.stringify({ role: 'assistant', content: 'Analyzing the code' })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      fs.writeFileSync(
        path.join(tmpDir, 'progress.json'),
        JSON.stringify({
          stage: 'receiving',
          stageLabel: 'Generating response...',
          messagesReceived: 1,
          updatedAt: new Date().toISOString()
        })
      );

      const result = readProgress(tmpDir);

      // Should use the actual assistant content, not the generic stage label
      expect(result.latest).toBe('Analyzing the code');
      expect(result.messages).toBe(1);
    });

    it('uses progress.json latest for tool_use entries without toolCall.name', () => {
      // Tool-use entry with missing name (SDK may not populate part.name)
      const lines = [
        JSON.stringify({ role: 'assistant', type: 'tool_use', toolCall: { id: 'tool-1' } })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      fs.writeFileSync(
        path.join(tmpDir, 'progress.json'),
        JSON.stringify({
          stage: 'receiving',
          stageLabel: 'Calling tool: web_search',
          latestTool: 'web_search',
          messagesReceived: 1,
          updatedAt: new Date().toISOString()
        })
      );

      const result = readProgress(tmpDir);

      // progress.json has a better label; extractLatest returns "Executing tool call..."
      // but progress.json latestTool gives us the tool name
      expect(result.latest).toBe('Calling tool: web_search');
      expect(result.stage).toBe('receiving');
    });

    it('uses extractLatest when it returns something meaningful', () => {
      // Tool-use entry with proper name
      const lines = [
        JSON.stringify({ role: 'assistant', toolCall: { name: 'Read', id: 'tool-1' } })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      fs.writeFileSync(
        path.join(tmpDir, 'progress.json'),
        JSON.stringify({
          stage: 'receiving',
          stageLabel: 'Generating response...',
          updatedAt: new Date().toISOString()
        })
      );

      const result = readProgress(tmpDir);

      // extractLatest returns "Using Read" which is better than the generic stage label
      expect(result.latest).toBe('Using Read');
    });

    it('uses messagesReceived from progress.json when conversation has no assistant entries', () => {
      const lines = [
        JSON.stringify({ role: 'system', content: 'System prompt' })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );

      fs.writeFileSync(
        path.join(tmpDir, 'progress.json'),
        JSON.stringify({
          stage: 'receiving',
          stageLabel: 'Generating response...',
          messagesReceived: 1,
          updatedAt: new Date().toISOString()
        })
      );

      const result = readProgress(tmpDir);

      expect(result.messages).toBe(1);
    });

    it('uses lastActivity from progress.json updatedAt when more recent', () => {
      // Write conversation.jsonl with old mtime
      const convPath = path.join(tmpDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'system', content: 'init' }));
      const tenMinutesAgo = new Date(Date.now() - 600000);
      fs.utimesSync(convPath, tenMinutesAgo, tenMinutesAgo);

      // Progress file updated recently
      fs.writeFileSync(
        path.join(tmpDir, 'progress.json'),
        JSON.stringify({
          stage: 'prompt_sent',
          stageLabel: 'Briefing delivered',
          updatedAt: new Date().toISOString()
        })
      );

      const result = readProgress(tmpDir);

      // Should use progress.json's time, not the old conversation.jsonl mtime
      expect(result.lastActivity).toMatch(/^\d+s ago$/);
    });

    it('ignores malformed progress.json gracefully', () => {
      const lines = [
        JSON.stringify({ role: 'assistant', content: 'Hello' })
      ];
      fs.writeFileSync(
        path.join(tmpDir, 'conversation.jsonl'),
        lines.join('\n')
      );
      fs.writeFileSync(path.join(tmpDir, 'progress.json'), '{ invalid json');

      const result = readProgress(tmpDir);

      // Should fall back to conversation.jsonl data
      expect(result.messages).toBe(1);
      expect(result.latest).toBe('Hello');
    });

    it('returns all lifecycle stages correctly', () => {
      const stages = [
        { stage: 'initializing', label: 'Starting OpenCode server...' },
        { stage: 'server_ready', label: 'Server ready, creating session...' },
        { stage: 'session_created', label: 'Session created' },
        { stage: 'prompt_sent', label: 'Briefing delivered, waiting for response...' },
      ];

      for (const { stage, label } of stages) {
        fs.writeFileSync(
          path.join(tmpDir, 'progress.json'),
          JSON.stringify({
            stage,
            stageLabel: label,
            updatedAt: new Date().toISOString()
          })
        );

        const result = readProgress(tmpDir);
        expect(result.stage).toBe(stage);
        expect(result.latest).toBe(label);
      }
    });

    it('defaults stage to undefined when no progress.json exists', () => {
      const result = readProgress(tmpDir);

      expect(result.stage).toBeUndefined();
    });
  });

  describe('lastActivityMs in readProgress', () => {
    it('returns lastActivityMs based on file mtime', () => {
      const convPath = path.join(tmpDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'assistant', content: 'hi' }));
      const tenSecondsAgo = new Date(Date.now() - 10000);
      fs.utimesSync(convPath, tenSecondsAgo, tenSecondsAgo);

      const result = readProgress(tmpDir);

      expect(result.lastActivityMs).toBeGreaterThanOrEqual(9000);
      expect(result.lastActivityMs).toBeLessThan(15000);
    });

    it('returns null lastActivityMs when no activity exists', () => {
      const result = readProgress(tmpDir);

      expect(result.lastActivityMs).toBeNull();
    });

    it('uses progress.json updatedAt for lastActivityMs when more recent', () => {
      const convPath = path.join(tmpDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'system', content: 'init' }));
      const fiveMinutesAgo = new Date(Date.now() - 300000);
      fs.utimesSync(convPath, fiveMinutesAgo, fiveMinutesAgo);

      // Progress was updated 5 seconds ago
      const fiveSecondsAgo = new Date(Date.now() - 5000);
      fs.writeFileSync(
        path.join(tmpDir, 'progress.json'),
        JSON.stringify({
          stage: 'receiving',
          stageLabel: 'Generating response...',
          updatedAt: fiveSecondsAgo.toISOString()
        })
      );

      const result = readProgress(tmpDir);

      // Should use progress.json time, not the old conversation mtime
      expect(result.lastActivityMs).toBeGreaterThanOrEqual(4000);
      expect(result.lastActivityMs).toBeLessThan(10000);
    });

    it('returns large lastActivityMs for old activity', () => {
      const convPath = path.join(tmpDir, 'conversation.jsonl');
      fs.writeFileSync(convPath, JSON.stringify({ role: 'assistant', content: 'hi' }));
      const twoMinutesAgo = new Date(Date.now() - 120000);
      fs.utimesSync(convPath, twoMinutesAgo, twoMinutesAgo);

      const result = readProgress(tmpDir);

      expect(result.lastActivityMs).toBeGreaterThanOrEqual(119000);
    });
  });

  describe('writeProgress', () => {
    it('writes progress.json with stage and label', () => {
      writeProgress(tmpDir, 'initializing');

      const data = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'progress.json'), 'utf-8')
      );
      expect(data.stage).toBe('initializing');
      expect(data.stageLabel).toBe('Starting OpenCode server...');
      expect(data.updatedAt).toBeDefined();
    });

    it('includes extra fields when provided', () => {
      writeProgress(tmpDir, 'receiving', { messagesReceived: 2 });

      const data = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'progress.json'), 'utf-8')
      );
      expect(data.stage).toBe('receiving');
      expect(data.messagesReceived).toBe(2);
    });

    it('overwrites previous progress', () => {
      writeProgress(tmpDir, 'initializing');
      writeProgress(tmpDir, 'prompt_sent');

      const data = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'progress.json'), 'utf-8')
      );
      expect(data.stage).toBe('prompt_sent');
    });

    it('handles unknown stage gracefully', () => {
      writeProgress(tmpDir, 'custom_stage');

      const data = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'progress.json'), 'utf-8')
      );
      expect(data.stage).toBe('custom_stage');
      expect(data.stageLabel).toBe('custom_stage');
    });
  });

  describe('computeLastActivity', () => {
    it('returns "never" when mtime is null', () => {
      expect(computeLastActivity(null)).toBe('never');
    });

    it('returns "never" when mtime is undefined', () => {
      expect(computeLastActivity(undefined)).toBe('never');
    });

    it('returns seconds ago for recent times', () => {
      const tenSecondsAgo = new Date(Date.now() - 10000);
      expect(computeLastActivity(tenSecondsAgo)).toBe('10s ago');
    });

    it('returns minutes ago for older times', () => {
      const threeMinutesAgo = new Date(Date.now() - 180000);
      expect(computeLastActivity(threeMinutesAgo)).toBe('3m ago');
    });

    it('returns hours ago for much older times', () => {
      const twoHoursAgo = new Date(Date.now() - 7200000);
      expect(computeLastActivity(twoHoursAgo)).toBe('2h ago');
    });

    it('returns "0s ago" for current time', () => {
      const now = new Date();
      expect(computeLastActivity(now)).toBe('0s ago');
    });
  });
});
