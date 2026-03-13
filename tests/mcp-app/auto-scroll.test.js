describe('auto-scroll module', () => {
  test('exports setupAutoScroll function', () => {
    const mod = require('../../src/mcp-app/auto-scroll');
    expect(typeof mod.setupAutoScroll).toBe('function');
  });
});
