const { renderMarkdown } = require('../../src/mcp-app/markdown');

describe('renderMarkdown', () => {
  test('renders bold text with <strong> tags', () => {
    const result = renderMarkdown('**bold**');
    expect(result).toContain('<strong>');
    expect(result).toContain('bold');
  });

  test('renders italic text with <em> tags', () => {
    const result = renderMarkdown('*italic*');
    expect(result).toContain('<em>');
  });

  test('renders inline code with <code> tags', () => {
    const result = renderMarkdown('use `require()` here');
    expect(result).toContain('<code>');
    expect(result).toContain('require()');
  });

  test('renders code blocks with syntax highlighting classes', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain('hl-keyword');
  });

  test('code blocks include a language label when language is specified', () => {
    const result = renderMarkdown('```python\ndef foo():\n    pass\n```');
    expect(result).toContain('code-language');
    expect(result).toContain('python');
  });

  test('escapes <script> tags found in markdown input', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
  });

  test('escapes raw HTML angle brackets in plain text', () => {
    const result = renderMarkdown('foo <bar> baz');
    expect(result).not.toContain('<bar>');
  });

  test('preserves line breaks in GFM mode', () => {
    // GFM hard line breaks: two trailing spaces before newline
    const result = renderMarkdown('line one  \nline two');
    expect(result).toContain('<br');
  });

  test('renders headings', () => {
    const result = renderMarkdown('# Heading');
    expect(result).toContain('<h1');
  });

  test('renders unordered lists', () => {
    const result = renderMarkdown('- item one\n- item two');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
  });

  test('renders ordered lists', () => {
    const result = renderMarkdown('1. first\n2. second');
    expect(result).toContain('<ol>');
    expect(result).toContain('<li>');
  });

  test('returns string output', () => {
    const result = renderMarkdown('hello');
    expect(typeof result).toBe('string');
  });

  test('handles empty string input', () => {
    const result = renderMarkdown('');
    expect(typeof result).toBe('string');
  });

  test('falls back to escaped text when marked throws', () => {
    // Temporarily break marked to simulate a throw
    const markdown = require('../../src/mcp-app/markdown');
    const marked = require('marked');
    const originalParse = marked.parse;
    marked.parse = () => { throw new Error('parse error'); };

    const result = markdown.renderMarkdown('<b>hello</b>');
    expect(result).not.toContain('<b>');
    expect(result).toContain('hello');

    marked.parse = originalParse;
  });

  test('code block without language has no code-language label', () => {
    const result = renderMarkdown('```\nsome code\n```');
    expect(result).not.toContain('code-language');
  });
});
