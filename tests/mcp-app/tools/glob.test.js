const { formatGlobOutput } = require('../../../src/mcp-app/tools/glob');

describe('formatGlobOutput', () => {
  test('renders glob-results container', () => {
    const html = formatGlobOutput({ pattern: '**/*.js' }, 'src/a.js\nsrc/b.js');
    expect(html).toContain('glob-results');
  });

  test('groups files by directory with directory headers', () => {
    const output = 'src/tools/a.js\nsrc/tools/b.js\nsrc/utils/c.js';
    const html = formatGlobOutput({ pattern: '**/*.js' }, output);
    expect(html).toContain('glob-dir');
    expect(html).toContain('src/tools');
    expect(html).toContain('src/utils');
  });

  test('shows file count in directory header', () => {
    const output = 'src/a.js\nsrc/b.js\nsrc/c.js';
    const html = formatGlobOutput({}, output);
    expect(html).toContain('3');
  });

  test('renders file names with glob-file class', () => {
    const html = formatGlobOutput({}, 'src/a.js');
    expect(html).toContain('glob-file');
    expect(html).toContain('a.js');
  });

  test('renders file icons with glob-file-icon class', () => {
    const html = formatGlobOutput({}, 'src/a.js');
    expect(html).toContain('glob-file-icon');
  });

  test('escapes HTML in file paths', () => {
    const html = formatGlobOutput({}, 'src/<evil>/file.js');
    expect(html).not.toContain('<evil>');
  });

  test('truncates at 50 files with more indicator', () => {
    const paths = Array(60).fill(null).map((_, i) => `src/file${i}.js`).join('\n');
    const html = formatGlobOutput({}, paths);
    expect(html).toContain('more');
  });

  test('handles empty output', () => {
    const html = formatGlobOutput({}, '');
    expect(html).toContain('glob-results');
  });

  test('handles root-level files (no directory)', () => {
    const html = formatGlobOutput({}, 'README.md\npackage.json');
    expect(html).toContain('glob-file');
    expect(html).toContain('README.md');
  });

  test('uses file extension icons for known extensions', () => {
    const html = formatGlobOutput({}, 'src/app.ts');
    expect(html).toContain('file-icon');
  });
});
