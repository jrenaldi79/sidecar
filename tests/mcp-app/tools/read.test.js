const { formatFileOutput } = require('../../../src/mcp-app/tools/read');

describe('formatFileOutput', () => {
  test('renders arrow-format line numbers', () => {
    const html = formatFileOutput({}, '     1\u2192const x = 1;\n     2\u2192const y = 2;');
    expect(html).toContain('tool-diff-line');
    expect(html).toContain('1');
    expect(html).toContain('const x = 1;');
  });
  test('renders pipe-format line numbers', () => {
    const html = formatFileOutput({}, '00001| const x = 1;');
    expect(html).toContain('1');
  });
  test('strips file tags', () => {
    const html = formatFileOutput({}, '<file path="test.js">\n     1\u2192hello\n</file>');
    expect(html).not.toContain('<file');
    expect(html).toContain('hello');
  });
  test('truncates long files', () => {
    const lines = Array(30).fill(0).map((_, i) => `     ${i + 1}\u2192line ${i}`).join('\n');
    const html = formatFileOutput({}, lines);
    expect(html).toContain('more');
  });
  test('handles empty output', () => {
    const html = formatFileOutput({}, '');
    expect(html).toContain('tool-diff');
  });
  test('escapes HTML in content', () => {
    const html = formatFileOutput({}, '     1\u2192<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
