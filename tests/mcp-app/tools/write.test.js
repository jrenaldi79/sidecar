const { formatWriteOutput } = require('../../../src/mcp-app/tools/write');

describe('formatWriteOutput', () => {
  test('renders file path prominently', () => {
    const html = formatWriteOutput({ file_path: 'src/foo.js', content: 'hello' }, 'File written.');
    expect(html).toContain('src/foo.js');
    expect(html).toContain('tool-diff-card');
  });

  test('renders all content lines as additions with + gutter', () => {
    const html = formatWriteOutput({ file_path: 'a.js', content: 'line1\nline2' }, '');
    expect(html).toContain('tool-diff-line addition');
    expect(html).toContain('tool-diff-gutter addition');
    expect(html).toContain('+');
    expect(html).toContain('line1');
    expect(html).toContain('line2');
  });

  test('escapes HTML in content', () => {
    const html = formatWriteOutput({ file_path: 'x.js', content: '<script>alert(1)</script>' }, '');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('escapes HTML in file_path', () => {
    const html = formatWriteOutput({ file_path: '<evil>/path', content: 'x' }, '');
    expect(html).not.toContain('<evil>');
    expect(html).toContain('&lt;evil&gt;');
  });

  test('truncates at 12 lines with show more toggle', () => {
    const content = Array(20).fill('a line').join('\n');
    const html = formatWriteOutput({ file_path: 'f.js', content }, '');
    expect(html).toContain('Show');
    expect(html).toContain('more lines');
  });

  test('does not show toggle when content is within limit', () => {
    const content = Array(5).fill('a line').join('\n');
    const html = formatWriteOutput({ file_path: 'f.js', content }, '');
    expect(html).not.toContain('more lines');
  });

  test('handles missing input gracefully', () => {
    const html = formatWriteOutput(null, 'File written.');
    expect(html).toBeTruthy();
  });

  test('handles empty content', () => {
    const html = formatWriteOutput({ file_path: 'f.js', content: '' }, '');
    expect(html).toContain('tool-diff-card');
  });

  test('shows line numbers as additions', () => {
    const html = formatWriteOutput({ file_path: 'f.js', content: 'only line' }, '');
    expect(html).toContain('tool-diff-line-number');
    expect(html).toContain('only line');
  });
});
