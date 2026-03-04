/**
 * Setup UI - Step 1: API Keys
 *
 * Builds the HTML for the API key configuration step of the wizard.
 * Supports multiple providers with checkmarks for configured keys,
 * test connection, and save per provider.
 */

/** Provider metadata for the setup form */
const PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access all models (Gemini, GPT, Claude, etc.) with one key',
    placeholder: 'sk-or-v1-...',
    helpUrl: 'https://openrouter.ai/keys',
    helpLabel: 'openrouter.ai/keys',
    recommended: true
  },
  {
    id: 'google',
    name: 'Google AI (Gemini)',
    description: 'Direct access to Gemini models',
    placeholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
    helpLabel: 'aistudio.google.com/apikey',
    recommended: false
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Direct access to GPT models',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    helpLabel: 'platform.openai.com/api-keys',
    recommended: false
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Direct access to Claude models',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpLabel: 'console.anthropic.com/settings/keys',
    recommended: false
  }
];

/**
 * Build the HTML fragment for Step 1 (API Keys)
 * @param {Array} providers - Provider metadata array
 * @returns {string} HTML fragment (not a full document)
 */
function buildKeysStepHTML(providers) {
  const providerCards = providers.map(p => {
    const badge = p.recommended
      ? '<span class="badge">Recommended</span>'
      : '';
    return `<button class="provider-btn" data-provider="${p.id}">
        <span class="provider-name">${p.name}${badge}</span>
        <span class="provider-desc">${p.description}</span>
        <span class="provider-check" id="check-${p.id}"></span>
      </button>`;
  }).join('\n      ');

  return `<div class="step-content">
    <h1>Configure API Keys</h1>
    <p class="subtitle">Add at least one API key to get started.</p>

    <div class="provider-list" id="provider-list">
      ${providerCards}
    </div>

    <div class="key-section" id="key-section">
      <label class="field-label" id="key-label" for="api-key-input">API Key</label>
      <div class="input-row">
        <div class="input-wrap">
          <input id="api-key-input" type="password" placeholder="" autocomplete="off" spellcheck="false">
          <button class="eye-btn" id="eye-btn" type="button" title="Show/hide key">
            <svg id="eye-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3C4.4 3 1.4 5.4.5 8c.9 2.6 3.9 5 7.5 5s6.6-2.4 7.5-5c-.9-2.6-3.9-5-7.5-5z" stroke="currentColor" stroke-width="1.2" fill="none"/>
              <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2" fill="none"/>
            </svg>
          </button>
        </div>
        <button class="test-btn" id="test-btn">Save &amp; Test</button>
      </div>
      <div class="key-actions">
        <span id="status-msg"></span>
        <button class="remove-btn" id="remove-btn" type="button" style="display:none">Remove key</button>
      </div>
      <p class="help-link" id="help-link"></p>
    </div>
  </div>`;
}

module.exports = { buildKeysStepHTML, PROVIDERS };
