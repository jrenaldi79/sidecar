/**
 * CLI Argument Parser Tests
 *
 * Spec Reference: §4 CLI Interface
 * Tests the argument parsing for all sidecar commands.
 */

const { parseArgs, validateStartArgs } = require('../src/cli');

describe('CLI Argument Parser', () => {
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
        'google/gemini-2.5',
        'google/gemini-2.5-pro',
        'openai/o3',
        'openai/gpt-4.1',
        'anthropic/claude-sonnet-4'
      ];

      validModels.forEach(model => {
        const args = { _: ['start'], model, briefing: 'test' };
        const result = validateStartArgs(args);
        expect(result.valid).toBe(true);
      });
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
});
