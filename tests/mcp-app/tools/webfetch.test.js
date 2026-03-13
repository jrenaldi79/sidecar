const { formatWebfetchOutput } = require('../../../src/mcp-app/tools/webfetch');

describe('formatWebfetchOutput', () => {
  test('renders webfetch-output container', () => {
    const html = formatWebfetchOutput({ url: 'https://example.com' }, 'page content');
    expect(html).toContain('webfetch-output');
  });

  test('shows the URL prominently', () => {
    const html = formatWebfetchOutput({ url: 'https://example.com/page' }, 'content');
    expect(html).toContain('https://example.com/page');
  });

  test('shows truncated response content', () => {
    const html = formatWebfetchOutput({ url: 'https://example.com' }, 'Hello world content');
    expect(html).toContain('Hello world content');
  });

  test('truncates very long content', () => {
    const content = 'x'.repeat(3000);
    const html = formatWebfetchOutput({ url: 'https://example.com' }, content);
    expect(html).toContain('more');
  });

  test('escapes HTML in URL', () => {
    const html = formatWebfetchOutput({ url: 'https://example.com/<path>' }, '');
    expect(html).not.toContain('<path>');
    expect(html).toContain('&lt;path&gt;');
  });

  test('escapes HTML in content', () => {
    const html = formatWebfetchOutput({ url: 'https://x.com' }, '<script>evil</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('handles missing URL gracefully', () => {
    const html = formatWebfetchOutput({}, 'content');
    expect(html).toContain('webfetch-output');
  });

  test('handles null input gracefully', () => {
    const html = formatWebfetchOutput(null, 'content');
    expect(html).toContain('webfetch-output');
  });
});
