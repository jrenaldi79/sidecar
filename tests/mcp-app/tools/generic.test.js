const { formatGenericOutput } = require('../../../src/mcp-app/tools/generic');

describe('formatGenericOutput', () => {
  test('returns HTML with escaped text', () => {
    const html = formatGenericOutput({}, 'hello <world>');
    expect(html).toContain('hello');
    expect(html).toContain('&lt;world&gt;');
  });
  test('truncates output over 2000 chars', () => {
    const long = 'x'.repeat(3000);
    const html = formatGenericOutput({}, long);
    expect(html).toContain('characters');
  });
  test('handles empty output', () => {
    const html = formatGenericOutput({}, '');
    expect(html).toContain('tool-output');
  });
  test('handles null output', () => {
    const html = formatGenericOutput({}, null);
    expect(html).toBeTruthy();
  });
});
