/**
 * Context Panel State Manager
 *
 * Tracks token usage, context limits, and breakdown by category.
 * Provides real-time updates for the context usage modal.
 */

// Model context limits (in tokens)
const MODEL_CONTEXT_LIMITS = {
  // Gemini models
  'gemini-3-flash-preview': 1000000,
  'gemini-3-pro-preview': 2000000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-pro': 2000000,
  // OpenAI models
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'o3-mini': 200000,
  'o3': 200000,
  'o1': 200000,
  'o1-mini': 128000,
  // Claude models
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-3.5-sonnet': 200000,
  // DeepSeek
  'deepseek-chat': 64000,
  'deepseek-r1': 64000,
  // Default
  default: 128000,
};

/**
 * Estimate token count from text (~4 chars per token)
 * @param {string|null|undefined} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) {
    return 0;
  }
  return Math.floor(String(text).length / 4);
}

/**
 * Get context limit for a model
 * @param {string} modelId - Model identifier (may include provider prefix)
 * @returns {number} Context limit in tokens
 */
function getContextLimit(modelId) {
  if (!modelId) {
    return MODEL_CONTEXT_LIMITS.default;
  }

  // Remove provider prefixes (openrouter/, google/, openai/, etc.)
  const normalizedId = modelId
    .replace(/^openrouter\//, '')
    .replace(/^google\//, '')
    .replace(/^openai\//, '')
    .replace(/^anthropic\//, '');

  // Check for exact match
  if (MODEL_CONTEXT_LIMITS[normalizedId]) {
    return MODEL_CONTEXT_LIMITS[normalizedId];
  }

  // Check for partial match (model name contains key)
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (key !== 'default' && normalizedId.includes(key)) {
      return limit;
    }
  }

  return MODEL_CONTEXT_LIMITS.default;
}

/**
 * Extract text content from message content (handles string or array format)
 * @param {string|Array} content - Message content
 * @returns {string} Extracted text
 */
function extractTextContent(content) {
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .join(' ');
  }
  return '';
}

/**
 * Context Panel State Manager
 */
class ContextPanelState {
  constructor() {
    this._contextLimit = MODEL_CONTEXT_LIMITS.default;
    this._breakdown = {
      systemPrompt: 0,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      reasoning: 0,
    };
    this._usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    this._turnCount = 0;
    this._messageCount = 0;
    this._listeners = [];
  }

  /**
   * Set the current model and update context limit
   * @param {string} modelId - Model identifier
   */
  setModel(modelId) {
    this._contextLimit = getContextLimit(modelId);
    this._notify();
  }

  /**
   * Set the system prompt and calculate its tokens
   * @param {string} systemPrompt - System prompt text
   */
  setSystemPrompt(systemPrompt) {
    this._breakdown.systemPrompt = estimateTokens(systemPrompt);
    this._notify();
  }

  /**
   * Calculate token breakdown from messages array
   * @param {Array} messages - Array of message objects
   */
  calculateFromMessages(messages) {
    // Reset message-related counts (preserve system prompt)
    this._breakdown.userMessages = 0;
    this._breakdown.assistantMessages = 0;
    this._breakdown.toolCalls = 0;
    this._breakdown.reasoning = 0;
    this._turnCount = 0;
    this._messageCount = 0;

    if (!messages || !Array.isArray(messages)) {
      this._notify();
      return;
    }

    for (const msg of messages) {
      this._messageCount++;

      const role = msg.role;
      const content = extractTextContent(msg.content);

      if (role === 'user') {
        this._breakdown.userMessages += estimateTokens(content);
        this._turnCount++;
      } else if (role === 'assistant') {
        this._breakdown.assistantMessages += estimateTokens(content);

        // Process parts array for tool calls and reasoning
        if (msg.parts && Array.isArray(msg.parts)) {
          for (const part of msg.parts) {
            if (part.type === 'tool_call') {
              const input = part.input || '';
              const output = part.output || '';
              this._breakdown.toolCalls += estimateTokens(input + output);
            } else if (part.type === 'reasoning') {
              this._breakdown.reasoning += estimateTokens(part.content || '');
            }
          }
        }
      }
    }

    this._notify();
  }

  /**
   * Update usage stats from API response
   * @param {Object} usageData - Usage data from API
   */
  updateUsage(usageData) {
    if (!usageData) {
      return;
    }

    this._usage.inputTokens += usageData.input_tokens || 0;
    this._usage.outputTokens += usageData.output_tokens || 0;
    this._usage.cacheReadTokens += usageData.cache_read_input_tokens || 0;
    this._usage.cacheWriteTokens += usageData.cache_creation_input_tokens || 0;

    this._notify();
  }

  /**
   * Get current context info
   * @returns {Object} Context information
   */
  getContextInfo() {
    const totalTokens =
      this._breakdown.systemPrompt +
      this._breakdown.userMessages +
      this._breakdown.assistantMessages +
      this._breakdown.toolCalls +
      this._breakdown.reasoning;

    const usedPercentage = Math.min(
      100,
      (totalTokens / this._contextLimit) * 100
    );

    const remainingTokens = Math.max(0, this._contextLimit - totalTokens);

    return {
      totalTokens,
      contextLimit: this._contextLimit,
      usedPercentage,
      remainingTokens,
      breakdown: { ...this._breakdown },
      usage: { ...this._usage },
      turnCount: this._turnCount,
      messageCount: this._messageCount,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Register a change listener
   * @param {Function} callback - Called with context info on changes
   */
  onChange(callback) {
    this._listeners.push(callback);
  }

  /**
   * Reset all values (preserves model/context limit)
   */
  reset() {
    this._breakdown = {
      systemPrompt: 0,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      reasoning: 0,
    };
    this._usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    this._turnCount = 0;
    this._messageCount = 0;
    this._notify();
  }

  /**
   * Notify all listeners of state change
   * @private
   */
  _notify() {
    const info = this.getContextInfo();
    for (const listener of this._listeners) {
      listener(info);
    }
  }
}

// Export for Node.js (tests) and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    estimateTokens,
    getContextLimit,
    ContextPanelState,
    MODEL_CONTEXT_LIMITS,
  };
}

// Export for browser (ESLint: window is global in browser)
/* eslint-disable no-undef */
if (typeof window !== 'undefined') {
  window.ContextPanel = {
    estimateTokens,
    getContextLimit,
    ContextPanelState,
    MODEL_CONTEXT_LIMITS,
  };
}
/* eslint-enable no-undef */
