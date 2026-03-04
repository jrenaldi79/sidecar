/**
 * Setup UI - Alias Editor
 *
 * Builds collapsible alias groups with search, inline editing,
 * delete, and add functionality for the setup wizard Step 3.
 */

/** Grouping metadata for the 21 default aliases */
const ALIAS_GROUPS = [
  { name: 'Gemini', keys: ['gemini', 'gemini-pro', 'gemini-3.1'] },
  { name: 'GPT', keys: ['gpt', 'gpt-pro', 'codex'] },
  { name: 'Claude', keys: ['claude', 'sonnet', 'opus', 'haiku'] },
  { name: 'DeepSeek', keys: ['deepseek'] },
  { name: 'Qwen', keys: ['qwen', 'qwen-coder', 'qwen-flash'] },
  { name: 'Mistral', keys: ['mistral', 'devstral'] },
  { name: 'Other', keys: ['glm', 'minimax', 'grok', 'kimi', 'seed'] },
];

/**
 * Build the HTML fragment for the alias editor section
 * @param {Object<string,string>} aliases - Map of alias name to model string
 * @returns {string} HTML fragment with search, groups, rows, and add button
 */
function buildAliasEditorHTML(aliases) {
  const searchInput = `<input type="text" id="alias-search" class="alias-search" placeholder="Search aliases..." autocomplete="off" spellcheck="false">`;

  const groups = ALIAS_GROUPS.map(group => {
    const rows = group.keys
      .filter(key => aliases[key] !== undefined)
      .map(key => {
        const model = aliases[key];
        return `<div class="alias-row" data-alias="${key}">` +
          `<span class="alias-name">${key}</span>` +
          `<span class="alias-arrow">\u2192</span>` +
          `<span class="alias-model">${model}</span>` +
          `<button class="alias-delete" data-alias="${key}">\u00d7</button>` +
          `</div>`;
      }).join('\n        ');

    const count = group.keys.filter(key => aliases[key] !== undefined).length;

    return `<details class="alias-group">
        <summary>${group.name} <span class="alias-count">(${count})</span></summary>
        ${rows}
      </details>`;
  }).join('\n      ');

  // Pick a representative example from actual aliases
  const exampleAlias = 'gemini';
  const exampleModel = aliases[exampleAlias] || 'openrouter/google/gemini-3-flash-preview';

  // SVG icons for the example box
  const terminalIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="#D97757" stroke-width="1.5"/><path d="M4 6l2.5 2L4 10" stroke="#D97757" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 10H11" stroke="#5A5550" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const arrowIcon = `<svg width="32" height="16" viewBox="0 0 32 16" fill="none"><path d="M2 8h24" stroke="#D97757" stroke-width="1.5" stroke-linecap="round"/><path d="M22 4l4 4-4 4" stroke="#D97757" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const modelIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="#6BBF6B" stroke-width="1.5"/><path d="M8 8v3" stroke="#6BBF6B" stroke-width="1.5" stroke-linecap="round"/><circle cx="4" cy="13" r="1.5" stroke="#6BBF6B" stroke-width="1.2"/><circle cx="8" cy="13" r="1.5" stroke="#6BBF6B" stroke-width="1.2"/><circle cx="12" cy="13" r="1.5" stroke="#6BBF6B" stroke-width="1.2"/><path d="M4 11.5L8 11M8 11l4 .5" stroke="#6BBF6B" stroke-width="1" stroke-linecap="round"/></svg>`;

  const exampleBox = `<div class="routing-example">
        <div class="example-label">How it works</div>
        <div class="example-flow">
          <div class="example-step">
            ${terminalIcon}
            <span class="example-cmd">sidecar start --model <strong>${exampleAlias}</strong></span>
          </div>
          <div class="example-connector">${arrowIcon}</div>
          <div class="example-step">
            ${modelIcon}
            <span class="example-model">${exampleModel}</span>
          </div>
        </div>
      </div>`;

  return `<div class="step-content">
      <h1>Model Routing</h1>
      <p class="subtitle">When you ask Sidecar for help, you can pick which LLM to collaborate with or offload tasks to. These names on the left route to the specific model on the right.</p>
      ${exampleBox}
      <div class="alias-editor">
        ${searchInput}
        ${groups}
        <button class="alias-add-btn" id="alias-add-btn">+ Add Custom Route</button>
      </div>
    </div>`;
}

module.exports = { ALIAS_GROUPS, buildAliasEditorHTML };
