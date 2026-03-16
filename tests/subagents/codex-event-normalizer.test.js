'use strict';

const {
  parseCodexJsonLine,
  normalizeCodexEvent,
  getFinalSummary,
} = require('../../src/subagents/codex-event-normalizer');

describe('codex-event-normalizer', () => {
  test('returns null for blank lines', () => {
    expect(parseCodexJsonLine('')).toBeNull();
  });

  test('throws for malformed JSON', () => {
    expect(() => parseCodexJsonLine('{oops')).toThrow(/codex json/i);
  });

  test('parses a valid codex json line', () => {
    const parsed = parseCodexJsonLine('{"type":"turn.started"}');
    expect(parsed).toEqual({ type: 'turn.started' });
  });

  test('maps observed agent_message item into assistant content', () => {
    const event = {
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'agent_message',
        text: 'READY'
      }
    };

    expect(normalizeCodexEvent(event)).toEqual({
      kind: 'assistant_text',
      content: 'READY'
    });
  });

  test('maps observed command_execution item into a tool-use style entry', () => {
    const event = {
      type: 'item.completed',
      item: {
        id: 'item_3',
        type: 'command_execution',
        command: '/bin/zsh -lc "printf \'READY\\\\n\' > /tmp/sidecar-codex-probe.txt"',
        aggregated_output: '',
        exit_code: 0,
        status: 'completed'
      }
    };

    expect(normalizeCodexEvent(event)).toEqual({
      kind: 'tool_use',
      toolCall: {
        name: 'command_execution',
        input: {
          command: '/bin/zsh -lc "printf \'READY\\\\n\' > /tmp/sidecar-codex-probe.txt"',
          exitCode: 0,
          status: 'completed'
        }
      }
    });
  });

  test('ignores non-content lifecycle events', () => {
    expect(normalizeCodexEvent({ type: 'thread.started', thread_id: 'abc' })).toBeNull();
    expect(normalizeCodexEvent({ type: 'turn.started' })).toBeNull();
  });

  test('returns the final summary from an observed final message event', () => {
    const event = {
      type: 'item.completed',
      item: {
        id: 'item_5',
        type: 'agent_message',
        text: 'done'
      }
    };

    expect(getFinalSummary(event)).toBe('done');
  });
});
