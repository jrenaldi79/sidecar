/**
 * Sidecar MCP Server - exposes sidecar operations as MCP tools over stdio.
 * @module mcp-server
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TOOLS, getGuideText } = require('./mcp-tools');
const { logger } = require('./utils/logger');

/** @returns {string} Project directory (cwd of MCP client) */
function getProjectDir() { return process.cwd(); }

/** Read session metadata from disk, or null if not found */
function readMetadata(taskId, project) {
  const metaPath = path.join(project, '.claude', 'sidecar_sessions', taskId, 'metadata.json');
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
    cwd: getProjectDir(), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  child.unref();
  return child;
}

/** Tool handler implementations */
const handlers = {
  async sidecar_start(input, project) {
    const cwd = project || getProjectDir();
    const args = ['start', '--prompt', input.prompt];
    if (input.model) { args.push('--model', input.model); }
    if (input.agent) { args.push('--agent', input.agent); }
    if (input.noUi) { args.push('--no-ui'); }
    if (input.thinking) { args.push('--thinking', input.thinking); }
    args.push('--cwd', cwd);

    const { generateTaskId } = require('./sidecar/start');
    const taskId = generateTaskId();

    try { spawnSidecarProcess(args); } catch (err) {
      return textResult(`Failed to start sidecar: ${err.message}`, true);
    }
    return textResult(JSON.stringify({
      taskId, status: 'running',
      message: 'Sidecar started. Use sidecar_status to check progress, sidecar_read to get results.',
    }));
  },

  async sidecar_status(input, project) {
    const cwd = project || getProjectDir();
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
    const cwd = project || getProjectDir();
    const sessionDir = path.join(cwd, '.claude', 'sidecar_sessions', input.taskId);
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
    const cwd = project || getProjectDir();
    const sessionsDir = path.join(cwd, '.claude', 'sidecar_sessions');
    if (!fs.existsSync(sessionsDir)) { return textResult('No sidecar sessions found.'); }

    let sessions = fs.readdirSync(sessionsDir)
      .filter(d => fs.existsSync(path.join(sessionsDir, d, 'metadata.json')))
      .map(d => {
        const meta = JSON.parse(fs.readFileSync(path.join(sessionsDir, d, 'metadata.json'), 'utf-8'));
        return { id: d, ...meta };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (input.status && input.status !== 'all') {
      sessions = sessions.filter(s => s.status === input.status);
    }
    if (sessions.length === 0) { return textResult('No sidecar sessions found.'); }

    return textResult(JSON.stringify(sessions.map(s => ({
      id: s.id, model: s.model, status: s.status, agent: s.agent,
      briefing: (s.briefing || '').slice(0, 80), createdAt: s.createdAt,
    })), null, 2));
  },

  async sidecar_resume(input, project) {
    const cwd = project || getProjectDir();
    const args = ['resume', input.taskId, '--cwd', cwd];
    if (input.noUi) { args.push('--no-ui'); }
    try { spawnSidecarProcess(args); } catch (err) {
      return textResult(`Failed to resume: ${err.message}`, true);
    }
    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'running',
      message: 'Session resumed. Use sidecar_status to check progress.',
    }));
  },

  async sidecar_continue(input, project) {
    const cwd = project || getProjectDir();
    const args = ['continue', input.taskId, '--prompt', input.prompt, '--cwd', cwd];
    if (input.model) { args.push('--model', input.model); }
    if (input.noUi) { args.push('--no-ui'); }
    try { spawnSidecarProcess(args); } catch (err) {
      return textResult(`Failed to continue: ${err.message}`, true);
    }
    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'running',
      message: 'Continuation started. Use sidecar_status to check progress.',
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
          return await handlers[tool.name](input);
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

module.exports = { handlers, startMcpServer };
