/**
 * CLI Argument Parser Tests
 *
 * Spec Reference: §4 CLI Interface
 * Tests the argument parsing for all sidecar commands.
 */

const { parseArgs, validateStartArgs, validateSubagentArgs } = require('../src/cli');

describe('CLI Argument Parser', () => {
  // Set up API keys for all tests to avoid validation failures
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Set default API keys so existing tests pass
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.DEEPSEEK_API_KEY = 'test-key';
  });

  afterAll(() => {
    // Restore original environment
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });
  describe('parseArgs', () => {
    it('should parse command as first positional argument', () => {
      const result = parseArgs(['start']);
      expect(result._).toEqual(['start']);
    });

    it('should parse --model option', () => {
      const result = parseArgs(['start', '--model', 'google/gemini-2.5']);
      expect(result.model).toBe('google/gemini-2.5');
    });

    it('should parse --briefing option', () => {
      const result = parseArgs(['start', '--briefing', 'Debug the auth issue']);
      expect(result.briefing).toBe('Debug the auth issue');
    });

    it('should parse --session option', () => {
      const result = parseArgs(['start', '--session', 'abc123-def456']);
      expect(result.session).toBe('abc123-def456');
    });

    it('should default session to "current" if not specified', () => {
      const result = parseArgs(['start', '--model', 'x', '--briefing', 'y']);
      expect(result.session).toBe('current');
    });

    it('should parse --project option', () => {
      const result = parseArgs(['start', '--project', '/path/to/project']);
      expect(result.project).toBe('/path/to/project');
    });

    it('should default project to cwd if not specified', () => {
      const result = parseArgs(['start']);
      expect(result.project).toBe(process.cwd());
    });

    it('should parse --context-turns option with default of 50', () => {
      const result = parseArgs(['start']);
      expect(result['context-turns']).toBe(50);
    });

    it('should override --context-turns when specified', () => {
      const result = parseArgs(['start', '--context-turns', '100']);
      expect(result['context-turns']).toBe(100);
    });

    it('should parse --context-since option', () => {
      const result = parseArgs(['start', '--context-since', '2h']);
      expect(result['context-since']).toBe('2h');
    });

    it('should parse --context-max-tokens with default of 80000', () => {
      const result = parseArgs(['start']);
      expect(result['context-max-tokens']).toBe(80000);
    });

    it('should override --context-max-tokens when specified', () => {
      const result = parseArgs(['start', '--context-max-tokens', '120000']);
      expect(result['context-max-tokens']).toBe(120000);
    });

    it('should parse --headless flag as boolean', () => {
      const result = parseArgs(['start', '--headless']);
      expect(result.headless).toBe(true);
    });

    it('should default --headless to false', () => {
      const result = parseArgs(['start']);
      expect(result.headless).toBe(false);
    });

    it('should parse --timeout option with default of 15', () => {
      const result = parseArgs(['start']);
      expect(result.timeout).toBe(15);
    });

    it('should override --timeout when specified', () => {
      const result = parseArgs(['start', '--timeout', '30']);
      expect(result.timeout).toBe(30);
    });

    it('should parse task_id as second positional for resume/continue/read', () => {
      const result = parseArgs(['resume', 'abc123']);
      expect(result._).toEqual(['resume', 'abc123']);
    });

    it('should parse --status filter for list command', () => {
      const result = parseArgs(['list', '--status', 'complete']);
      expect(result.status).toBe('complete');
    });

    it('should parse --all flag for list command', () => {
      const result = parseArgs(['list', '--all']);
      expect(result.all).toBe(true);
    });

    it('should parse --summary flag for read command', () => {
      const result = parseArgs(['read', 'abc123', '--summary']);
      expect(result.summary).toBe(true);
    });

    it('should parse --conversation flag for read command', () => {
      const result = parseArgs(['read', 'abc123', '--conversation']);
      expect(result.conversation).toBe(true);
    });

    it('should parse --json flag for list command', () => {
      const result = parseArgs(['list', '--json']);
      expect(result.json).toBe(true);
    });

    it('should parse --version flag', () => {
      const result = parseArgs(['--version']);
      expect(result.version).toBe(true);
    });

    it('should parse --help flag', () => {
      const result = parseArgs(['--help']);
      expect(result.help).toBe(true);
    });

    describe('MCP server options', () => {
      it('should parse --mcp option with name=url format', () => {
        const result = parseArgs(['start', '--mcp', 'my-server=https://mcp.example.com']);
        expect(result.mcp).toBe('my-server=https://mcp.example.com');
      });

      it('should parse --mcp option with name=command format', () => {
        const result = parseArgs(['start', '--mcp', 'my-server=npx my-mcp-server']);
        expect(result.mcp).toBe('my-server=npx my-mcp-server');
      });

      it('should parse --mcp-config option for custom config path', () => {
        const result = parseArgs(['start', '--mcp-config', '/path/to/opencode.json']);
        expect(result['mcp-config']).toBe('/path/to/opencode.json');
      });

      it('should default mcp to undefined if not specified', () => {
        const result = parseArgs(['start', '--model', 'x', '--briefing', 'y']);
        expect(result.mcp).toBeUndefined();
      });
    });

    describe('--mode and --agent options', () => {
      it('should parse --mode build', () => {
        const result = parseArgs(['start', '--mode', 'build']);
        expect(result.mode).toBe('build');
      });

      it('should parse --mode plan', () => {
        const result = parseArgs(['start', '--mode', 'plan']);
        expect(result.mode).toBe('plan');
      });

      it('should parse --agent explore', () => {
        const result = parseArgs(['start', '--agent', 'explore']);
        expect(result.agent).toBe('explore');
      });

      it('should parse --agent general', () => {
        const result = parseArgs(['start', '--agent', 'general']);
        expect(result.agent).toBe('general');
      });

      it('should default mode to undefined when not specified', () => {
        const result = parseArgs(['start']);
        expect(result.mode).toBeUndefined();
      });
    });

    describe('--thinking option', () => {
      it('should parse --thinking option with valid effort level', () => {
        const result = parseArgs(['start', '--thinking', 'low']);
        expect(result.thinking).toBe('low');
      });

      it('should parse all valid --thinking effort levels', () => {
        const validLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'none'];
        validLevels.forEach(level => {
          const result = parseArgs(['start', '--thinking', level]);
          expect(result.thinking).toBe(level);
        });
      });

      it('should default thinking to undefined if not specified', () => {
        const result = parseArgs(['start', '--model', 'x', '--briefing', 'y']);
        expect(result.thinking).toBeUndefined();
      });

      it('should parse --thinking alongside other options', () => {
        const result = parseArgs([
          'start',
          '--model', 'openrouter/google/gemini-3-pro-preview',
          '--briefing', 'Test task',
          '--thinking', 'high',
          '--headless'
        ]);
        expect(result.model).toBe('openrouter/google/gemini-3-pro-preview');
        expect(result.briefing).toBe('Test task');
        expect(result.thinking).toBe('high');
        expect(result.headless).toBe(true);
      });
    });
  });

  describe('validateStartArgs', () => {
    it('should return error if --model is missing', () => {
      const args = { _: ['start'], briefing: 'test' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('--model');
    });

    it('should return error if --briefing is missing', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('--briefing');
    });

    it('should return valid if both --model and --briefing are present', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', briefing: 'test' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(true);
    });

    it('should validate model format (provider/model)', () => {
      const args = { _: ['start'], model: 'invalid', briefing: 'test' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('provider/model');
    });

    it('should accept valid model formats', () => {
      const validModels = [
        // Direct API formats
        'google/gemini-2.5',
        'google/gemini-2.5-pro',
        'openai/o3',
        'openai/gpt-4.1',
        'anthropic/claude-sonnet-4',
        // OpenRouter formats (3 parts)
        'openrouter/google/gemini-2.5-flash',
        'openrouter/openai/gpt-4o',
        'openrouter/anthropic/claude-sonnet-4'
      ];

      validModels.forEach(model => {
        const args = { _: ['start'], model, briefing: 'test' };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(true);
      });
    });

    it('should validate --thinking with valid effort levels', () => {
      const validLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'none'];
      validLevels.forEach(level => {
        const args = { _: ['start'], model: 'google/gemini-2.5', briefing: 'test', thinking: level };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid --thinking effort level', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', briefing: 'test', thinking: 'invalid' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('thinking');
    });

    it('should accept start command without --thinking (optional)', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', briefing: 'test' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(true);
    });

    it('should validate --timeout is a positive number', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', briefing: 'test', timeout: -5 };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should validate --context-turns is a positive number', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', briefing: 'test', 'context-turns': 0 };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('context-turns');
    });

    it('should validate --context-since format (e.g., 2h, 30m, 1d)', () => {
      const validFormats = ['30m', '2h', '1d', '12h', '90m'];
      validFormats.forEach(since => {
        const args = { _: ['start'], model: 'google/gemini-2.5', briefing: 'test', 'context-since': since };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid --context-since format', () => {
      const args = { _: ['start'], model: 'google/gemini-2.5', briefing: 'test', 'context-since': 'invalid' };
      const result = validateStartArgs(args);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('context-since');
    });
  });

  describe('validateStartArgs - comprehensive validation', () => {
    // Save original environment
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Set up default API keys so other tests pass
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.DEEPSEEK_API_KEY = 'test-key';
    });

    afterEach(() => {
      // Restore original environment
      Object.keys(process.env).forEach(key => {
        if (!(key in originalEnv)) {
          delete process.env[key];
        }
      });
      Object.assign(process.env, originalEnv);
    });

    describe('--briefing content validation', () => {
      it('should reject empty briefing', () => {
        const result = validateStartArgs({ model: 'openrouter/google/gemini-2.5-flash', briefing: '' });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('briefing');
      });

      it('should reject whitespace-only briefing', () => {
        const result = validateStartArgs({ model: 'openrouter/google/gemini-2.5-flash', briefing: '   ' });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('briefing');
      });

      it('should accept non-empty briefing', () => {
        const result = validateStartArgs({ model: 'openrouter/google/gemini-2.5-flash', briefing: 'Debug the auth issue' });
        expect(result.valid).toBe(true);
      });
    });

    describe('--project validation', () => {
      it('should reject non-existent project path', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          project: '/nonexistent/path/12345'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('project');
      });

      it('should accept valid project path', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          project: process.cwd()
        });
        expect(result.valid).toBe(true);
      });

      it('should accept when project is not specified (uses default)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('--session validation', () => {
      it('should reject explicit session ID that does not exist', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          session: 'nonexistent-session-id-12345',
          project: process.cwd()
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('session');
      });

      it('should accept "current" session (deferred resolution)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          session: 'current'
        });
        expect(result.valid).toBe(true);
      });

      it('should accept undefined session (uses default)', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('--agent validation', () => {
      it('should reject empty agent name', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          agent: '   '
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('agent');
      });

      it.each(['Build', 'Plan', 'General', 'Explore'])('should accept OpenCode native agent: %s', (agent) => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          agent
        });
        expect(result.valid).toBe(true);
      });

      it('should accept custom agent names (for user-defined OpenCode agents)', () => {
        // OpenCode allows custom agents defined in ~/.config/opencode/agents/
        // These should be passed through and validated by OpenCode at runtime
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          agent: 'my-custom-agent'
        });
        expect(result.valid).toBe(true);
      });

      it('should accept when agent is not specified', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(true);
      });
    });

    // MCP flags are OPTIONAL - only validated if explicitly provided
    describe('--mcp validation (optional, only if provided)', () => {
      it('should pass when --mcp is not provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(true);
      });

      it('should reject invalid MCP format when provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          mcp: 'invalid-format-no-equals'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('mcp');
      });

      it('should accept valid MCP URL format when provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          mcp: 'myserver=http://localhost:3000'
        });
        expect(result.valid).toBe(true);
      });

      it('should accept valid MCP command format when provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          mcp: 'myserver=npx some-mcp-server'
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('--mcp-config validation (optional, only if provided)', () => {
      it('should pass when --mcp-config is not provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(true);
      });

      it('should reject non-existent config file when provided', () => {
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task',
          'mcp-config': '/nonexistent/mcp-config.json'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('mcp-config');
      });
    });

    describe('API key validation', () => {
      it('should error when OPENROUTER_API_KEY is missing for openrouter model', () => {
        delete process.env.OPENROUTER_API_KEY;
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('OPENROUTER_API_KEY');
      });

      it('should error when GEMINI_API_KEY is missing for google model', () => {
        delete process.env.GEMINI_API_KEY;
        const result = validateStartArgs({
          model: 'google/gemini-2.5-flash',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('GEMINI_API_KEY');
      });

      it('should error when OPENAI_API_KEY is missing for openai model', () => {
        delete process.env.OPENAI_API_KEY;
        const result = validateStartArgs({
          model: 'openai/gpt-4o',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('OPENAI_API_KEY');
      });

      it('should error when ANTHROPIC_API_KEY is missing for anthropic model', () => {
        delete process.env.ANTHROPIC_API_KEY;
        const result = validateStartArgs({
          model: 'anthropic/claude-sonnet-4',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('ANTHROPIC_API_KEY');
      });

      it('should error when DEEPSEEK_API_KEY is missing for deepseek model', () => {
        delete process.env.DEEPSEEK_API_KEY;
        const result = validateStartArgs({
          model: 'deepseek/deepseek-chat',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('DEEPSEEK_API_KEY');
      });

      it('should pass when correct API key is set', () => {
        process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
        const result = validateStartArgs({
          model: 'openrouter/google/gemini-2.5-flash',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(true);
      });

      it('should pass for unknown provider (let runtime handle it)', () => {
        const result = validateStartArgs({
          model: 'custom-provider/some-model',
          briefing: 'Test task'
        });
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('validateSubagentArgs', () => {
    describe('subagent spawn', () => {
      it('should validate valid spawn command', () => {
        const args = {
          _: ['subagent', 'spawn'],
          parent: 'abc123',
          agent: 'explore',
          briefing: 'Find API endpoints'
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(true);
      });

      it('should reject spawn without --parent', () => {
        const args = {
          _: ['subagent', 'spawn'],
          agent: 'explore',
          briefing: 'Find API endpoints'
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('--parent');
      });

      it('should reject spawn without --agent', () => {
        const args = {
          _: ['subagent', 'spawn'],
          parent: 'abc123',
          briefing: 'Find API endpoints'
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('--agent');
      });

      it('should reject spawn without --briefing', () => {
        const args = {
          _: ['subagent', 'spawn'],
          parent: 'abc123',
          agent: 'explore'
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('--briefing');
      });

      it('should reject invalid agent type', () => {
        const args = {
          _: ['subagent', 'spawn'],
          parent: 'abc123',
          agent: 'invalid-agent',
          briefing: 'Task'
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid subagent type');
      });

      it('should accept OpenCode native subagent types (General and Explore)', () => {
        // Only General and Explore are valid subagent types
        const validTypes = ['General', 'Explore', 'general', 'explore'];
        validTypes.forEach(type => {
          const args = {
            _: ['subagent', 'spawn'],
            parent: 'abc123',
            agent: type,
            briefing: 'Task'
          };
          const result = validateSubagentArgs(args);
          expect(result.valid).toBe(true);
        });
      });

      it('should reject removed agent types (security and test)', () => {
        const removedTypes = ['security', 'test'];
        removedTypes.forEach(type => {
          const args = {
            _: ['subagent', 'spawn'],
            parent: 'abc123',
            agent: type,
            briefing: 'Task'
          };
          const result = validateSubagentArgs(args);
          expect(result.valid).toBe(false);
          expect(result.error).toContain('Invalid subagent type');
        });
      });
    });

    describe('subagent list', () => {
      it('should validate valid list command', () => {
        const args = {
          _: ['subagent', 'list'],
          parent: 'abc123'
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(true);
      });

      it('should reject list without --parent', () => {
        const args = {
          _: ['subagent', 'list']
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('--parent');
      });
    });

    describe('subagent read', () => {
      it('should validate valid read command', () => {
        const args = {
          _: ['subagent', 'read', 'subagent-xyz']
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(true);
      });

      it('should reject read without subagent ID', () => {
        const args = {
          _: ['subagent', 'read']
        };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('subagent ID');
      });
    });

    describe('invalid subcommands', () => {
      it('should reject missing subcommand', () => {
        const args = { _: ['subagent'] };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('requires a subcommand');
      });

      it('should reject invalid subcommand', () => {
        const args = { _: ['subagent', 'invalid'] };
        const result = validateSubagentArgs(args);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid subagent subcommand');
      });
    });
  });
});
