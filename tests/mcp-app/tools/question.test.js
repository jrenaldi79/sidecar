const { formatQuestionOutput } = require('../../../src/mcp-app/tools/question');

describe('formatQuestionOutput', () => {
  test('renders question-output container', () => {
    const html = formatQuestionOutput({ question: 'What is 2+2?' }, '');
    expect(html).toContain('question-output');
  });

  test('shows the question text prominently', () => {
    const html = formatQuestionOutput({ question: 'What is 2+2?' }, '');
    expect(html).toContain('What is 2+2?');
  });

  test('escapes HTML in question text', () => {
    const html = formatQuestionOutput({ question: '<script>evil</script>' }, '');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('handles missing question field', () => {
    const html = formatQuestionOutput({}, 'some output');
    expect(html).toContain('question-output');
  });

  test('handles null input gracefully', () => {
    const html = formatQuestionOutput(null, '');
    expect(html).toContain('question-output');
  });

  test('shows output if provided', () => {
    const html = formatQuestionOutput({ question: 'Yes or no?' }, 'User said yes');
    expect(html).toContain('User said yes');
  });
});
