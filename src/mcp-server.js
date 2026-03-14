/** @module mcp-server — Sidecar MCP Server (stdio transport) */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getTools, getGuideText } = require('./mcp-tools');
const { tryResolveModel } = require('./utils/config');
const os = require('os');
const { logger } = require('./utils/logger');
const { safeSessionDir } = require('./utils/validators');
const { readProgress } = require('./sidecar/progress');
const { apiRequest, requestSummaryFromModel } = require('./utils/opencode-api');
const { getSummaryTemplate } = require('./prompt-builder');
const { buildChatResource } = require('./mcp-app/chat-resource');

/** Resolve the project directory with smart fallback. */
function getProjectDir(explicitProject) {
  if (explicitProject && fs.existsSync(explicitProject)) { return explicitProject; }
  const cwd = process.cwd();
  if (cwd !== '/' && fs.existsSync(cwd)) { return cwd; }
  if (cwd === '/') { logger.warn('cwd is root (/), falling back to $HOME'); }
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

/**
 * Compute next poll hint for headless sessions.
 * @returns {{ hint: string }}
 */
function computeNextPoll() {
  return {
    hint: 'Each unnecessary poll burns context window tokens for zero benefit. Be disciplined: wait at least 30s.',
  };
}

const HEADLESS_STATUS_REMINDER = '<system-reminder>This sidecar is still running. Each poll costs context tokens for zero benefit. Be disciplined: wait at least 30s before checking again. Do other useful work while waiting.</system-reminder>';

/** Spawn a sidecar CLI process (fire-and-forget) */
function spawnSidecarProcess(args, sessionDir) {
  const sidecarBin = path.join(__dirname, '..', 'bin', 'sidecar.js');
  let stderrFd = 'ignore';
  if (sessionDir) {
    try {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      stderrFd = fs.openSync(path.join(sessionDir, 'debug.log'), 'w');
    } catch { /* fall back to ignore */ }
  }
  const child = spawn('node', [sidecarBin, ...args], {
    cwd: getProjectDir(),
    stdio: ['ignore', 'ignore', stderrFd],
    env: { ...process.env, SIDECAR_DEBUG_PORT: '9223', LOG_LEVEL: process.env.LOG_LEVEL || 'info' },
  });
  child.unref();
  return child;
}

/** Tool handler implementations */
const handlers = {
  async sidecar_start(input, project) {
    const modelCheck = tryResolveModel(input.model);
    if (modelCheck.error) {
      return textResult(modelCheck.error, true);
    }

    const cwd = project || getProjectDir(input.project);
    const { generateTaskId } = require('./sidecar/start');
    const taskId = generateTaskId();

    // Use mcp-app client so the OpenCode server stays alive for tool-based communication.
    // The inline MCP App UI communicates via sidecar_app_send / sidecar_app_messages / sidecar_app_fold.
    const args = ['start', '--prompt', input.prompt, '--task-id', taskId, '--client', 'mcp-app'];
    if (input.model) { args.push('--model', input.model); }
    // In MCP App mode, never pass --no-ui since the inline UI handles interaction.
    // Default to 'build' agent since MCP App has no Electron approval UI for tool calls.
    // 'chat' agent would hang waiting for permission that can never be granted.
    const agent = input.agent || 'build';
    if (agent) { args.push('--agent', agent); }
    if (input.thinking) { args.push('--thinking', input.thinking); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    if (input.contextTurns)     { args.push('--context-turns', String(input.contextTurns)); }
    if (input.contextSince)     { args.push('--context-since', input.contextSince); }
    if (input.contextMaxTokens) { args.push('--context-max-tokens', String(input.contextMaxTokens)); }
    if (input.summaryLength)    { args.push('--summary-length', input.summaryLength); }
    if (input.includeContext === false) { args.push('--no-context'); }
    if (input.coworkProcess)    { args.push('--cowork-process', input.coworkProcess); }
    if (input.parentSession)    { args.push('--session-id', input.parentSession); }
    if (input.windowPosition)   { args.push('--position', input.windowPosition); }
    args.push('--cwd', cwd);

    const sessionDir = path.join(cwd, '.claude', 'sidecar_sessions', taskId);
    let child;
    try { child = spawnSidecarProcess(args, sessionDir); } catch (err) {
      return textResult(`Failed to start sidecar: ${err.message}`, true);
    }

    if (child && child.pid) {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      const metaPath = path.join(sessionDir, 'metadata.json');
      if (!fs.existsSync(metaPath)) {
        fs.writeFileSync(metaPath, JSON.stringify({
          taskId, status: 'running', pid: child.pid, createdAt: new Date().toISOString(),
          headless: !!input.noUi,
        }, null, 2), { mode: 0o600 });
      }
    }

    // MCP App mode is always interactive - the inline UI handles the session
    const mode = 'interactive';
    const message = 'Sidecar opened in interactive mode. Do NOT poll for status. ' +
      "Tell the user: 'Let me know when you're done with the sidecar and have clicked Fold.' " +
      'Then wait for the user to tell you. Use sidecar_read to get results once they confirm.';

    const body = JSON.stringify({ taskId, status: 'running', mode, message });
    // _meta.ui is on the tool definition via registerAppTool, not on the result.
    return { content: [{ type: 'text', text: body }] };
  },

  async sidecar_status(input, project) {
    const cwd = project || getProjectDir(input.project);
    const sessionDir = safeSessionDir(cwd, input.taskId);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }

    if (metadata.status === 'running' && metadata.pid) {
      try { process.kill(metadata.pid, 0); } catch {
        Object.assign(metadata, {
          status: 'crashed', crashedAt: new Date().toISOString(),
          reason: 'Process exited unexpectedly',
        });
        fs.writeFileSync(path.join(sessionDir, 'metadata.json'),
          JSON.stringify(metadata, null, 2));
      }
    }

    const ms = Date.now() - new Date(metadata.createdAt).getTime();
    const response = {
      taskId: metadata.taskId, status: metadata.status,
      elapsed: `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`,
    };
    if (metadata.model) { response.model = metadata.model; }

    if (metadata.status === 'running') {
      const progress = readProgress(sessionDir);
      Object.assign(response, progress);
      if (metadata.headless) {
        response.next_poll = computeNextPoll();
      }
    }
    if (metadata.status === 'crashed' || metadata.status === 'error') {
      response.reason = metadata.reason || 'Unknown error';
    }
    const responseText = JSON.stringify(response);
    if (metadata.status === 'running' && metadata.headless) {
      return { content: [{ type: 'text', text: responseText }, { type: 'text', text: HEADLESS_STATUS_REMINDER }] };
    }
    return textResult(responseText);
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
    const metaForRead = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(sessionDir, 'metadata.json'), 'utf-8')); }
      catch { return {}; }
    })();
    const summaryText = fs.readFileSync(summaryPath, 'utf-8');
    const header = metaForRead.model ? `**Model:** ${metaForRead.model}\n\n` : '';
    return textResult(header + summaryText);
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
    const sessionDir = safeSessionDir(cwd, input.taskId);
    const args = ['resume', input.taskId, '--client', 'cowork', '--cwd', cwd];
    if (input.noUi) { args.push('--no-ui', '--agent', 'build'); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    try { spawnSidecarProcess(args, sessionDir); } catch (err) {
      return textResult(`Failed to resume: ${err.message}`, true);
    }
    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'running',
      message: 'Session resumed. Use sidecar_status to check progress.',
    }));
  },

  async sidecar_continue(input, project) {
    if (input.model) {
      const modelCheck = tryResolveModel(input.model);
      if (modelCheck.error) {
        return textResult(modelCheck.error, true);
      }
    }

    const cwd = project || getProjectDir(input.project);
    const { generateTaskId } = require('./sidecar/start');
    const newTaskId = generateTaskId();
    const sessionDir = path.join(cwd, '.claude', 'sidecar_sessions', newTaskId);

    const args = ['continue', input.taskId, '--prompt', input.prompt,
      '--task-id', newTaskId, '--client', 'cowork', '--cwd', cwd];
    if (input.model) { args.push('--model', input.model); }
    if (input.noUi) { args.push('--no-ui', '--agent', 'build'); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    if (input.contextTurns)     { args.push('--context-turns', String(input.contextTurns)); }
    if (input.contextMaxTokens) { args.push('--context-max-tokens', String(input.contextMaxTokens)); }
    try { spawnSidecarProcess(args, sessionDir); } catch (err) {
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

    if (metadata.pid) {
      try { process.kill(metadata.pid, 'SIGTERM'); } catch (err) {
        if (err.code !== 'ESRCH') {
          logger.warn('Failed to kill sidecar process', { pid: metadata.pid, error: err.message });
        }
      }
    }
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
  async sidecar_guide() { return textResult(getGuideText()); },

  async sidecar_app_send(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }
    if (!metadata.opencodePort || !metadata.opencodeSessionId) {
      return textResult('Session missing OpenCode port/session info.', true);
    }
    try {
      await apiRequest('POST',
        `/session/${metadata.opencodeSessionId}/prompt_async`,
        metadata.opencodePort,
        { parts: [{ type: 'text', text: input.message }] }
      );
      return textResult(JSON.stringify({ status: 'sent', taskId: input.taskId }));
    } catch (err) {
      return textResult(`Failed to send message: ${err.message}`, true);
    }
  },

  async sidecar_app_messages(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }
    if (!metadata.opencodePort || !metadata.opencodeSessionId) {
      return textResult('Session missing OpenCode port/session info.', true);
    }

    // Fingerprint: count total parts across all messages.
    // OpenCode updates messages in-place (parts grow), so message count
    // alone misses content changes within existing messages.
    function fingerprint(msgs) {
      let parts = 0;
      for (const m of msgs) {
        const p = m.parts || m.content;
        parts += Array.isArray(p) ? p.length : 1;
      }
      return `${msgs.length}:${parts}`;
    }

    try {
      const lastFp = input.cursor || '0:0';
      const MAX_WAIT = 8000;
      const POLL_STEP = 400;
      let msgArray;
      const deadline = Date.now() + MAX_WAIT;

      while (Date.now() < deadline) {
        const messages = await apiRequest('GET',
          `/session/${metadata.opencodeSessionId}/message`,
          metadata.opencodePort
        );
        msgArray = Array.isArray(messages) ? messages : [];
        const fp = fingerprint(msgArray);
        const meta = readMetadata(input.taskId, cwd);
        // Return immediately when: content changed, first request, or session ended
        if (fp !== lastFp || lastFp === '0:0' ||
            meta?.status === 'completed' || meta?.status === 'error') {
          break;
        }
        await new Promise(r => setTimeout(r, POLL_STEP));
      }

      if (!msgArray) {
        const messages = await apiRequest('GET',
          `/session/${metadata.opencodeSessionId}/message`,
          metadata.opencodePort
        );
        msgArray = Array.isArray(messages) ? messages : [];
      }

      const cursor = fingerprint(msgArray);
      const MAX_PART_LEN = 2000;
      const trimmed = msgArray.map(msg => {
        const parts = msg.parts || msg.content;
        if (!Array.isArray(parts)) { return msg; }
        return {
          ...msg,
          parts: parts.map(p => {
            if (p.type === 'tool' && p.state?.output && p.state.output.length > MAX_PART_LEN) {
              return { ...p, state: { ...p.state, output: p.state.output.slice(0, MAX_PART_LEN) + '\n...(truncated)' } };
            }
            if (p.type === 'text' && p.text && p.text.length > MAX_PART_LEN) {
              return { ...p, text: p.text.slice(0, MAX_PART_LEN) + '\n...(truncated)' };
            }
            return p;
          }),
        };
      });
      const currentMeta = readMetadata(input.taskId, cwd);
      return textResult(JSON.stringify({ messages: trimmed, cursor, status: currentMeta?.status || metadata.status }));
    } catch (err) {
      return textResult(`Failed to get messages: ${err.message}`, true);
    }
  },

  async sidecar_app_answer_question(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }
    if (!metadata.opencodePort || !metadata.opencodeSessionId) {
      return textResult('Session missing OpenCode port/session info.', true);
    }
    try {
      // List pending questions from the OpenCode server
      const questions = await apiRequest('GET', '/question', metadata.opencodePort);
      const pending = Array.isArray(questions)
        ? questions.filter(q => q.sessionID === metadata.opencodeSessionId)
        : [];
      if (pending.length === 0) {
        // No pending question found; send as regular user message as fallback
        await apiRequest('POST',
          `/session/${metadata.opencodeSessionId}/prompt_async`,
          metadata.opencodePort,
          { parts: [{ type: 'text', text: input.answer }] }
        );
        return textResult(JSON.stringify({ status: 'sent_as_message', taskId: input.taskId }));
      }
      // Reply to the first pending question for this session
      const requestId = pending[0].id;
      await apiRequest('POST',
        `/question/${requestId}/reply`,
        metadata.opencodePort,
        { answers: [[input.answer]] }
      );
      return textResult(JSON.stringify({ status: 'answered', taskId: input.taskId, requestId }));
    } catch (err) {
      return textResult(`Failed to answer question: ${err.message}`, true);
    }
  },

  async sidecar_app_skip_question(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }
    if (!metadata.opencodePort || !metadata.opencodeSessionId) {
      return textResult('Session missing OpenCode port/session info.', true);
    }
    try {
      const questions = await apiRequest('GET', '/question', metadata.opencodePort);
      const pending = Array.isArray(questions)
        ? questions.filter(q => q.sessionID === metadata.opencodeSessionId)
        : [];
      if (pending.length === 0) {
        return textResult(JSON.stringify({ status: 'no_pending_question', taskId: input.taskId }));
      }
      const requestId = pending[0].id;
      await apiRequest('POST',
        `/question/${requestId}/reject`,
        metadata.opencodePort,
        {}
      );
      return textResult(JSON.stringify({ status: 'skipped', taskId: input.taskId, requestId }));
    } catch (err) {
      return textResult(`Failed to skip question: ${err.message}`, true);
    }
  },

  async sidecar_app_fold(input, project) {
    const cwd = project || getProjectDir(input.project);
    const metadata = readMetadata(input.taskId, cwd);
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }
    if (metadata.status !== 'running') {
      return textResult(`Session ${input.taskId} is not running (status: ${metadata.status}).`, true);
    }
    if (!metadata.opencodePort || !metadata.opencodeSessionId) {
      return textResult('Session missing OpenCode port/session info.', true);
    }
    try {
      const summary = await requestSummaryFromModel(
        metadata.opencodeSessionId, metadata.opencodePort, getSummaryTemplate
      );
      if (!summary) {
        return textResult('Summary generation timed out.', true);
      }
      const sessionDir = safeSessionDir(cwd, input.taskId);
      const { finalizeSession } = require('./sidecar/session-utils');
      await finalizeSession(sessionDir, summary, cwd, metadata);
      return textResult(JSON.stringify({ summary, taskId: input.taskId }));
    } catch (err) {
      return textResult(`Fold failed: ${err.message}`, true);
    }
  },
};

/** Start the MCP server on stdio transport */
async function startMcpServer() {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } =
    require('@modelcontextprotocol/ext-apps/server');
  const server = new McpServer({ name: 'sidecar', version: require('../package.json').version });

  const resourceUri = 'ui://sidecar/chat';

  // Register MCP App UI resource with proper ext-apps MIME type
  registerAppResource(server, resourceUri, resourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: buildChatResource() }],
  }));

  const toolHandler = (tool) => async (input) => {
    try {
      return await handlers[tool.name](input, getProjectDir(input.project));
    } catch (err) {
      logger.error(`MCP tool error: ${tool.name}`, { error: err.message });
      return textResult(`Error: ${err.message}`, true);
    }
  };

  for (const tool of getTools()) {
    if (tool.name === 'sidecar_start') {
      // Register sidecar_start with ext-apps so _meta.ui is on the tool definition
      registerAppTool(server, tool.name, {
        title: 'Start Sidecar',
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        _meta: { ui: { resourceUri } },
      }, toolHandler(tool));
    } else {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
        toolHandler(tool),
      );
    }
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[sidecar] MCP server running on stdio\n');
}

module.exports = { handlers, startMcpServer, getProjectDir };
