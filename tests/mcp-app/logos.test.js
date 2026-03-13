const { getModelLogo, getModelColor, KNOWN_MODELS } = require('../../src/mcp-app/logos');

describe('Logo Registry', () => {
  test('returns SVG string for known models', () => {
    const svg = getModelLogo('gemini');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  test('returns fallback for unknown models', () => {
    const svg = getModelLogo('unknown-model-xyz');
    expect(svg).toContain('?');
  });

  test('returns color for known models', () => {
    expect(getModelColor('gemini')).toBe('#8E75B2');
    expect(getModelColor('openai')).toBe('#ffffff');
    expect(getModelColor('grok')).toBe('#ffffff');
    expect(getModelColor('llama')).toBe('#0081FB');
    expect(getModelColor('deepseek')).toBe('#4D6BFE');
  });

  test('returns default color for unknown models', () => {
    expect(getModelColor('unknown')).toBe('#999999');
  });

  test('matches model names case-insensitively', () => {
    expect(getModelLogo('Gemini')).toEqual(getModelLogo('gemini'));
    expect(getModelLogo('GPT-4')).toEqual(getModelLogo('openai'));
  });

  test('matches model names from full provider strings', () => {
    expect(getModelLogo('openrouter/google/gemini-2.5-flash')).toContain('<svg');
    expect(getModelLogo('openrouter/openai/gpt-4o')).toContain('<svg');
  });

  test('KNOWN_MODELS contains all supported providers', () => {
    expect(KNOWN_MODELS).toContain('gemini');
    expect(KNOWN_MODELS).toContain('openai');
    expect(KNOWN_MODELS).toContain('grok');
    expect(KNOWN_MODELS).toContain('llama');
    expect(KNOWN_MODELS).toContain('deepseek');
  });
});
