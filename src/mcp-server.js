/**
 * Sidecar MCP Server - exposes sidecar operations as MCP tools over stdio.
 * @module mcp-server
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TOOLS, getGuideText } = require('./mcp-tools');
const os = require('os');
const { logger } = require('./utils/logger');
const { safeSessionDir } = require('./utils/validators');

/**
 * Resolve the project directory with smart fallback.
 * @param {string} [explicitProject] - Optional explicit project path
 * @returns {string} Resolved project directory
 */
function getProjectDir(explicitProject) {
  if (explicitProject && fs.existsSync(explicitProject)) {
    return explicitProject;
  }
  const cwd = process.cwd();
  if (cwd !== '/' && fs.existsSync(cwd)) {
    return cwd;
  }
  if (cwd === '/') {
    logger.warn('process.cwd() is root (/), falling back to $HOME for session storage');
  }
  return os.homedir();
}

/** Read session metadata from disk, or null if not found */
function readMetadata(taskId, project) {
  const sessionDir = safeSessionDir(project, taskId);
  const metaPath = path.join(sessionDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) { return null; }
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

/** Build an MCP text response */
function textResult(text, isError) {
  const result = { content: [{ type: 'text', text }] };
  if (isError) { result.isError = true; }
  return result;
}

/** Spawn a sidecar CLI process (detached, fire-and-forget) */
function spawnSidecarProcess(args) {
  const sidecarBin = path.join(__dirname, '..', 'bin', 'sidecar.js');
  const child = spawn('node', [sidecarBin, ...args], {
    cwd: getProjectDir(),
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    // Use port 9223 for CDP to avoid conflict with Chrome on 9222
    env: { ...process.env, SIDECAR_DEBUG_PORT: '9223' },
  });
  child.unref();
  return child;
}

/** Tool handler implementations */
const handlers = {
  async sidecar_start(input, project) {
    const cwd = project || getProjectDir(input.project);
    const { generateTaskId } = require('./sidecar/start');
    const taskId = generateTaskId();

    const args = ['start', '--prompt', input.prompt, '--task-id', taskId, '--client', 'cowork'];
    if (input.model) { args.push('--model', input.model); }
    if (input.agent) { args.push('--agent', input.agent); }
    if (input.noUi) { args.push('--no-ui'); }
    if (input.thinking) { args.push('--thinking', input.thinking); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    if (input.contextTurns)     { args.push('--context-turns', String(input.contextTurns)); }
    if (input.contextSince)     { args.push('--context-since', input.contextSince); }
    if (input.contextMaxTokens) { args.push('--context-max-tokens', String(input.contextMaxTokens)); }
    if (input.summaryLength)    { args.push('--summary-length', input.summaryLength); }
    args.push('--cwd', cwd);

    let child;
    try { child = spawnSidecarProcess(args); } catch (err) {
      return textResult(`Failed to start sidecar: ${err.message}`, true);
    }

    // Save PID so sidecar_abort can kill the process
    if (child && child.pid) {
      const sessionDir = path.join(cwd, '.claude', 'sidecar_sessions', taskId);
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      const metaPath = path.join(sessionDir, 'metadata.json');
      if (!fs.existsSync(metaPath)) {
        fs.writeFileSync(metaPath, JSON.stringify({
          taskId, status: 'running', pid: child.pid, createdAt: new Date().toISOString(),
        }, null, 2), { mode: 0o600 });
      }
    }

    return textResult(JSON.stringify({
      taskId, status: 'running',
      message: 'Sidecar started. Use sidecar_status to check progress, sidecar_read to get results.',
    }));
  },

  async sidecar_status(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }

    const elapsed = Date.now() - new Date(metadata.createdAt).getTime();
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    return textResult(JSON.stringify({
      taskId: metadata.taskId, status: metadata.status, model: metadata.model,
      agent: metadata.agent, elapsed: `${mins}m ${secs}s`,
      briefing: (metadata.briefing || '').slice(0, 100),
    }));
  },

  async sidecar_read(input, project) {
    const cwd = project || getProjectDir(input.project);
    const sessionDir = safeSessionDir(cwd, input.taskId);
    if (!fs.existsSync(sessionDir)) {
      return textResult(`Session ${input.taskId} not found.`, true);
    }

    const mode = input.mode || 'summary';
    if (mode === 'metadata') {
      return textResult(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8'));
    }
    if (mode === 'conversation') {
      const convPath = path.join(sessionDir, 'conversation.jsonl');
      if (!fs.existsSync(convPath)) { return textResult('No conversation recorded.'); }
      return textResult(fs.readFileSync(convPath, 'utf-8'));
    }
    // Default: summary
    const summaryPath = path.join(sessionDir, 'summary.md');
    if (!fs.existsSync(summaryPath)) {
      return textResult('No summary available (session may still be running or was not folded).');
    }
    return textResult(fs.readFileSync(summaryPath, 'utf-8'));
  },

  async sidecar_list(input, project) {
    const cwd = project || getProjectDir(input.project);
    const sessionsDir = path.join(cwd, '.claude', 'sidecar_sessions');
    if (!fs.existsSync(sessionsDir)) { return textResult('No sidecar sessions found.'); }

    let sessions = fs.readdirSync(sessionsDir)
      .filter(d => /^[a-zA-Z0-9_-]{1,64}$/.test(d))
      .filter(d => fs.existsSync(path.join(sessionsDir, d, 'metadata.json')))
      .map(d => {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(sessionsDir, d, 'metadata.json'), 'utf-8'));
          return {
            id: d, model: meta.model, status: meta.status, agent: meta.agent,
            briefing: (String(meta.briefing || '')).slice(0, 80),
            createdAt: meta.createdAt,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (input.status && input.status !== 'all') {
      sessions = sessions.filter(s => s.status === input.status);
    }
    if (sessions.length === 0) { return textResult('No sidecar sessions found.'); }

    return textResult(JSON.stringify(sessions, null, 2));
  },

  async sidecar_resume(input, project) {
    const cwd = project || getProjectDir(input.project);
    const args = ['resume', input.taskId, '--client', 'cowork', '--cwd', cwd];
    if (input.noUi) { args.push('--no-ui'); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    try { spawnSidecarProcess(args); } catch (err) {
      return textResult(`Failed to resume: ${err.message}`, true);
    }
    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'running',
      message: 'Session resumed. Use sidecar_status to check progress.',
    }));
  },

  async sidecar_continue(input, project) {
    const cwd = project || getProjectDir(input.project);
    const { generateTaskId } = require('./sidecar/start');
    const newTaskId = generateTaskId();

    const args = ['continue', input.taskId, '--prompt', input.prompt,
      '--task-id', newTaskId, '--client', 'cowork', '--cwd', cwd];
    if (input.model) { args.push('--model', input.model); }
    if (input.noUi) { args.push('--no-ui'); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    if (input.contextTurns)     { args.push('--context-turns', String(input.contextTurns)); }
    if (input.contextMaxTokens) { args.push('--context-max-tokens', String(input.contextMaxTokens)); }
    try { spawnSidecarProcess(args); } catch (err) {
      return textResult(`Failed to continue: ${err.message}`, true);
    }
    return textResult(JSON.stringify({
      taskId: newTaskId, status: 'running',
      message: 'Continuation started. Use sidecar_status to check progress.',
    }));
  },

  async sidecar_abort(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }
    if (metadata.status !== 'running') {
      return textResult(`Session ${input.taskId} is not running (status: ${metadata.status}).`);
    }

    // Kill the process if PID is recorded
    if (metadata.pid) {
      try {
        process.kill(metadata.pid, 'SIGTERM');
      } catch (err) {
        // ESRCH = process already exited; any other error is unexpected but non-fatal
        if (err.code !== 'ESRCH') {
          logger.warn('Failed to kill sidecar process', { pid: metadata.pid, error: err.message });
        }
      }
    }

    // Update metadata to aborted
    const sessionDir = safeSessionDir(cwd, input.taskId);
    const metaPath = path.join(sessionDir, 'metadata.json');
    metadata.status = 'aborted';
    metadata.abortedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'aborted',
      message: 'Session abort requested. The sidecar process will terminate shortly.',
    }));
  },

  async sidecar_setup() {
    try { spawnSidecarProcess(['setup']); } catch (err) {
      return textResult(`Failed to launch setup: ${err.message}`, true);
    }
    return textResult('Setup wizard launched. The Electron window should appear on your desktop.');
  },

  async sidecar_guide() {
    return textResult(getGuideText());
  },
};

/** Start the MCP server on stdio transport */
async function startMcpServer() {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

  const server = new McpServer({ name: 'sidecar', version: require('../package.json').version });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input) => {
        try {
          return await handlers[tool.name](input, getProjectDir(input.project));
        } catch (err) {
          logger.error(`MCP tool error: ${tool.name}`, { error: err.message });
          return textResult(`Error: ${err.message}`, true);
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[sidecar] MCP server running on stdio\n');
}

module.exports = { handlers, startMcpServer, getProjectDir };
