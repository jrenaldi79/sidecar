/**
 * Headless Mode Runner
 *
 * Spec Reference: §6.2 Headless Mode, §9 Implementation
 * Uses OpenCode SDK for headless execution (no CLI spawning required).
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const {
  createSession,
  sendPrompt,
  getMessages,
  getSessionStatus,
  checkHealth,
  startServer
} = require('./opencode-client');
const { ensureNodeModulesBinInPath } = require('./utils/path-setup');
const { ensurePortAvailable } = require('./utils/server-setup');
const { mapAgentToOpenCode } = require('./utils/agent-mapping');

/**
 * Completion marker that the agent outputs when done
 * Spec Reference: §6.2
 */
const COMPLETE_MARKER = '[SIDECAR_COMPLETE]';

/**
 * Default timeout: 15 minutes per spec §6.2
 */
const DEFAULT_TIMEOUT = 15 * 60 * 1000;

/**
 * Grace period after injecting summary prompt (30 seconds per spec)
 */
const SUMMARY_GRACE_PERIOD = 30 * 1000;

/**
 * Wait for the OpenCode server to be ready using SDK health check
 */
async function waitForServer(client, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const isHealthy = await checkHealth(client);
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
  const { summaryLength = 'normal', reasoning } = options;  const sessionDir = path.join(project, '.claude', 'sidecar_sessions', taskId);
  const conversationPath = path.join(sessionDir, 'conversation.jsonl');

  // Ensure session directory exists
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  // Log system prompt as first message in conversation
  logMessage(conversationPath, {
    role: 'system',
    content: systemPrompt,
    timestamp: new Date().toISOString()
  });

  // Ensure node_modules/.bin is in PATH so SDK can find opencode wrapper
  ensureNodeModulesBinInPath();

  // Ensure port is available (kills stale processes from previous sessions)
  ensurePortAvailable();

  // Start OpenCode server using SDK (no CLI spawning required)
  logger.debug('Starting OpenCode server via SDK', { model, hasMcp: !!options.mcp });
  let client, server;

  try {
    // Pass MCP config to server if provided
    const serverOptions = {};
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

  try {
    // Wait for server to be ready
    logger.debug('Waiting for OpenCode server to be ready');
    const serverReady = await waitForServer(client);
    logger.debug('Server ready', { serverReady });

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
    let sessionId;
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

    // Map sidecar agent mode to OpenCode native agent
    // This handles aliases (code→Build, plan→Plan) and passes custom agents through
    if (agent) {
      const agentConfig = mapAgentToOpenCode(agent);
      promptOptions.agent = agentConfig.agent;

      // Handle 'ask' mode which requires permission approval
      if (agentConfig.permissions) {
        promptOptions.permissions = agentConfig.permissions;
      }
    }

    // Add reasoning/thinking configuration if provided
    if (reasoning) {
      promptOptions.reasoning = reasoning;
    }

    const messageResult = await sendPrompt(client, sessionId, promptOptions);
    logger.debug('Message result', { partsCount: messageResult.data?.parts?.length || 0 });

    let output = '';
    let completed = false;
    let timedOut = false;
    const toolCalls = []; // Track tool calls for debugging

    // Process response parts (text, tool_use, tool_result)
    if (messageResult.data?.parts) {
      for (const part of messageResult.data.parts) {
        if (part.type === 'text' && part.text) {
          output += part.text;
          logMessage(conversationPath, {
            role: 'assistant',
            content: part.text,
            timestamp: new Date().toISOString()
          });
        } else if (part.type === 'tool_use') {
          // Log tool calls (including Task tool for subagent spawning)
          const toolCall = {
            id: part.id,
            name: part.name,
            input: part.input
          };
          toolCalls.push(toolCall);
          logger.debug('Tool call detected', {
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
        } else if (part.type === 'tool_result') {
          // Log tool results
          logger.debug('Tool result received', {
            toolUseId: part.tool_use_id,
            isError: part.is_error || false,
            contentLength: part.content?.length || 0
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

    // Check for completion marker
    if (output.includes(COMPLETE_MARKER)) {
      completed = true;
    }

    // Poll for completion by checking messages directly
    // Note: session.status() API returns {} so we check messages instead
    const startTime = Date.now();
    let pollCount = 0;
    let lastAssistantMsgId = null;
    let stablePolls = 0; // Count polls where assistant message hasn't changed

    while (!completed && (Date.now() - startTime) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      pollCount++;

      try {
        const messages = await getMessages(client, sessionId);
        const messageCount = messages?.length || 0;

        // Find the last assistant message to check if it's complete
        let currentAssistantMsgId = null;
        let assistantFinished = false;

        if (messages && Array.isArray(messages)) {
          for (const msg of messages) {
            // Check if this is an assistant message with completion info
            if (msg.info?.role === 'assistant') {
              currentAssistantMsgId = msg.info.id;
              // Check if the message has a completed time (indicates it's done)
              if (msg.info.time?.completed) {
                assistantFinished = true;
              }
              // Check for errors
              if (msg.info.error) {
                logger.warn('Session error detected', {
                  sessionId,
                  error: msg.info.error.name,
                  message: msg.info.error.data?.message
                });
              }
            }

            // Process message parts
            if (msg.parts) {
              for (const part of msg.parts) {
                if (part.type === 'text' && part.text && !output.includes(part.text)) {
                  output += part.text;
                  logMessage(conversationPath, {
                    role: 'assistant',
                    content: part.text,
                    timestamp: new Date().toISOString()
                  });
                } else if (part.type === 'tool_use' && !toolCalls.find(t => t.id === part.id)) {
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
          }
        }

        logger.debug('Poll status', {
          pollCount,
          messageCount,
          assistantFinished,
          outputLength: output.length,
          elapsed: Date.now() - startTime
        });

        // Check for completion marker in output
        if (output.includes(COMPLETE_MARKER)) {
          completed = true;
          break;
        }

        // If assistant message is finished and stable for 2 polls, consider it done
        if (assistantFinished && currentAssistantMsgId === lastAssistantMsgId) {
          stablePolls++;
          if (stablePolls >= 2) {
            logger.debug('Session appears complete (assistant finished, stable)', { stablePolls });
            break;
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

    // Handle timeout - inject summary prompt
    if (!completed && (Date.now() - startTime) >= timeoutMs) {
      timedOut = true;

      // Send summary prompt using SDK
      let summaryPrompt = '\n\nYou are running out of time. Please output your summary now in the required format, followed by [SIDECAR_COMPLETE].\n';
      if (summaryLength === 'brief') {
        summaryPrompt = '\n\nYou are running out of time. Please output a BRIEF summary now, followed by [SIDECAR_COMPLETE].\n';
      }

      await sendPrompt(client, sessionId, {
        model: model,
        parts: [{ type: 'text', text: summaryPrompt }]
      });

      // Wait grace period for response
      await new Promise(resolve => setTimeout(resolve, SUMMARY_GRACE_PERIOD));

      // Get final messages using SDK
      const finalMessages = await getMessages(client, sessionId);

      if (finalMessages && Array.isArray(finalMessages)) {
        for (const msg of finalMessages) {
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.type === 'text' && part.text && !output.includes(part.text)) {
                output += part.text;
              }
            }
          }
        }
      }

      if (output.includes(COMPLETE_MARKER)) {
        completed = true;
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

    return {
      summary: extractSummary(output),
      completed,
      timedOut,
      taskId,
      toolCalls, // Include tool calls in result for verification
      exitCode: 0
    };

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
}

/**
 * Extract summary from output (everything before [SIDECAR_COMPLETE])
 * Spec Reference: §6.2 - Return summary (everything before [SIDECAR_COMPLETE])
 *
 * @param {string} output - Raw output from OpenCode
 * @returns {string} Extracted summary
 */
function extractSummary(output) {
  if (!output) {
    return '';
  }

  // Split on the completion marker and take everything before it
  const parts = output.split(COMPLETE_MARKER);
  return parts[0].trim();
}

/**
 * Log a message to the conversation JSONL file
 * Spec Reference: §8.2 - Capture conversation to JSONL in real-time
 *
 * @param {string} conversationPath - Path to conversation.jsonl
 * @param {object} message - Message object with role, content, timestamp
 */
function logMessage(conversationPath, message) {
  fs.appendFileSync(conversationPath, JSON.stringify(message) + '\n');
}

module.exports = {
  runHeadless,
  extractSummary,
  DEFAULT_TIMEOUT,
  COMPLETE_MARKER
};
