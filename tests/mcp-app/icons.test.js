const { getToolIcon, getFileIcon } = require('../../src/mcp-app/icons');

describe('getToolIcon', () => {
  test('returns SVG for bash', () => {
    expect(getToolIcon('bash')).toContain('<svg');
  });
  test('returns SVG for unknown tool', () => {
    expect(getToolIcon('unknown_tool')).toContain('<svg');
  });
  test('is case-insensitive', () => {
    expect(getToolIcon('Bash')).toEqual(getToolIcon('bash'));
  });
  test('returns different icons for different tools', () => {
    expect(getToolIcon('bash')).not.toEqual(getToolIcon('read'));
  });
});

describe('getFileIcon', () => {
  test('returns JS badge for js extension', () => {
    expect(getFileIcon('js')).toContain('JS');
  });
  test('returns TS badge for ts extension', () => {
    expect(getFileIcon('ts')).toContain('TS');
  });
  test('returns default for unknown extension', () => {
    expect(getFileIcon('xyz')).toContain('file-icon');
  });
  test('handles yaml alias', () => {
    expect(getFileIcon('yaml')).toEqual(getFileIcon('yml'));
  });
});
