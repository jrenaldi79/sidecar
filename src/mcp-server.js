/** @module mcp-server — Sidecar MCP Server (stdio transport) */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getTools, getGuideText } = require('./mcp-tools');
const { tryResolveModel } = require('./utils/config');
const { logger } = require('./utils/logger');
const {
  assertContextBinding,
  buildChildProcessEnv,
  ensureSidecarSessionDir,
  openContainedSessionFileForWrite,
  readContainedSessionFile,
  validateProjectPath,
  validateSidecarSessionDir,
  validateSidecarSessionsRoot,
  validateSidecarSubagentSessionDir,
  validateSubagentParent,
  writeContainedSessionFile,
} = require('./utils/sidecar-boundaries');
const { readProgress } = require('./sidecar/progress');
const { SharedServerManager } = require('./utils/shared-server');

const sharedServer = new SharedServerManager({ logger });

/** Resolve the project directory with smart fallback. */
function getProjectDir(explicitProject) {
  const cwd = process.cwd();
  if (explicitProject && fs.existsSync(explicitProject)) {
    return validateProjectPath(path.resolve(explicitProject), { cwd });
  }
  return validateProjectPath(path.resolve(cwd), { cwd });
}

/** Resolve and validate the project path used by an MCP handler. */
function resolveHandlerProject(input = {}, project) {
  if (project) {
    const resolved = path.resolve(project);
    return validateProjectPath(resolved, { cwd: resolved, allowedRoots: [resolved] });
  }
  return getProjectDir(input.project);
}

/** Read session metadata from disk, or null if not found */
function readMetadataFromSessionDir(sessionDir) {
  const metadataText = readContainedSessionFile(sessionDir, 'metadata.json', { optional: true });
  if (metadataText === null) { return null; }
  return JSON.parse(metadataText);
}

function readMetadata(taskId, project) {
  let sessionDir;
  try {
    sessionDir = validateSidecarSessionDir(project, taskId);
  } catch (err) {
    if (/not found/i.test(err.message)) { return null; }
    throw err;
  }
  return readMetadataFromSessionDir(sessionDir);
}

/** Read and validate parent metadata before using subagent files. */
function readValidatedParentMetadata(taskId, project) {
  const metadata = readMetadata(taskId, project);
  if (!metadata) { return null; }
  validateSubagentParent({
    ...metadata,
    taskId: metadata.taskId || taskId
  }, project);
  return metadata;
}

/** Resolve a subagent session directory safely beneath a parent sidecar task. */
function getSubagentSessionDir(project, parentTaskId, subagentId) {
  return validateSidecarSubagentSessionDir(project, parentTaskId, subagentId);
}

/** Read subagent metadata from disk, or null if not found. */
function readSubagentMetadata(project, parentTaskId, subagentId) {
  const sessionDir = getSubagentSessionDir(project, parentTaskId, subagentId);
  const metadataText = readContainedSessionFile(sessionDir, 'metadata.json', { optional: true });
  if (metadataText === null) { return null; }
  return JSON.parse(metadataText);
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
    hint: 'Run `sleep 25` in your shell before calling sidecar_status again. This enforces the wait and prevents token-wasting rapid polls.',
    wait_command: 'sleep 25',
  };
}

const HEADLESS_START_REMINDER = '<system-reminder>IMPORTANT: Before calling sidecar_status, you MUST run `sleep 25` in your shell first. This enforces the polling interval and prevents token waste. Do other useful work while waiting, or run `sleep 25` to block until the next poll window.</system-reminder>';
const HEADLESS_STATUS_REMINDER = '<system-reminder>IMPORTANT: This sidecar is still running. Before calling sidecar_status again, you MUST run `sleep 25` in your shell first. Each premature poll wastes context tokens for zero benefit. Run `sleep 25` now, then check again.</system-reminder>';

/** Spawn a sidecar CLI process (fire-and-forget) */
function spawnSidecarProcess(args, sessionDir) {
  const sidecarBin = path.join(__dirname, '..', 'bin', 'sidecar.js');
  let stderrFd = 'ignore';
  if (sessionDir) {
    try {
      stderrFd = openContainedSessionFileForWrite(sessionDir, 'debug.log', { mode: 0o600 });
    } catch { /* fall back to ignore */ }
  }
  const child = spawn('node', [sidecarBin, ...args], {
    cwd: getProjectDir(),
    stdio: ['ignore', 'ignore', stderrFd],
    env: buildChildProcessEnv({
      SIDECAR_DEBUG_PORT: '9223',
      LOG_LEVEL: process.env.LOG_LEVEL || 'info'
    }),
  });
  child.unref();
  return child;
}

/** Tool handler implementations */
const handlers = {
  async sidecar_start(input, project) {
    // Validate all inputs before any session creation
    const { validateStartInputs } = require('./utils/input-validators');
    const validation = validateStartInputs(input);
    if (!validation.valid) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(validation.error) }],
      };
    }
    const resolvedModel = validation.resolvedModel;

    const cwd = resolveHandlerProject(input, project);
    const { generateTaskId } = require('./sidecar/start');
    const taskId = generateTaskId();
    const includeContext = input.includeContext === true;
    if (includeContext) {
      try {
        assertContextBinding({
          parentSession: input.parentSession,
          session: input.parentSession,
          coworkProcess: input.coworkProcess,
          client: input.coworkProcess ? 'cowork' : undefined
        });
      } catch (err) {
        return textResult(err.message, true);
      }
    }

    const args = ['start', '--prompt', input.prompt, '--task-id', taskId, '--client', 'cowork'];
    if (resolvedModel) { args.push('--model', resolvedModel); }
    const agent = (input.noUi && (!input.agent || input.agent.toLowerCase() === 'chat'))
      ? 'build' : input.agent;
    if (agent) { args.push('--agent', agent); }
    if (input.noUi) { args.push('--no-ui'); }
    if (input.thinking) { args.push('--thinking', input.thinking); }
    if (input.timeout) { args.push('--timeout', String(input.timeout)); }
    if (input.contextTurns)     { args.push('--context-turns', String(input.contextTurns)); }
    if (input.contextSince)     { args.push('--context-since', input.contextSince); }
    if (input.contextMaxTokens) { args.push('--context-max-tokens', String(input.contextMaxTokens)); }
    if (input.summaryLength)    { args.push('--summary-length', input.summaryLength); }
    if (includeContext) { args.push('--include-context'); }
    if (!includeContext) { args.push('--no-context'); }
    if (input.coworkProcess)    { args.push('--cowork-process', input.coworkProcess); }
    if (input.parentSession)    { args.push('--session-id', input.parentSession); }
    if (input.windowPosition)   { args.push('--position', input.windowPosition); }
    args.push('--cwd', cwd);

    let sessionDir;
    try {
      sessionDir = ensureSidecarSessionDir(cwd, taskId, { allowExisting: false });
    } catch (err) {
      return textResult(err.message, true);
    }

    if (sharedServer.enabled && input.noUi) {
      // Shared server path: headless only, delegates to runHeadless()
      let sessionId;
      try {
        const { server, client } = await sharedServer.ensureServer();
        const { createSession } = require('./opencode-client');
        const { buildContext } = require('./sidecar/context-builder');
        const { buildPrompts } = require('./prompt-builder');
        const { runHeadless } = require('./headless');
        const { finalizeSession } = require('./sidecar/session-utils');
        // resolvedModel is already available from validateStartInputs() above

        sessionId = await createSession(client);

        // Write initial metadata (MCP handler owns this, runHeadless skips it)
        const serverPort = server.url ? new URL(server.url).port : null;
        writeContainedSessionFile(sessionDir, 'metadata.json', JSON.stringify({
          taskId, status: 'running',
          pid: null, // Shared server path: don't store MCP server PID (abort would kill all sessions)
          opencodeSessionId: sessionId,
          opencodePort: serverPort,
          goPid: server.goPid || null,
          project: cwd,
          projectDir: cwd,
          createdAt: new Date().toISOString(),
          headless: true, model: resolvedModel,
        }, null, 2), { mode: 0o600 });

        // Build context from parent conversation (unless --no-context)
        let context = null;
        if (includeContext) {
          try {
            context = buildContext(cwd, input.parentSession, {
              contextTurns: input.contextTurns,
              contextSince: input.contextSince,
              contextMaxTokens: input.contextMaxTokens,
              coworkProcess: input.coworkProcess,
              client: input.coworkProcess ? 'cowork' : undefined,
              parentProject: cwd,
              exactSession: true,
            });
          } catch (ctxErr) {
            return textResult(`Failed to build context: ${ctxErr.message}`, true);
          }
        }

        // Build prompts (same as CLI path in start.js)
        const { system: systemPrompt, userMessage } = buildPrompts(
          input.prompt, context, cwd, true, agent, input.summaryLength
        );

        // Register session with idle eviction
        sharedServer.addSession(sessionId, (_evictedId) => {
          try {
            const meta = readMetadataFromSessionDir(sessionDir);
            if (!meta) { return; }
            meta.status = 'idle-timeout';
            meta.completedAt = new Date().toISOString();
            writeContainedSessionFile(sessionDir, 'metadata.json', JSON.stringify(meta, null, 2), { mode: 0o600 });
          } catch (err) {
            logger.warn('Failed to update evicted session metadata', { error: err.message });
          }
        });
        const watchdog = sharedServer.getSessionWatchdog(sessionId);

        const timeoutMs = (input.timeout || 15) * 60 * 1000;

        // Fire-and-forget: runHeadless with shared server's client
        runHeadless(resolvedModel, systemPrompt, userMessage, taskId, cwd,
          timeoutMs, agent, {
            client, server, watchdog, sessionId,
            mcp: undefined, // shared server already has MCP config
          }
        ).then((result) => {
          // Session complete - finalize and remove from tracking
          try {
            const meta = readMetadataFromSessionDir(sessionDir);
            if (meta) {
              finalizeSession(sessionDir, result.summary || '', cwd, meta);
            }
          } catch (finErr) {
            logger.warn('Failed to finalize session', { error: finErr.message });
          }
          sharedServer.removeSession(sessionId);
        }).catch((err) => {
          logger.error('Shared server session failed', { taskId, error: err.message });
          sharedServer.removeSession(sessionId);
          try {
            const meta = readMetadataFromSessionDir(sessionDir);
            if (!meta) { return; }
            meta.status = 'error';
            meta.reason = err.message;
            meta.completedAt = new Date().toISOString();
            writeContainedSessionFile(sessionDir, 'metadata.json', JSON.stringify(meta, null, 2), { mode: 0o600 });
          } catch (writeErr) {
            logger.warn('Failed to write error metadata', { error: writeErr.message });
          }
        });

        // Return immediately
        const body = JSON.stringify({
          taskId, status: 'running', mode: 'headless',
          message: 'Sidecar started in headless mode. Use sidecar_status to check progress.',
        });
        return { content: [{ type: 'text', text: body }, { type: 'text', text: HEADLESS_START_REMINDER }] };
      } catch (err) {
        logger.warn('Shared server path failed, falling back to spawn', { error: err.message });
        // Clean up partial shared server state before falling through
        if (sessionId) {
          sharedServer.removeSession(sessionId);
        }
        // Fall through to spawn path below
      }
    }

    // Feature flag disabled (or shared server failed): fall back to per-process spawn
    let child;
    try { child = spawnSidecarProcess(args, sessionDir); } catch (err) {
      return textResult(`Failed to start sidecar: ${err.message}`, true);
    }

    if (child && child.pid) {
      if (readMetadataFromSessionDir(sessionDir) === null) {
        writeContainedSessionFile(sessionDir, 'metadata.json', JSON.stringify({
          taskId, status: 'running', pid: child.pid, createdAt: new Date().toISOString(),
          project: cwd, projectDir: cwd,
          headless: !!input.noUi,
        }, null, 2), { mode: 0o600 });
      }
    }

    const isHeadless = !!input.noUi;
    const mode = isHeadless ? 'headless' : 'interactive';
    const message = isHeadless
      ? 'Sidecar started in headless mode. Use sidecar_status to check progress.'
      : 'Sidecar opened in interactive mode. Do NOT poll for status. ' +
        "Tell the user: 'Let me know when you're done with the sidecar and have clicked Fold.' " +
        'Then wait for the user to tell you. Use sidecar_read to get results once they confirm.';

    const body = JSON.stringify({ taskId, status: 'running', mode, message });
    if (isHeadless) {
      return { content: [{ type: 'text', text: body }, { type: 'text', text: HEADLESS_START_REMINDER }] };
    }
    return textResult(body);
  },

  async sidecar_status(input, project) {
    const cwd = resolveHandlerProject(input, project);
    let sessionDir;
    let metadata;
    try {
      sessionDir = validateSidecarSessionDir(cwd, input.taskId);
      metadata = readMetadataFromSessionDir(sessionDir);
    } catch (err) {
      return textResult(err.message, true);
    }
    if (!metadata) { return textResult(`Session ${input.taskId} not found.`, true); }

    if (metadata.status === 'running' && metadata.pid) {
      try { process.kill(metadata.pid, 0); } catch {
        Object.assign(metadata, {
          status: 'crashed', crashedAt: new Date().toISOString(),
          reason: 'Process exited unexpectedly',
        });
        writeContainedSessionFile(sessionDir, 'metadata.json',
          JSON.stringify(metadata, null, 2), { mode: 0o600 });
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

      // Stall detection: flag when no activity for 2+ minutes
      const STALL_THRESHOLD_MS = 120000;
      if (metadata.headless && progress.lastActivityMs !== null && progress.lastActivityMs > STALL_THRESHOLD_MS) {
        response.stalled = true;
        response.stalledForSeconds = Math.floor(progress.lastActivityMs / 1000);
        response.recovery = `This session appears stalled (no activity for ${response.stalledForSeconds}s). ` +
          `To recover: 1) call sidecar_abort with taskId "${input.taskId}" ` +
          `2) call sidecar_resume with taskId "${input.taskId}" and noUi: true to pick up where it left off.`;
      }

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
    const cwd = resolveHandlerProject(input, project);
    let sessionDir;
    try {
      sessionDir = validateSidecarSessionDir(cwd, input.taskId);
    } catch (err) {
      return textResult(err.message, true);
    }

    const mode = input.mode || 'summary';
    if (mode === 'metadata') {
      const metadataText = readContainedSessionFile(sessionDir, 'metadata.json', { optional: true });
      if (metadataText === null) { return textResult(`Session ${input.taskId} not found.`, true); }
      return textResult(metadataText);
    }
    if (mode === 'conversation') {
      const conversation = readContainedSessionFile(sessionDir, 'conversation.jsonl', { optional: true });
      if (conversation === null) { return textResult('No conversation recorded.'); }
      return textResult(conversation);
    }
    // Default: summary
    const summaryText = readContainedSessionFile(sessionDir, 'summary.md', { optional: true });
    if (summaryText === null) {
      return textResult('No summary available (session may still be running or was not folded).');
    }
    const metaForRead = (() => {
      try {
        const metadataText = readContainedSessionFile(sessionDir, 'metadata.json', { optional: true });
        return metadataText === null ? {} : JSON.parse(metadataText);
      }
      catch { return {}; }
    })();
    const header = metaForRead.model ? `**Model:** ${metaForRead.model}\n\n` : '';
    return textResult(header + summaryText);
  },

  async sidecar_list(input, project) {
    const cwd = resolveHandlerProject(input, project);
    let sessionsDir;
    try {
      sessionsDir = validateSidecarSessionsRoot(cwd);
    } catch (err) {
      if (/does not exist/i.test(err.message)) {
        return textResult('No sidecar sessions found.');
      }
      return textResult(err.message, true);
    }

    let sessions = fs.readdirSync(sessionsDir)
      .filter(d => /^[a-zA-Z0-9_-]{1,64}$/.test(d))
      .map(d => {
        try {
          const sessionDir = validateSidecarSessionDir(cwd, d);
          const meta = readMetadataFromSessionDir(sessionDir);
          if (!meta) { return null; }
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
    const cwd = resolveHandlerProject(input, project);
    let sessionDir;
    try {
      sessionDir = validateSidecarSessionDir(cwd, input.taskId);
    } catch (err) {
      return textResult(err.message, true);
    }
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

    const cwd = resolveHandlerProject(input, project);
    const { generateTaskId } = require('./sidecar/start');
    const newTaskId = generateTaskId();
    let sessionDir;
    try {
      sessionDir = ensureSidecarSessionDir(cwd, newTaskId, { allowExisting: false });
    } catch (err) {
      return textResult(err.message, true);
    }

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
    const cwd = resolveHandlerProject(input, project);
    let sessionDir;
    let metadata;
    try {
      sessionDir = validateSidecarSessionDir(cwd, input.taskId);
      metadata = readMetadataFromSessionDir(sessionDir);
    } catch (err) {
      return textResult(err.message, true);
    }
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
    metadata.status = 'aborted';
    metadata.abortedAt = new Date().toISOString();
    writeContainedSessionFile(
      sessionDir,
      'metadata.json',
      JSON.stringify(metadata, null, 2),
      { mode: 0o600 }
    );

    return textResult(JSON.stringify({
      taskId: input.taskId, status: 'aborted',
      message: 'Session abort requested. The sidecar process will terminate shortly.',
    }));
  },

  async sidecar_subagent_start(input, project) {
    const cwd = resolveHandlerProject(input, project);
    const parentMetadata = readValidatedParentMetadata(input.parentTaskId, cwd);
    if (!parentMetadata) {
      return textResult(`Parent session ${input.parentTaskId} not found.`, true);
    }

    const { generateTaskId } = require('./sidecar/start');
    const { startCodexSubagent } = require('./subagents/codex-runner');
    const subagentId = generateTaskId();
    const run = await startCodexSubagent({
      projectDir: cwd,
      parentTaskId: input.parentTaskId,
      subagentId,
      briefing: input.prompt,
      agentType: input.agentType,
      model: input.model,
    });

    if (run && run.completion && typeof run.completion.catch === 'function') {
      run.completion.catch((err) => {
        logger.warn('Codex subagent completion rejected', {
          parentTaskId: input.parentTaskId,
          subagentId,
          error: err.message
        });
      });
    }

    return textResult(JSON.stringify({
      parentTaskId: input.parentTaskId,
      subagentId,
      status: 'running',
      backend: 'codex',
    }));
  },

  async sidecar_subagent_status(input, project) {
    const cwd = resolveHandlerProject(input, project);
    const parentMetadata = readValidatedParentMetadata(input.parentTaskId, cwd);
    if (!parentMetadata) {
      return textResult(`Parent session ${input.parentTaskId} not found.`, true);
    }
    let subagentDir;
    let metadata;
    try {
      subagentDir = getSubagentSessionDir(cwd, input.parentTaskId, input.subagentId);
      metadata = readSubagentMetadata(cwd, input.parentTaskId, input.subagentId);
    } catch (err) {
      return textResult(err.message, true);
    }
    if (!metadata) {
      return textResult(`Sub-agent ${input.subagentId} not found under parent ${input.parentTaskId}.`, true);
    }

    if (metadata.status === 'running' && metadata.pid) {
      try { process.kill(metadata.pid, 0); } catch {
        const { updateSubagentSession } = require('./session-manager');
        updateSubagentSession(cwd, input.parentTaskId, input.subagentId, {
          status: 'crashed',
          reason: 'Process exited unexpectedly',
          completedAt: new Date().toISOString(),
          pid: null
        });
      }
    }

    const refreshed = readSubagentMetadata(cwd, input.parentTaskId, input.subagentId);
    const response = {
      parentTaskId: input.parentTaskId,
      subagentId: input.subagentId,
      status: refreshed.status,
      backend: refreshed.backend
    };

    if (refreshed.agentType) {
      response.agentType = refreshed.agentType;
    }
    if (refreshed.status === 'running') {
      Object.assign(response, readProgress(subagentDir));
    }
    if (refreshed.status === 'crashed' || refreshed.status === 'error') {
      response.reason = refreshed.reason || 'Unknown error';
    }

    return textResult(JSON.stringify(response));
  },

  async sidecar_subagent_read(input, project) {
    const cwd = resolveHandlerProject(input, project);
    const parentMetadata = readValidatedParentMetadata(input.parentTaskId, cwd);
    if (!parentMetadata) {
      return textResult(`Parent session ${input.parentTaskId} not found.`, true);
    }
    let subagentDir;
    try {
      subagentDir = getSubagentSessionDir(cwd, input.parentTaskId, input.subagentId);
    } catch (err) {
      return textResult(err.message, true);
    }

    const mode = input.mode || 'summary';
    if (mode === 'metadata') {
      const metadataText = readContainedSessionFile(subagentDir, 'metadata.json', { optional: true });
      if (metadataText === null) {
        return textResult(`Sub-agent ${input.subagentId} not found under parent ${input.parentTaskId}.`, true);
      }
      return textResult(metadataText);
    }
    if (mode === 'conversation') {
      try {
        const conversation = readContainedSessionFile(subagentDir, 'conversation.jsonl', { optional: true });
        if (conversation === null) { return textResult('No conversation recorded.'); }
        return textResult(conversation);
      } catch (err) {
        return textResult(err.message, true);
      }
    }

    try {
      const summary = readContainedSessionFile(subagentDir, 'summary.md', { optional: true });
      if (summary === null) {
        return textResult('No summary available (subagent may still be running).');
      }
      return textResult(summary);
    } catch (err) {
      return textResult(err.message, true);
    }
  },

  async sidecar_subagent_abort(input, project) {
    const cwd = resolveHandlerProject(input, project);
    const parentMetadata = readValidatedParentMetadata(input.parentTaskId, cwd);
    if (!parentMetadata) {
      return textResult(`Parent session ${input.parentTaskId} not found.`, true);
    }
    let metadata;
    try {
      metadata = readSubagentMetadata(cwd, input.parentTaskId, input.subagentId);
    } catch (err) {
      return textResult(err.message, true);
    }
    if (!metadata) {
      return textResult(`Sub-agent ${input.subagentId} not found under parent ${input.parentTaskId}.`, true);
    }
    if (metadata.status !== 'running') {
      return textResult(
        `Sub-agent ${input.subagentId} is not running (status: ${metadata.status}).`
      );
    }

    if (metadata.pid) {
      try { process.kill(metadata.pid, 'SIGTERM'); } catch (err) {
        if (err.code !== 'ESRCH') {
          logger.warn('Failed to kill Codex subagent process', {
            pid: metadata.pid,
            error: err.message
          });
        }
      }
    }

    const { updateSubagentSession } = require('./session-manager');
    updateSubagentSession(cwd, input.parentTaskId, input.subagentId, {
      status: 'aborted',
      abortedAt: new Date().toISOString(),
      pid: null
    });

    return textResult(JSON.stringify({
      parentTaskId: input.parentTaskId,
      subagentId: input.subagentId,
      status: 'aborted',
      backend: metadata.backend || 'codex',
      message: 'Sub-agent abort requested. The Codex process will terminate shortly.',
    }));
  },

  async sidecar_setup() {
    try { spawnSidecarProcess(['setup']); } catch (err) {
      return textResult(`Failed to launch setup: ${err.message}`, true);
    }
    return textResult('Setup wizard launched. The Electron window should appear on your desktop.');
  },
  async sidecar_guide() { return textResult(getGuideText()); },
};

/** Start the MCP server on stdio transport */
async function startMcpServer() {
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const server = new McpServer({ name: 'sidecar', version: require('../package.json').version });

  for (const tool of getTools()) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
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
  process.on('SIGTERM', () => {
    sharedServer.shutdown();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    sharedServer.shutdown();
    process.exit(0);
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[sidecar] MCP server running on stdio\n');
}

module.exports = { handlers, startMcpServer, getProjectDir };
