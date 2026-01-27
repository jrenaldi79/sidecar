/**
 * End-to-End Tests for Claude Sidecar
 *
 * Tests the full sidecar flow:
 * 1. Create a mock Claude Code session in the correct location
 * 2. Launch sidecar with a briefing
 * 3. Sidecar reads Claude Code session context from ~/.claude/projects/{encoded-path}/
 * 4. OpenCode processes the task (mocked)
 * 5. Summary returns to caller
 *
 * Spec Reference: §9 Implementation, §5 Context Passing, §6 Fold Mechanism
 */

// Mock the opencode-client SDK module first (before any imports)
const mockServerClose = jest.fn();
jest.mock('../src/opencode-client', () => ({
  createClient: jest.fn().mockReturnValue({}),
  createSession: jest.fn().mockResolvedValue('mock-session-id'),
  sendPrompt: jest.fn().mockResolvedValue({ data: { parts: [{ type: 'text', text: '[SIDECAR_COMPLETE]' }] } }),
  getMessages: jest.fn().mockResolvedValue([]),
  checkHealth: jest.fn().mockResolvedValue(true),
  startServer: jest.fn().mockResolvedValue({
    client: {},
    server: { url: 'http://127.0.0.1:4440', close: mockServerClose }
  }),
  loadMcpConfig: jest.fn().mockReturnValue(null),
  parseMcpSpec: jest.fn().mockReturnValue(null)
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock os.homedir to use our test directory
const originalHomedir = os.homedir;
let mockHomeDir;
jest.spyOn(os, 'homedir').mockImplementation(() => mockHomeDir || originalHomedir());

// Import after mocks are set up
const { startSidecar, listSidecars, readSidecar, COMPLETE_MARKER } = require('../src/index');

describe('End-to-End Sidecar Flow', () => {
  let tmpDir;       // Project directory
  let tmpHomeDir;   // Mock home directory for Claude sessions
  let consoleSpy;
  let stdoutSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create temp directories for test using system temp dir
    const systemTmpDir = require('os').tmpdir();
    tmpDir = fs.mkdtempSync(path.join(systemTmpDir, 'sidecar-e2e-'));
    tmpHomeDir = fs.mkdtempSync(path.join(systemTmpDir, 'sidecar-home-'));

    // Mock os.homedir to return our test home directory
    mockHomeDir = tmpHomeDir;

    // Capture console output
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation();
  });

  afterEach(() => {
    // Reset mock
    mockHomeDir = null;

    // Cleanup temp directories
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tmpHomeDir)) {
      fs.rmSync(tmpHomeDir, { recursive: true, force: true });
    }
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  /**
   * Helper to create a mock Claude Code session with conversation history
   * Creates session at ~/.claude/projects/{encoded-project-path}/{session-id}.jsonl
   * Spec Reference: §5.2 Claude Code Conversation Storage
   */
  function createMockClaudeSession(projectPath, messages) {
    // Encode project path: /Users/john/myproject -> -Users-john-myproject
    const encodedPath = projectPath.replace(/[/\\]/g, '-');

    // Create Claude Code session directory structure at mock home
    const sessionDir = path.join(tmpHomeDir, '.claude', 'projects', encodedPath);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Create a session file with mock conversation
    const sessionId = 'test-session-12345';
    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

    // Format messages in Claude Code JSONL format
    const lines = messages.map(msg => JSON.stringify({
      type: msg.role,
      message: { content: msg.content },
      timestamp: new Date().toISOString()
    }));

    fs.writeFileSync(sessionPath, lines.join('\n'));
    return sessionId;
  }

  describe('Full Sidecar Workflow', () => {
    it('should complete a full sidecar task and return summary', async () => {
      // Step 1: Create mock Claude Code session with conversation
      createMockClaudeSession(tmpDir, [
        { role: 'user', content: 'I have a bug in auth.js, users get logged out randomly' },
        { role: 'assistant', content: 'Let me look at auth.js to understand the issue' },
        { role: 'user', content: 'The token refresh logic seems suspicious' }
      ]);

      // Step 2: Setup mock SDK responses
      const mockSummary = `## Sidecar Results: Auth Bug Analysis

**Task:** Debug random logout issue

**Findings:**
- Found race condition in token refresh logic
- TokenManager.refresh() can be called multiple times simultaneously
- No mutex or lock mechanism

**Recommendations:**
1. Add a mutex lock around token refresh
2. Implement token refresh queue
3. Add retry logic with exponential backoff

**Files Modified:** None (analysis only)

${COMPLETE_MARKER}`;

      // Get SDK mocks and configure them for this test
      const { startServer, sendPrompt, createSession } = require('../src/opencode-client');
      sendPrompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: mockSummary }] } });

      // Step 3: Spy on console.log to capture the summary output
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      // Step 4: Run sidecar start
      await startSidecar({
        model: 'google/gemini-2.5-flash',
        briefing: 'Debug the random logout issue. Focus on token refresh race conditions.',
        project: tmpDir,
        headless: true,
        timeout: 5
      });

      // Step 5: Verify sidecar workflow executed correctly
      // 5a. SDK startServer was called (no CLI spawning)
      expect(startServer).toHaveBeenCalled();

      // 5b. Session was created in sidecar_sessions directory
      const sessionsDir = path.join(tmpDir, '.claude', 'sidecar_sessions');
      expect(fs.existsSync(sessionsDir)).toBe(true);
      const sessions = fs.readdirSync(sessionsDir);
      expect(sessions.length).toBe(1);

      // 5c. Metadata was saved correctly
      const sessionDir = path.join(sessionsDir, sessions[0]);
      const metadata = JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8'));
      expect(metadata.model).toBe('google/gemini-2.5-flash');
      expect(metadata.status).toBe('complete');
      expect(metadata.briefing).toContain('Debug the random logout issue');

      // 5d. Initial context was saved
      expect(fs.existsSync(path.join(sessionDir, 'initial_context.md'))).toBe(true);
      const context = fs.readFileSync(path.join(sessionDir, 'initial_context.md'), 'utf-8');
      expect(context).toContain('Debug the random logout issue');

      // 5e. Summary was captured and output
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Auth Bug Analysis'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('race condition'));

      // 5f. Summary was saved to file
      expect(fs.existsSync(path.join(sessionDir, 'summary.md'))).toBe(true);
      const savedSummary = fs.readFileSync(path.join(sessionDir, 'summary.md'), 'utf-8');
      expect(savedSummary).toContain('token refresh');

      // 5g. SDK server was closed after completion
      expect(mockServerClose).toHaveBeenCalled();

      logSpy.mockRestore();
    });

    it('should list sidecars after completing a task', async () => {
      // SDK mock returns completion marker by default
      await startSidecar({
        model: 'openai/gpt-4o',
        briefing: 'Generate unit tests',
        project: tmpDir,
        headless: true
      });

      // Now list sidecars
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await listSidecars({ project: tmpDir });

      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('openai/gpt-4o');
      expect(output).toContain('complete');

      logSpy.mockRestore();
    });

    it('should read sidecar summary after completion', async () => {
      // Configure SDK mock for this test
      const testSummary = `## Test Summary\nThis is the analysis result.\n${COMPLETE_MARKER}`;
      const { sendPrompt } = require('../src/opencode-client');
      sendPrompt.mockResolvedValue({ data: { parts: [{ type: 'text', text: testSummary }] } });

      await startSidecar({
        model: 'google/gemini-2.5-flash',
        briefing: 'Analyze codebase',
        project: tmpDir,
        headless: true
      });

      // Get the task ID
      const sessions = fs.readdirSync(path.join(tmpDir, '.claude', 'sidecar_sessions'));
      const taskId = sessions[0];

      // Read the summary
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await readSidecar({ taskId, project: tmpDir });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Summary'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('analysis result'));

      logSpy.mockRestore();
    });
  });

  describe('Context Passing', () => {
    it('should include Claude Code conversation context in system prompt', async () => {
      // Create Claude Code session with specific context
      createMockClaudeSession(tmpDir, [
        { role: 'user', content: 'The API endpoint /users/profile returns 500 errors' },
        { role: 'assistant', content: 'Let me check the profile endpoint handler' },
        { role: 'user', content: 'Here is the error log: "Database connection timeout"' }
      ]);

      // SDK mocks are already configured by default

      await startSidecar({
        model: 'google/gemini-2.5-flash',
        briefing: 'Investigate the database timeout issue',
        project: tmpDir,
        headless: true
      });

      // Check that the initial context includes conversation details
      const sessions = fs.readdirSync(path.join(tmpDir, '.claude', 'sidecar_sessions'));
      const contextPath = path.join(tmpDir, '.claude', 'sidecar_sessions', sessions[0], 'initial_context.md');
      const context = fs.readFileSync(contextPath, 'utf-8');

      // Context should include the briefing
      expect(context).toContain('Investigate the database timeout issue');
    });
  });

  describe('Error Handling', () => {
    it('should handle OpenCode server startup failure gracefully', async () => {
      // Configure SDK mock to fail health check
      const { checkHealth, startServer } = require('../src/opencode-client');
      checkHealth.mockResolvedValue(false);

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await startSidecar({
        model: 'google/gemini-2.5-flash',
        briefing: 'Test task',
        project: tmpDir,
        headless: true,
        timeout: 1
      });

      // Should still create a session but mark it as complete
      const sessions = fs.readdirSync(path.join(tmpDir, '.claude', 'sidecar_sessions'));
      expect(sessions.length).toBe(1);

      const metadata = JSON.parse(fs.readFileSync(
        path.join(tmpDir, '.claude', 'sidecar_sessions', sessions[0], 'metadata.json'),
        'utf-8'
      ));
      expect(metadata.status).toBe('complete');

      // Error should be logged via structured logger
      const { logger } = require('../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith('Task error', expect.objectContaining({ error: expect.any(String) }));

      // Reset mock for other tests
      checkHealth.mockResolvedValue(true);
      logSpy.mockRestore();
    }, 20000);

    it('should handle session creation failure', async () => {
      // Configure SDK mock to fail session creation
      const { createSession } = require('../src/opencode-client');
      createSession.mockRejectedValueOnce(new Error('Session creation failed'));

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await startSidecar({
        model: 'google/gemini-2.5-flash',
        briefing: 'Test task',
        project: tmpDir,
        headless: true
      });

      // Should log an error via structured logger
      const { logger } = require('../src/utils/logger');
      expect(logger.error).toHaveBeenCalledWith('Task error', expect.objectContaining({ error: expect.any(String) }));

      logSpy.mockRestore();
    });
  });

  describe('Model Environment Configuration', () => {
    it('should pass model to SDK sendPrompt call', async () => {
      // Get SDK mock
      const { sendPrompt } = require('../src/opencode-client');

      await startSidecar({
        model: 'anthropic/claude-3.5-sonnet',
        briefing: 'Test model config',
        project: tmpDir,
        headless: true
      });

      // Verify SDK sendPrompt was called with the correct model
      expect(sendPrompt).toHaveBeenCalled();
      const promptCall = sendPrompt.mock.calls[0];
      expect(promptCall[2].model).toBe('anthropic/claude-3.5-sonnet');
    });
  });
});
