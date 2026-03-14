const { formatQuestionOutput } = require('../../../src/mcp-app/tools/question');

describe('formatQuestionOutput', () => {
  describe('container and header', () => {
    test('renders question-tool-container', () => {
      const html = formatQuestionOutput({ question: 'What?' }, '');
      expect(html).toContain('question-tool-container');
    });

    test('renders header with icon and label', () => {
      const html = formatQuestionOutput({ question: 'What?' }, '');
      expect(html).toContain('question-header');
      expect(html).toContain('question-icon');
      expect(html).toContain('Question');
    });

    test('adds completed class when output is present', () => {
      const html = formatQuestionOutput({ question: 'Yes?' }, 'Yes');
      expect(html).toContain('question-completed');
    });

    test('no completed class when pending', () => {
      const html = formatQuestionOutput({ question: 'Yes?' }, '');
      expect(html).not.toContain('question-completed');
    });
  });

  describe('question text', () => {
    test('shows the question text', () => {
      const html = formatQuestionOutput({ question: 'What is 2+2?' }, '');
      expect(html).toContain('question-text');
      expect(html).toContain('What is 2+2?');
    });

    test('escapes HTML in question text', () => {
      const html = formatQuestionOutput({ question: '<script>evil</script>' }, '');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    test('handles null input gracefully', () => {
      const html = formatQuestionOutput(null, '');
      expect(html).toContain('question-tool-container');
    });
  });

  describe('options (pending state)', () => {
    const input = {
      question: 'Pick a region',
      options: [
        { label: 'us-east-1', description: 'Virginia' },
        { label: 'eu-west-1', description: 'Ireland' },
      ],
    };

    test('renders option buttons with radio indicators', () => {
      const html = formatQuestionOutput(input, '');
      expect(html).toContain('question-option-btn');
      expect(html).toContain('question-radio');
    });

    test('renders option labels and descriptions', () => {
      const html = formatQuestionOutput(input, '');
      expect(html).toContain('question-btn-label');
      expect(html).toContain('us-east-1');
      expect(html).toContain('Virginia');
      expect(html).toContain('eu-west-1');
      expect(html).toContain('Ireland');
    });

    test('renders number badges', () => {
      const html = formatQuestionOutput(input, '');
      expect(html).toContain('question-option-badge');
    });

    test('highlights first option when pending', () => {
      const html = formatQuestionOutput(input, '');
      expect(html).toContain('highlighted');
    });

    test('renders "Type something else" option when pending', () => {
      const html = formatQuestionOutput(input, '');
      expect(html).toContain('question-other-btn');
      expect(html).toContain('Type something else...');
    });

    test('does not render "Type something else" when completed', () => {
      const html = formatQuestionOutput(input, 'us-east-1');
      expect(html).not.toContain('question-other-btn');
    });

    test('renders string options without descriptions', () => {
      const html = formatQuestionOutput({
        question: 'Choose one',
        options: ['Alpha', 'Beta'],
      }, '');
      expect(html).toContain('Alpha');
      expect(html).toContain('Beta');
      expect(html).not.toContain('question-btn-desc');
    });
  });

  describe('options (completed state)', () => {
    test('marks selected option', () => {
      const html = formatQuestionOutput({
        question: 'Pick',
        options: [
          { label: 'A', description: 'first' },
          { label: 'B', description: 'second' },
        ],
      }, 'A');
      // First option should have "selected" class
      expect(html).toContain('selected');
    });
  });

  describe('free-form input (pending)', () => {
    test('renders text input and submit button', () => {
      const html = formatQuestionOutput({ question: 'Name?' }, '');
      expect(html).toContain('question-freeform-input');
      expect(html).toContain('question-submit-btn');
      expect(html).toContain('Submit');
    });

    test('does not render input when completed', () => {
      const html = formatQuestionOutput({ question: 'Name?' }, 'John');
      expect(html).not.toContain('question-freeform-input');
    });
  });

  describe('answer display', () => {
    test('shows answer in green highlight when provided', () => {
      const html = formatQuestionOutput({ question: 'Yes or no?' }, 'User said yes');
      expect(html).toContain('question-selected-answer');
      expect(html).toContain('answer-label');
      expect(html).toContain('User said yes');
    });
  });

  describe('footer', () => {
    test('shows skip button when pending', () => {
      const html = formatQuestionOutput({ question: 'Optional?' }, '');
      expect(html).toContain('question-skip-btn');
      expect(html).toContain('Skip');
    });

    test('hides skip button when completed', () => {
      const html = formatQuestionOutput({ question: 'Done?' }, 'Yes');
      expect(html).not.toContain('question-skip-btn');
    });
  });

  describe('multi-question format', () => {
    test('renders counter for multi-question', () => {
      const html = formatQuestionOutput({
        questions: [
          { question: 'First question?' },
          { question: 'Second question?' },
        ],
      }, 'Both answered');
      expect(html).toContain('question-counter');
      expect(html).toContain('1 / 2');
      expect(html).toContain('First question?');
    });
  });

  describe('interactive data attributes', () => {
    test('option buttons have data-answer attribute when pending', () => {
      const html = formatQuestionOutput({
        question: 'Pick one',
        options: [
          { label: 'us-east-1', description: 'Virginia' },
          { label: 'eu-west-1', description: 'Ireland' },
        ],
      }, '');
      expect(html).toContain('data-answer="us-east-1"');
      expect(html).toContain('data-answer="eu-west-1"');
    });

    test('option buttons have data-answer when completed', () => {
      const html = formatQuestionOutput({
        question: 'Pick one',
        options: [
          { label: 'A', description: 'first' },
          { label: 'B', description: 'second' },
        ],
      }, 'A');
      expect(html).toContain('data-answer="A"');
      expect(html).toContain('data-answer="B"');
    });

    test('string options have data-answer', () => {
      const html = formatQuestionOutput({
        question: 'Choose',
        options: ['Alpha', 'Beta'],
      }, '');
      expect(html).toContain('data-answer="Alpha"');
      expect(html).toContain('data-answer="Beta"');
    });

    test('escapes HTML in data-answer attribute', () => {
      const html = formatQuestionOutput({
        question: 'Choose',
        options: [{ label: 'foo"bar', description: 'test' }],
      }, '');
      expect(html).toContain('data-answer="foo&quot;bar"');
    });

    test('skip button has data-action="skip"', () => {
      const html = formatQuestionOutput({ question: 'Optional?' }, '');
      expect(html).toContain('data-action="skip"');
    });

    test('"Type something else" button has data-action="other"', () => {
      const html = formatQuestionOutput({
        question: 'Pick',
        options: [{ label: 'A', description: 'first' }],
      }, '');
      expect(html).toContain('data-action="other"');
    });

    test('pending container has data-pending="true"', () => {
      const html = formatQuestionOutput({ question: 'Yes?' }, '');
      expect(html).toContain('data-pending="true"');
    });

    test('completed container does not have data-pending', () => {
      const html = formatQuestionOutput({ question: 'Yes?' }, 'Yes');
      expect(html).not.toContain('data-pending');
    });
  });
});
