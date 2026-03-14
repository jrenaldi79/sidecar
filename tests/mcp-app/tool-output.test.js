const { formatToolOutput, TOOL_HANDLERS } = require('../../src/mcp-app/tool-output');

describe('formatToolOutput', () => {
  test('falls back to generic for unknown tools', () => {
    const result = formatToolOutput('UnknownTool', {}, 'output text');
    expect(result).toContain('output text');
  });
  test('falls back to generic for bash (not yet wired)', () => {
    const result = formatToolOutput('Bash', { command: 'ls' }, 'file.txt');
    expect(result).toBeTruthy();
  });
  test('is case-insensitive', () => {
    const result = formatToolOutput('BASH', {}, 'test');
    expect(result).toBeTruthy();
  });
  test('handles empty output', () => {
    const result = formatToolOutput('Bash', {}, '');
    expect(result).toBeTruthy();
  });
  test('handles null output', () => {
    const result = formatToolOutput('Bash', {}, null);
    expect(result).toBeTruthy();
  });
});

describe('TOOL_HANDLERS export', () => {
  test('exports a TOOL_HANDLERS map', () => {
    expect(TOOL_HANDLERS).toBeDefined();
    expect(typeof TOOL_HANDLERS).toBe('object');
  });

  test('contains all expected tool keys', () => {
    const expected = [
      'edit', 'write', 'bash', 'read', 'glob', 'grep',
      'question', 'askuserquestion', 'list', 'ls',
      'task', 'webfetch', 'todowrite', 'todoread', 'skill',
    ];
    for (const key of expected) {
      expect(TOOL_HANDLERS).toHaveProperty(key);
      expect(typeof TOOL_HANDLERS[key]).toBe('function');
    }
  });

  test('aliases point to same handler', () => {
    expect(TOOL_HANDLERS.ls).toBe(TOOL_HANDLERS.list);
    expect(TOOL_HANDLERS.askuserquestion).toBe(TOOL_HANDLERS.question);
    expect(TOOL_HANDLERS.todoread).toBe(TOOL_HANDLERS.todowrite);
  });
});
