const { apiRequest, requestSummaryFromModel } = require('../../src/utils/opencode-api');

describe('OpenCode API utilities', () => {
  test('apiRequest is a function', () => {
    expect(typeof apiRequest).toBe('function');
  });

  test('requestSummaryFromModel is a function', () => {
    expect(typeof requestSummaryFromModel).toBe('function');
  });

  test('requestSummaryFromModel returns empty string for null sessionId', async () => {
    const result = await requestSummaryFromModel(null, 3000, () => 'test');
    expect(result).toBe('');
  });
});
