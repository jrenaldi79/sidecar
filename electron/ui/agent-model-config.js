/**
 * Agent-Model Configuration UI
 *
 * Provides a settings panel where users can configure which model
 * each agent type uses. Each agent can be set to:
 * - 'inherit': Use the parent session's model
 * - 'select': Use a specific model chosen by the user
 *
 * Exposed API:
 * - AgentModelConfigUI class for managing the settings panel
 * - initAgentModelConfig() for initialization
 */

/**
 * Agent types that can be configured
 * @constant {string[]}
 */
const CONFIGURABLE_AGENTS = ['Explore', 'Plan', 'General'];

/**
 * Default cheap model for Explore agents
 * @constant {string}
 */
const DEFAULT_EXPLORE_MODEL = 'openrouter/google/gemini-3-flash-preview';

/**
 * Agent descriptions for the UI
 * @constant {Object}
 */
const AGENT_DESCRIPTIONS = {
  Explore: 'Read-only codebase exploration',
  Plan: 'Analysis and planning tasks',
  General: 'Full-access research tasks'
};

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) { return ''; }
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * AgentModelConfigUI class
 * Manages the settings panel UI and state
 */
class AgentModelConfigUI {
  constructor() {
    this.config = null;
    this.isOpen = false;
    this._listeners = [];
    this._modelOptions = [];
  }

  /**
   * Initialize the config UI
   * @param {Array} modelOptions - Available models from model registry
   */
  async init(modelOptions = []) {
    this._modelOptions = modelOptions;

    // Load config from main process
    try {
      this.config = await window.electronAPI.getAgentModelConfig();
    } catch (error) {
      console.error('[AgentModelConfig] Failed to load config:', error);
      this.config = this._getDefaultConfig();
    }

    // Create the UI elements
    this._createSettingsButton();
    this._createSettingsPanel();
  }

  /**
   * Get default configuration
   * @private
   */
  _getDefaultConfig() {
    return {
      Explore: { mode: 'select', model: DEFAULT_EXPLORE_MODEL },
      Plan: { mode: 'inherit', model: null },
      General: { mode: 'inherit', model: null }
    };
  }

  /**
   * Create the settings gear button using safe DOM methods
   * @private
   */
  _createSettingsButton() {
    const controlBar = document.querySelector('.bottom-controls');
    if (!controlBar) {
      console.error('[AgentModelConfig] Control bar not found');
      return;
    }

    // Create settings button
    const btn = document.createElement('button');
    btn.id = 'agent-settings-btn';
    btn.className = 'settings-gear-btn';
    btn.title = 'Agent Model Settings';

    // Create SVG using safe DOM methods
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'currentColor');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M7.068 0.5c-.315 0-.594.204-.694.506l-.4 1.219a5.446 5.446 0 0 0-.869.358l-1.1-.592a.728.728 0 0 0-.847.127L1.566 3.71a.728.728 0 0 0-.127.847l.592 1.1a5.446 5.446 0 0 0-.358.869l-1.22.4a.728.728 0 0 0-.505.694v2.76c0 .315.204.594.506.694l1.219.4c.085.31.206.6.358.869l-.592 1.1a.728.728 0 0 0 .127.847l1.592 1.592a.728.728 0 0 0 .847.127l1.1-.592c.269.152.558.273.869.358l.4 1.22c.1.3.38.505.694.505h2.76c.315 0 .594-.204.694-.506l.4-1.219a5.446 5.446 0 0 0 .869-.358l1.1.592a.728.728 0 0 0 .847-.127l1.592-1.592a.728.728 0 0 0 .127-.847l-.592-1.1a5.446 5.446 0 0 0 .358-.869l1.22-.4a.728.728 0 0 0 .505-.694V6.62c0-.315-.204-.594-.506-.694l-1.219-.4a5.446 5.446 0 0 0-.358-.869l.592-1.1a.728.728 0 0 0-.127-.847l-1.592-1.592a.728.728 0 0 0-.847-.127l-1.1.592a5.446 5.446 0 0 0-.869-.358l-.4-1.22A.728.728 0 0 0 9.828.5H7.068zM8.5 5.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z');
    svg.appendChild(path);
    btn.appendChild(svg);

    btn.addEventListener('click', () => this.toggle());

    // Insert before the fold button
    const foldBtn = document.getElementById('fold-btn');
    if (foldBtn) {
      controlBar.insertBefore(btn, foldBtn);
    } else {
      controlBar.appendChild(btn);
    }
  }

  /**
   * Create the settings panel using safe DOM methods
   * @private
   */
  _createSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'agent-settings-panel';
    panel.className = 'agent-config-panel';

    // Create header
    const header = document.createElement('div');
    header.className = 'agent-config-header';

    const title = document.createElement('span');
    title.className = 'agent-config-title';
    title.textContent = 'Agent Model Settings';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'agent-config-close';
    closeBtn.id = 'agent-settings-close';
    closeBtn.textContent = '\u00D7'; // × character
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // Create content
    const content = document.createElement('div');
    content.className = 'agent-config-content';

    CONFIGURABLE_AGENTS.forEach(agent => {
      content.appendChild(this._createAgentRow(agent));
    });

    panel.appendChild(content);

    // Create footer
    const footer = document.createElement('div');
    footer.className = 'agent-config-footer';

    const hint = document.createElement('span');
    hint.className = 'agent-config-hint';
    hint.textContent = 'Changes are saved automatically';
    footer.appendChild(hint);

    panel.appendChild(footer);

    document.body.appendChild(panel);

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (this.isOpen && !panel.contains(e.target) && e.target.id !== 'agent-settings-btn') {
        this.close();
      }
    });
  }

  /**
   * Create a row for an agent type using safe DOM methods
   * @private
   */
  _createAgentRow(agent) {
    const setting = this.config[agent] || { mode: 'inherit', model: null };
    const isInherit = setting.mode === 'inherit';
    const agentLower = agent.toLowerCase();

    const row = document.createElement('div');
    row.className = 'agent-config-row';

    // Label section
    const label = document.createElement('div');
    label.className = 'agent-config-label';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'agent-name';
    nameSpan.textContent = agent;
    label.appendChild(nameSpan);

    const descSpan = document.createElement('span');
    descSpan.className = 'agent-description';
    descSpan.textContent = AGENT_DESCRIPTIONS[agent];
    label.appendChild(descSpan);

    row.appendChild(label);

    // Options section
    const options = document.createElement('div');
    options.className = 'agent-config-options';

    // Inherit radio
    const inheritLabel = document.createElement('label');
    inheritLabel.className = 'agent-radio-label';

    const inheritRadio = document.createElement('input');
    inheritRadio.type = 'radio';
    inheritRadio.name = `${agentLower}-mode`;
    inheritRadio.id = `${agentLower}-inherit`;
    inheritRadio.value = 'inherit';
    inheritRadio.checked = isInherit;
    inheritRadio.addEventListener('change', () => this._handleModeChange(agent, 'inherit'));
    inheritLabel.appendChild(inheritRadio);

    const inheritText = document.createElement('span');
    inheritText.className = 'radio-text';
    inheritText.textContent = 'Inherit parent';
    inheritLabel.appendChild(inheritText);

    options.appendChild(inheritLabel);

    // Select radio
    const selectLabel = document.createElement('label');
    selectLabel.className = 'agent-radio-label';

    const selectRadio = document.createElement('input');
    selectRadio.type = 'radio';
    selectRadio.name = `${agentLower}-mode`;
    selectRadio.id = `${agentLower}-select`;
    selectRadio.value = 'select';
    selectRadio.checked = !isInherit;
    selectRadio.addEventListener('change', () => this._handleModeChange(agent, 'select'));
    selectLabel.appendChild(selectRadio);

    const selectText = document.createElement('span');
    selectText.className = 'radio-text';
    selectText.textContent = 'Use model:';
    selectLabel.appendChild(selectText);

    options.appendChild(selectLabel);

    // Model select dropdown
    const modelSelect = document.createElement('select');
    modelSelect.id = `${agentLower}-model-select`;
    modelSelect.className = 'agent-model-select';
    modelSelect.disabled = isInherit;
    modelSelect.addEventListener('change', (e) => this._handleModelChange(agent, e.target.value));

    this._populateModelOptions(modelSelect, setting.model);
    options.appendChild(modelSelect);

    row.appendChild(options);

    return row;
  }

  /**
   * Populate model options in a select element using safe DOM methods
   * @private
   */
  _populateModelOptions(selectElement, selectedModel) {
    // Use available models if provided, otherwise use common defaults
    const models = this._modelOptions.length > 0
      ? this._modelOptions
      : [
          { id: 'openrouter/google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
          { id: 'openrouter/google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
          { id: 'openrouter/openai/gpt-4o-mini', name: 'GPT-4o Mini' },
          { id: 'openrouter/anthropic/claude-3-haiku', name: 'Claude 3 Haiku' }
        ];

    models.forEach(m => {
      const id = m.id || m;
      const name = m.name || this._extractModelName(id);

      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      option.selected = id === selectedModel;

      selectElement.appendChild(option);
    });
  }

  /**
   * Extract short model name from full ID
   * @private
   */
  _extractModelName(modelId) {
    if (!modelId) { return 'Unknown'; }
    const parts = modelId.split('/');
    return parts[parts.length - 1]
      .replace(/-preview$/, '')
      .replace(/-latest$/, '')
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Handle mode change (inherit/select)
   * @private
   */
  _handleModeChange(agent, mode) {
    const modelSelect = document.getElementById(`${agent.toLowerCase()}-model-select`);

    if (mode === 'inherit') {
      modelSelect.disabled = true;
      this.config[agent] = { mode: 'inherit', model: null };
    } else {
      modelSelect.disabled = false;
      this.config[agent] = { mode: 'select', model: modelSelect.value };
    }

    this._save();
  }

  /**
   * Handle model selection change
   * @private
   */
  _handleModelChange(agent, model) {
    this.config[agent] = { mode: 'select', model };
    this._save();
  }

  /**
   * Save configuration to main process
   * @private
   */
  async _save() {
    try {
      await window.electronAPI.setAgentModelConfig(this.config);
      this._notifyListeners();
    } catch (error) {
      console.error('[AgentModelConfig] Failed to save config:', error);
    }
  }

  /**
   * Toggle panel visibility
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Open the settings panel
   */
  open() {
    const panel = document.getElementById('agent-settings-panel');
    const btn = document.getElementById('agent-settings-btn');

    if (panel) {
      panel.classList.add('visible');
      this.isOpen = true;
    }
    if (btn) {
      btn.classList.add('active');
    }
  }

  /**
   * Close the settings panel
   */
  close() {
    const panel = document.getElementById('agent-settings-panel');
    const btn = document.getElementById('agent-settings-btn');

    if (panel) {
      panel.classList.remove('visible');
      this.isOpen = false;
    }
    if (btn) {
      btn.classList.remove('active');
    }
  }

  /**
   * Get model for a specific agent type
   * @param {string} agentType - Agent type
   * @param {string} parentModel - Parent model to use if inheriting
   * @returns {{model: string, wasRouted: boolean}}
   */
  getModelForAgent(agentType, parentModel) {
    const setting = this.config[agentType];

    if (!setting || setting.mode === 'inherit') {
      return { model: parentModel, wasRouted: false };
    }

    return { model: setting.model, wasRouted: true };
  }

  /**
   * Add change listener
   * @param {Function} listener - Callback function
   */
  onChange(listener) {
    this._listeners.push(listener);
  }

  /**
   * Notify listeners of config change
   * @private
   */
  _notifyListeners() {
    this._listeners.forEach(listener => {
      try {
        listener(this.config);
      } catch (error) {
        console.error('[AgentModelConfig] Listener error:', error);
      }
    });
  }

  /**
   * Update available model options
   * @param {Array} models - Model list from registry
   */
  updateModelOptions(models) {
    this._modelOptions = models;

    // Update select elements if panel exists
    CONFIGURABLE_AGENTS.forEach(agent => {
      const select = document.getElementById(`${agent.toLowerCase()}-model-select`);
      if (select) {
        const currentValue = select.value;
        // Clear existing options
        select.length = 0;
        // Repopulate
        this._populateModelOptions(select, currentValue);
      }
    });
  }
}

// Singleton instance
let agentModelConfigInstance = null;

/**
 * Initialize the agent-model config UI
 * @param {Array} modelOptions - Available models
 * @returns {AgentModelConfigUI} Config UI instance
 */
async function initAgentModelConfig(modelOptions = []) {
  if (!agentModelConfigInstance) {
    agentModelConfigInstance = new AgentModelConfigUI();
    await agentModelConfigInstance.init(modelOptions);
  }
  return agentModelConfigInstance;
}

/**
 * Get the agent-model config instance
 * @returns {AgentModelConfigUI|null}
 */
function getAgentModelConfig() {
  return agentModelConfigInstance;
}

// Export for use in renderer
window.AgentModelConfig = {
  AgentModelConfigUI,
  initAgentModelConfig,
  getAgentModelConfig,
  CONFIGURABLE_AGENTS,
  DEFAULT_EXPLORE_MODEL
};
