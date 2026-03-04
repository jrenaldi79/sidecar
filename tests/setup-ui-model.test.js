/**
 * Tests for electron/setup-ui-model.js
 *
 * Verifies Step 2 (Model Selection) HTML contains required elements:
 * model radio cards, pre-selection support, descriptions,
 * provider routing toggles, and PROVIDER_NAMES export.
 */

const { buildModelStepHTML, MODEL_CHOICES, PROVIDER_NAMES } = require('../electron/setup-ui-model');

describe('setup-ui-model', () => {
  describe('buildModelStepHTML', () => {
    it('should return an HTML string', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('should contain radio inputs for each model choice', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      for (const choice of MODEL_CHOICES) {
        expect(html).toContain(`value="${choice.alias}"`);
      }
    });

    it('should contain model labels', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      for (const choice of MODEL_CHOICES) {
        expect(html).toContain(choice.label);
      }
    });

    it('should contain model alias names', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      for (const choice of MODEL_CHOICES) {
        expect(html).toContain(choice.alias);
      }
    });

    it('should support pre-selecting a model via selectedAlias', () => {
      const html = buildModelStepHTML(MODEL_CHOICES, 'opus');
      // The opus radio should be checked
      expect(html).toContain('value="opus"');
      // Should have a checked attribute near opus
      const opusIdx = html.indexOf('value="opus"');
      const contextStart = Math.max(0, opusIdx - 100);
      const context = html.slice(contextStart, opusIdx + 50);
      expect(context).toContain('checked');
    });

    it('should default to first choice when no selectedAlias given', () => {
      const html = buildModelStepHTML(MODEL_CHOICES);
      // First choice should be checked
      const firstAlias = MODEL_CHOICES[0].alias;
      const firstIdx = html.indexOf(`value="${firstAlias}"`);
      const contextStart = Math.max(0, firstIdx - 100);
      const context = html.slice(contextStart, firstIdx + 50);
      expect(context).toContain('checked');
    });

    it('should fall back to first choice for unknown selectedAlias', () => {
      const html = buildModelStepHTML(MODEL_CHOICES, 'nonexistent');
      const firstAlias = MODEL_CHOICES[0].alias;
      const firstIdx = html.indexOf(`value="${firstAlias}"`);
      const contextStart = Math.max(0, firstIdx - 100);
      const context = html.slice(contextStart, firstIdx + 50);
      expect(context).toContain('checked');
    });

    describe('provider routing', () => {
      it('should show route-toggle for models with multiple providers when keys configured', () => {
        const configuredKeys = { openrouter: true, google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        // gemini has both openrouter and google routes
        expect(html).toContain('route-toggle');
      });

      it('should show route-pill buttons for each available provider', () => {
        const configuredKeys = { openrouter: true, google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        expect(html).toContain('route-pill');
        expect(html).toContain('OpenRouter');
        expect(html).toContain('Google AI');
      });

      it('should show static "via OpenRouter" when only openrouter key configured', () => {
        const configuredKeys = { openrouter: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        expect(html).toContain('route-static');
        expect(html).toContain('via OpenRouter');
      });

      it('should show only static text when model has one route regardless of keys', () => {
        // deepseek only has openrouter route — no toggle at all
        const configuredKeys = { openrouter: true, google: true, openai: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        const deepseekIdx = html.indexOf('value="deepseek"');
        const cardEnd = html.indexOf('</label>', deepseekIdx);
        const cardHtml = html.slice(deepseekIdx, cardEnd);
        expect(cardHtml).toContain('route-static');
        // deepseek card should not have a route-toggle since it has only 1 route
        expect(cardHtml).not.toContain('route-toggle');
      });

      it('should hide toggles when configuredKeys not provided', () => {
        const html = buildModelStepHTML(MODEL_CHOICES);
        // Toggles exist but are hidden; static text is visible
        expect(html).toContain('route-toggle');
        expect(html).toContain('style="display:none"');
      });

      it('should include data-alias and data-provider attributes on pills', () => {
        const configuredKeys = { openrouter: true, google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        expect(html).toContain('data-alias="gemini"');
        expect(html).toContain('data-provider="openrouter"');
        expect(html).toContain('data-provider="google"');
      });

      it('should mark openrouter pill as active by default', () => {
        const configuredKeys = { openrouter: true, google: true };
        const html = buildModelStepHTML(MODEL_CHOICES, undefined, configuredKeys);
        // The first route-toggle should have the first pill with 'active' class
        const toggleIdx = html.indexOf('route-toggle');
        const toggleEnd = html.indexOf('</span>', toggleIdx);
        const toggleHtml = html.slice(toggleIdx, toggleEnd);
        expect(toggleHtml).toContain('route-pill active');
      });
    });
  });

  describe('MODEL_CHOICES', () => {
    it('should export 5 model choices', () => {
      expect(MODEL_CHOICES).toHaveLength(5);
    });

    it('should have required fields on each choice', () => {
      for (const choice of MODEL_CHOICES) {
        expect(choice).toHaveProperty('alias');
        expect(choice).toHaveProperty('label');
        expect(choice).toHaveProperty('routes');
        expect(typeof choice.alias).toBe('string');
        expect(typeof choice.label).toBe('string');
        expect(typeof choice.routes).toBe('object');
      }
    });

    it('should have unique aliases', () => {
      const aliases = MODEL_CHOICES.map(c => c.alias);
      expect(new Set(aliases).size).toBe(aliases.length);
    });

    it('should have openrouter route for every choice', () => {
      for (const choice of MODEL_CHOICES) {
        expect(choice.routes).toHaveProperty('openrouter');
        expect(choice.routes.openrouter).toContain('openrouter/');
      }
    });

    it('should have google route for gemini models', () => {
      const gemini = MODEL_CHOICES.find(c => c.alias === 'gemini');
      expect(gemini.routes).toHaveProperty('google');
      expect(gemini.routes.google).toContain('google/');

      const geminiPro = MODEL_CHOICES.find(c => c.alias === 'gemini-pro');
      expect(geminiPro.routes).toHaveProperty('google');
    });

    it('should have openai route for gpt model', () => {
      const gpt = MODEL_CHOICES.find(c => c.alias === 'gpt');
      expect(gpt.routes).toHaveProperty('openai');
      expect(gpt.routes.openai).toContain('openai/');
    });

    it('should have anthropic route for opus model', () => {
      const opus = MODEL_CHOICES.find(c => c.alias === 'opus');
      expect(opus.routes).toHaveProperty('anthropic');
      expect(opus.routes.anthropic).toContain('anthropic/');
    });

    it('should only have openrouter route for deepseek', () => {
      const deepseek = MODEL_CHOICES.find(c => c.alias === 'deepseek');
      expect(Object.keys(deepseek.routes)).toEqual(['openrouter']);
    });
  });

  describe('PROVIDER_NAMES', () => {
    it('should be exported', () => {
      expect(PROVIDER_NAMES).toBeDefined();
      expect(typeof PROVIDER_NAMES).toBe('object');
    });

    it('should have display names for all providers', () => {
      expect(PROVIDER_NAMES.openrouter).toBe('OpenRouter');
      expect(PROVIDER_NAMES.google).toBe('Google AI');
      expect(PROVIDER_NAMES.openai).toBe('OpenAI');
      expect(PROVIDER_NAMES.anthropic).toBe('Anthropic');
    });
  });
});
