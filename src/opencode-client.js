/**
 * OpenCode SDK Client Wrapper
 *
 * Provides a clean interface for interacting with the @opencode-ai/sdk.
 * Handles model string parsing and provides simplified API methods.
 * Now uses SDK server creation instead of spawning CLI.
 *
 * Spec Reference: SDK Migration Plan
 */

// Lazy-load SDK (ESM module) - all imports must be dynamic
let _sdk = null;
async function getSDK() {
  if (!_sdk) {
    _sdk = await import('@opencode-ai/sdk');
  }
  return _sdk;
}

async function getCreateOpencodeClient() {
  const sdk = await getSDK();
  return sdk.createOpencodeClient;
}

async function getCreateOpencodeServer() {
  const sdk = await getSDK();
  return sdk.createOpencodeServer;
}

/**
 * Parse a model string into SDK format
 *
 * Converts from sidecar format (e.g., 'openrouter/google/gemini-2.5-flash')
 * to SDK format ({ providerID: 'openrouter', modelID: 'google/gemini-2.5-flash' })
 *
 * @param {string|object} modelString - Model identifier or already-parsed object
 * @returns {{providerID: string, modelID: string}} SDK model specification
 */
function parseModelString(modelString) {
  // If already an object, return as-is
  if (typeof modelString === 'object' && modelString !== null) {
    return modelString;
  }

  // Handle empty string
  if (!modelString) {
    return { providerID: 'openrouter', modelID: '' };
  }

  const parts = modelString.split('/');

  // Single part (just model name) - default to openrouter
  if (parts.length === 1) {
    return { providerID: 'openrouter', modelID: modelString };
  }

  // Two or more parts - first is provider, rest is modelID
  return {
    providerID: parts[0],
    modelID: parts.slice(1).join('/')
  };
}

/**
 * Create an OpenCode SDK client
 *
 * @param {string} [baseUrl] - Base URL for the OpenCode server
 * @returns {Promise<import('@opencode-ai/sdk').OpencodeClient>} SDK client instance
 */
async function createClient(baseUrl) {
  const createOpencodeClient = await getCreateOpencodeClient();
  const config = baseUrl ? { baseUrl } : {};
  return createOpencodeClient(config);
}

/**
 * Create a new session
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @returns {Promise<string>} Session ID
 * @throws {Error} If session creation fails
 */
async function createSession(client) {
  const result = await client.session.create({});

  if (result.error) {
    throw new Error(result.error.message || 'Failed to create session');
  }

  // Handle both direct ID and nested session.id
  const sessionId = result.data?.id || result.data?.session?.id;

  if (!sessionId) {
    throw new Error('No session ID returned');
  }

  return sessionId;
}

/**
 * Send a prompt to a session
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} sessionId - Session ID
 * @param {object} options - Prompt options
 * @param {string|object} options.model - Model identifier or SDK format object
 * @param {string} [options.system] - System prompt
 * @param {Array} options.parts - Message parts
 * @param {string} [options.agent] - Agent to use (e.g., 'build', 'explore')
 * @param {object} [options.tools] - Tool configuration
 * @param {object} [options.reasoning] - Reasoning/thinking configuration
 * @param {string} [options.reasoning.effort] - Effort level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'none'
 * @returns {Promise<object>} API response
 */
async function sendPrompt(client, sessionId, options) {
  const { model, system, parts, agent, tools, reasoning } = options;

  // Parse model string to SDK format
  const modelSpec = parseModelString(model);

  // Build request body
  const body = {
    model: modelSpec,
    parts
  };

  // Add optional fields
  if (system) {
    body.system = system;
  }

  if (agent) {
    body.agent = agent;
  }

  if (tools) {
    body.tools = tools;
  }

  if (reasoning) {
    body.reasoning = reasoning;
  }

  return client.session.prompt({
    path: { id: sessionId },
    body
  });
}

/**
 * Get messages for a session
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} Array of messages
 */
async function getMessages(client, sessionId) {
  const result = await client.session.messages({
    path: { id: sessionId }
  });

  return result.data || [];
}

/**
 * Check if the OpenCode server is healthy
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @returns {Promise<boolean>} True if server is healthy
 */
async function checkHealth(client) {
  try {
    await client.config.get({});
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Create a child session with a parent ID
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} parentId - Parent session ID
 * @returns {Promise<string>} Child session ID
 * @throws {Error} If child session creation fails
 */
async function createChildSession(client, parentId) {
  const result = await client.session.create({
    body: { parentID: parentId }
  });

  if (result.error) {
    throw new Error(result.error.message || 'Failed to create child session');
  }

  // Handle both direct ID and nested session.id
  const sessionId = result.data?.id || result.data?.session?.id;

  if (!sessionId) {
    throw new Error('No session ID returned');
  }

  return sessionId;
}

/**
 * Get child sessions for a parent session
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} parentId - Parent session ID
 * @returns {Promise<Array>} Array of child sessions
 */
async function getChildren(client, parentId) {
  const result = await client.session.children({
    path: { id: parentId }
  });

  return result.data || [];
}

/**
 * Get session status
 *
 * @param {import('@opencode-ai/sdk').OpencodeClient} client - SDK client
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Session status
 */
async function getSessionStatus(client, sessionId) {
  const result = await client.session.status({
    path: { id: sessionId }
  });

  return result.data || {};
}

/**
 * Start an OpenCode server and return client + server handle
 *
 * @param {object} [options] - Server options
 * @param {number} [options.port] - Port to run on
 * @param {string} [options.hostname='127.0.0.1'] - Hostname to bind to
 * @param {AbortSignal} [options.signal] - Abort signal to stop server
 * @param {object} [options.mcp] - MCP server configurations
 * @param {string} [options.model] - Default model
 * @returns {Promise<{client: object, server: {url: string, close: Function}}>}
 */
async function startServer(options = {}) {
  const createOpencodeServer = await getCreateOpencodeServer();

  // Build config object for SDK
  const config = {};
  if (options.mcp) {
    config.mcp = options.mcp;
  }
  if (options.model) {
    config.model = options.model;
  }

  const serverOptions = {
    hostname: options.hostname || '127.0.0.1',
    port: options.port,
    signal: options.signal
  };

  // Only add config if we have settings
  if (Object.keys(config).length > 0) {
    serverOptions.config = config;
  }

  const server = await createOpencodeServer(serverOptions);
  const client = await createClient(server.url);

  return { client, server };
}

/**
 * Load MCP configuration from user's opencode.json
 *
 * @param {string} [configPath] - Optional path to config file
 * @returns {object|null} MCP configuration or null if not found
 */
function loadMcpConfig(configPath) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  // Check paths in order of precedence
  const paths = [];

  if (configPath) {
    paths.push(configPath);
  }

  // Global config location
  paths.push(path.join(os.homedir(), '.config', 'opencode', 'opencode.json'));

  // Project-level config (cwd)
  paths.push(path.join(process.cwd(), 'opencode.json'));

  for (const configFile of paths) {
    try {
      if (fs.existsSync(configFile)) {
        const content = fs.readFileSync(configFile, 'utf-8');
        const config = JSON.parse(content);
        if (config.mcp && Object.keys(config.mcp).length > 0) {
          return config.mcp;
        }
      }
    } catch (e) {
      // Ignore parse errors, try next file
    }
  }

  return null;
}

/**
 * Parse MCP server specification from CLI format
 *
 * Supports formats:
 *   - name=url (remote server)
 *   - name=command (local server with simple command)
 *   - JSON string (full config)
 *
 * @param {string} spec - MCP server specification
 * @returns {{name: string, config: object}|null} Parsed MCP config or null
 */
function parseMcpSpec(spec) {
  // Try JSON first
  if (spec.startsWith('{')) {
    try {
      const parsed = JSON.parse(spec);
      const name = Object.keys(parsed)[0];
      return { name, config: parsed[name] };
    } catch (e) {
      return null;
    }
  }

  // Try name=value format
  const eqIndex = spec.indexOf('=');
  if (eqIndex > 0) {
    const name = spec.slice(0, eqIndex);
    const value = spec.slice(eqIndex + 1);

    // If value looks like a URL, treat as remote
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return {
        name,
        config: {
          type: 'remote',
          url: value,
          enabled: true
        }
      };
    }

    // Otherwise treat as local command
    return {
      name,
      config: {
        type: 'local',
        command: value.split(' '),
        enabled: true
      }
    };
  }

  return null;
}

module.exports = {
  parseModelString,
  createClient,
  createSession,
  createChildSession,
  sendPrompt,
  getMessages,
  getChildren,
  getSessionStatus,
  checkHealth,
  startServer,
  loadMcpConfig,
  parseMcpSpec
};
