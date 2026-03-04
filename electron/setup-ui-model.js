/**
 * Setup UI - Step 2: Default Model Selection
 *
 * Builds the HTML for the model selection step of the wizard.
 * Renders radio card choices with provider routing and pre-selection support.
 */

/** @type {Array<{alias: string, label: string, routes: Object<string,string>}>} */
const MODEL_CHOICES = [
  { alias: 'gemini', label: 'Gemini 3 Flash \u2014 fast, large context',
    routes: { openrouter: 'openrouter/google/gemini-3-flash-preview',
              google: 'google/gemini-3-flash-preview' } },
  { alias: 'gemini-pro', label: 'Gemini 3 Pro \u2014 advanced reasoning',
    routes: { openrouter: 'openrouter/google/gemini-3-pro-preview',
              google: 'google/gemini-3-pro-preview' } },
  { alias: 'gpt', label: 'GPT-5.2 Chat \u2014 strong coding',
    routes: { openrouter: 'openrouter/openai/gpt-5.2-chat',
              openai: 'openai/gpt-5.2-chat' } },
  { alias: 'opus', label: 'Claude Opus 4.6 \u2014 deep analysis',
    routes: { openrouter: 'openrouter/anthropic/claude-opus-4.6',
              anthropic: 'anthropic/claude-opus-4.6' } },
  { alias: 'deepseek', label: 'DeepSeek v3.2 \u2014 open-source',
    routes: { openrouter: 'openrouter/deepseek/deepseek-v3.2' } },
];

const PROVIDER_NAMES = {
  openrouter: 'OpenRouter',
  google: 'Google AI',
  openai: 'OpenAI',
  anthropic: 'Anthropic'
};

/**
 * Build the HTML fragment for Step 2 (Model Selection)
 * @param {Array<{alias: string, label: string, routes: Object<string,string>}>} choices
 * @param {string} [selectedAlias] - Pre-selected alias, defaults to first choice
 * @param {Object<string,boolean>} [configuredKeys] - Provider IDs the user has keys for
 * @returns {string} HTML fragment
 */
function buildModelStepHTML(choices, selectedAlias, configuredKeys = {}) {
  const validAliases = choices.map(c => c.alias);
  const selected = validAliases.includes(selectedAlias)
    ? selectedAlias
    : choices[0].alias;

  const cards = choices.map(c => {
    const checked = c.alias === selected ? 'checked' : '';
    const providers = Object.keys(c.routes);
    const available = providers.filter(p => configuredKeys[p]);
    const hasMultipleRoutes = providers.length >= 2;
    const showToggle = available.length >= 2;
    let routeHtml = '';
    if (hasMultipleRoutes) {
      const pills = providers.map((p, i) => {
        const cls = i === 0 ? 'route-pill active' : 'route-pill';
        return `<button class="${cls}" data-alias="${c.alias}" data-provider="${p}">${PROVIDER_NAMES[p]}</button>`;
      }).join('');
      const toggleDisplay = showToggle ? '' : ' style="display:none"';
      const staticDisplay = showToggle ? ' style="display:none"' : '';
      routeHtml = `<span class="route-toggle" data-alias="${c.alias}"${toggleDisplay}>${pills}</span>`;
      routeHtml += `<span class="route-static" data-alias="${c.alias}"${staticDisplay}>via ${PROVIDER_NAMES[providers[0]]}</span>`;
    } else {
      routeHtml = `<span class="route-static">via ${PROVIDER_NAMES[providers[0]]}</span>`;
    }
    return `<label class="model-card">
        <input type="radio" name="default-model" value="${c.alias}" ${checked}>
        <span class="model-alias">${c.alias}</span>
        <span class="model-label">${c.label}</span>
        ${routeHtml}
      </label>`;
  }).join('\n      ');

  return `<div class="step-content">
    <h1>Choose Default Model</h1>
    <p class="subtitle">Pick the model to use when no --model flag is given.</p>

    <div class="model-list" id="model-list">
      ${cards}
    </div>
  </div>`;
}

module.exports = { buildModelStepHTML, MODEL_CHOICES, PROVIDER_NAMES };
