/**
 * Context Drift Detection Tests
 *
 * Spec Reference: Section 7.3 Context Drift Indicator
 * Tests detection of context staleness in sidecar sessions.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Module under test
const {
  calculateDrift,
  formatDriftWarning,
  countTurnsSince,
  isDriftSignificant
} = require('../src/drift');

describe('Context Drift Detection', () => {
  let tempDir;
  let projectDir;
  let mainSessionPath;

  beforeEach(() => {
    // Create temporary project directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-drift-test-'));
    projectDir = tempDir;

    // Create a mock main session file
    const claudeDir = path.join(tempDir, '.claude', 'projects', '-test-project');
    fs.mkdirSync(claudeDir, { recursive: true });
    mainSessionPath = path.join(claudeDir, 'main-session.jsonl');
  });

  afterEach(() => {
    // Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('countTurnsSince', () => {
    it('should count user messages (turns) since a given time', () => {
      const sessionStartTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      // Create messages: some before and some after session start
      const messages = [
        { type: 'user', message: { content: 'Before 1' }, timestamp: new Date(sessionStartTime.getTime() - 30 * 60 * 1000).toISOString() },
        { type: 'assistant', message: { content: 'Response 1' }, timestamp: new Date(sessionStartTime.getTime() - 29 * 60 * 1000).toISOString() },
        { type: 'user', message: { content: 'After 1' }, timestamp: new Date(sessionStartTime.getTime() + 10 * 60 * 1000).toISOString() },
        { type: 'assistant', message: { content: 'Response 2' }, timestamp: new Date(sessionStartTime.getTime() + 11 * 60 * 1000).toISOString() },
        { type: 'user', message: { content: 'After 2' }, timestamp: new Date(sessionStartTime.getTime() + 20 * 60 * 1000).toISOString() },
        { type: 'assistant', message: { content: 'Response 3' }, timestamp: new Date(sessionStartTime.getTime() + 21 * 60 * 1000).toISOString() }
      ];

      fs.writeFileSync(mainSessionPath, messages.map(m => JSON.stringify(m)).join('\n'));

      const turns = countTurnsSince(mainSessionPath, sessionStartTime);

      // Should count only user messages after session start: "After 1" and "After 2"
      expect(turns).toBe(2);
    });

    it('should return 0 if no turns since session start', () => {
      const sessionStartTime = new Date(); // Now

      const messages = [
        { type: 'user', message: { content: 'Old' }, timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() }
      ];

      fs.writeFileSync(mainSessionPath, messages.map(m => JSON.stringify(m)).join('\n'));

      const turns = countTurnsSince(mainSessionPath, sessionStartTime);
      expect(turns).toBe(0);
    });

    it('should only count user messages as turns', () => {
      const sessionStartTime = new Date(Date.now() - 60 * 60 * 1000);

      const messages = [
        { type: 'user', message: { content: 'User msg' }, timestamp: new Date().toISOString() },
        { type: 'assistant', message: { content: 'Assistant' }, timestamp: new Date().toISOString() },
        { type: 'tool_use', tool: 'Read', timestamp: new Date().toISOString() },
        { type: 'user', message: { content: 'User msg 2' }, timestamp: new Date().toISOString() }
      ];

      fs.writeFileSync(mainSessionPath, messages.map(m => JSON.stringify(m)).join('\n'));

      const turns = countTurnsSince(mainSessionPath, sessionStartTime);
      expect(turns).toBe(2); // Only user messages
    });

    it('should handle empty session file', () => {
      fs.writeFileSync(mainSessionPath, '');
      const sessionStartTime = new Date();

      const turns = countTurnsSince(mainSessionPath, sessionStartTime);
      expect(turns).toBe(0);
    });

    it('should handle non-existent file gracefully', () => {
      const turns = countTurnsSince('/nonexistent/path.jsonl', new Date());
      expect(turns).toBe(0);
    });
  });

  describe('isDriftSignificant', () => {
    it('should return true if age > 10 minutes per spec §7.3', () => {
      expect(isDriftSignificant(11, 0)).toBe(true);
      expect(isDriftSignificant(15, 3)).toBe(true);
    });

    it('should return true if turns > 5 per spec §7.3', () => {
      expect(isDriftSignificant(5, 6)).toBe(true);
      expect(isDriftSignificant(2, 10)).toBe(true);
    });

    it('should return false if age <= 10 and turns <= 5', () => {
      expect(isDriftSignificant(10, 5)).toBe(false);
      expect(isDriftSignificant(5, 3)).toBe(false);
      expect(isDriftSignificant(0, 0)).toBe(false);
    });

    it('should return true if both thresholds exceeded', () => {
      expect(isDriftSignificant(15, 10)).toBe(true);
    });
  });

  describe('calculateDrift', () => {
    it('should return drift object with required fields per spec §7.3', () => {
      const sessionStartTime = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago

      // Create some turns after session start
      const messages = [
        { type: 'user', message: { content: 'Turn 1' }, timestamp: new Date().toISOString() },
        { type: 'user', message: { content: 'Turn 2' }, timestamp: new Date().toISOString() }
      ];
      fs.writeFileSync(mainSessionPath, messages.map(m => JSON.stringify(m)).join('\n'));

      const drift = calculateDrift(sessionStartTime, mainSessionPath);

      // Spec §7.3: { ageMinutes, mainTurns, isSignificant }
      expect(drift).toHaveProperty('ageMinutes');
      expect(drift).toHaveProperty('mainTurns');
      expect(drift).toHaveProperty('isSignificant');
    });

    it('should calculate age in minutes', () => {
      const sessionStartTime = new Date(Date.now() - 23 * 60 * 1000); // 23 minutes ago
      fs.writeFileSync(mainSessionPath, '');

      const drift = calculateDrift(sessionStartTime, mainSessionPath);

      // Should be approximately 23 (allow for test execution time)
      expect(drift.ageMinutes).toBeGreaterThanOrEqual(22);
      expect(drift.ageMinutes).toBeLessThanOrEqual(24);
    });

    it('should count main session turns since start', () => {
      const sessionStartTime = new Date(Date.now() - 60 * 60 * 1000);

      const messages = [
        { type: 'user', message: { content: 'Turn 1' }, timestamp: new Date().toISOString() },
        { type: 'assistant', message: { content: 'Response' }, timestamp: new Date().toISOString() },
        { type: 'user', message: { content: 'Turn 2' }, timestamp: new Date().toISOString() },
        { type: 'assistant', message: { content: 'Response' }, timestamp: new Date().toISOString() },
        { type: 'user', message: { content: 'Turn 3' }, timestamp: new Date().toISOString() }
      ];
      fs.writeFileSync(mainSessionPath, messages.map(m => JSON.stringify(m)).join('\n'));

      const drift = calculateDrift(sessionStartTime, mainSessionPath);
      expect(drift.mainTurns).toBe(3);
    });

    it('should mark significant drift per spec §7.3 thresholds', () => {
      // Test >10 minutes threshold
      const oldSessionStart = new Date(Date.now() - 15 * 60 * 1000);
      fs.writeFileSync(mainSessionPath, '');

      const drift1 = calculateDrift(oldSessionStart, mainSessionPath);
      expect(drift1.isSignificant).toBe(true);

      // Test >5 turns threshold
      const recentSessionStart = new Date(Date.now() - 5 * 60 * 1000);
      const manyTurns = [];
      for (let i = 0; i < 7; i++) {
        manyTurns.push({ type: 'user', message: { content: `Turn ${i}` }, timestamp: new Date().toISOString() });
      }
      fs.writeFileSync(mainSessionPath, manyTurns.map(m => JSON.stringify(m)).join('\n'));

      const drift2 = calculateDrift(recentSessionStart, mainSessionPath);
      expect(drift2.isSignificant).toBe(true);
    });

    it('should mark insignificant drift when under thresholds', () => {
      const recentSessionStart = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes
      const fewTurns = [
        { type: 'user', message: { content: 'Turn 1' }, timestamp: new Date().toISOString() },
        { type: 'user', message: { content: 'Turn 2' }, timestamp: new Date().toISOString() }
      ];
      fs.writeFileSync(mainSessionPath, fewTurns.map(m => JSON.stringify(m)).join('\n'));

      const drift = calculateDrift(recentSessionStart, mainSessionPath);
      expect(drift.isSignificant).toBe(false);
    });

    it('should round ageMinutes', () => {
      // 23.7 minutes ago should round to 24
      const sessionStartTime = new Date(Date.now() - 23.7 * 60 * 1000);
      fs.writeFileSync(mainSessionPath, '');

      const drift = calculateDrift(sessionStartTime, mainSessionPath);
      expect(Number.isInteger(drift.ageMinutes)).toBe(true);
    });
  });

  describe('formatDriftWarning', () => {
    it('should format drift warning per spec §7.3', () => {
      const drift = {
        ageMinutes: 23,
        mainTurns: 15,
        isSignificant: true
      };

      const warning = formatDriftWarning(drift);

      // Spec §7.3: "Context Age: X minutes (Y conversation turns in main session)"
      expect(warning).toContain('Context Age');
      expect(warning).toContain('23');
      expect(warning).toContain('15');
      expect(warning).toContain('turns');
    });

    it('should include emoji indicator', () => {
      const drift = {
        ageMinutes: 5,
        mainTurns: 2,
        isSignificant: false
      };

      const warning = formatDriftWarning(drift);
      expect(warning).toContain('\uD83D\uDCCD'); // Pin emoji
    });

    it('should include drift warning for significant drift per spec §7.3', () => {
      const drift = {
        ageMinutes: 23,
        mainTurns: 15,
        isSignificant: true
      };

      const warning = formatDriftWarning(drift);

      // Spec §7.3: "Drift Warning" for significant drift
      expect(warning).toContain('Drift Warning');
      expect(warning).toContain('Verify recommendations');
    });

    it('should not include drift warning for insignificant drift', () => {
      const drift = {
        ageMinutes: 5,
        mainTurns: 2,
        isSignificant: false
      };

      const warning = formatDriftWarning(drift);

      expect(warning).not.toContain('Drift Warning');
    });

    it('should handle zero values', () => {
      const drift = {
        ageMinutes: 0,
        mainTurns: 0,
        isSignificant: false
      };

      const warning = formatDriftWarning(drift);

      expect(warning).toContain('0');
    });

    it('should return empty string for null/undefined drift', () => {
      expect(formatDriftWarning(null)).toBe('');
      expect(formatDriftWarning(undefined)).toBe('');
    });
  });

  describe('Edge cases', () => {
    it('should handle session that just started (0 age)', () => {
      const sessionStartTime = new Date();
      fs.writeFileSync(mainSessionPath, '');

      const drift = calculateDrift(sessionStartTime, mainSessionPath);

      expect(drift.ageMinutes).toBe(0);
      expect(drift.mainTurns).toBe(0);
      expect(drift.isSignificant).toBe(false);
    });

    it('should handle very old sessions', () => {
      const veryOldSession = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      fs.writeFileSync(mainSessionPath, '');

      const drift = calculateDrift(veryOldSession, mainSessionPath);

      expect(drift.ageMinutes).toBeGreaterThan(60 * 23); // At least 23 hours in minutes
      expect(drift.isSignificant).toBe(true);
    });

    it('should handle malformed JSONL in main session', () => {
      const sessionStartTime = new Date(Date.now() - 60 * 60 * 1000);
      fs.writeFileSync(mainSessionPath, 'not valid json\nalso invalid');

      // Should not throw, should return 0 turns
      const drift = calculateDrift(sessionStartTime, mainSessionPath);
      expect(drift.mainTurns).toBe(0);
    });

    it('should handle messages without timestamps', () => {
      const sessionStartTime = new Date(Date.now() - 60 * 60 * 1000);
      const messages = [
        { type: 'user', message: { content: 'No timestamp' } }
      ];
      fs.writeFileSync(mainSessionPath, messages.map(m => JSON.stringify(m)).join('\n'));

      // Should handle gracefully - messages without timestamps are excluded
      const drift = calculateDrift(sessionStartTime, mainSessionPath);
      expect(drift.mainTurns).toBe(0);
    });

    it('should accept sessionStartTime as ISO string', () => {
      const sessionStartTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      fs.writeFileSync(mainSessionPath, '');

      const drift = calculateDrift(sessionStartTime, mainSessionPath);
      expect(drift.ageMinutes).toBeGreaterThanOrEqual(14);
    });
  });
});
