/**
 * Sub-Agent Manager
 *
 * Manages the lifecycle of sub-agents including:
 * - Spawning with concurrency limits (max 5)
 * - Tracking status and results
 * - Auto-folding results back to parent
 * - Queue management for pending requests
 *
 * Uses OpenCode's native subagent types:
 *   - General: Full-access subagent for research
 *   - Explore: Read-only subagent for codebase exploration
 */

const EventEmitter = require('events');
const { validateAgentType, getAgentType } = require('./agent-types');
const { normalizeSubagent } = require('./utils/agent-mapping');
const { getModelForAgent } = require('./utils/agent-model-config');
const opencodeClient = require('./opencode-client');

/**
 * Maximum number of concurrent sub-agents
 * @constant {number}
 */
const MAX_CONCURRENT = 5;

/**
 * Sub-agent status constants
 * @constant {Object}
 */
const SUBAGENT_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * @typedef {Object} SubagentConfig
 * @property {string} agentType - Type of agent (General or Explore)
 * @property {string} briefing - Task description for the sub-agent
 * @property {string} [model] - Optional model override (defaults to parent model)
 */

/**
 * @typedef {Object} Subagent
 * @property {string} id - Unique identifier
 * @property {string} agentType - Type of agent (OpenCode normalized: General or Explore)
 * @property {string} briefing - Task description
 * @property {string} model - Model used for this subagent
 * @property {boolean} modelWasRouted - Whether model was auto-routed (true) or inherited/explicit (false)
 * @property {string} status - Current status
 * @property {string} [sessionId] - OpenCode session ID
 * @property {string} [result] - Result text when completed
 * @property {Error} [error] - Error when failed
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} [completedAt] - Completion timestamp
 */

/**
 * Generates a unique ID for sub-agents
 * @returns {string} Unique ID
 */
function generateId() {
  return `subagent-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * SubagentManager class
 * Extends EventEmitter to provide event-based notifications
 *
 * Events:
 * - 'spawned': Emitted when a sub-agent is spawned
 * - 'completed': Emitted when a sub-agent completes
 * - 'failed': Emitted when a sub-agent fails
 * - 'fold': Emitted with fold summary when auto-folding
 * - 'queue-processed': Emitted when a queued item is processed
 */
class SubagentManager extends EventEmitter {
  /**
   * Create a new SubagentManager
   * @param {Object} options - Configuration options
   * @param {Object} options.client - OpenCode SDK client
   * @param {string} options.parentSessionId - Parent session ID
   * @param {string} [options.parentModel] - Parent model for inheritance
   */
  constructor(options) {
    super();
    this.client = options.client;
    this.parentSessionId = options.parentSessionId;
    this.parentModel = options.parentModel;

    /** @type {Map<string, Subagent>} */
    this.subagents = new Map();

    /** @type {Array<{config: SubagentConfig, resolve: Function, reject: Function}>} */
    this.queue = [];

    this.activeCount = 0;
  }

  /**
   * Spawn a new sub-agent
   * @param {SubagentConfig} config - Sub-agent configuration
   * @returns {Promise<Subagent>} Spawned sub-agent info
   * @throws {Error} If agent type is invalid or briefing is missing
   */
  async spawnSubagent(config) {
    const { agentType, briefing } = config;

    // Validate agent type (must be General or Explore)
    if (!validateAgentType(agentType)) {
      throw new Error(`Invalid agent type: ${agentType}. Must be General or Explore.`);
    }

    // Validate briefing
    if (!briefing || typeof briefing !== 'string') {
      throw new Error('Briefing is required');
    }

    // Check concurrency limit
    if (this.activeCount >= MAX_CONCURRENT) {
      // Queue the request
      return new Promise((resolve, reject) => {
        this.queue.push({ config, resolve, reject });
      });
    }

    // Spawn immediately
    return this._spawn(config);
  }

  /**
   * Internal spawn implementation
   * @private
   */
  async _spawn(config) {
    const { agentType, briefing, model: explicitModel } = config;
    const id = generateId();

    // Get the OpenCode-normalized agent name (General or Explore)
    const openCodeAgent = normalizeSubagent(agentType);
    const agentConfig = getAgentType(agentType);

    // Resolve model using agent-model configuration
    // Priority: explicit model > configured model for agent type > parent model
    let resolvedModel = this.parentModel;
    let modelWasRouted = false;

    if (explicitModel) {
      // Explicit model override always wins
      resolvedModel = explicitModel;
      modelWasRouted = false;
    } else {
      // Check agent-model configuration
      const modelConfig = getModelForAgent(openCodeAgent, this.parentModel);
      resolvedModel = modelConfig.model;
      modelWasRouted = modelConfig.wasRouted;
    }

    // Create sub-agent record with model info
    const subagent = {
      id,
      agentType: openCodeAgent, // Store normalized name
      briefing,
      model: resolvedModel,
      modelWasRouted,
      status: SUBAGENT_STATUS.RUNNING,
      sessionId: null,
      result: null,
      error: null,
      createdAt: new Date(),
      completedAt: null
    };

    this.subagents.set(id, subagent);
    this.activeCount++;

    try {
      // Create child session
      const sessionId = await opencodeClient.createSession(this.client);
      subagent.sessionId = sessionId;

      // Build system prompt (minimal - OpenCode handles tool permissions)
      const systemPrompt = this._buildSystemPrompt(openCodeAgent, agentConfig);

      // Send initial prompt to child session with resolved model
      await opencodeClient.sendPrompt(this.client, sessionId, {
        model: resolvedModel,
        system: systemPrompt,
        parts: [{ type: 'text', text: briefing }],
        agent: openCodeAgent // Pass agent to OpenCode SDK for proper tool enforcement
      });

      this.emit('spawned', { ...subagent });
      return { ...subagent };
    } catch (error) {
      this.markFailed(id, error);
      throw error;
    }
  }

  /**
   * Build system prompt for sub-agent
   * Note: Tool permissions are enforced by OpenCode's agent framework,
   * not via system prompt. This just provides context.
   * @private
   */
  _buildSystemPrompt(openCodeAgent, agentConfig) {
    let prompt = `You are a ${openCodeAgent} sub-agent. ${agentConfig.description}\n\n`;
    prompt += `Tool access: ${agentConfig.toolAccess}\n\n`;
    prompt += 'When you have completed your task, provide a concise summary of your findings.';
    return prompt;
  }

  /**
   * Get a sub-agent by ID
   * @param {string} id - Sub-agent ID
   * @returns {Subagent|null} Sub-agent or null if not found
   */
  getSubagent(id) {
    const subagent = this.subagents.get(id);
    return subagent ? { ...subagent } : null;
  }

  /**
   * Get all sub-agents, optionally filtered
   * @param {Object} [filter] - Filter options
   * @param {string} [filter.status] - Filter by status
   * @param {string} [filter.agentType] - Filter by agent type
   * @returns {Subagent[]} Array of sub-agents
   */
  getSubagents(filter = {}) {
    let subagents = Array.from(this.subagents.values());

    if (filter.status) {
      subagents = subagents.filter(s => s.status === filter.status);
    }

    if (filter.agentType) {
      const normalizedFilter = normalizeSubagent(filter.agentType);
      subagents = subagents.filter(s => s.agentType === normalizedFilter);
    }

    return subagents.map(s => ({ ...s }));
  }

  /**
   * Mark a sub-agent as completed
   * @param {string} id - Sub-agent ID
   * @param {string} result - Result text
   */
  markCompleted(id, result) {
    const subagent = this.subagents.get(id);
    if (!subagent) {
      return;
    }

    subagent.status = SUBAGENT_STATUS.COMPLETED;
    subagent.result = result;
    subagent.completedAt = new Date();

    if (subagent.status === SUBAGENT_STATUS.RUNNING) {
      this.activeCount--;
    }
    this.activeCount = Math.max(0, this.activeCount - 1);

    this.emit('completed', { ...subagent });

    // Auto-fold results
    this._autoFold(subagent);

    // Process queue
    this._processQueue();
  }

  /**
   * Mark a sub-agent as failed
   * @param {string} id - Sub-agent ID
   * @param {Error} error - Error that caused failure
   */
  markFailed(id, error) {
    const subagent = this.subagents.get(id);
    if (!subagent) {
      return;
    }

    subagent.status = SUBAGENT_STATUS.FAILED;
    subagent.error = error;
    subagent.completedAt = new Date();

    this.activeCount = Math.max(0, this.activeCount - 1);

    this.emit('failed', { ...subagent, error });

    // Process queue
    this._processQueue();
  }

  /**
   * Read results from a sub-agent
   * @param {string} id - Sub-agent ID
   * @returns {Promise<Array>} Messages from the sub-agent session
   */
  async readResults(id) {
    const subagent = this.subagents.get(id);
    if (!subagent) {
      throw new Error(`Subagent not found: ${id}`);
    }

    if (!subagent.sessionId) {
      return [];
    }

    return opencodeClient.getMessages(this.client, subagent.sessionId);
  }

  /**
   * Auto-fold results back to parent
   * @private
   */
  _autoFold(subagent) {
    const summary = this._formatFoldSummary(subagent);

    this.emit('fold', {
      subagentId: subagent.id,
      agentType: subagent.agentType,
      briefing: subagent.briefing,
      model: subagent.model,
      modelWasRouted: subagent.modelWasRouted,
      summary
    });
  }

  /**
   * Format fold summary
   * @private
   */
  _formatFoldSummary(subagent) {
    const modelInfo = subagent.modelWasRouted
      ? ` (using ${this._extractModelName(subagent.model)})`
      : '';
    return `[${subagent.agentType} sub-agent${modelInfo}: "${subagent.briefing}"]\n\n${subagent.result || 'No result'}`;
  }

  /**
   * Extract short model name from full model ID
   * @private
   */
  _extractModelName(model) {
    if (!model) { return 'unknown'; }
    const parts = model.split('/');
    return parts[parts.length - 1].replace(/-preview$/, '').replace(/-latest$/, '');
  }

  /**
   * Process the queue when capacity is available
   * @private
   */
  _processQueue() {
    while (this.queue.length > 0 && this.activeCount < MAX_CONCURRENT) {
      const { config, resolve, reject } = this.queue.shift();

      this._spawn(config)
        .then(result => {
          this.emit('queue-processed', { id: result.id });
          resolve(result);
        })
        .catch(reject);
    }
  }

  /**
   * Get count of currently active sub-agents
   * @returns {number} Active count
   */
  getActiveCount() {
    return this.activeCount;
  }

  /**
   * Get length of pending queue
   * @returns {number} Queue length
   */
  getQueueLength() {
    return this.queue.length;
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.subagents.clear();
    this.queue = [];
    this.activeCount = 0;
    this.removeAllListeners();
  }
}

module.exports = {
  SubagentManager,
  MAX_CONCURRENT,
  SUBAGENT_STATUS
};
