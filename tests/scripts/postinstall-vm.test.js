const { checkVMPrerequisites } = require('../../scripts/postinstall');

describe('checkVMPrerequisites', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  test('returns empty array on non-darwin platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const warnings = checkVMPrerequisites();
    expect(warnings).toEqual([]);
  });

  test('returns warning when Claude Desktop not found', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const warnings = checkVMPrerequisites({
      claudeAppPath: '/nonexistent/Claude.app',
      coworkImagePath: '/nonexistent/rootfs.img',
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('Claude Desktop');
  });

  test('returns warning when Cowork VM image not found', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const warnings = checkVMPrerequisites({
      claudeAppPath: '/Applications', // exists on macOS
      coworkImagePath: '/nonexistent/rootfs.img',
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('Cowork VM image');
  });
});
