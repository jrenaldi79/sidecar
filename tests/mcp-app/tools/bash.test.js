const { formatBashOutput } = require('../../../src/mcp-app/tools/bash');

describe('formatBashOutput', () => {
  test('renders command card with highlighted command', () => {
    const html = formatBashOutput({ command: 'npm test' }, 'PASS');
    expect(html).toContain('tool-bash-command-card');
    expect(html).toContain('npm');
  });
  test('renders output lines', () => {
    const html = formatBashOutput({ command: 'ls' }, 'file.txt\ndir/');
    expect(html).toContain('file.txt');
    expect(html).toContain('tool-bash-line');
  });
  test('colorizes PASS lines as success', () => {
    const html = formatBashOutput({ command: 'npm test' }, 'PASS tests/foo.test.js');
    expect(html).toContain('success');
  });
  test('colorizes FAIL lines as error', () => {
    const html = formatBashOutput({ command: 'npm test' }, 'FAIL tests/foo.test.js');
    expect(html).toContain('error');
  });
  test('truncates long output', () => {
    const lines = Array(20).fill('output line').join('\n');
    const html = formatBashOutput({ command: 'cat' }, lines);
    expect(html).toContain('more lines');
  });
  test('handles missing command', () => {
    const html = formatBashOutput({}, 'some output');
    expect(html).toContain('tool-bash-output-card');
  });
  test('handles empty input', () => {
    const html = formatBashOutput({}, '');
    expect(html).toBeTruthy();
  });
});
