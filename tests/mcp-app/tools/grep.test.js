const { formatGrepOutput } = require('../../../src/mcp-app/tools/grep');

describe('formatGrepOutput', () => {
  test('renders grep-results container', () => {
    const html = formatGrepOutput({ pattern: 'foo' }, 'src/a.js:10:foo bar');
    expect(html).toContain('grep-results');
  });

  test('groups results by file path with file header', () => {
    const output = 'src/a.js:10:foo\nsrc/a.js:20:foo again\nsrc/b.js:5:foo here';
    const html = formatGrepOutput({ pattern: 'foo' }, output);
    expect(html).toContain('grep-file');
    expect(html).toContain('src/a.js');
    expect(html).toContain('src/b.js');
  });

  test('shows match count badges per file', () => {
    const output = 'src/a.js:10:foo\nsrc/a.js:20:foo again';
    const html = formatGrepOutput({ pattern: 'foo' }, output);
    expect(html).toContain('2');
  });

  test('shows line numbers and content for each match', () => {
    const html = formatGrepOutput({ pattern: 'foo' }, 'src/a.js:42:match content here');
    expect(html).toContain('grep-line-num');
    expect(html).toContain('42');
    expect(html).toContain('match content here');
  });

  test('highlights pattern in results', () => {
    const html = formatGrepOutput({ pattern: 'foo' }, 'src/a.js:1:foo bar');
    expect(html).toContain('grep-highlight');
  });

  test('escapes HTML in output content', () => {
    const html = formatGrepOutput({ pattern: 'x' }, 'src/a.js:1:<script>evil</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('truncates at 50 matches total', () => {
    const lines = Array(60).fill('src/a.js:1:match').join('\n');
    const html = formatGrepOutput({ pattern: 'match' }, lines);
    expect(html).toContain('more');
  });

  test('handles empty output', () => {
    const html = formatGrepOutput({ pattern: 'foo' }, '');
    expect(html).toContain('grep-results');
    expect(html).not.toContain('grep-match');
  });

  test('handles missing input pattern gracefully', () => {
    const html = formatGrepOutput({}, 'src/a.js:1:something');
    expect(html).toContain('grep-match');
    expect(html).toContain('something');
  });

  test('uses grep-match class for each match row', () => {
    const html = formatGrepOutput({ pattern: 'x' }, 'src/a.js:5:x content');
    expect(html).toContain('grep-match');
  });
});
