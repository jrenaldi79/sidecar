const { formatListOutput } = require('../../../src/mcp-app/tools/list');

describe('formatListOutput', () => {
  test('renders list-output container', () => {
    const html = formatListOutput({ path: '/src' }, 'file.js\ndir/');
    expect(html).toContain('list-output');
  });

  test('shows directory path if provided', () => {
    const html = formatListOutput({ path: '/src/utils' }, 'a.js\nb.js');
    expect(html).toContain('/src/utils');
  });

  test('renders each file entry', () => {
    const html = formatListOutput({ path: '/src' }, 'alpha.js\nbeta.ts');
    expect(html).toContain('alpha.js');
    expect(html).toContain('beta.ts');
  });

  test('escapes HTML in file names', () => {
    const html = formatListOutput({}, '<script>.js');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('handles empty output gracefully', () => {
    const html = formatListOutput({ path: '/empty' }, '');
    expect(html).toContain('list-output');
  });

  test('handles null input gracefully', () => {
    const html = formatListOutput(null, 'a.js');
    expect(html).toContain('list-output');
  });
});
