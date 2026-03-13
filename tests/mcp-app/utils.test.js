const { escapeHtml, copyIconSvg, chevronRightSvg, chevronDownSvg } = require('../../src/mcp-app/utils');

describe('escapeHtml', () => {
  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
  test('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });
  test('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
  test('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
  test('passes through safe text', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('SVG constants', () => {
  test('copyIconSvg is an SVG string', () => {
    expect(copyIconSvg).toContain('<svg');
  });
  test('chevronRightSvg is an SVG string', () => {
    expect(chevronRightSvg).toContain('<svg');
  });
  test('chevronDownSvg is an SVG string', () => {
    expect(chevronDownSvg).toContain('<svg');
  });
});
