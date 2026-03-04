/**
 * Tests for electron/setup-ui-keys.js
 *
 * Verifies Step 1 (API Keys) HTML contains required elements:
 * provider cards, checkmark indicators, key input, save/test buttons.
 */

const { buildKeysStepHTML, PROVIDERS } = require('../electron/setup-ui-keys');

describe('setup-ui-keys', () => {
  describe('buildKeysStepHTML', () => {
    let html;

    beforeAll(() => {
      html = buildKeysStepHTML(PROVIDERS);
    });

    it('should return an HTML string', () => {
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('should contain provider buttons for all 4 providers', () => {
      expect(html).toContain('data-provider="openrouter"');
      expect(html).toContain('data-provider="google"');
      expect(html).toContain('data-provider="openai"');
      expect(html).toContain('data-provider="anthropic"');
    });

    it('should mark OpenRouter as recommended', () => {
      expect(html).toContain('Recommended');
    });

    it('should contain checkmark indicator elements', () => {
      expect(html).toContain('provider-check');
    });

    it('should contain an API key input', () => {
      expect(html).toContain('api-key-input');
    });

    it('should contain a Save & Test button', () => {
      expect(html).toContain('Save &amp; Test');
    });

    it('should contain status message area', () => {
      expect(html).toContain('status-msg');
    });

    it('should contain help link area', () => {
      expect(html).toContain('help-link');
    });

    it('should contain provider descriptions', () => {
      for (const p of PROVIDERS) {
        expect(html).toContain(p.description);
      }
    });
  });

  describe('PROVIDERS', () => {
    it('should export 4 providers', () => {
      expect(PROVIDERS).toHaveLength(4);
    });

    it('should have required fields on each provider', () => {
      for (const p of PROVIDERS) {
        expect(p).toHaveProperty('id');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('description');
        expect(p).toHaveProperty('placeholder');
        expect(p).toHaveProperty('helpUrl');
        expect(p).toHaveProperty('helpLabel');
      }
    });

    it('should have exactly one recommended provider', () => {
      const recommended = PROVIDERS.filter(p => p.recommended);
      expect(recommended).toHaveLength(1);
      expect(recommended[0].id).toBe('openrouter');
    });
  });
});
