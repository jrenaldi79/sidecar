const { highlightCode, formatBashCommand } = require('../../src/mcp-app/highlight');

describe('highlightCode', () => {
  test('highlights JS keywords', () => {
    const result = highlightCode('const x = 1;', 'js');
    expect(result).toContain('hl-keyword');
    expect(result).toContain('hl-number');
  });
  test('highlights strings', () => {
    const result = highlightCode('const s = "hello";', 'js');
    expect(result).toContain('hl-string');
  });
  test('highlights function calls', () => {
    const result = highlightCode('console.log("hi")', 'js');
    expect(result).toContain('hl-function');
  });
  test('highlights comments', () => {
    const result = highlightCode('// this is a comment', 'js');
    expect(result).toContain('hl-comment');
  });
  test('escapes HTML in code', () => {
    const result = highlightCode('<div>test</div>', 'html');
    expect(result).toContain('&lt;div&gt;');
  });
  test('handles empty input', () => {
    expect(highlightCode('', 'js')).toBe('');
  });
});

describe('formatBashCommand', () => {
  test('highlights common commands', () => {
    const result = formatBashCommand('git status');
    expect(result).toContain('bash-cmd');
  });
  test('highlights flags', () => {
    const result = formatBashCommand('ls -la --all');
    expect(result).toContain('bash-flag');
  });
  test('highlights strings', () => {
    const result = formatBashCommand('echo "hello world"');
    expect(result).toContain('bash-string');
  });
  test('handles empty input', () => {
    expect(formatBashCommand('')).toBe('');
  });
});
