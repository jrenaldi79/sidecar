const { buildCoworkAgentPrompt } = require('../../src/prompts/cowork-agent-prompt');

describe('buildCoworkAgentPrompt', () => {
  let prompt;

  beforeAll(() => {
    prompt = buildCoworkAgentPrompt();
  });

  it('returns a non-empty string', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('identifies as Sidecar', () => {
    expect(prompt).toContain('Sidecar');
    expect(prompt).not.toContain('You are OpenCode');
    expect(prompt).not.toContain('best coding agent');
  });

  it('describes second-perspective and parallel-task purpose', () => {
    expect(prompt).toMatch(/second (perspective|opinion)/i);
    expect(prompt).toMatch(/parallel/i);
  });

  it('includes tone and formatting guidance', () => {
    expect(prompt).toMatch(/formatting/i);
    expect(prompt).toMatch(/natural/i);
    expect(prompt).toMatch(/emoji/i);
  });

  it('includes evenhandedness guidance', () => {
    expect(prompt).toMatch(/balanced|charitable/i);
    expect(prompt).toMatch(/charitable/i);
  });

  it('includes mistake-handling guidance', () => {
    expect(prompt).toMatch(/mistake/i);
    expect(prompt).toMatch(/honest/i);
  });

  it('describes general-purpose task execution', () => {
    expect(prompt).toMatch(/research/i);
    expect(prompt).toMatch(/analysis/i);
    expect(prompt).toMatch(/writing/i);
  });

  it('does not include SE-specific guidance', () => {
    expect(prompt).not.toContain('solving bugs');
    expect(prompt).not.toContain('refactoring code');
    expect(prompt).not.toContain('linting');
  });

  it('includes professional objectivity', () => {
    expect(prompt).toMatch(/accuracy/i);
    expect(prompt).toMatch(/disagree/i);
  });

  it('includes task management guidance', () => {
    expect(prompt).toMatch(/TodoWrite|task management|multi-step/i);
  });

  it('includes tool usage guidance', () => {
    expect(prompt).toMatch(/tool/i);
    expect(prompt).toMatch(/parallel/i);
  });

  it('includes clarification guidance', () => {
    expect(prompt).toMatch(/clarif/i);
    expect(prompt).toMatch(/scope|format|depth/i);
  });

  it('is under 5000 characters', () => {
    expect(prompt.length).toBeLessThan(5000);
  });
});
