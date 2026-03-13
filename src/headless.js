/**
 * Headless Mode Runner
 *
 * Spec Reference: §6.2 Headless Mode, §9 Implementation
 * Uses OpenCode SDK for headless execution (no CLI spawning required).
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const { ensureNodeModulesBinInPath } = require('./utils/path-setup');
const { ensurePortAvailable } = require('./utils/server-setup');
const { mapAgentToOpenCode } = require('./utils/agent-mapping');
const { writeProgress } = require('./sidecar/progress');
const { writeSessionInfo } = require('./sidecar/session-utils');

/**
 * Fold marker that the agent outputs when done
 * Spec Reference: §6.2
 */
const FOLD_MARKER = '[SIDECAR_FOLD]';
const COMPLETE_MARKER = FOLD_MARKER; // backward compat

/**
 * Default timeout: 15 minutes per spec §6.2
 */
const DEFAULT_TIMEOUT = 15 * 60 * 1000;


/**
 * Wait for the OpenCode server to be ready using SDK health check
 */
async function waitForServer(client, checkHealthFn, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const isHealthy = await checkHealthFn(client);
      if (isHealthy) {
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Run a headless sidecar session
 * Spec Reference: §6.2, §9.1 runHeadless function
 *
 * @param {string} model - Model to use (e.g., 'openrouter/google/gemini-2.5-flash')
 * @param {string} systemPrompt - The system prompt for the agent (instruction-level context)
 * @param {string} userMessage - The user message (task briefing)
 * @param {string} taskId - Unique task identifier
 * @param {string} project - Project directory path
 * @param {number} [timeoutMs=DEFAULT_TIMEOUT] - Timeout in milliseconds
 * @param {string} [agent] - Agent mode: build (default), plan, explore, general
 * @param {object} [options] - Additional options
 * @param {object} [options.mcp] - MCP server configurations
 * @param {string} [options.summaryLength='normal'] - Desired summary length
 * @param {object} [options.reasoning] - Reasoning/thinking configuration
 * @param {string} [options.reasoning.effort] - Effort level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'none'
 * @returns {Promise<object>} Result object with summary, completed, timedOut flags
 */
async function runHeadless(model, systemPrompt, userMessage, taskId, project, timeoutMs = DEFAULT_TIMEOUT, agent, options = {}) {
  const {
    createSession,
    sendPromptAsync,
    getMessages,
    checkHealth,
    startServer
  } = require('./opencode-client');

  const { reasoning } = options;
  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');

  // Ensure session directory exists
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }

  // Log system prompt as first message in conversation
  logMessage(conversationPath, {
    role: 'system',
    content: systemPrompt,
    timestamp: new Date().toISOString()
  });

  // Write initial progress
  writeProgress(sessionDir, 'initializing');

  // Ensure node_modules/.bin is in PATH so SDK can find opencode wrapper
  ensureNodeModulesBinInPath();

  // Use specified port, or 0 to let the OS auto-assign (enables parallel sessions)
  const port = options.port || 0;
  if (port > 0) {
    ensurePortAvailable(port);
  }

  // Start OpenCode server using SDK (no CLI spawning required)
  logger.debug('Starting OpenCode server via SDK', { model, hasMcp: !!options.mcp, port });
  let client, server;

  try {
    // Pass MCP config and port to server
    const serverOptions = { port };
    if (options.mcp) {
      serverOptions.mcp = options.mcp;
    }
    const result = await startServer(serverOptions);
    client = result.client;
    server = result.server;
    logger.debug('Server started', { url: server.url });
  } catch (error) {
    logger.error('Failed to start OpenCode server', { error: error.message });
    return {
      summary: '',
      completed: false,
      timedOut: false,
      taskId,
      error: `Failed to start server: ${error.message}`
    };
  }

  let sessionId;

  try {
    // Wait for server to be ready
    logger.debug('Waiting for OpenCode server to be ready');
    const serverReady = await waitForServer(client, checkHealth);
    logger.debug('Server ready', { serverReady });
    writeProgress(sessionDir, 'server_ready');

    if (!serverReady) {
      server.close();
      return {
        summary: '',
        completed: false,
        timedOut: false,
        taskId,
        error: 'OpenCode server failed to start'
      };
    }

    // Create a new session using SDK
    logger.debug('Creating OpenCode session');
    try {
      sessionId = await createSession(client);
    } catch (error) {
      server.close();
      return {
        summary: '',
        completed: false,
        timedOut: false,
        taskId,
        error: error.message
      };
    }
    logger.debug('Session ID', { sessionId });
    writeProgress(sessionDir, 'session_created');

    // Write port + session ID to metadata so MCP App tools can access them
    const serverPort = new URL(server.url).port;
    writeSessionInfo(sessionDir, serverPort, sessionId);

    // Log user message to conversation before sending
    logMessage(conversationPath, {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // Send system prompt and user message using SDK
    logger.debug('Sending message to OpenCode', {
      sessionId,
      systemLength: systemPrompt.length,
      userMessageLength: userMessage.length
    });

    const promptOptions = {
      model: model,
      system: systemPrompt,
      parts: [{ type: 'text', text: userMessage }]
    };

    // Default to 'build' in headless mode — 'chat' stalls without user interaction
    const agentConfig = mapAgentToOpenCode(agent || 'build');
    promptOptions.agent = agentConfig.agent;

    // Add reasoning/thinking configuration if provided
    if (reasoning) {
      promptOptions.reasoning = reasoning;
    }

    // Send prompt asynchronously (returns immediately, we poll for results)
    logger.info('Sending prompt to OpenCode', {
      sessionId,
      model,
      agent: promptOptions.agent,
      userMessageLength: userMessage.length
    });
    await sendPromptAsync(client, sessionId, promptOptions);
    writeProgress(sessionDir, 'prompt_sent');
    logger.info('Prompt sent successfully, entering polling loop', {
      sessionId,
      timeoutMs
    });

    let output = '';
    let completed = false;
    let timedOut = false;
    let aborted = false;
    let sessionError = null; // Captures model/SDK errors from assistant messages
    const toolCalls = [];

    // Poll for completion by checking messages
    const startTime = Date.now();
    let pollCount = 0;
    let lastAssistantMsgId = null;
    let lastOutputLength = 0; // Track output growth to detect streaming
    let stablePolls = 0; // Count polls where nothing has changed
    let receivingReported = false; // Track whether 'receiving' stage was reported
    const seenTextParts = new Map(); // partId -> last captured text length
    // seenPartIds reserved for future use (tracking processed non-text parts)

    while (!completed && (Date.now() - startTime) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check for external abort signal (MCP tool or CLI command)
      try {
        const metaCheck = path.join(sessionDir, 'metadata.json');
        if (fs.existsSync(metaCheck)) {
          const metaContent = fs.readFileSync(metaCheck, 'utf-8');
          const meta = JSON.parse(metaContent);
          if (meta.status === 'aborted') {
            logger.info('External abort signal received', { taskId });
            try {
              const { abortSession } = require('./opencode-client');
              await abortSession(client, sessionId);
            } catch (abortErr) {
              logger.warn('Failed to abort OpenCode session', { error: abortErr.message });
            }
            aborted = true;
            break;
          }
        }
      } catch {
        // Ignore metadata read errors during polling
      }
      pollCount++;

      try {
        const messages = await getMessages(client, sessionId);
        const messageCount = messages?.length || 0;

        // Find the last assistant message to check if it's complete
        let currentAssistantMsgId = null;
        let assistantFinished = false;

        if (messages && Array.isArray(messages)) {
          for (const msg of messages) {
            const role = msg.info?.role;

            // Track assistant message state
            if (role === 'assistant') {
              currentAssistantMsgId = msg.info.id;
              // Check for errors — capture for result propagation
              if (msg.info.error) {
                sessionError = msg.info.error.data?.message
                  || msg.info.error.name
                  || 'Unknown model error';
                logger.error('Session error detected in assistant message', {
                  sessionId,
                  error: msg.info.error.name,
                  message: msg.info.error.data?.message
                });
              }
            }

            // Only process parts from assistant messages (skip user messages)
            if (role !== 'assistant' || !msg.parts) {
              continue;
            }

            for (const part of msg.parts) {
              const partId = part.id || `${msg.info.id}:${part.type}:${msg.parts.indexOf(part)}`;

              if (part.type === 'text' && part.text) {
                const prevLen = seenTextParts.get(partId) || 0;
                if (part.text.length > prevLen) {
                  // Append only the new portion (handles streaming growth)
                  const newText = part.text.slice(prevLen);
                  output += newText;
                  seenTextParts.set(partId, part.text.length);
                  logMessage(conversationPath, {
                    role: 'assistant',
                    content: newText,
                    timestamp: new Date().toISOString()
                  });

                  // Report 'receiving' stage on first text detection
                  if (!receivingReported) {
                    receivingReported = true;
                    writeProgress(sessionDir, 'receiving', { messagesReceived: 1 });
                  }
                }
              } else if ((part.type === 'tool_use' || part.type === 'tool') && !toolCalls.find(t => t.id === part.id)) {
                const toolCall = {
                  id: part.id,
                  name: part.name,
                  input: part.input
                };
                toolCalls.push(toolCall);
                logger.debug('Tool call detected (polling)', {
                  toolName: part.name,
                  toolId: part.id,
                  subagentType: part.input?.subagent_type,
                  model: part.input?.model
                });
                logMessage(conversationPath, {
                  role: 'assistant',
                  type: 'tool_use',
                  toolCall,
                  timestamp: new Date().toISOString()
                });

                // Update progress on tool_use detection
                const toolLabel = part.name
                  ? `Calling tool: ${part.name}`
                  : 'Executing tool call...';
                writeProgress(sessionDir, 'receiving', {
                  messagesReceived: toolCalls.length,
                  latestTool: part.name || undefined,
                  stageLabel: toolLabel
                });
                receivingReported = true;
              } else if (part.type === 'tool_result') {
                logger.debug('Tool result received (polling)', {
                  toolUseId: part.tool_use_id,
                  isError: part.is_error || false
                });
                logMessage(conversationPath, {
                  role: 'tool',
                  type: 'tool_result',
                  toolUseId: part.tool_use_id,
                  isError: part.is_error || false,
                  content: part.content,
                  timestamp: new Date().toISOString()
                });
              }
            }
          }

          // assistantFinished = true only when the LAST assistant message is complete
          // (earlier messages may finish while the model continues in new messages)
          const lastAssistant = messages
            .filter(m => m.info?.role === 'assistant')
            .pop();
          assistantFinished = !!(lastAssistant?.info?.time?.completed);
        }

        logger.debug('Poll status', {
          pollCount,
          messageCount,
          assistantFinished,
          outputLength: output.length,
          elapsed: Date.now() - startTime
        });

        // Check for completion marker on its own line (not inline in prose).
        // Models may mention [SIDECAR_FOLD] when describing code — only treat
        // it as a signal when it appears as a standalone line.
        if (/^\s*\[SIDECAR_FOLD\]\s*$/m.test(output)) {
          completed = true;
          break;
        }

        // If the model returned an error with no output, exit immediately
        // (don't wait for timeout — the model won't produce anything)
        if (sessionError && !output && assistantFinished) {
          logger.error('Model returned error with no output, exiting', {
            sessionError, pollCount
          });
          break;
        }

        // Count as stable when nothing has changed — same messages, no new output.
        //   1. assistantFinished + stable for 2 polls (ideal)
        //   2. No output growth + same message count for 4 polls (fallback
        //      for models that don't set time.completed reliably)
        //
        // IMPORTANT: Only count stable polls when the assistant has actually
        // produced output. The SDK may create an empty assistant message
        // placeholder immediately when promptAsync is called — that's NOT
        // a completed response. We need real text output before we start
        // counting towards completion.
        const outputGrew = output.length > lastOutputLength;
        lastOutputLength = output.length;

        if (!outputGrew && currentAssistantMsgId === lastAssistantMsgId) {
          if (currentAssistantMsgId !== null && output.length > 0) {
            stablePolls++;
            const threshold = assistantFinished ? 2 : 4;
            if (stablePolls >= threshold) {
              logger.debug('Session appears complete', { stablePolls, assistantFinished });
              break;
            }
          } else {
            logger.debug('Waiting for model to produce output', {
              pollCount,
              hasAssistantMsg: currentAssistantMsgId !== null,
              outputLength: output.length
            });
          }
        } else {
          stablePolls = 0;
        }
        lastAssistantMsgId = currentAssistantMsgId;

      } catch (pollError) {
        logger.debug('Polling error', { error: pollError.message });
        // Continue polling despite errors
      }
    }

    // Log why the polling loop exited (error level so it always appears in debug.log)
    logger.error('Polling loop exited', {
      taskId,
      completed,
      aborted,
      pollCount,
      stablePolls,
      outputLength: output.length,
      elapsed: Date.now() - startTime,
      hasAssistantMsg: lastAssistantMsgId !== null,
      sessionError: sessionError || null
    });

    // Handle timeout
    if (!completed && !aborted && (Date.now() - startTime) >= timeoutMs) {
      timedOut = true;
      logger.warn('Task timed out', { taskId, elapsed: Date.now() - startTime });

      // Abort the OpenCode session on timeout (agent keeps running otherwise)
      try {
        const { abortSession } = require('./opencode-client');
        await abortSession(client, sessionId);
        logger.info('Session aborted after timeout', { taskId, sessionId });
      } catch (abortErr) {
        logger.warn('Failed to abort session after timeout', { error: abortErr.message });
      }
    }

    server.close();

    // Log summary of tool calls for debugging
    if (toolCalls.length > 0) {
      logger.info('Tool calls summary', {
        totalToolCalls: toolCalls.length,
        taskToolCalls: toolCalls.filter(t => t.name === 'Task').length,
        subagentTypes: toolCalls
          .filter(t => t.name === 'Task' && t.input?.subagent_type)
          .map(t => ({ type: t.input.subagent_type, model: t.input.model || 'inherited' }))
      });
    }

    // If the model returned an error and produced no output, propagate the error
    // so startSidecar() marks the session as 'error' instead of 'complete'
    if (sessionError && !output) {
      return {
        summary: '',
        completed: false,
        timedOut,
        aborted,
        taskId,
        toolCalls,
        error: sessionError
      };
    }

    return {
      summary: extractSummary(output),
      completed,
      timedOut,
      aborted,
      taskId,
      toolCalls, // Include tool calls in result for verification
      exitCode: 0
    };

  } catch (error) {
    logger.error('runHeadless caught exception', {
      taskId,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join(' | ')
    });
    // Abort session on error (agent may keep running)
    if (sessionId) {
      try {
        const { abortSession } = require('./opencode-client');
        await abortSession(client, sessionId);
      } catch {
        // Ignore abort errors during error handling
      }
    }
    server.close();
    return {
      summary: '',
      completed: false,
      timedOut: false,
      aborted: false,
      taskId,
      error: error.message
    };
  }
}

/**
 * Extract summary from output (everything before [SIDECAR_FOLD])
 * Spec Reference: §6.2 - Return summary (everything before [SIDECAR_FOLD])
 *
 * @param {string} output - Raw output from OpenCode
 * @returns {string} Extracted summary
 */
function extractSummary(output) {
  if (!output) {
    return '';
  }

  // Split on the fold marker only when it appears on its own line.
  // Models may mention [SIDECAR_FOLD] inline when describing code —
  // only treat it as a delimiter when standalone.
  const markerRegex = /^\s*\[SIDECAR_FOLD\]\s*$/m;
  const match = output.match(markerRegex);
  if (match) {
    return output.slice(0, match.index).trim();
  }
  return output.trim();
}

/**
 * Format a structured fold output with metadata
 * @param {Object} options - Fold output options
 * @param {string} options.model - Model identifier
 * @param {string} options.sessionId - Session identifier
 * @param {string} [options.client='code-local'] - Client identifier
 * @param {string} [options.cwd] - Working directory (defaults to process.cwd())
 * @param {string} [options.mode='headless'] - Execution mode
 * @param {string} options.summary - Summary text
 * @returns {string} Formatted fold output
 */
function formatFoldOutput({ model, sessionId, client, cwd, mode, summary }) {
  return [
    '[SIDECAR_FOLD]',
    `Model: ${model}`,
    `Session: ${sessionId}`,
    `Client: ${client || 'code-local'}`,
    `CWD: ${cwd || process.cwd()}`,
    `Mode: ${mode || 'headless'}`,
    '---',
    summary
  ].join('\n');
}

/**
 * Log a message to the conversation JSONL file
 * Spec Reference: §8.2 - Capture conversation to JSONL in real-time
 *
 * @param {string} conversationPath - Path to conversation.jsonl
 * @param {object} message - Message object with role, content, timestamp
 */
function logMessage(conversationPath, message) {
  fs.appendFileSync(conversationPath, JSON.stringify(message) + '\n', { mode: 0o600 });
}

module.exports = {
  runHeadless,
  waitForServer,
  extractSummary,
  formatFoldOutput,
  DEFAULT_TIMEOUT,
  FOLD_MARKER,
  COMPLETE_MARKER
};
