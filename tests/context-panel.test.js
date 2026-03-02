/**
 * Context Panel Tests
 *
 * Tests the context usage tracking and display logic for the sidecar UI.
 * Follows TDD approach - tests written before implementation.
 */

// Module under test (will be created after tests)
const {
  estimateTokens,
  getContextLimit,
  ContextPanelState
} = require('../electron/ui/context-panel');

describe('Context Panel', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens at ~4 chars per token', () => {
      const text = 'a'.repeat(400);
      expect(estimateTokens(text)).toBe(100);
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });

    it('should round down token count', () => {
      const text = 'a'.repeat(10); // 10 chars = 2.5 tokens -> 2
      expect(estimateTokens(text)).toBe(2);
    });

    it('should handle multiline text', () => {
      const text = 'line1\nline2\nline3'; // 17 chars
      expect(estimateTokens(text)).toBe(4);
    });
  });

  describe('getContextLimit', () => {
    it('should return correct limit for Gemini 3 Flash', () => {
      expect(getContextLimit('gemini-3-flash-preview')).toBe(1000000);
      expect(getContextLimit('google/gemini-3-flash-preview')).toBe(1000000);
    });

    it('should return correct limit for Gemini 3 Pro', () => {
      expect(getContextLimit('gemini-3-pro-preview')).toBe(2000000);
    });

    it('should return correct limit for GPT-4o', () => {
      expect(getContextLimit('gpt-4o')).toBe(128000);
    });

    it('should return correct limit for o3-mini', () => {
      expect(getContextLimit('o3-mini')).toBe(200000);
    });

    it('should return correct limit for Claude models', () => {
      expect(getContextLimit('claude-sonnet-4-20250514')).toBe(200000);
      expect(getContextLimit('claude-opus-4-20250514')).toBe(200000);
    });

    it('should return default for unknown models', () => {
      expect(getContextLimit('unknown-model')).toBe(128000);
      expect(getContextLimit('')).toBe(128000);
    });

    it('should handle OpenRouter prefixed models', () => {
      expect(getContextLimit('openrouter/google/gemini-3-flash-preview')).toBe(1000000);
      expect(getContextLimit('openrouter/openai/gpt-4o')).toBe(128000);
    });
  });

  describe('ContextPanelState', () => {
    let state;

    beforeEach(() => {
      state = new ContextPanelState();
    });

    describe('initialization', () => {
      it('should initialize with default values', () => {
        const info = state.getContextInfo();
        expect(info.totalTokens).toBe(0);
        expect(info.contextLimit).toBe(128000);
        expect(info.usedPercentage).toBe(0);
        expect(info.remainingTokens).toBe(128000);
        expect(info.turnCount).toBe(0);
        expect(info.messageCount).toBe(0);
      });

      it('should have empty breakdown', () => {
        const info = state.getContextInfo();
        expect(info.breakdown.systemPrompt).toBe(0);
        expect(info.breakdown.userMessages).toBe(0);
        expect(info.breakdown.assistantMessages).toBe(0);
        expect(info.breakdown.toolCalls).toBe(0);
        expect(info.breakdown.reasoning).toBe(0);
      });

      it('should have empty usage stats', () => {
        const info = state.getContextInfo();
        expect(info.usage.inputTokens).toBe(0);
        expect(info.usage.outputTokens).toBe(0);
        expect(info.usage.cacheReadTokens).toBe(0);
        expect(info.usage.cacheWriteTokens).toBe(0);
      });
    });

    describe('setModel', () => {
      it('should update context limit based on model', () => {
        state.setModel('gemini-3-flash-preview');
        const info = state.getContextInfo();
        expect(info.contextLimit).toBe(1000000);
      });

      it('should recalculate percentages when model changes', () => {
        state.setSystemPrompt('a'.repeat(4000)); // 1000 tokens
        state.setModel('gpt-4o'); // 128K context

        let info = state.getContextInfo();
        const percentWith128K = info.usedPercentage;

        state.setModel('gemini-3-flash-preview'); // 1M context
        info = state.getContextInfo();

        expect(info.usedPercentage).toBeLessThan(percentWith128K);
      });
    });

    describe('setSystemPrompt', () => {
      it('should calculate tokens for system prompt', () => {
        state.setSystemPrompt('a'.repeat(400)); // 100 tokens
        const info = state.getContextInfo();
        expect(info.breakdown.systemPrompt).toBe(100);
        expect(info.totalTokens).toBe(100);
      });

      it('should update percentage', () => {
        state.setModel('gpt-4o'); // 128K context
        state.setSystemPrompt('a'.repeat(51200)); // 12800 tokens = 10%
        const info = state.getContextInfo();
        expect(info.usedPercentage).toBeCloseTo(10, 0);
      });
    });

    describe('calculateFromMessages', () => {
      it('should categorize user messages', () => {
        const messages = [
          { role: 'user', content: 'a'.repeat(400) } // 100 tokens
        ];
        state.calculateFromMessages(messages);
        const info = state.getContextInfo();
        expect(info.breakdown.userMessages).toBe(100);
        expect(info.turnCount).toBe(1);
      });

      it('should categorize assistant messages', () => {
        const messages = [
          { role: 'assistant', content: 'a'.repeat(800) } // 200 tokens
        ];
        state.calculateFromMessages(messages);
        const info = state.getContextInfo();
        expect(info.breakdown.assistantMessages).toBe(200);
      });

      it('should count tool calls from parts array', () => {
        const messages = [
          {
            role: 'assistant',
            parts: [
              { type: 'tool_call', input: 'a'.repeat(200), output: 'b'.repeat(200) }
            ]
          }
        ];
        state.calculateFromMessages(messages);
        const info = state.getContextInfo();
        expect(info.breakdown.toolCalls).toBe(100); // 400 chars = 100 tokens
      });

      it('should count reasoning from parts array', () => {
        const messages = [
          {
            role: 'assistant',
            parts: [
              { type: 'reasoning', content: 'a'.repeat(400) }
            ]
          }
        ];
        state.calculateFromMessages(messages);
        const info = state.getContextInfo();
        expect(info.breakdown.reasoning).toBe(100);
      });

      it('should handle mixed message types', () => {
        const messages = [
          { role: 'user', content: 'a'.repeat(400) },      // 100 user
          { role: 'assistant', content: 'b'.repeat(400) }, // 100 assistant
          { role: 'user', content: 'c'.repeat(200) }       // 50 user
        ];
        state.calculateFromMessages(messages);
        const info = state.getContextInfo();
        expect(info.breakdown.userMessages).toBe(150);
        expect(info.breakdown.assistantMessages).toBe(100);
        expect(info.totalTokens).toBe(250);
        expect(info.messageCount).toBe(3);
        expect(info.turnCount).toBe(2); // 2 user messages
      });

      it('should preserve system prompt tokens', () => {
        state.setSystemPrompt('a'.repeat(400)); // 100 tokens
        state.calculateFromMessages([
          { role: 'user', content: 'b'.repeat(400) } // 100 tokens
        ]);
        const info = state.getContextInfo();
        expect(info.breakdown.systemPrompt).toBe(100);
        expect(info.breakdown.userMessages).toBe(100);
        expect(info.totalTokens).toBe(200);
      });

      it('should handle empty messages array', () => {
        state.calculateFromMessages([]);
        const info = state.getContextInfo();
        expect(info.messageCount).toBe(0);
        expect(info.turnCount).toBe(0);
      });

      it('should handle messages with nested content', () => {
        const messages = [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a'.repeat(400) }
            ]
          }
        ];
        state.calculateFromMessages(messages);
        const info = state.getContextInfo();
        expect(info.breakdown.userMessages).toBe(100);
      });
    });

    describe('updateUsage', () => {
      it('should accumulate input/output tokens', () => {
        state.updateUsage({
          input_tokens: 100,
          output_tokens: 50
        });
        let info = state.getContextInfo();
        expect(info.usage.inputTokens).toBe(100);
        expect(info.usage.outputTokens).toBe(50);

        state.updateUsage({
          input_tokens: 200,
          output_tokens: 100
        });
        info = state.getContextInfo();
        expect(info.usage.inputTokens).toBe(300);
        expect(info.usage.outputTokens).toBe(150);
      });

      it('should track cache read tokens', () => {
        state.updateUsage({
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 80
        });
        const info = state.getContextInfo();
        expect(info.usage.cacheReadTokens).toBe(80);
      });

      it('should track cache write tokens', () => {
        state.updateUsage({
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 60
        });
        const info = state.getContextInfo();
        expect(info.usage.cacheWriteTokens).toBe(60);
      });

      it('should handle missing cache fields', () => {
        state.updateUsage({
          input_tokens: 100,
          output_tokens: 50
        });
        const info = state.getContextInfo();
        expect(info.usage.cacheReadTokens).toBe(0);
        expect(info.usage.cacheWriteTokens).toBe(0);
      });
    });

    describe('onChange callback', () => {
      it('should notify listeners on setModel', () => {
        const callback = jest.fn();
        state.onChange(callback);
        state.setModel('gpt-4o');
        expect(callback).toHaveBeenCalledTimes(1);
      });

      it('should notify listeners on setSystemPrompt', () => {
        const callback = jest.fn();
        state.onChange(callback);
        state.setSystemPrompt('test prompt');
        expect(callback).toHaveBeenCalledTimes(1);
      });

      it('should notify listeners on calculateFromMessages', () => {
        const callback = jest.fn();
        state.onChange(callback);
        state.calculateFromMessages([{ role: 'user', content: 'test' }]);
        expect(callback).toHaveBeenCalledTimes(1);
      });

      it('should notify listeners on updateUsage', () => {
        const callback = jest.fn();
        state.onChange(callback);
        state.updateUsage({ input_tokens: 100, output_tokens: 50 });
        expect(callback).toHaveBeenCalledTimes(1);
      });

      it('should pass context info to callback', () => {
        const callback = jest.fn();
        state.onChange(callback);
        state.setSystemPrompt('a'.repeat(400));

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
          breakdown: expect.objectContaining({
            systemPrompt: 100
          })
        }));
      });

      it('should support multiple listeners', () => {
        const callback1 = jest.fn();
        const callback2 = jest.fn();
        state.onChange(callback1);
        state.onChange(callback2);
        state.setModel('gpt-4o');
        expect(callback1).toHaveBeenCalledTimes(1);
        expect(callback2).toHaveBeenCalledTimes(1);
      });
    });

    describe('percentage calculations', () => {
      it('should calculate correct percentage', () => {
        state.setModel('gpt-4o'); // 128000 limit
        state.setSystemPrompt('a'.repeat(25600)); // 6400 tokens = 5%
        const info = state.getContextInfo();
        expect(info.usedPercentage).toBeCloseTo(5, 0);
      });

      it('should cap percentage at 100', () => {
        state.setModel('gpt-4o'); // 128000 limit
        // Set tokens way over limit
        state.setSystemPrompt('a'.repeat(600000)); // 150000 tokens
        const info = state.getContextInfo();
        expect(info.usedPercentage).toBe(100);
      });

      it('should calculate remaining tokens', () => {
        state.setModel('gpt-4o'); // 128000 limit
        state.setSystemPrompt('a'.repeat(40000)); // 10000 tokens
        const info = state.getContextInfo();
        expect(info.remainingTokens).toBe(118000);
      });

      it('should not go negative for remaining tokens', () => {
        state.setModel('gpt-4o'); // 128000 limit
        state.setSystemPrompt('a'.repeat(600000)); // 150000 tokens
        const info = state.getContextInfo();
        expect(info.remainingTokens).toBe(0);
      });
    });

    describe('reset', () => {
      it('should reset all values except model', () => {
        state.setModel('gpt-4o');
        state.setSystemPrompt('test');
        state.calculateFromMessages([{ role: 'user', content: 'msg' }]);
        state.updateUsage({ input_tokens: 100, output_tokens: 50 });

        state.reset();

        const info = state.getContextInfo();
        expect(info.totalTokens).toBe(0);
        expect(info.breakdown.systemPrompt).toBe(0);
        expect(info.breakdown.userMessages).toBe(0);
        expect(info.usage.inputTokens).toBe(0);
        expect(info.contextLimit).toBe(128000); // Model preserved
      });
    });
  });
});
