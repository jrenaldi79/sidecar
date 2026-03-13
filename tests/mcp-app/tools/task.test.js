const { formatTaskOutput } = require('../../../src/mcp-app/tools/task');

describe('formatTaskOutput', () => {
  test('renders task-output container', () => {
    const html = formatTaskOutput({ id: 'task-123' }, 'completed');
    expect(html).toContain('task-output');
  });

  test('shows task ID when provided in input', () => {
    const html = formatTaskOutput({ id: 'task-abc' }, '');
    expect(html).toContain('task-abc');
  });

  test('shows status from output', () => {
    const html = formatTaskOutput({}, 'Task completed successfully');
    expect(html).toContain('Task completed successfully');
  });

  test('escapes HTML in task ID', () => {
    const html = formatTaskOutput({ id: '<evil>' }, '');
    expect(html).not.toContain('<evil>');
    expect(html).toContain('&lt;evil&gt;');
  });

  test('escapes HTML in output', () => {
    const html = formatTaskOutput({}, '<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('handles null input gracefully', () => {
    const html = formatTaskOutput(null, 'some status');
    expect(html).toContain('task-output');
  });

  test('handles empty output gracefully', () => {
    const html = formatTaskOutput({ id: 't1' }, '');
    expect(html).toContain('task-output');
  });
});
