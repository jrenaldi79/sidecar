/**
 * Sidecar Start Operations - Handles starting new sidecar sessions
 * Spec Reference: §4.1, §9
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { buildContext } = require('./context-builder');
const {
  SessionPaths,
  saveInitialContext,
  finalizeSession,
  outputSummary,
  createHeartbeat,
  HEARTBEAT_INTERVAL
} = require('./session-utils');
const { runInteractive, checkElectronAvailable } = require('./interactive');
const { buildPrompts } = require('../prompt-builder');
const { runHeadless } = require('../headless');
const { runMcpAppServer } = require('./mcp-app-server');
const { logger } = require('../utils/logger');
const { loadMcpConfig, parseMcpSpec } = require('../opencode-client');
const { mapAgentToOpenCode } = require('../utils/agent-mapping');
const { checkConfigChanged } = require('../utils/config');
const { discoverParentMcps } = require('../utils/mcp-discovery');
const { createVMProvider } = require('../vm/provider');
const { MacOSProvider } = require('../vm/macos-vz');

/** Generate a unique 8-character hex task ID */
function generateTaskId() {
  return crypto.randomBytes(4).toString('hex');
}

/** Create session directory and save metadata */
function createSessionMetadata(taskId, project, options) {
  const { model, prompt, briefing, noUi, headless, agent, thinking } = options;

  const sessionDir = SessionPaths.sessionDir(project, taskId);
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

  const effectiveBriefing = prompt || briefing;
  const isHeadless = noUi !== undefined ? noUi : headless;

  // Preserve fields from existing metadata (e.g., pid written by MCP handler)
  const metaPath = SessionPaths.metadataFile(sessionDir);
  let existing = {};
  if (fs.existsSync(metaPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      // ignore corrupt metadata
    }
  }

  const metadata = {
    ...existing,
    taskId,
    model,
    project,
    briefing: effectiveBriefing,
    mode: isHeadless ? 'headless' : 'interactive',
    agent: agent || (isHeadless ? 'build' : 'chat'),
    thinking: thinking || 'medium',
    status: 'running',
    createdAt: existing.createdAt || new Date().toISOString()
  };

  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });

  return sessionDir;
}

/**
 * Build MCP configuration from options.
 * Merge priority: CLI --mcp > --mcp-config > file config > discovered parent MCPs
 *
 * @param {object} options
 * @param {string} [options.mcp] - CLI --mcp spec
 * @param {string} [options.mcpConfig] - CLI --mcp-config path
 * @param {string} [options.clientType] - Parent client type for discovery
 * @param {boolean} [options.noMcp] - Skip MCP inheritance from parent
 * @param {string[]} [options.excludeMcp] - Server names to exclude
 * @returns {object|null} MCP server configs or null
 */
function buildMcpConfig(options) {
  const { mcp, mcpConfig, clientType, noMcp, excludeMcp } = options;
  let mcpServers = null;

  // Layer 1: Discover parent MCPs (unless --no-mcp)
  if (!noMcp) {
    const discovered = discoverParentMcps(clientType);
    if (discovered) {
      mcpServers = { ...discovered };
      logger.info('Discovered parent MCP servers', { serverCount: Object.keys(mcpServers).length });
    }
  }

  // Layer 2: File config (opencode.json) overrides discovered
  const fileConfig = loadMcpConfig(mcpConfig);
  if (fileConfig) {
    mcpServers = mcpServers ? { ...mcpServers, ...fileConfig } : { ...fileConfig };
    logger.debug('Loaded MCP config from file', { serverCount: Object.keys(fileConfig).length });
  }

  // Layer 3: CLI --mcp (highest priority)
  if (mcp) {
    const parsed = parseMcpSpec(mcp);
    if (parsed) {
      mcpServers = mcpServers || {};
      mcpServers[parsed.name] = parsed.config;
      logger.debug('Added CLI MCP server', { name: parsed.name });
    } else {
      logger.warn('Invalid MCP server spec', { mcp });
    }
  }

  // Always exclude the sidecar itself to prevent recursive spawning.
  // When launched from Cowork, the discovered MCP list includes "sidecar"
  // which would cause an infinite spawn loop.
  if (mcpServers && mcpServers.sidecar) {
    delete mcpServers.sidecar;
    logger.debug('Auto-excluded sidecar MCP (recursive spawn prevention)');
  }

  // Apply explicit exclusions
  if (excludeMcp && Array.isArray(excludeMcp) && mcpServers) {
    for (const name of excludeMcp) {
      if (mcpServers[name]) {
        delete mcpServers[name];
        logger.debug('Excluded MCP server', { name });
      }
    }
  }

  // Return null if all servers were excluded
  if (mcpServers && Object.keys(mcpServers).length === 0) {
    mcpServers = null;
  }

  return mcpServers;
}

/** Start a new sidecar session - Spec Reference: §4.1, §9 */
async function startSidecar(options) {
  const {
    model, prompt, briefing, sessionId, session = 'current',
    cwd, project = process.cwd(), contextTurns = 50, contextSince,
    contextMaxTokens = 80000, noUi, headless = false, timeout = 15,
    agent, mcp, mcpConfig, summaryLength = 'normal', thinking,
    client, sessionDir, noMcp, excludeMcp, opencodePort, coworkProcess, includeContext = true,
    position = 'right'
  } = options;

  const effectivePrompt = prompt || briefing;
  const effectiveSession = sessionId || session;
  const effectiveProject = cwd || project;
  const effectiveHeadless = noUi !== undefined ? noUi : headless;
  const mcpServers = buildMcpConfig({ mcp, mcpConfig, clientType: client, noMcp, excludeMcp });
  const taskId = options.taskId || generateTaskId();
  const reasoning = thinking ? { effort: thinking } : undefined;

  logger.info('Starting task', { taskId, model, mode: effectiveHeadless ? 'headless' : 'interactive' });

  // Check for config changes and emit update data to stderr
  const claudeMdPath = path.join(effectiveProject, 'CLAUDE.md');
  let currentHash = null;
  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    const match = content.match(/<!-- sidecar-config-hash: ([0-9a-f]+) -->/);
    if (match) { currentHash = match[1]; }
  }
  const configCheck = checkConfigChanged(currentHash);
  if (configCheck.changed) {
    process.stderr.write(`\n[SIDECAR_CONFIG_UPDATE] Model configuration has changed.\nAction: Replace the "Model Aliases" section in CLAUDE.md (near the top, after the title) with the content below.\nIf no "Model Aliases" section exists, add it after the title line.\nThe hash comment tracks config changes — do not remove it.\n\n${configCheck.updateData}\n\n`);
  }

  const context = includeContext !== false
    ? buildContext(effectiveProject, effectiveSession, { contextTurns, contextSince, contextMaxTokens, sessionDir, client, coworkProcess })
    : '[Context excluded by caller - briefing is self-contained]';
  const { system: systemPrompt, userMessage } = buildPrompts(
    effectivePrompt, context, effectiveProject, effectiveHeadless, agent, summaryLength, client
  );

  const sessDir = createSessionMetadata(taskId, effectiveProject, {
    model, prompt: effectivePrompt, noUi: effectiveHeadless, agent, thinking
  });
  saveInitialContext(sessDir, systemPrompt, userMessage);

  const heartbeat = createHeartbeat(HEARTBEAT_INTERVAL, sessDir);
  let summary;
  let result;

  // VM sandboxing: enabled by default, only skipped for known-safe local clients.
  // Falls back to unsandboxed mode if VM boot fails (stub methods, missing CLI, etc.)
  const UNSANDBOXED_CLIENTS = new Set(['code-local', 'code-web']);
  let vmProvider = null;
  let vmConnection = null;
  if (!UNSANDBOXED_CLIENTS.has(client)) {
    try {
      vmProvider = createVMProvider();
      const vmAvailable = await vmProvider.isAvailable();
      if (vmAvailable) {
        logger.info('VM provider available, checking provisioning', { taskId });
        if (await vmProvider.needsProvisioning()) {
          logger.info('Provisioning VM image', { taskId });
          await vmProvider.provision();
        }
        MacOSProvider.validateMountPath(effectiveProject);
        vmConnection = await vmProvider.boot({ workspace: effectiveProject, taskId });
        logger.info('VM booted', { taskId, host: vmConnection.host, transport: vmConnection.transport });
      } else {
        logger.info('VM not available, running unsandboxed', { taskId });
        vmProvider = null;
      }
    } catch (vmErr) {
      logger.warn('VM setup failed, falling back to unsandboxed mode', { taskId, error: vmErr.message });
      vmProvider = null;
      vmConnection = null;
    }
  }

  try {
    if (client === 'mcp-app') {
      logger.info('Launching MCP App server mode', { taskId, model });
      result = await runMcpAppServer(
        model, systemPrompt, userMessage, taskId, effectiveProject,
        { mcp: mcpServers, reasoning, agent, client, vmConnection }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('MCP App error', { taskId, error: result.error }); }
    } else if (effectiveHeadless) {
      result = await runHeadless(
        model, systemPrompt, userMessage, taskId, effectiveProject,
        timeout * 60 * 1000, agent || 'build', { mcp: mcpServers, summaryLength, reasoning, port: opencodePort, vmConnection }
      );
      summary = result.summary || '## Sidecar Results: No Output\n\nHeadless mode completed without summary.';
      if (result.timedOut) { logger.warn('Task timed out', { taskId }); }
      if (result.error) { logger.error('Task error', { taskId, error: result.error }); }
    } else {
      const effectiveAgent = mapAgentToOpenCode(agent).agent;
      logger.info('Launching interactive sidecar', { taskId, model, agent: effectiveAgent });
      result = await runInteractive(
        model, systemPrompt, userMessage, taskId, effectiveProject,
        { agent, mcp: mcpServers, reasoning, client, windowPosition: position, vmConnection }
      );
      summary = result.summary || '';
      if (result.error) { logger.error('Interactive task error', { taskId, error: result.error }); }
    }
  } finally {
    heartbeat.stop();
    if (vmProvider) {
      try {
        await vmProvider.shutdown();
        logger.info('VM shut down', { taskId });
      } catch (shutdownErr) {
        logger.warn('VM shutdown failed', { taskId, error: shutdownErr.message });
      }
    }
  }

  outputSummary(summary);
  const metaPath = SessionPaths.metadataFile(sessDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Persist OpenCode session ID for resume capability
  if (result && result.opencodeSessionId) {
    meta.opencodeSessionId = result.opencodeSessionId;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  }

  // Mark error results as 'error' instead of 'complete'
  if (result && result.error) {
    meta.status = 'error';
    meta.reason = result.error;
    meta.completedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    logger.error('Session completed with error', { taskId, error: result.error });
  } else {
    finalizeSession(sessDir, summary, effectiveProject, meta);
  }
}

module.exports = {
  generateTaskId,
  createSessionMetadata,
  buildMcpConfig,
  checkElectronAvailable,
  runInteractive,
  startSidecar,
  HEARTBEAT_INTERVAL
};
