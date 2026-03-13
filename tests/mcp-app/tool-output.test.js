const { formatToolOutput } = require('../../src/mcp-app/tool-output');

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
