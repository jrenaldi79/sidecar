/**
 * Tests for electron/setup-ui.js (Wizard Orchestrator)
 *
 * Verifies the unified wizard HTML contains all 3 steps:
 * Step 1 (API Keys), Step 2 (Model Selection), Step 3 (Review).
 * Also tests progress bar, navigation, routing state, and shared CSS.
 */

const { buildSetupHTML, PROVIDERS } = require('../electron/setup-ui');

describe('setup-ui wizard', () => {
  let html;

  beforeAll(() => {
    html = buildSetupHTML();
  });

  describe('buildSetupHTML', () => {
    it('should return a complete HTML document', () => {
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('should contain the sidecar branding', () => {
      expect(html).toContain('OpenCode Sidecar');
    });

    it('should use the dark theme colors', () => {
      expect(html).toContain('#2D2B2A'); // background
      expect(html).toContain('#D97757'); // accent
      expect(html).toContain('#E8E0D8'); // text
    });
  });

  describe('progress bar', () => {
    it('should contain 4 step indicators', () => {
      expect(html).toContain('step-1');
      expect(html).toContain('step-2');
      expect(html).toContain('step-3');
      expect(html).toContain('step-4');
    });

    it('should contain step labels', () => {
      expect(html).toContain('API Keys');
      expect(html).toContain('Models');
      expect(html).toContain('Routing');
      expect(html).toContain('Review');
    });

    it('should use "Models" instead of "Default Model" for step 2', () => {
      // Extract the progress bar section
      const progStart = html.indexOf('progress-bar');
      const progEnd = html.indexOf('</div>', html.indexOf('step-4') + 10);
      const progHtml = html.slice(progStart, progEnd);
      expect(progHtml).toContain('Models');
      expect(progHtml).not.toContain('Default Model');
    });
  });

  describe('Step 1 - API Keys', () => {
    it('should contain the keys step container', () => {
      expect(html).toContain('id="wizard-step-1"');
    });

    it('should contain provider options', () => {
      expect(html).toContain('data-provider="openrouter"');
      expect(html).toContain('data-provider="google"');
      expect(html).toContain('data-provider="openai"');
      expect(html).toContain('data-provider="anthropic"');
    });

    it('should contain an API key input field', () => {
      expect(html).toContain('api-key-input');
    });

    it('should contain a Save & Test button', () => {
      expect(html).toContain('Save &amp; Test');
    });

    it('should mark OpenRouter as recommended', () => {
      expect(html).toContain('Recommended');
    });

    it('should contain a password type input for masking', () => {
      expect(html).toContain('type="password"');
    });
  });

  describe('Step 2 - Model Selection', () => {
    it('should contain the model step container', () => {
      expect(html).toContain('id="wizard-step-2"');
    });

    it('should contain model choices', () => {
      expect(html).toContain('gemini');
      expect(html).toContain('gemini-pro');
      expect(html).toContain('gpt');
      expect(html).toContain('opus');
      expect(html).toContain('deepseek');
    });
  });

  describe('Step 3 - Aliases', () => {
    it('should contain the aliases step container', () => {
      expect(html).toContain('id="wizard-step-3"');
    });

    it('should contain the alias-editor section in step 3', () => {
      // alias-editor should be inside wizard-step-3, not wizard-step-2
      const step3Start = html.indexOf('id="wizard-step-3"');
      const step4Start = html.indexOf('id="wizard-step-4"');
      const step3Html = html.slice(step3Start, step4Start);
      expect(step3Html).toContain('alias-editor');
    });

    it('should NOT contain alias-editor in step 2', () => {
      const step2Start = html.indexOf('id="wizard-step-2"');
      const step3Start = html.indexOf('id="wizard-step-3"');
      const step2Html = html.slice(step2Start, step3Start);
      expect(step2Html).not.toContain('alias-editor');
    });
  });

  describe('Step 4 - Review', () => {
    it('should contain the review step container', () => {
      expect(html).toContain('id="wizard-step-4"');
    });

    it('should contain review summary elements', () => {
      expect(html).toContain('review-keys');
      expect(html).toContain('review-model');
    });

    it('should contain routing review section', () => {
      expect(html).toContain('review-routing');
    });

    it('should contain Setup Complete text', () => {
      expect(html).toContain('Setup Complete');
    });
  });

  describe('navigation', () => {
    it('should contain Next button', () => {
      expect(html).toContain('next-btn');
    });

    it('should contain Back button', () => {
      expect(html).toContain('back-btn');
    });

    it('should contain Finish button', () => {
      expect(html).toContain('finish-btn');
    });

    it('should contain the sidecar branding in footer', () => {
      expect(html).toContain('footer-brand');
    });
  });

  describe('IPC references', () => {
    it('should reference all required IPC channels', () => {
      expect(html).toContain('sidecar:validate-key');
      expect(html).toContain('sidecar:save-key');
      expect(html).toContain('sidecar:setup-done');
      expect(html).toContain('sidecar:save-config');
      expect(html).toContain('sidecar:get-config');
      expect(html).toContain('sidecar:get-api-keys');
    });
  });

  describe('routing state', () => {
    it('should initialize routingChoices object in script', () => {
      expect(html).toContain('routingChoices');
    });

    it('should pass MODEL_CHOICES data to script as JSON', () => {
      expect(html).toContain('modelChoicesData');
    });

    it('should pass PROVIDER_NAMES data to script as JSON', () => {
      expect(html).toContain('providerNamesData');
    });

    it('should handle route pill clicks', () => {
      expect(html).toContain('route-pill');
    });

    it('should pass routing overrides to save-config', () => {
      // The finish handler should send overrides
      expect(html).toContain('routingOverrides');
    });
  });

  describe('Step 3 - Alias Editor', () => {
    it('should contain the alias-editor section', () => {
      expect(html).toContain('alias-editor');
    });

    it('should contain the alias search input', () => {
      expect(html).toContain('alias-search');
    });

    it('should contain alias groups as details elements', () => {
      expect(html).toContain('alias-group');
    });

    it('should contain the Add Custom Alias button', () => {
      expect(html).toContain('alias-add-btn');
    });

    it('should contain aliasEdits state in script', () => {
      expect(html).toContain('aliasEdits');
    });

    it('should contain alias-search handler reference', () => {
      expect(html).toContain('alias-search');
    });
  });

  describe('PROVIDERS export', () => {
    it('should export 4 providers', () => {
      expect(PROVIDERS).toHaveLength(4);
    });

    it('should have openrouter as recommended', () => {
      const or = PROVIDERS.find(p => p.id === 'openrouter');
      expect(or.recommended).toBe(true);
    });

    it('should have unique IDs', () => {
      const ids = PROVIDERS.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
