const { formatTodoOutput } = require('../../../src/mcp-app/tools/todo');

describe('formatTodoOutput', () => {
  test('renders todo-output container', () => {
    const html = formatTodoOutput({ todos: [] }, '');
    expect(html).toContain('todo-output');
  });

  test('renders todo items from output string', () => {
    const output = '[ ] Write tests\n[x] Implement formatter';
    const html = formatTodoOutput({}, output);
    expect(html).toContain('Write tests');
    expect(html).toContain('Implement formatter');
  });

  test('marks completed items differently from pending', () => {
    const output = '[ ] pending item\n[x] done item';
    const html = formatTodoOutput({}, output);
    expect(html).toContain('pending item');
    expect(html).toContain('done item');
  });

  test('escapes HTML in todo content', () => {
    const html = formatTodoOutput({}, '<script>evil</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('handles empty output gracefully', () => {
    const html = formatTodoOutput({}, '');
    expect(html).toContain('todo-output');
  });

  test('handles null input gracefully', () => {
    const html = formatTodoOutput(null, 'some todos');
    expect(html).toContain('todo-output');
  });
});
