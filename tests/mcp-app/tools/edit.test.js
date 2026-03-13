const { formatEditDiff, buildEditDiffLines } = require('../../../src/mcp-app/tools/edit');

describe('buildEditDiffLines', () => {
  test('detects additions and deletions', () => {
    const lines = buildEditDiffLines({ old_string: 'foo', new_string: 'bar' });
    expect(lines.some(l => l.type === 'deletion')).toBe(true);
    expect(lines.some(l => l.type === 'addition')).toBe(true);
  });
  test('includes context lines', () => {
    const lines = buildEditDiffLines({ old_string: 'a\nb\nc\nd', new_string: 'a\nb\nX\nd' });
    expect(lines.some(l => l.type === 'context')).toBe(true);
  });
  test('supports camelCase aliases', () => {
    const lines = buildEditDiffLines({ oldString: 'hello', newString: 'world' });
    expect(lines.some(l => l.type === 'deletion')).toBe(true);
    expect(lines.some(l => l.type === 'addition')).toBe(true);
  });
  test('returns empty array when strings are identical', () => {
    const lines = buildEditDiffLines({ old_string: 'same', new_string: 'same' });
    expect(lines.every(l => l.type === 'context')).toBe(true);
    expect(lines.some(l => l.type === 'deletion')).toBe(false);
    expect(lines.some(l => l.type === 'addition')).toBe(false);
  });
  test('assigns correct line numbers to deletions', () => {
    const lines = buildEditDiffLines({ old_string: 'foo', new_string: 'bar' });
    const deletion = lines.find(l => l.type === 'deletion');
    expect(deletion.oldNum).toBe(1);
    expect(deletion.newNum).toBeNull();
  });
  test('assigns correct line numbers to additions', () => {
    const lines = buildEditDiffLines({ old_string: 'foo', new_string: 'bar' });
    const addition = lines.find(l => l.type === 'addition');
    expect(addition.newNum).toBe(1);
    expect(addition.oldNum).toBeNull();
  });
});

describe('formatEditDiff', () => {
  test('renders diff HTML', () => {
    const html = formatEditDiff({ old_string: 'foo', new_string: 'bar' });
    expect(html).toContain('tool-diff-card');
    expect(html).toContain('deletion');
    expect(html).toContain('addition');
  });
  test('handles empty input', () => {
    const html = formatEditDiff({});
    expect(html).toContain('Edit applied');
  });
  test('handles null input', () => {
    const html = formatEditDiff(null);
    expect(html).toContain('Edit applied');
  });
  test('truncates long diffs', () => {
    const old_string = Array(20).fill('old line').join('\n');
    const new_string = Array(20).fill('new line').join('\n');
    const html = formatEditDiff({ old_string, new_string });
    expect(html).toContain('more lines');
  });
  test('escapes HTML in diff content', () => {
    const html = formatEditDiff({ old_string: '<script>evil</script>', new_string: 'safe' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  test('does not truncate short diffs', () => {
    const html = formatEditDiff({ old_string: 'foo', new_string: 'bar' });
    expect(html).not.toContain('more lines');
  });
});
