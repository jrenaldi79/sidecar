/**
 * Sidecar Chat UI Renderer
 *
 * Handles:
 * - Displaying messages
 * - Sending messages via OpenCode API
 * - Tool call status display
 * - FOLD button functionality
 */

// DOM Elements
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const foldBtn = document.getElementById('fold-btn');
const taskIdEl = document.getElementById('task-id');
const modelNameEl = document.getElementById('model-name');

// State
let sessionId = null;
let isWaitingForResponse = false;
let config = null;
let initialized = false;
let toolStatusEl = null;
let pollInterval = null;
let lastMessageCount = 0;
let autoScrollEnabled = true;

// Model Picker State
let modelPickerState = null;
let currentModel = null;

// Mode Picker State
let modePickerState = null;
let currentMode = null;

// Thinking Picker State
let thinkingPickerState = null;
let currentThinking = 'medium';

// MCP Manager State
let mcpManagerState = null;

// Autocomplete Manager State
let autocompleteManager = null;

// Request Timer State
let requestTimerInterval = null;
let requestStartTime = null;

// Cancel Request State
let isCancelMode = false;
let cancelClickHandler = null;

// SSE Streaming State
let sseSubscribed = false;
let streamingTextBuffer = '';
let streamingMessageEl = null;
let streamingRequestResolve = null; // Resolve function for streaming promise
let streamingToolsCalled = [];
let streamingProcessedReasoningIds = new Set();
let sseMessageAddedForCurrentRequest = false; // Track if SSE added a message for current request
let userSentMessageContents = new Set(); // Track message contents we've sent to filter from SSE
let currentStreamingMessageId = null; // Track the message ID we're currently streaming

// Response Block State (unified text + tools)
let currentResponseBlock = null;
let responseBlockToolStats = { total: 0, completed: 0, running: 0, failed: 0 };
let pendingPermissionsForTools = new Map(); // callId -> permission data

// Status Indicator State
let statusCheckInterval = null;
let lastStatusCheck = null;
const STATUS_CHECK_INTERVAL = 10000; // Check every 10 seconds

// Sub-agent State
const subagents = new Map();
// OpenCode native subagent types only: General (full access) and Explore (read-only)
const VALID_SUBAGENT_TYPES = ['general', 'explore'];

// Context Panel State
let contextPanelState = null;
let contextModalVisible = false;

// ============================================================================
// Error Reporting Utility
// ============================================================================

/**
 * Report an error to the main process for logging and diagnostics
 * @param {string} source - Error source (e.g., 'fetch', 'api', 'init')
 * @param {string} message - Error message
 * @param {object} [context] - Additional context
 * @param {Error} [error] - Original error object
 */
async function reportError(source, message, context = {}, error = null) {
  console.error(`[Sidecar][${source}] ${message}`, context, error);

  // Report to main process if API is available
  if (window.electronAPI?.reportError) {
    try {
      await window.electronAPI.reportError({
        source,
        message,
        context: {
          ...context,
          url: window.location?.href,
          timestamp: Date.now()
        },
        stack: error?.stack
      });
    } catch (e) {
      // Ignore reporting errors
      console.warn('[Sidecar] Failed to report error to main:', e);
    }
  }
}

/**
 * Use IPC proxy for API calls (bypasses Chromium network service issues)
 * @param {string} endpoint - API endpoint (e.g., '/session/abc/message')
 * @param {object} options - Fetch-like options
 * @returns {Promise<{ok: boolean, status: number, data: any}>}
 */
async function proxyFetch(endpoint, options = {}) {
  // Check if IPC proxy is available
  if (window.electronAPI?.proxyApiCall) {
    try {
      const body = options.body ? JSON.parse(options.body) : undefined;
      const result = await window.electronAPI.proxyApiCall({
        method: options.method || 'GET',
        endpoint,
        body
      });

      // If proxy returned an error field, throw it
      if (result.error) {
        throw new Error(result.error);
      }

      return result;
    } catch (err) {
      await reportError('proxy', `IPC proxy failed: ${err.message}`, { endpoint }, err);
      throw err;
    }
  }

  // Fallback to direct fetch if proxy not available
  return safeFetch(`${config.apiBase}${endpoint}`, options);
}

/**
 * Wrap fetch with error reporting (used when IPC proxy not available)
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function safeFetch(url, options = {}) {
  try {
    const response = await fetch(url, options);

    // Check for empty response that should have content
    if (response.ok && options.method === 'POST') {
      const contentLength = response.headers.get('content-length');
      if (contentLength === '0') {
        await reportError('api', 'API returned empty response', {
          url,
          status: response.status,
          method: options.method
        });
      }
    }

    // Convert response to our standard format
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      data: text ? JSON.parse(text) : null
    };
  } catch (err) {
    // Report network-level errors
    await reportError('network', `Fetch failed: ${err.message}`, {
      url,
      method: options.method || 'GET'
    }, err);
    throw err;
  }
}

/**
 * Parse JSON response with error handling
 * @param {Response} response - Fetch response
 * @returns {Promise<object>}
 */
async function safeJsonParse(response) {
  const text = await response.text();

  if (!text || text.length === 0) {
    await reportError('api', 'Empty response body', {
      status: response.status,
      url: response.url
    });
    throw new Error('Server returned empty response - API may be unavailable');
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    await reportError('api', 'JSON parse failed', {
      status: response.status,
      url: response.url,
      bodyPreview: text.slice(0, 200)
    }, err);
    throw new Error(`Invalid JSON response: ${err.message}`);
  }
}

// ============================================================================
// SSE Streaming Functions
// ============================================================================

/**
 * Subscribe to SSE events for real-time streaming
 */
async function subscribeToSSE() {
  if (sseSubscribed) {
    console.log('[Sidecar] SSE already subscribed');
    return;
  }

  if (!window.electronAPI?.subscribeSSE) {
    console.warn('[Sidecar] SSE not available - using sync mode');
    return;
  }

  try {
    const result = await window.electronAPI.subscribeSSE();
    if (result.success) {
      sseSubscribed = true;
      console.log('[Sidecar] ✅ SSE subscription active');

      // Set up event listener
      window.electronAPI.onSSEEvent(handleSSEEvent);
    } else {
      console.warn('[Sidecar] SSE subscription failed:', result.message);
    }
  } catch (err) {
    console.error('[Sidecar] SSE subscription error:', err);
  }
}

/**
 * Unsubscribe from SSE events
 */
async function unsubscribeFromSSE() {
  if (!sseSubscribed) return;

  if (window.electronAPI?.unsubscribeSSE) {
    await window.electronAPI.unsubscribeSSE();
  }
  sseSubscribed = false;
  console.log('[Sidecar] SSE unsubscribed');
}

/**
 * Handle SSE events from the server
 * @param {{type: string, data: object}} event - SSE event
 */
function handleSSEEvent(event) {
  // OpenCode wraps events in a payload object
  // Format: { payload: { type: "message.part.updated", properties: {...} } }
  const payload = event.data?.payload || event.data;
  const eventType = payload?.type || event.type;
  const properties = payload?.properties || payload;

  console.log('[Sidecar] SSE event:', eventType, properties);

  switch (eventType) {
    case 'message.delta':
    case 'message.part.updated':
      handleMessagePartUpdate(properties);
      break;

    case 'message.complete':
    case 'message.updated':
      handleMessageUpdate(properties);
      // Capture usage data if present
      if (properties?.usage) {
        updateContextUsage(properties.usage);
      }
      break;

    case 'session.idle':
      handleSessionIdle(properties);
      break;

    case 'session.complete':
    case 'session.status':
      handleSessionStatus(properties);
      break;

    case 'tool.start':
    case 'session.tool.start':
      handleToolStart(properties);
      break;

    case 'tool.complete':
    case 'session.tool.complete':
      handleToolComplete(properties);
      break;

    case 'reasoning':
    case 'session.reasoning':
      handleStreamingReasoning(properties);
      break;

    case 'error':
    case 'session.error':
      handleStreamingError(properties);
      break;

    case 'server.connected':
      console.log('[Sidecar] SSE server connected');
      break;

    case 'session.updated':
    case 'session.diff':
      // Informational events, no action needed
      break;

    case 'question.asked':
      handleQuestionAsked(properties);
      break;

    case 'permission.asked':
    case 'permission.updated':
      handlePermissionAsked(properties);
      break;

    default:
      console.log('[Sidecar] Unhandled SSE event type:', eventType);
  }
}

/**
 * Handle message part update (streaming text chunks)
 * @param {object} properties - Part properties
 */
function handleMessagePartUpdate(properties) {
  const part = properties?.part || properties;
  if (!part) return;

  // Get message ID from the part
  const messageId = part?.messageID || properties?.messageID;

  // Handle text parts
  if (part.type === 'text' && part.text) {
    const textContent = part.text.trim();

    // Skip messages we've sent as user - they are echoed back via SSE
    // Check if this text matches something we sent
    if (userSentMessageContents.has(textContent)) {
      console.log('[Sidecar] Skipping user message (content match):', textContent.slice(0, 50));
      return;
    }

    // If we're already streaming a different message, don't overwrite
    if (currentStreamingMessageId && messageId && currentStreamingMessageId !== messageId) {
      // Check if the new message is one we sent by content
      if (userSentMessageContents.has(textContent)) {
        console.log('[Sidecar] Skipping user message during stream:', textContent.slice(0, 50));
        return;
      }
      // New assistant message - finalize the old one first
      if (streamingMessageEl) {
        streamingMessageEl.classList.remove('streaming');
        streamingMessageEl = null;
        streamingTextBuffer = '';
      }
    }

    // Track this as the current streaming message
    if (messageId) {
      currentStreamingMessageId = messageId;
    }

    const cleanText = part.text.replace(/\[REDACTED\]/gi, '');
    if (!cleanText) return;

    // Mark that SSE is handling this message
    sseMessageAddedForCurrentRequest = true;

    // Update or create streaming message (standalone, not in response block)
    if (!streamingMessageEl) {
      removeTypingIndicator();

      // Close current tool group when AI text response starts
      // This ensures subsequent tools/reasoning go into a NEW group
      if (currentToolGroup && currentToolGroup.dataset.active === 'true') {
        currentToolGroup.dataset.active = 'false';
        // Don't collapse yet - just mark inactive so new tools create new group
      }

      streamingMessageEl = document.createElement('div');
      streamingMessageEl.className = 'message assistant streaming';

      const contentEl = document.createElement('div');
      contentEl.className = 'message-content';
      streamingMessageEl.appendChild(contentEl);

      messagesContainer.appendChild(streamingMessageEl);
    }

    // Replace entire buffer with current text (part.text is cumulative)
    streamingTextBuffer = cleanText;

    const contentEl = streamingMessageEl.querySelector('.message-content');
    if (contentEl) {
      contentEl.innerHTML = formatMessageContent(streamingTextBuffer);
      scrollToBottom();
    }
  }

  // Handle reasoning parts
  if ((part.type === 'reasoning' || part.type === 'thinking') && part.text) {
    const reasoningText = part.text.replace(/\[REDACTED\]/gi, '');
    if (reasoningText && !streamingProcessedReasoningIds.has(part.id)) {
      streamingProcessedReasoningIds.add(part.id || `reason-${Date.now()}`);
      addReasoningToGroup(reasoningText);
    }
  }

  // Handle tool parts
  if (part.type === 'tool') {
    handleToolPart(part);
  }
}

/**
 * Handle message update event
 * @param {object} properties - Message properties
 */
function handleMessageUpdate(properties) {
  // Message update may contain completed message info
  const message = properties?.message || properties;

  // Check if message has parts with text
  if (message?.parts) {
    for (const part of message.parts) {
      if (part.type === 'text' && part.text) {
        const cleanText = part.text.replace(/\[REDACTED\]/gi, '');
        if (cleanText && streamingMessageEl) {
          streamingTextBuffer = cleanText;
          const contentEl = streamingMessageEl.querySelector('.message-content');
          if (contentEl) {
            contentEl.innerHTML = formatMessageContent(cleanText);
          }
        }
      }
    }
  }
}

/**
 * Handle session idle event (work complete)
 * @param {object} properties - Session properties
 */
function handleSessionIdle(properties) {
  console.log('[Sidecar] Session idle:', properties);

  // Finalize streaming message
  if (streamingMessageEl) {
    streamingMessageEl.classList.remove('streaming');

    // Log the message
    if (window.electronAPI?.logMessage && streamingTextBuffer) {
      window.electronAPI.logMessage({
        role: 'assistant',
        content: streamingTextBuffer,
        timestamp: new Date().toISOString()
      });
    }

    streamingMessageEl = null;
  }

  // Finalize tool group
  if (streamingToolsCalled.length > 0) {
    finalizeToolGroup();
  }

  // Reset state
  streamingTextBuffer = '';
  streamingToolsCalled = [];
  streamingProcessedReasoningIds.clear();

  // Resolve streaming promise
  if (streamingRequestResolve) {
    streamingRequestResolve();
    streamingRequestResolve = null;
  }

  // Reset UI
  removeTypingIndicator();
  isWaitingForResponse = false;
  sendBtn.disabled = false;
  messageInput.focus();
  stopRequestTimer();

  // Recalculate context usage after message completes
  recalculateContext();
}

/**
 * Handle session status event
 * @param {object} properties - Status properties
 */
function handleSessionStatus(properties) {
  const status = properties?.status;
  console.log('[Sidecar] Session status:', status);

  // Update typing indicator based on status
  if (status === 'running' || status === 'busy') {
    if (!streamingMessageEl && isWaitingForResponse) {
      showTypingIndicator('Processing...');
    }
  }
}

/**
 * Handle tool part from SSE
 * @param {object} part - Tool part data
 */
function handleToolPart(part) {
  const callId = part.callID || part.id;
  const toolName = part.tool || part.name;
  const status = part.state?.status || 'running';

  if (!callId || !toolName) return;

  // Check if this is a question tool that needs user interaction
  // Question tools have input but no output yet (waiting for user response)
  const isQuestion = toolName?.toLowerCase() === 'question' || toolName?.toLowerCase() === 'askuserquestion';
  if (isQuestion && part.state?.input && !part.state?.output) {
    // Skip if already answered or pending
    if (!pendingQuestions.has(callId) && !answeredQuestions.has(callId)) {
      console.log('[Sidecar] SSE detected question tool, showing UI:', callId);
      showQuestionUI(callId, part.state.input);
    }
    // Don't add question tools to normal tool tracking
    return;
  }

  // Check if already tracked
  const existing = streamingToolsCalled.find(t => t.callID === callId);
  if (existing) {
    if (existing.status !== status) {
      updateToolStatus(callId, status);
      existing.status = status;
    }

    // Update tool content if we have new input/output data
    const input = part.state?.input;
    const output = part.state?.output;
    if (input || output) {
      updateToolContent(callId, toolName, input, output);
    }
  } else {
    streamingToolsCalled.push({
      callID: callId,
      name: toolName,
      status,
      title: part.state?.title || toolName
    });
    // Add to tool group (grouped design with icons)
    addToolStatus(toolName, status, part.state?.input, part.state?.output, callId);
  }
}

/**
 * Update tool content with new input/output data
 * @param {string} callId - Tool call ID
 * @param {string} toolName - Tool name
 * @param {object} input - Tool input data
 * @param {object} output - Tool output data
 */
function updateToolContent(callId, toolName, input, output) {
  const toolEl = document.querySelector(`[data-call-id="${callId}"]`);
  if (!toolEl) return;

  const toolRow = toolEl.querySelector('.tool-item-row');

  // Update title, subtitle, and badge if we have input data now
  if (input && toolRow) {
    const titleInfo = getToolTitleInfo(toolName, input);

    // Update title
    const titleEl = toolRow.querySelector('.tool-item-title');
    if (titleEl && titleInfo.title) {
      titleEl.textContent = titleInfo.title;
    }

    // Update subtitle
    let subtitleEl = toolRow.querySelector('.tool-item-subtitle');
    if (titleInfo.subtitle) {
      if (!subtitleEl) {
        // Create subtitle element if it doesn't exist
        subtitleEl = document.createElement('span');
        subtitleEl.className = 'tool-item-subtitle';
        // Insert after title
        if (titleEl && titleEl.nextSibling) {
          toolRow.insertBefore(subtitleEl, titleEl.nextSibling);
        } else if (titleEl) {
          titleEl.insertAdjacentElement('afterend', subtitleEl);
        }
      }
      subtitleEl.textContent = titleInfo.subtitle;
    } else if (subtitleEl) {
      subtitleEl.remove();
    }

    // Update badge
    let badgeEl = toolRow.querySelector('.tool-item-badge');
    if (titleInfo.badge) {
      if (!badgeEl) {
        // Create badge element if it doesn't exist
        badgeEl = document.createElement('span');
        badgeEl.className = 'tool-item-badge';
        // Insert after subtitle (or title if no subtitle)
        const insertAfter = subtitleEl || titleEl;
        if (insertAfter && insertAfter.nextSibling) {
          toolRow.insertBefore(badgeEl, insertAfter.nextSibling);
        } else if (insertAfter) {
          insertAfter.insertAdjacentElement('afterend', badgeEl);
        }
      }
      badgeEl.textContent = titleInfo.badge;
    } else if (badgeEl) {
      badgeEl.remove();
    }
  }

  // Re-render the details panel with actual content
  const detailsEl = toolEl.querySelector('.tool-item-details');
  if (detailsEl && (input || output)) {
    const newContent = formatToolOutput(toolName, input, output);
    // Only update if content changed (avoid flickering)
    if (detailsEl.innerHTML !== newContent) {
      detailsEl.innerHTML = newContent; // formatToolOutput handles escaping
    }
  }
}

/**
 * Format message content for display (markdown rendering)
 * @param {string} content - Raw message content
 * @returns {string} HTML-formatted content
 */
function formatMessageContent(content) {
  if (typeof marked !== 'undefined') {
    try {
      return marked.parse(content);
    } catch (e) {
      console.warn('[Sidecar] Markdown parse error:', e);
      return escapeHtml(content);
    }
  }
  return escapeHtml(content);
}


/**
 * Handle tool start event
 * @param {object} data - Tool start data
 */
function handleToolStart(data) {
  const toolName = data.tool || data.name;
  const callId = data.callID || data.id;

  if (!toolName || !callId) return;

  // Check if this is a question tool - handle separately
  const isQuestion = toolName?.toLowerCase() === 'question' || toolName?.toLowerCase() === 'askuserquestion';
  if (isQuestion && data.input) {
    // Skip if already answered or pending
    if (!pendingQuestions.has(callId) && !answeredQuestions.has(callId)) {
      console.log('[Sidecar] SSE tool.start detected question tool:', callId);
      showQuestionUI(callId, data.input);
    }
    return;
  }

  // Check if already tracked
  if (streamingToolsCalled.find(t => t.callID === callId)) return;

  // Add to tracking
  streamingToolsCalled.push({
    callID: callId,
    name: toolName,
    status: 'running',
    title: data.title || toolName
  });

  // Display tool status in tool group
  addToolStatus(toolName, 'running', data.input, null, callId);

  // Update typing indicator
  updateTypingIndicator(`Running ${toolName}...`);
}

/**
 * Handle tool complete event
 * @param {object} data - Tool completion data
 */
function handleToolComplete(data) {
  const callId = data.callID || data.id;
  if (!callId) return;

  console.log('[Sidecar] tool.complete:', callId, JSON.stringify(data).slice(0, 500));

  // Update tool status
  updateToolStatus(callId, 'completed');

  // Update tracking
  const trackedTool = streamingToolsCalled.find(t => t.callID === callId);
  if (trackedTool) {
    trackedTool.status = 'completed';
  }

  // Get tool name from tracking or data
  const toolEl = document.querySelector(`[data-call-id="${callId}"]`);
  const toolName = trackedTool?.name || data.tool || data.name || toolEl?.dataset?.toolName;

  // Update tool content if we have data
  if (toolName) {
    const input = data.input || data.state?.input;
    const output = data.output || data.state?.output;
    if (input || output) {
      updateToolContent(callId, toolName, input, output);
    }
  }
}

/**
 * Handle streaming reasoning
 * @param {object} data - Reasoning data
 */
function handleStreamingReasoning(data) {
  const text = data.text || data.content || '';
  if (!text || text === '[REDACTED]') return;

  const reasoningId = data.id || `stream-${Date.now()}-${text.slice(0, 20)}`;
  if (streamingProcessedReasoningIds.has(reasoningId)) return;

  streamingProcessedReasoningIds.add(reasoningId);
  addReasoningToGroup(text);
}

/**
 * Handle streaming error
 * @param {object} data - Error data
 */
function handleStreamingError(data) {
  console.error('[Sidecar] Streaming error:', data);

  // Extract error message, handling nested objects
  let message = 'Unknown streaming error';
  if (typeof data === 'string') {
    message = data;
  } else if (data.message && typeof data.message === 'string') {
    message = data.message;
  } else if (data.error) {
    if (typeof data.error === 'string') {
      message = data.error;
    } else if (data.error.message) {
      message = data.error.message;
    } else {
      message = JSON.stringify(data.error);
    }
  } else if (data.info?.error?.message) {
    message = data.info.error.message;
  }

  showError(`Streaming error: ${message}`);

  // Reset streaming state
  streamingTextBuffer = '';
  streamingMessageEl = null;
  isWaitingForResponse = false;
  sendBtn.disabled = false;
  stopRequestTimer();

  // Reject the streaming promise if waiting
  if (streamingRequestResolve) {
    streamingRequestResolve();
    streamingRequestResolve = null;
  }
}

/**
 * Handle question.asked SSE event
 * This event is sent by OpenCode when a Question/AskUserQuestion tool needs user input
 * @param {object} data - Question event data
 */
function handleQuestionAsked(data) {
  console.log('[Sidecar] question.asked event received:', JSON.stringify(data).slice(0, 500));

  // Extract IDs from the event
  // data.id is the question request ID (e.g., "que_xxx") for the /question/{requestID}/reply endpoint
  // data.tool?.callID is the tool call ID for UI tracking
  const requestId = data.id;  // The question request ID for API reply
  const callId = data.tool?.callID || data.callID || data.id || data.toolCallId || `question-${Date.now()}`;

  // Skip if already answered or pending
  if (pendingQuestions.has(callId) || answeredQuestions.has(callId)) {
    console.log('[Sidecar] question.asked skipping - already handled:', callId);
    return;
  }

  // Store the request ID for later use when replying
  if (requestId) {
    questionRequestIds.set(callId, requestId);
    console.log('[Sidecar] Stored question request ID:', requestId, 'for callId:', callId);
  }

  // Try to extract question data from various possible formats
  let questionData = data.questions || data.input?.questions || data;

  // If questionData is an array, wrap it
  if (Array.isArray(questionData)) {
    questionData = { questions: questionData };
  }

  // If it has a single 'question' property, normalize it
  if (data.question && !data.questions) {
    questionData = {
      questions: [{
        question: data.question,
        options: data.options || data.answers || [],
        header: data.header || '',
        multiSelect: data.multiSelect || false
      }]
    };
  }

  console.log('[Sidecar] question.asked showing UI for:', callId, questionData);
  showQuestionUI(callId, questionData);
}

/**
 * Send message using SSE streaming (async mode)
 * @param {string} content - Message content
 * @param {string} [systemPrompt] - Optional system prompt
 * @param {boolean} [rethrowOnError=false] - If true, re-throw errors instead of just displaying them
 * @returns {Promise<void>}
 */
async function sendToAPIStreaming(content, systemPrompt = null, rethrowOnError = false) {
  if (!sessionId) {
    const error = new Error('No active session');
    showError(error.message);
    if (rethrowOnError) throw error;
    return;
  }

  if (!window.electronAPI?.sendMessageAsync) {
    console.warn('[Sidecar] Async API not available, falling back to sync');
    await sendToAPI(content, systemPrompt, rethrowOnError);
    return;
  }

  isWaitingForResponse = true;
  sendBtn.disabled = true;
  showTypingIndicator();
  startRequestTimer();

  // Track this message content so we can filter it from SSE
  userSentMessageContents.add(content.trim());

  // Reset streaming state
  streamingTextBuffer = '';
  streamingMessageEl = null;
  streamingToolsCalled = [];
  streamingProcessedReasoningIds.clear();
  currentStreamingMessageId = null;

  try {
    // Build model for API
    const modelToUse = currentModel || config.model;
    const modelForAPI = typeof window.ModelPicker !== 'undefined'
      ? window.ModelPicker.formatModelForAPI(modelToUse)
      : { providerID: 'openrouter', modelID: modelToUse.replace('openrouter/', '') };

    // Build reasoning config
    const thinkingToUse = currentThinking || 'medium';
    let reasoning = null;
    if (typeof window.ThinkingPicker !== 'undefined') {
      reasoning = window.ThinkingPicker.formatThinkingForAPI(thinkingToUse);
    }

    console.log(`[Sidecar] ▶ Sending async message with model: ${modelToUse}, thinking: ${thinkingToUse}`);

    // Create a promise that will be resolved when streaming completes
    const streamingPromise = new Promise((resolve) => {
      streamingRequestResolve = resolve;
    });

    // Send async message
    const result = await window.electronAPI.sendMessageAsync({
      sessionId,
      content,
      model: modelForAPI,
      system: systemPrompt,
      reasoning
    });

    if (!result.ok) {
      throw new Error(`API error: ${result.status || result.error}`);
    }

    // Wait for streaming to complete (resolved by handleSessionComplete or handleStreamingComplete)
    // Add timeout to prevent infinite waiting
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Streaming timeout')), 120000); // 2 minute timeout
    });

    await Promise.race([streamingPromise, timeoutPromise]);

  } catch (error) {
    console.error('[Sidecar] Streaming error:', error);
    removeTypingIndicator();
    finalizeToolGroup();
    showError(`Error: ${error.message}`);
    if (rethrowOnError) throw error;
  } finally {
    isWaitingForResponse = false;
    sendBtn.disabled = false;
    messageInput.focus();
    stopRequestTimer();
  }
}

// ============================================================================

/**
 * Parse @agent syntax from message content
 * @param {string} content - Message content
 * @returns {{agentType: string, briefing: string}|null} Parsed agent command or null
 */
function parseAgentSyntax(content) {
  // Match @agentType followed by briefing text
  // e.g., "@explore Find all API endpoints" or "@general Review the auth code"
  const match = content.match(/^@(\w+)\s+(.+)$/s);
  if (!match) {
    return null;
  }

  const agentType = match[1].toLowerCase();
  const briefing = match[2].trim();

  // Only General and Explore are valid subagent types (OpenCode native)
  if (!VALID_SUBAGENT_TYPES.includes(agentType)) {
    return null;
  }

  return { agentType, briefing };
}

/**
 * Spawn a sub-agent via IPC
 * @param {string} agentType - Type of agent (General or Explore)
 * @param {string} briefing - Task description
 */
async function spawnSubagent(agentType, briefing) {
  const subagentId = `subagent-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // Add sub-agent card to panel
  addSubagentCard(subagentId, agentType, briefing, 'running');

  // Show sub-agent panel if hidden
  showSubagentPanel();

  try {
    // Call IPC to spawn sub-agent
    const result = await window.electronAPI.spawnSubagent({
      agentType,
      briefing,
      parentSessionId: sessionId
    });

    // Update sub-agent status
    subagents.set(subagentId, {
      ...result,
      agentType,
      briefing,
      status: 'running'
    });

    // Poll for completion
    pollSubagentStatus(subagentId, result.childSessionId);

  } catch (error) {
    console.error('[Sidecar] Failed to spawn sub-agent:', error);
    updateSubagentCard(subagentId, 'failed', error.message);
  }
}

/**
 * Poll sub-agent for completion
 */
async function pollSubagentStatus(subagentId, childSessionId) {
  const pollInterval = setInterval(async () => {
    try {
      const status = await window.electronAPI.getSubagentStatus(childSessionId);

      if (status.completed) {
        clearInterval(pollInterval);

        // Get the result
        const result = await window.electronAPI.getSubagentResult(childSessionId);

        // Update UI
        updateSubagentCard(subagentId, 'completed', result.summary);

        // Auto-fold: Add result to parent conversation
        autoFoldSubagentResult(subagentId, result);
      }
    } catch (error) {
      clearInterval(pollInterval);
      updateSubagentCard(subagentId, 'failed', error.message);
    }
  }, 2000);
}

/**
 * Auto-fold sub-agent result into parent conversation
 */
function autoFoldSubagentResult(subagentId, result) {
  const subagent = subagents.get(subagentId);
  if (!subagent) return;

  // Add folded result as a system message
  const foldedContent = `**[${subagent.agentType} sub-agent completed]**\n\n` +
    `Task: ${subagent.briefing}\n\n` +
    `Result:\n${result.summary}`;

  addMessage('assistant', foldedContent);

  // Log the fold event
  if (window.electronAPI && window.electronAPI.logMessage) {
    window.electronAPI.logMessage({
      role: 'system',
      content: `Sub-agent fold: ${subagent.agentType} - ${subagent.briefing}`,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Show the sub-agent panel
 */
function showSubagentPanel() {
  let panel = document.getElementById('subagent-panel');
  if (!panel) {
    panel = createSubagentPanel();
  }
  panel.classList.remove('hidden');
}

/**
 * Hide the sub-agent panel
 */
function hideSubagentPanel() {
  const panel = document.getElementById('subagent-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
}

/**
 * Create the sub-agent panel element using safe DOM methods
 */
function createSubagentPanel() {
  const panel = document.createElement('div');
  panel.id = 'subagent-panel';
  panel.className = 'subagent-panel';

  // Create header
  const header = document.createElement('div');
  header.className = 'subagent-panel-header';

  const title = document.createElement('span');
  title.className = 'subagent-panel-title';
  title.textContent = 'Sub-Agents';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'subagent-panel-close';
  closeBtn.textContent = '\u00D7'; // × character
  closeBtn.addEventListener('click', hideSubagentPanel);
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Create list container
  const list = document.createElement('div');
  list.className = 'subagent-list';
  list.id = 'subagent-list';
  panel.appendChild(list);

  // Insert before the input area
  const inputContainer = document.querySelector('.input-container');
  if (inputContainer) {
    inputContainer.parentNode.insertBefore(panel, inputContainer);
  } else {
    document.body.appendChild(panel);
  }

  return panel;
}

/**
 * Add a sub-agent card to the panel using safe DOM methods
 */
function addSubagentCard(subagentId, agentType, briefing, status) {
  const list = document.getElementById('subagent-list');
  if (!list) return;

  const card = document.createElement('div');
  card.id = `subagent-card-${subagentId}`;
  card.className = `subagent-card subagent-${status}`;

  // Create header
  const cardHeader = document.createElement('div');
  cardHeader.className = 'subagent-card-header';

  const typeSpan = document.createElement('span');
  typeSpan.className = 'subagent-type';
  typeSpan.textContent = `@${agentType}`;
  cardHeader.appendChild(typeSpan);

  const statusSpan = document.createElement('span');
  statusSpan.className = 'subagent-status';
  statusSpan.textContent = status === 'running' ? '\u23F3' : status === 'completed' ? '\u2713' : '\u2717';
  cardHeader.appendChild(statusSpan);

  card.appendChild(cardHeader);

  // Create briefing
  const briefingDiv = document.createElement('div');
  briefingDiv.className = 'subagent-briefing';
  const truncatedBriefing = briefing.length > 50 ? briefing.substring(0, 47) + '...' : briefing;
  briefingDiv.textContent = truncatedBriefing;
  card.appendChild(briefingDiv);

  // Create result container
  const resultDiv = document.createElement('div');
  resultDiv.className = 'subagent-result';
  resultDiv.id = `subagent-result-${subagentId}`;
  card.appendChild(resultDiv);

  list.appendChild(card);
}

/**
 * Update a sub-agent card status
 */
function updateSubagentCard(subagentId, status, result) {
  const card = document.getElementById(`subagent-card-${subagentId}`);
  if (!card) return;

  // Update class
  card.className = `subagent-card subagent-${status}`;

  // Update status icon
  const statusEl = card.querySelector('.subagent-status');
  if (statusEl) {
    statusEl.textContent = status === 'running' ? '\u23F3' : status === 'completed' ? '\u2713' : '\u2717';
  }

  // Update result
  const resultEl = document.getElementById(`subagent-result-${subagentId}`);
  if (resultEl && result) {
    const truncatedResult = result.length > 100 ? result.substring(0, 97) + '...' : result;
    resultEl.textContent = truncatedResult;
  }
}

// Scroll to bottom of messages container
function scrollToBottom(smooth = true) {
  if (!autoScrollEnabled) return;

  const chatContainer = document.getElementById('chat-container');
  if (chatContainer) {
    chatContainer.scrollTo({
      top: chatContainer.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant'
    });
  }
}

/**
 * Scroll to the first pending permission that needs user action.
 * This ensures the user sees permissions in order and doesn't miss earlier ones.
 */
function scrollToFirstPendingPermission() {
  // Find all pending permission elements (both accordion and standalone)
  const pendingAccordions = document.querySelectorAll('.tool-permission-accordion.pending');
  const pendingContainers = document.querySelectorAll('.permission-container:not(.permission-collapsed)');

  // Find the first (oldest) pending permission in DOM order
  let firstPending = null;
  const allPending = [...pendingAccordions, ...pendingContainers];

  if (allPending.length > 0) {
    // Sort by DOM position to find the first one
    allPending.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    firstPending = allPending[0];
  }

  if (firstPending) {
    // Scroll the first pending permission into view
    firstPending.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add a brief highlight effect
    firstPending.classList.add('permission-highlight');
    setTimeout(() => {
      firstPending.classList.remove('permission-highlight');
    }, 2000);
  } else {
    // No pending permissions, scroll to bottom as usual
    scrollToBottom();
  }

  // Update pending permissions badge
  updatePendingPermissionsBadge();
}

/**
 * Update the floating badge showing count of pending permissions
 */
function updatePendingPermissionsBadge() {
  const pendingAccordions = document.querySelectorAll('.tool-permission-accordion.pending');
  const pendingContainers = document.querySelectorAll('.permission-container:not(.permission-collapsed)');
  const totalPending = pendingAccordions.length + pendingContainers.length;

  let badge = document.getElementById('pending-permissions-badge');

  if (totalPending > 0) {
    if (!badge) {
      // Create badge
      badge = document.createElement('div');
      badge.id = 'pending-permissions-badge';
      badge.className = 'pending-permissions-badge';
      badge.onclick = scrollToFirstPendingPermission;
      document.body.appendChild(badge);
    }
    badge.textContent = `⚠ ${totalPending} permission${totalPending > 1 ? 's' : ''} pending`;
    badge.style.display = 'flex';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

// Set up auto-scroll observer
function setupAutoScroll() {
  const chatContainer = document.getElementById('chat-container');

  // Detect if user scrolls up (disable auto-scroll)
  chatContainer.addEventListener('scroll', () => {
    const isAtBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 50;
    autoScrollEnabled = isAtBottom;
  });

  // Observe changes to messages container and auto-scroll
  const observer = new MutationObserver(() => {
    scrollToBottom();
  });

  observer.observe(messagesContainer, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// Initialize UI
async function init() {
  // Prevent double initialization
  if (initialized) {
    console.log('[Sidecar] Already initialized, skipping');
    return;
  }
  initialized = true;

  // Get configuration from Electron (injected after page load)
  if (typeof window.sidecarConfig === 'undefined') {
    config = await window.electronAPI.getConfig();
  } else {
    config = window.sidecarConfig;
  }

  console.log('[Sidecar] Config loaded:', config);

  taskIdEl.textContent = config.taskId.slice(0, 8);
  modelNameEl.textContent = config.model;

  // Also show model name in input controls
  const inputModelNameEl = document.getElementById('input-model-name');
  if (inputModelNameEl) {
    // Extract just the model name (e.g., "gemini-2.5-flash" from "openrouter/google/gemini-2.5-flash")
    const modelParts = config.model.split('/');
    const shortName = modelParts[modelParts.length - 1];
    inputModelNameEl.textContent = shortName;
  }

  // Set up event listeners
  sendBtn.addEventListener('click', sendMessage);
  foldBtn.addEventListener('click', handleFold);

  messageInput.addEventListener('keydown', (e) => {
    // Let autocomplete handle navigation keys when active
    if (autocompleteManager && autocompleteManager.isActive()) {
      if (['ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'Enter'].includes(e.key)) {
        return; // Autocomplete handles these
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  });

   // Set up auto-scroll behavior
   setupAutoScroll();

   // Initialize model selector
   initModelSelector();

   // Initialize mode selector
   initModeSelector();

   // Initialize thinking selector
   initThinkingSelector();

   // Initialize MCP selector
   initMcpSelector();

   // Initialize agent-model config (settings panel)
   initAgentModelConfigUI();

   // Initialize autocomplete
   initAutocomplete();

   // Initialize global keyboard shortcuts
   initKeyboardShortcuts();

   // Initialize status indicator
   initStatusIndicator();

   // Initialize context panel
   initContextPanel();

   // Create session and send initial briefing
   createSession();
 }

// Create a new OpenCode session and send initial task
async function createSession() {
  try {
    // The session is already created by main.js, we just need to use it
    sessionId = config.sessionId;
    console.log('[Sidecar] Using session:', sessionId);
    console.log('[Sidecar] API base URL:', config.apiBase);
    console.log('[Sidecar] Config keys:', Object.keys(config));

    // Check if we have a valid session
    if (!sessionId) {
      console.error('[Sidecar] ❌ No sessionId in config!');
      showError('No session ID provided - check main process logs');
      return;
    }

    // Verify server connectivity before sending messages
    // Uses IPC proxy to bypass Chromium network service issues
    console.log('[Sidecar] Testing server connectivity...');
    try {
      const healthResponse = await proxyFetch('/config', { method: 'GET' });
      if (healthResponse.ok) {
        console.log('[Sidecar] ✅ Server is reachable');
      } else {
        console.warn(`[Sidecar] ⚠️ Server returned status ${healthResponse.status}`);
      }
    } catch (healthErr) {
      console.error('[Sidecar] ❌ Server connectivity test failed:', healthErr.message);
      console.error('[Sidecar] This usually means the OpenCode server failed to start.');
      console.error('[Sidecar] Check main process logs for "opencode" command errors.');
      showError(`Cannot connect to server at ${config.apiBase}: ${healthErr.message}`);
      return;
    }

    // Subscribe to SSE events for streaming responses
    await subscribeToSSE();

    // Send initial task if provided
    if (config.userMessage) {
      addMessage('system', `Task: ${config.userMessage}`);

      // Send with proper system/user separation
      // system: instruction-level context (role, environment, previous conversation reference)
      // parts: the actual task as a user message
      // Use SYNC API for initial message (has retry logic and more reliable error handling)
      // SSE streaming is used for subsequent messages
      const maxRetries = 3;
      let lastError = null;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[Sidecar] Sending initial message (attempt ${attempt}/${maxRetries})...`);
          // Use sync API with rethrowOnError=true so we can catch and retry
          await sendToAPI(config.userMessage, config.systemPrompt, true);
          console.log('[Sidecar] ✅ Initial message sent successfully');
          lastError = null; // Success
          break;
        } catch (err) {
          lastError = err;
          console.warn(`[Sidecar] Initial message attempt ${attempt}/${maxRetries} failed:`, err.message);
          if (attempt < maxRetries) {
            const delay = 1000 * attempt;
            console.log(`[Sidecar] Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay)); // Exponential backoff
          }
        }
      }
      if (lastError) {
        throw lastError; // Re-throw if all retries failed
      }
    } else {
      console.log('[Sidecar] No task provided, waiting for user input');
    }
  } catch (error) {
    console.error('[Sidecar] ❌ Session error:', error);
    console.error('[Sidecar] Stack trace:', error.stack);

    // Report error to main process for diagnostics
    await reportError('init', 'Session initialization failed', {
      sessionId: config?.sessionId,
      model: config?.model,
      apiBase: config?.apiBase
    }, error);

    showError('Failed to start session: ' + error.message);
  }
}

// Add a message to the chat
function addMessage(role, content) {
  // Filter out [REDACTED] content that shouldn't be shown to users
  if (typeof content === 'string') {
    content = content.replace(/\[REDACTED\]/gi, '').trim();
    // Skip empty messages after filtering
    if (!content) return;
  }

  const messageEl = document.createElement('div');
  messageEl.className = `message ${role}`;

  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';

  // Use markdown parsing for assistant messages
  if (role === 'assistant' && typeof marked !== 'undefined') {
    // Configure marked for safe rendering with language labels
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: function(code, lang) {
        // Return code with language info for styling
        return code;
      }
    });

    // Custom renderer to add language labels and syntax highlighting to code blocks
    const renderer = new marked.Renderer();
    renderer.code = function(code, language) {
      const lang = language || '';
      const langLabel = lang ? `<div class="code-language">${escapeHtml(lang)}</div>` : '';
      const codeText = typeof code === 'object' ? code.text : code;
      const highlightedCode = highlightCode(codeText, lang);
      return `<pre>${langLabel}<code class="language-${lang}">${highlightedCode}</code></pre>`;
    };

    contentEl.innerHTML = marked.parse(content, { renderer });
  } else {
    contentEl.textContent = content;
  }

  messageEl.appendChild(contentEl);

  // Add copy button for assistant messages
  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-copy-btn';
    copyBtn.title = 'Copy to clipboard';

    // Create copy icon SVG
    const copySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    copySvg.setAttribute('width', '14');
    copySvg.setAttribute('height', '14');
    copySvg.setAttribute('viewBox', '0 0 24 24');
    copySvg.setAttribute('fill', 'none');
    copySvg.setAttribute('stroke', 'currentColor');
    copySvg.setAttribute('stroke-width', '2');

    const rect1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect1.setAttribute('x', '9');
    rect1.setAttribute('y', '9');
    rect1.setAttribute('width', '13');
    rect1.setAttribute('height', '13');
    rect1.setAttribute('rx', '2');
    rect1.setAttribute('ry', '2');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');

    copySvg.appendChild(rect1);
    copySvg.appendChild(path);
    copyBtn.appendChild(copySvg);

    // Store raw markdown content for copying
    messageEl.dataset.rawContent = content;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyMessageToClipboard(messageEl);
    });

    messageEl.appendChild(copyBtn);
  }

  messagesContainer.appendChild(messageEl);

  // Scroll to bottom
  scrollToBottom();

  // Log to Electron for conversation capture
  if (window.electronAPI && window.electronAPI.logMessage) {
    window.electronAPI.logMessage({
      role,
      content,
      timestamp: new Date().toISOString()
    });
  }

  return messageEl;
}

// Copy message content to clipboard
async function copyMessageToClipboard(messageEl) {
  const rawContent = messageEl.dataset.rawContent;
  if (!rawContent) return;

  try {
    await navigator.clipboard.writeText(rawContent);

    // Show "Copied!" feedback
    const copyBtn = messageEl.querySelector('.message-copy-btn');
    if (copyBtn) {
      copyBtn.classList.add('copied');

      // Create and show tooltip
      let tooltip = copyBtn.querySelector('.copy-tooltip');
      if (!tooltip) {
        tooltip = document.createElement('span');
        tooltip.className = 'copy-tooltip';
        tooltip.textContent = 'Copied!';
        copyBtn.appendChild(tooltip);
      }
      tooltip.classList.add('visible');

      // Reset after delay
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        tooltip.classList.remove('visible');
      }, 1500);
    }
  } catch (err) {
    console.error('[Sidecar] Failed to copy to clipboard:', err);
  }
}

// Current tool group for collecting related tool calls
let currentToolGroup = null;

// Global set to track all displayed tool call IDs (prevents duplicates across messages)
const displayedToolCallIds = new Set();

// Chevron SVGs for expand/collapse
const chevronRightSvg = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2L8 6L4 10"/></svg>`;
const chevronDownSvg = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4L6 8L10 4"/></svg>`;
const chevronUpSvg = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8L6 4L10 8"/></svg>`;

// ============================================================================
// Response Block Functions (Unified Text + Tools)
// ============================================================================

/**
 * Get or create the current response block for unified text + tools display
 * @returns {HTMLElement} The response block container
 */
function getOrCreateResponseBlock() {
  // If there's an existing active response block, return it
  if (currentResponseBlock && currentResponseBlock.dataset.active === 'true') {
    return currentResponseBlock;
  }

  // Create new response block
  const blockEl = document.createElement('div');
  blockEl.className = 'response-block expanded';
  blockEl.dataset.active = 'true';
  blockEl.dataset.expanded = 'true';

  // Content container for text and tools
  const contentEl = document.createElement('div');
  contentEl.className = 'response-block-content';
  blockEl.appendChild(contentEl);

  // Summary header (collapsed state - hidden by default)
  const summaryEl = document.createElement('div');
  summaryEl.className = 'response-block-summary';

  const chevronSpan = document.createElement('span');
  chevronSpan.className = 'response-block-chevron';
  chevronSpan.innerHTML = chevronRightSvg; // Safe: constant defined in this file

  const countSpan = document.createElement('span');
  countSpan.className = 'response-block-count';
  countSpan.textContent = 'Show tool calls';

  summaryEl.appendChild(chevronSpan);
  summaryEl.appendChild(countSpan);
  summaryEl.style.display = 'none'; // Hidden until there are tools

  // Toggle expand/collapse on summary click
  summaryEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (blockEl._animating) return;

    const isExpanded = blockEl.dataset.expanded === 'true';
    if (isExpanded) {
      collapseResponseBlock(blockEl);
    } else {
      expandResponseBlock(blockEl);
    }
  });

  blockEl.appendChild(summaryEl);
  messagesContainer.appendChild(blockEl);

  currentResponseBlock = blockEl;
  responseBlockToolStats = { total: 0, completed: 0, running: 0, failed: 0 };

  return blockEl;
}

/**
 * Add text to the current response block
 * @param {string} text - Text content to add
 * @param {boolean} isStreaming - Whether this is streaming text
 * @returns {HTMLElement} The text element
 */
function addTextToResponseBlock(text, isStreaming = false) {
  const block = getOrCreateResponseBlock();
  const contentEl = block.querySelector('.response-block-content');

  // Check if we have a streaming text element to update
  let textEl = contentEl.querySelector('.response-text.streaming');

  if (!textEl) {
    // Create new text element
    textEl = document.createElement('div');
    textEl.className = 'response-text' + (isStreaming ? ' streaming' : '');
    contentEl.appendChild(textEl);
  }

  // Update content using formatMessageContent (handles markdown safely)
  textEl.innerHTML = formatMessageContent(text); // Uses marked.parse with escapeHtml fallback

  if (!isStreaming) {
    textEl.classList.remove('streaming');
  }

  scrollToBottom();
  return textEl;
}

/**
 * Add a tool to the current response block
 * @param {string} tool - Tool name
 * @param {string} status - Tool status
 * @param {object} input - Tool input
 * @param {object} output - Tool output
 * @param {string} callID - Tool call ID
 * @returns {HTMLElement} The tool element
 */
function addToolToResponseBlock(tool, status, input, output, callID) {
  const block = getOrCreateResponseBlock();
  const contentEl = block.querySelector('.response-block-content');
  const summaryEl = block.querySelector('.response-block-summary');

  // Finalize any streaming text before adding tool
  const streamingTextEl = contentEl.querySelector('.response-text.streaming');
  if (streamingTextEl) {
    streamingTextEl.classList.remove('streaming');
  }

  // Create the tool item element
  const toolEl = createToolItemElement(tool, status, input, output, callID);
  contentEl.appendChild(toolEl);

  // Update stats
  responseBlockToolStats.total++;
  if (status === 'completed') {
    responseBlockToolStats.completed++;
  } else if (status === 'running') {
    responseBlockToolStats.running++;
  } else if (status === 'error' || status === 'failed') {
    responseBlockToolStats.failed++;
  }

  // Show summary and update count
  summaryEl.style.display = 'flex';
  updateResponseBlockSummary(block);

  // Check for pending permission for this tool
  if (callID && pendingPermissionsForTools.has(callID)) {
    const permData = pendingPermissionsForTools.get(callID);
    pendingPermissionsForTools.delete(callID);
    attachPermissionToTool(toolEl, permData.requestId, permData);
  }

  scrollToBottom();
  return toolEl;
}

/**
 * Create a tool item element (extracted from addToolStatus)
 * @param {string} tool - Tool name
 * @param {string} status - Tool status
 * @param {object} input - Tool input
 * @param {object} output - Tool output
 * @param {string} callID - Tool call ID
 * @returns {HTMLElement} The tool element
 */
function createToolItemElement(tool, status, input, output, callID) {
  const toolLower = tool.toLowerCase();

  // Create tool item container
  const toolEl = document.createElement('div');
  toolEl.className = `tool-item ${status}`;
  toolEl.dataset.toolName = tool;
  toolEl.dataset.expanded = 'false';
  toolEl.dataset.status = status;
  if (callID) {
    toolEl.dataset.callId = callID;
  }

  // Get display info
  const titleInfo = getToolTitleInfo(tool, input);
  const resultText = toolLower === 'edit' ? getEditLineCounts(input) : getToolResult(tool, output);
  const metaText = getToolMeta(tool, output);

  // Read tool is not expandable
  const isExpandable = toolLower !== 'read';

  // Tool header row - build with DOM methods for safety
  const toolRow = document.createElement('div');
  toolRow.className = 'tool-item-row';

  // Icon
  const iconSpan = document.createElement('span');
  iconSpan.className = 'tool-item-icon';
  iconSpan.innerHTML = getToolIcon(tool); // Safe: getToolIcon returns known SVG constants
  toolRow.appendChild(iconSpan);

  // Title
  const titleSpan = document.createElement('span');
  titleSpan.className = 'tool-item-title';
  titleSpan.textContent = titleInfo.title;
  toolRow.appendChild(titleSpan);

  // Subtitle (if present)
  if (titleInfo.subtitle) {
    const subtitleSpan = document.createElement('span');
    subtitleSpan.className = 'tool-item-subtitle';
    subtitleSpan.textContent = titleInfo.subtitle;
    toolRow.appendChild(subtitleSpan);
  }

  // Badge (if present)
  if (titleInfo.badge) {
    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'tool-item-badge';
    badgeSpan.textContent = titleInfo.badge;
    toolRow.appendChild(badgeSpan);
  }

  // Meta
  const metaSpan = document.createElement('span');
  metaSpan.className = 'tool-item-meta';
  metaSpan.textContent = metaText;
  toolRow.appendChild(metaSpan);

  // Chevron (for expandable tools)
  if (isExpandable) {
    const chevronSpan = document.createElement('span');
    chevronSpan.className = 'tool-item-chevron';
    chevronSpan.innerHTML = chevronRightSvg; // Safe: constant defined in this file
    toolRow.appendChild(chevronSpan);
  }

  toolEl.appendChild(toolRow);

  // Create details panel for expandable tools
  if (isExpandable) {
    const detailsEl = document.createElement('div');
    detailsEl.className = toolLower === 'bash' ? 'tool-item-details bash-details' : 'tool-item-details';
    detailsEl.innerHTML = formatToolOutput(tool, input, output); // formatToolOutput handles escaping

    toolEl.appendChild(detailsEl);

    // Auto-expand Edit and Write tools
    const autoExpand = toolLower === 'edit' || toolLower === 'write';
    if (autoExpand) {
      detailsEl.classList.add('visible');
      toolEl.classList.add('expanded');
      toolEl.dataset.expanded = 'true';
      const chevronEl = toolRow.querySelector('.tool-item-chevron');
      if (chevronEl) {
        chevronEl.innerHTML = chevronUpSvg; // Safe: constant
      }
    }

    // Toggle details on click
    toolRow.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = detailsEl.classList.contains('visible');
      detailsEl.classList.toggle('visible', !isExpanded);
      toolEl.classList.toggle('expanded', !isExpanded);
      toolEl.dataset.expanded = isExpanded ? 'false' : 'true';

      const chevronEl = toolRow.querySelector('.tool-item-chevron');
      if (chevronEl) {
        chevronEl.innerHTML = isExpanded ? chevronRightSvg : chevronUpSvg; // Safe: constants
      }
    });
  }

  // Result row
  if (resultText) {
    const resultRow = document.createElement('div');
    resultRow.className = 'tool-result-row';

    const bulletSpan = document.createElement('span');
    bulletSpan.className = 'tool-result-bullet';
    resultRow.appendChild(bulletSpan);

    if (toolLower === 'edit' && typeof resultText === 'object' && resultText.added !== undefined) {
      const countsSpan = document.createElement('span');
      countsSpan.className = 'edit-line-counts';

      const addedSpan = document.createElement('span');
      addedSpan.className = 'edit-added';
      addedSpan.textContent = `+${resultText.added}`;

      const removedSpan = document.createElement('span');
      removedSpan.className = 'edit-removed';
      removedSpan.textContent = `-${resultText.removed}`;

      countsSpan.appendChild(addedSpan);
      countsSpan.appendChild(removedSpan);
      resultRow.appendChild(countsSpan);
    } else {
      const textSpan = document.createElement('span');
      textSpan.className = 'tool-result-text';
      textSpan.textContent = String(resultText);
      resultRow.appendChild(textSpan);
    }

    toolEl.appendChild(resultRow);
  }

  return toolEl;
}

/**
 * Update the response block summary text
 * @param {HTMLElement} block - The response block element
 */
function updateResponseBlockSummary(block) {
  const summaryEl = block.querySelector('.response-block-summary');
  const countEl = summaryEl?.querySelector('.response-block-count');
  if (!countEl) return;

  const { total, completed, running, failed } = responseBlockToolStats;
  const isExpanded = block.dataset.expanded === 'true';

  if (isExpanded) {
    countEl.textContent = 'Hide tool calls';
  } else {
    let statusText = `${completed} of ${total}`;
    if (failed > 0) {
      statusText += ` (${failed} failed)`;
    }
    countEl.textContent = `Show tool calls (${statusText})`;
  }
}

/**
 * Update tool status within response block
 * @param {string} callId - Tool call ID
 * @param {string} newStatus - New status
 */
function updateToolStatusInResponseBlock(callId, newStatus) {
  const toolEl = document.querySelector(`[data-call-id="${callId}"]`);
  if (!toolEl) return;

  const oldStatus = toolEl.dataset.status;
  toolEl.dataset.status = newStatus;
  toolEl.className = `tool-item ${newStatus}`;

  // Update stats
  if (oldStatus === 'running') responseBlockToolStats.running--;
  if (oldStatus === 'completed') responseBlockToolStats.completed--;
  if (oldStatus === 'error' || oldStatus === 'failed') responseBlockToolStats.failed--;

  if (newStatus === 'running') responseBlockToolStats.running++;
  if (newStatus === 'completed') responseBlockToolStats.completed++;
  if (newStatus === 'error' || newStatus === 'failed') responseBlockToolStats.failed++;

  // Update summary
  if (currentResponseBlock) {
    updateResponseBlockSummary(currentResponseBlock);
  }
}

/**
 * Finalize the current response block
 */
function finalizeResponseBlock() {
  if (!currentResponseBlock) return;

  currentResponseBlock.dataset.active = 'false';

  // Finalize any streaming text
  const streamingTextEl = currentResponseBlock.querySelector('.response-text.streaming');
  if (streamingTextEl) {
    streamingTextEl.classList.remove('streaming');
  }

  // Update summary to final state
  updateResponseBlockSummary(currentResponseBlock);

  // Auto-collapse if there are tools (after a delay)
  if (responseBlockToolStats.total > 0) {
    const blockToCollapse = currentResponseBlock;
    setTimeout(() => {
      collapseResponseBlock(blockToCollapse);
    }, 500);
  }

  currentResponseBlock = null;
}

/**
 * Expand response block
 * @param {HTMLElement} block - Response block to expand
 */
function expandResponseBlock(block) {
  if (!block || block.dataset.expanded === 'true') return;

  block._animating = true;
  block.dataset.expanded = 'true';
  block.classList.add('expanded');

  const contentEl = block.querySelector('.response-block-content');
  const chevronEl = block.querySelector('.response-block-chevron');

  if (chevronEl) {
    chevronEl.innerHTML = chevronDownSvg; // Safe: constant
  }

  updateResponseBlockSummary(block);

  // Animate content height
  if (contentEl) {
    contentEl.style.display = 'block';
    contentEl.style.height = 'auto';
    const targetHeight = contentEl.scrollHeight;
    contentEl.style.height = '0px';
    contentEl.offsetHeight; // Force reflow
    contentEl.style.transition = 'height 0.3s ease-out, opacity 0.2s ease-out';
    contentEl.style.height = targetHeight + 'px';
    contentEl.style.opacity = '1';

    setTimeout(() => {
      block._animating = false;
      contentEl.style.height = '';
      contentEl.style.transition = '';
    }, 300);
  } else {
    block._animating = false;
  }
}

/**
 * Collapse response block
 * @param {HTMLElement} block - Response block to collapse
 */
function collapseResponseBlock(block) {
  if (!block || block.dataset.expanded !== 'true') return;

  block._animating = true;
  block.dataset.expanded = 'false';

  const contentEl = block.querySelector('.response-block-content');
  const chevronEl = block.querySelector('.response-block-chevron');

  if (chevronEl) {
    chevronEl.innerHTML = chevronRightSvg; // Safe: constant
  }

  updateResponseBlockSummary(block);

  // Animate content collapse
  if (contentEl) {
    const currentHeight = contentEl.scrollHeight;
    contentEl.style.height = currentHeight + 'px';
    contentEl.offsetHeight; // Force reflow
    contentEl.style.transition = 'height 0.3s ease-out, opacity 0.2s ease-out';
    contentEl.style.height = '0px';
    contentEl.style.opacity = '0';

    setTimeout(() => {
      block._animating = false;
      block.classList.remove('expanded');
      contentEl.style.height = '';
      contentEl.style.opacity = '';
      contentEl.style.transition = '';
      contentEl.style.display = 'none';
    }, 300);
  } else {
    block._animating = false;
    block.classList.remove('expanded');
  }
}

// ============================================================================
// Permission Accordion Functions
// ============================================================================

/**
 * Attach a permission accordion to a tool element
 * @param {HTMLElement} toolEl - The tool element to attach to
 * @param {string} requestId - Permission request ID
 * @param {object} permData - Permission data
 */
function attachPermissionToTool(toolEl, requestId, permData) {
  // Don't attach if already has a permission accordion
  if (toolEl.querySelector('.tool-permission-accordion')) return;

  const accordion = document.createElement('div');
  accordion.className = 'tool-permission-accordion pending';
  accordion.dataset.permissionId = requestId;

  // Build message based on type
  const permType = permData.type || 'unknown';
  const pattern = permData.pattern || '';
  const message = permData.message || `${permType.replace(/_/g, ' ')} permission needed`;

  // Build header
  const headerEl = document.createElement('div');
  headerEl.className = 'perm-accordion-header';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'perm-icon';
  iconSpan.textContent = '⚠';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'perm-label';
  labelSpan.textContent = message;

  const buttonsDiv = document.createElement('div');
  buttonsDiv.className = 'perm-buttons';

  const denyBtn = document.createElement('button');
  denyBtn.className = 'perm-btn perm-btn-deny';
  denyBtn.textContent = 'Deny';

  const onceBtn = document.createElement('button');
  onceBtn.className = 'perm-btn perm-btn-once';
  onceBtn.textContent = 'Once';

  const alwaysBtn = document.createElement('button');
  alwaysBtn.className = 'perm-btn perm-btn-always';
  alwaysBtn.textContent = 'Always';

  buttonsDiv.appendChild(denyBtn);
  buttonsDiv.appendChild(onceBtn);
  buttonsDiv.appendChild(alwaysBtn);

  headerEl.appendChild(iconSpan);
  headerEl.appendChild(labelSpan);
  headerEl.appendChild(buttonsDiv);
  accordion.appendChild(headerEl);

  // Add details if pattern present
  if (pattern) {
    const detailsEl = document.createElement('div');
    detailsEl.className = 'perm-accordion-details';
    const codeEl = document.createElement('code');
    codeEl.textContent = pattern;
    detailsEl.appendChild(codeEl);
    accordion.appendChild(detailsEl);
  }

  // Wire up button handlers
  denyBtn.onclick = () => handlePermissionAccordionResponse(accordion, requestId, 'reject', permData);
  onceBtn.onclick = () => handlePermissionAccordionResponse(accordion, requestId, 'once', permData);
  alwaysBtn.onclick = () => handlePermissionAccordionResponse(accordion, requestId, 'always', permData);

  // Insert after tool row but before details
  const toolRow = toolEl.querySelector('.tool-item-row');
  if (toolRow && toolRow.nextSibling) {
    toolEl.insertBefore(accordion, toolRow.nextSibling);
  } else {
    toolEl.appendChild(accordion);
  }

  // Track as pending
  pendingPermissions.set(requestId, accordion);

  // Scroll to the first pending permission (not just bottom)
  // This ensures user sees permissions in order
  scrollToFirstPendingPermission();
}

/**
 * Handle permission accordion response
 * @param {HTMLElement} accordion - The accordion element
 * @param {string} requestId - Permission request ID
 * @param {string} reply - User's reply (reject, once, always)
 * @param {object} permData - Original permission data
 */
async function handlePermissionAccordionResponse(accordion, requestId, reply, permData) {
  console.log('[Sidecar] Permission accordion response:', requestId, reply);

  // Mark as handled
  handledPermissions.add(requestId);
  pendingPermissions.delete(requestId);

  // Call the permission reply API
  if (window.electronAPI?.proxyApiCall) {
    try {
      const result = await window.electronAPI.proxyApiCall({
        method: 'POST',
        endpoint: `/permission/${requestId}/reply`,
        body: { reply }
      });

      console.log('[Sidecar] Permission accordion reply result:', result);

      // Transform to collapsed state
      const isGranted = reply !== 'reject';
      const icon = isGranted ? '✓' : '✗';
      const statusText = isGranted ? 'granted' : 'denied';
      const replyText = reply === 'always' ? ' (always)' : reply === 'once' ? ' (once)' : '';
      const permType = permData.type || 'permission';

      // Clear and rebuild accordion content
      accordion.className = `tool-permission-accordion resolved ${reply}`;
      accordion.textContent = ''; // Clear children

      const resolvedIconSpan = document.createElement('span');
      resolvedIconSpan.className = 'perm-resolved-icon';
      resolvedIconSpan.textContent = icon;

      const resolvedTextSpan = document.createElement('span');
      resolvedTextSpan.className = 'perm-resolved-text';
      resolvedTextSpan.textContent = `${permType.replace(/_/g, ' ')} ${statusText}${replyText}`;

      accordion.appendChild(resolvedIconSpan);
      accordion.appendChild(resolvedTextSpan);

      // Update the badge after permission resolved
      updatePendingPermissionsBadge();

    } catch (error) {
      console.error('[Sidecar] Error replying to permission:', error);
      showError(`Error sending permission response: ${error.message}`);
    }
  } else {
    console.error('[Sidecar] proxyApiCall not available');
    showError('Unable to send permission response - API not available');
  }
}

// Get or create the current tool group
function getOrCreateToolGroup() {
  // If there's an existing group that's still "active" (last tool running), use it
  if (currentToolGroup && currentToolGroup.dataset.active === 'true') {
    return currentToolGroup;
  }

  // Create new tool group (Claude Desktop style)
  const groupEl = document.createElement('div');
  groupEl.className = 'tool-group expanded'; // Start expanded
  groupEl.dataset.active = 'true';
  groupEl.dataset.expanded = 'true';
  groupEl.dataset.stepCount = '0';
  groupEl.dataset.completedCount = '0';
  groupEl.dataset.failedCount = '0';
  groupEl.dataset.runningCount = '0';

  // Header with chevron and step count
  const headerEl = document.createElement('div');
  headerEl.className = 'tool-group-header';

  // Create header elements safely
  const chevronSpan = document.createElement('span');
  chevronSpan.className = 'tool-group-chevron';
  chevronSpan.innerHTML = chevronDownSvg; // Safe: chevronDownSvg is a constant defined in this file

  const countSpan = document.createElement('span');
  countSpan.className = 'tool-group-count';
  countSpan.textContent = 'Hide tool calls';

  // Timer element for this tool group
  const timerSpan = document.createElement('span');
  timerSpan.className = 'tool-group-timer';
  // Start with current elapsed time if timer is running, otherwise empty
  if (requestStartTime) {
    const elapsed = Math.floor((Date.now() - requestStartTime) / 1000);
    timerSpan.textContent = formatElapsedTime(elapsed);
  } else {
    timerSpan.textContent = '';
  }

  headerEl.appendChild(chevronSpan);
  headerEl.appendChild(countSpan);
  headerEl.appendChild(timerSpan);

  // Toggle expand/collapse on header click with animation
  headerEl.addEventListener('click', (e) => {
    e.stopPropagation();

    // Prevent double-clicks during animation
    if (groupEl._animating) {
      return;
    }

    // Cancel any pending auto-collapse animation
    if (groupEl._collapseTimeout) {
      clearTimeout(groupEl._collapseTimeout);
      groupEl._collapseTimeout = null;
    }
    if (groupEl._expandTimeout) {
      clearTimeout(groupEl._expandTimeout);
      groupEl._expandTimeout = null;
    }

    const isExpanded = groupEl.dataset.expanded === 'true';

    if (isExpanded) {
      // Collapse with animation
      collapseToolGroup(groupEl);
    } else {
      // Expand with animation
      expandToolGroup(groupEl);
    }
  });

  // Container for tool items (with vertical line)
  const itemsEl = document.createElement('div');
  itemsEl.className = 'tool-group-items';

  groupEl.appendChild(headerEl);
  groupEl.appendChild(itemsEl);
  messagesContainer.appendChild(groupEl);

  currentToolGroup = groupEl;
  return groupEl;
}

// Add a tool call to the current group (Claude Desktop style)
function addToolStatus(tool, status, input, output, callID = null) {
  // Skip if this tool call was already displayed (prevents duplicates across messages)
  if (callID && displayedToolCallIds.has(callID)) {
    return;
  }
  if (callID) {
    displayedToolCallIds.add(callID);
  }

  const groupEl = getOrCreateToolGroup();
  const itemsEl = groupEl.querySelector('.tool-group-items');
  const toolLower = tool.toLowerCase();

  // Create tool item container
  const toolEl = document.createElement('div');
  toolEl.className = `tool-item ${status}`;
  toolEl.dataset.toolName = tool;
  toolEl.dataset.expanded = 'false';
  toolEl.dataset.status = status;
  if (callID) {
    toolEl.dataset.callId = callID;
  }

  // Get display info
  const titleInfo = getToolTitleInfo(tool, input);
  // For Edit tool, show line changes from input; for others, use output
  const resultText = toolLower === 'edit' ? getEditLineCounts(input) : getToolResult(tool, output);
  const metaText = getToolMeta(tool, output);

  // Read tool is not expandable - no details to show
  const isExpandable = toolLower !== 'read';

  // Tool header row (icon, title, [badge], meta, chevron)
  const toolRow = document.createElement('div');
  toolRow.className = 'tool-item-row';

  let titleHtml = `<span class="tool-item-title">${escapeHtml(titleInfo.title)}</span>`;
  if (titleInfo.subtitle) {
    titleHtml += `<span class="tool-item-subtitle">${escapeHtml(titleInfo.subtitle)}</span>`;
  }
  if (titleInfo.badge) {
    titleHtml += `<span class="tool-item-badge">${escapeHtml(titleInfo.badge)}</span>`;
  }

  // Only show chevron for expandable tools
  const chevronHtml = isExpandable ? `<span class="tool-item-chevron">${chevronRightSvg}</span>` : '';

  toolRow.innerHTML = `
    <span class="tool-item-icon">${getToolIcon(tool)}</span>
    ${titleHtml}
    <span class="tool-item-meta">${escapeHtml(metaText)}</span>
    ${chevronHtml}
  `;

  toolEl.appendChild(toolRow);

  // Only create details panel for expandable tools
  if (isExpandable) {
    const detailsEl = document.createElement('div');
    // Bash tools use transparent container since they have separate stacked cards
    detailsEl.className = toolLower === 'bash' ? 'tool-item-details bash-details' : 'tool-item-details';
    detailsEl.innerHTML = formatToolOutput(tool, input, output);

    toolEl.appendChild(detailsEl);

    // Auto-expand Edit and Write tools to show diff by default
    const autoExpand = toolLower === 'edit' || toolLower === 'write';
    if (autoExpand) {
      detailsEl.classList.add('visible');
      toolEl.classList.add('expanded');
      toolEl.dataset.expanded = 'true';
      // Update chevron to show expanded state
      const chevronEl = toolRow.querySelector('.tool-item-chevron');
      if (chevronEl) {
        chevronEl.replaceChildren();
        chevronEl.insertAdjacentHTML('beforeend', chevronUpSvg);
      }
    }

    // Toggle details on tool row click
    toolRow.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = detailsEl.classList.contains('visible');
      detailsEl.classList.toggle('visible', !isExpanded);
      toolEl.classList.toggle('expanded', !isExpanded);
      toolEl.dataset.expanded = isExpanded ? 'false' : 'true';

      // Update chevron: right when collapsed, up when expanded
      const chevronEl = toolRow.querySelector('.tool-item-chevron');
      chevronEl.replaceChildren();
      chevronEl.insertAdjacentHTML('beforeend', isExpanded ? chevronRightSvg : chevronUpSvg);
    });
  }

  // Result/summary row (bullet, summary text) - shown below tool row, not expandable
  if (resultText) {
    const resultRow = document.createElement('div');
    resultRow.className = 'tool-result-row';

    // For Edit tool, show color-coded +X -Y format
    if (toolLower === 'edit' && typeof resultText === 'object' && resultText.added !== undefined) {
      resultRow.innerHTML = `
        <span class="tool-result-bullet"></span>
        <span class="edit-line-counts">
          <span class="edit-added">+${resultText.added}</span>
          <span class="edit-removed">-${resultText.removed}</span>
        </span>
      `;
    } else {
      resultRow.innerHTML = `
        <span class="tool-result-bullet"></span>
        <span class="tool-result-text">${escapeHtml(String(resultText))}</span>
      `;
    }

    toolEl.appendChild(resultRow);
  }

  itemsEl.appendChild(toolEl);

  // Update step count and status counts
  const stepCount = parseInt(groupEl.dataset.stepCount) + 1;
  groupEl.dataset.stepCount = stepCount;

  // Track tool status
  if (status === 'completed') {
    groupEl.dataset.completedCount = parseInt(groupEl.dataset.completedCount) + 1;
  } else if (status === 'error' || status === 'failed') {
    groupEl.dataset.failedCount = parseInt(groupEl.dataset.failedCount) + 1;
  } else if (status === 'running') {
    groupEl.dataset.runningCount = parseInt(groupEl.dataset.runningCount) + 1;
  }

  // Update header count display
  updateToolGroupHeader(groupEl);

  // Check for pending permission for this tool
  if (callID && pendingPermissionsForTools.has(callID)) {
    const permData = pendingPermissionsForTools.get(callID);
    pendingPermissionsForTools.delete(callID);
    attachPermissionToTool(toolEl, permData.requestId, permData);
  }

  scrollToBottom();
  return toolEl;
}

// Update an existing tool's status in the current group
function updateToolStatus(callID, newStatus) {
  if (!currentToolGroup) return;

  const itemsEl = currentToolGroup.querySelector('.tool-group-items');
  if (!itemsEl) return;

  // Find the tool element by callID
  const toolEl = itemsEl.querySelector(`[data-call-id="${callID}"]`);
  if (!toolEl) return;

  const oldStatus = toolEl.dataset.status;
  if (oldStatus === newStatus) return; // No change

  // Update the tool element
  toolEl.classList.remove(oldStatus);
  toolEl.classList.add(newStatus);
  toolEl.dataset.status = newStatus;

  // Update counters - decrement old status, increment new status
  if (oldStatus === 'running') {
    currentToolGroup.dataset.runningCount = Math.max(0, parseInt(currentToolGroup.dataset.runningCount) - 1);
  } else if (oldStatus === 'completed') {
    currentToolGroup.dataset.completedCount = Math.max(0, parseInt(currentToolGroup.dataset.completedCount) - 1);
  } else if (oldStatus === 'error' || oldStatus === 'failed') {
    currentToolGroup.dataset.failedCount = Math.max(0, parseInt(currentToolGroup.dataset.failedCount) - 1);
  }

  if (newStatus === 'running') {
    currentToolGroup.dataset.runningCount = parseInt(currentToolGroup.dataset.runningCount) + 1;
  } else if (newStatus === 'completed') {
    currentToolGroup.dataset.completedCount = parseInt(currentToolGroup.dataset.completedCount) + 1;
  } else if (newStatus === 'error' || newStatus === 'failed') {
    currentToolGroup.dataset.failedCount = parseInt(currentToolGroup.dataset.failedCount) + 1;
  }

  // Update header
  updateToolGroupHeader(currentToolGroup);
}

// Update tool group header with completion status
function updateToolGroupHeader(groupEl) {
  const countEl = groupEl.querySelector('.tool-group-count');
  if (!countEl) return;

  const stepCount = parseInt(groupEl.dataset.stepCount) || 0;
  const completedCount = parseInt(groupEl.dataset.completedCount) || 0;
  const failedCount = parseInt(groupEl.dataset.failedCount) || 0;
  const runningCount = parseInt(groupEl.dataset.runningCount) || 0;
  const isExpanded = groupEl.dataset.expanded === 'true';

  if (isExpanded) {
    // When expanded, show "Hide tool calls" but with completion info
    if (stepCount === 0) {
      countEl.textContent = 'Hide tool calls';
    } else if (failedCount > 0) {
      // Show with failed count highlighted
      countEl.textContent = '';
      const hideText = document.createTextNode('Hide tool calls ');
      const statusSpan = document.createElement('span');
      statusSpan.className = 'tool-group-status';

      const completedSpan = document.createElement('span');
      completedSpan.textContent = `(${completedCount}`;

      const failedSpan = document.createElement('span');
      failedSpan.className = 'tool-group-failed';
      failedSpan.textContent = ` + ${failedCount} failed`;

      const closeSpan = document.createTextNode(` of ${stepCount})`);

      statusSpan.appendChild(completedSpan);
      statusSpan.appendChild(failedSpan);
      statusSpan.appendChild(closeSpan);

      countEl.appendChild(hideText);
      countEl.appendChild(statusSpan);
    } else {
      countEl.textContent = `Hide tool calls (${completedCount} of ${stepCount} completed)`;
    }
  } else {
    // When collapsed, show completion status
    if (failedCount > 0) {
      countEl.textContent = '';
      const completedSpan = document.createElement('span');
      completedSpan.textContent = `${completedCount}`;

      const failedSpan = document.createElement('span');
      failedSpan.className = 'tool-group-failed';
      failedSpan.textContent = ` + ${failedCount} failed`;

      const ofSpan = document.createTextNode(` of ${stepCount} completed`);

      countEl.appendChild(completedSpan);
      countEl.appendChild(failedSpan);
      countEl.appendChild(ofSpan);
    } else if (runningCount > 0) {
      countEl.textContent = `${completedCount} of ${stepCount} completed, ${runningCount} running`;
    } else {
      countEl.textContent = `${completedCount} of ${stepCount} completed`;
    }
  }
}

// Current thinking indicator element (if any)
let currentThinkingIndicator = null;
let thinkingAnimationInterval = null;

// Show animated thinking indicator while model is thinking
function showThinkingInProgress() {
  const groupEl = getOrCreateToolGroup();
  const itemsEl = groupEl.querySelector('.tool-group-items');

  // Remove existing indicator if any
  hideThinkingIndicator();

  // Create thinking indicator row
  const thinkingRow = document.createElement('div');
  thinkingRow.className = 'tool-result-row thinking-indicator-row';
  thinkingRow.innerHTML = `
    <span class="tool-result-bullet thinking-pulse"></span>
    <span class="tool-result-text thinking-text"><em>Thinking...</em></span>
  `;

  itemsEl.appendChild(thinkingRow);
  currentThinkingIndicator = thinkingRow;

  // Animate through different thinking states
  const thinkingStates = [
    'Reticulating splines...',
    'Consulting the neural oracle...',
    'Mass-hallucinating tokens...',
    'Warming up the tensor cores...',
    'Asking the rubber duck...',
    'Grepping for inspiration...',
    'Reversing the polarity...',
    'Caffeinating the model...',
    'Compiling witty response...',
    'Spinning up hamster wheels...',
    'Adjusting the hyperparameters...',
    'Summoning the context window...',
    'Poking the attention heads...',
    'Bribing the gradient descent...',
    'Channeling Stack Overflow...',
    'Unfolding the transformer...',
    'Perturbing latent space...',
    'Negotiating with the GPU...',
    'Invoking the embedding gods...',
    'Doing science...'
  ];
  let stateIndex = 0;

  thinkingAnimationInterval = setInterval(() => {
    if (!currentThinkingIndicator || !document.contains(currentThinkingIndicator)) {
      clearInterval(thinkingAnimationInterval);
      return;
    }
    stateIndex = (stateIndex + 1) % thinkingStates.length;
    const textEl = currentThinkingIndicator.querySelector('.thinking-text');
    if (textEl) {
      textEl.innerHTML = `<em>${thinkingStates[stateIndex]}</em>`;
    }
  }, 2000);

  scrollToBottom();
}

// Hide/remove thinking indicator
function hideThinkingIndicator() {
  if (thinkingAnimationInterval) {
    clearInterval(thinkingAnimationInterval);
    thinkingAnimationInterval = null;
  }
  if (currentThinkingIndicator) {
    currentThinkingIndicator.remove();
    currentThinkingIndicator = null;
  }
}

// Add reasoning/thinking to the tool group as an expandable item
function addReasoningToGroup(text) {
  const groupEl = getOrCreateToolGroup();
  const itemsEl = groupEl.querySelector('.tool-group-items');

  // Remove thinking indicator if present
  hideThinkingIndicator();

  // Strip markdown formatting for plain text summary
  const plainText = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // Remove bold
    .replace(/\*([^*]+)\*/g, '$1')      // Remove italic
    .replace(/`([^`]+)`/g, '$1')        // Remove code
    .replace(/^#+\s*/gm, '')            // Remove headers
    .replace(/\n+/g, ' ')               // Collapse newlines
    .trim();

  // Create summary text (first sentence or truncated)
  const firstSentence = plainText.split(/[.!?]\s/)[0];
  const summaryText = (firstSentence.length > 80 ? firstSentence.slice(0, 80) + '...' : firstSentence + '.').trim();

  // Create the clickable row
  const reasoningRow = document.createElement('div');
  reasoningRow.className = 'tool-result-row reasoning-row';
  reasoningRow.innerHTML = `
    <span class="tool-result-bullet thinking-pulse"></span>
    <span class="tool-result-text reasoning-text"></span>
    <span class="tool-result-chevron">${chevronRightSvg}</span>
  `;

  // Create expandable content (plain text, not markdown)
  const contentEl = document.createElement('div');
  contentEl.className = 'tool-reasoning-content';
  // Split into paragraphs and render as plain text
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p);
  contentEl.innerHTML = paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');

  // Toggle on click
  reasoningRow.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = contentEl.classList.contains('visible');
    contentEl.classList.toggle('visible', !isExpanded);

    const textEl = reasoningRow.querySelector('.reasoning-text');
    const chevronEl = reasoningRow.querySelector('.tool-result-chevron');

    if (isExpanded) {
      // Now collapsed
      textEl.textContent = summaryText;
      chevronEl.innerHTML = chevronRightSvg;
    } else {
      // Now expanded
      textEl.textContent = 'Thought process';
      chevronEl.innerHTML = chevronDownSvg;
    }
  });

  itemsEl.appendChild(reasoningRow);
  itemsEl.appendChild(contentEl);

  // Animate the summary text (typewriter effect)
  const textEl = reasoningRow.querySelector('.reasoning-text');
  const bulletEl = reasoningRow.querySelector('.tool-result-bullet');
  animateReasoningText(textEl, bulletEl, summaryText);

  // Update step count
  const stepCount = parseInt(groupEl.dataset.stepCount) + 1;
  groupEl.dataset.stepCount = stepCount;
  if (groupEl.dataset.expanded === 'true') {
    groupEl.querySelector('.tool-group-count').textContent = 'Hide tool calls';
  }

  scrollToBottom();
}

// Animate reasoning text with typewriter effect
function animateReasoningText(textEl, bulletEl, fullText) {
  let charIndex = 0;
  const charsPerFrame = 4; // Characters to add per frame (faster)
  const frameDelay = 12; // Milliseconds between frames (faster)

  function addChars() {
    if (charIndex < fullText.length) {
      charIndex = Math.min(charIndex + charsPerFrame, fullText.length);
      textEl.textContent = fullText.slice(0, charIndex);
      scrollToBottom(false);
      requestAnimationFrame(() => setTimeout(addChars, frameDelay));
    } else {
      // Animation complete - stop pulsing bullet
      bulletEl.classList.remove('thinking-pulse');
    }
  }

  addChars();
}

/**
 * Standardized tool display names for proper capitalization
 */
const TOOL_DISPLAY_NAMES = {
  'bash': 'Bash',
  'read': 'Read',
  'write': 'Write',
  'edit': 'Edit',
  'glob': 'Glob',
  'grep': 'Grep',
  'list': 'List',
  'ls': 'List',
  'task': 'Task',
  'webfetch': 'WebFetch',
  'websearch': 'WebSearch',
  'todowrite': 'Todo',
  'todoread': 'Todo',
  'question': 'Question',
  'askuserquestion': 'Question',
  'notebookedit': 'NotebookEdit',
  'notebookread': 'NotebookRead',
  'skill': 'Skill',
  'enterplanmode': 'EnterPlanMode',
  'exitplanmode': 'ExitPlanMode',
  'toolsearch': 'ToolSearch',
  'killshell': 'KillShell',
  'taskoutput': 'TaskOutput',
};

/**
 * Get proper display name for a tool
 * @param {string} tool - Tool name in any case
 * @returns {string} Properly capitalized tool name
 */
function getToolDisplayName(tool) {
  if (!tool) return 'Tool';
  const lower = tool.toLowerCase();
  return TOOL_DISPLAY_NAMES[lower] || tool.charAt(0).toUpperCase() + tool.slice(1);
}

// Get title info with optional badge
function getToolTitleInfo(tool, input) {
  const toolLower = tool.toLowerCase();

  if (!input || typeof input !== 'object') {
    return { title: getToolDisplayName(tool), badge: null };
  }

  // For Edit - show filename as title with path as subtitle
  if (toolLower === 'edit') {
    const filePath = input.file_path || input.filePath || '';
    const fileName = filePath.split('/').pop() || 'file';
    const ext = fileName.includes('.') ? fileName.split('.').pop() : null;
    const title = filePath ? `Edit ${fileName}` : 'Edit file';
    return { title, subtitle: filePath, badge: ext };
  }

  // For Read - show "Read" (bold) + filepath (light)
  if (toolLower === 'read') {
    const filePath = input.file_path || input.filePath || '';
    return { title: 'Read', subtitle: filePath || 'file', badge: null };
  }

  // For Write - show filename as title with path as subtitle (like Bash)
  if (toolLower === 'write') {
    const filePath = input.file_path || input.filePath || '';
    const fileName = filePath.split('/').pop() || 'file';
    // Get file extension for badge
    const ext = fileName.includes('.') ? fileName.split('.').pop() : null;
    // Create descriptive title like "Create package.json"
    const title = filePath ? `Write ${fileName}` : 'Write file';
    return { title, subtitle: filePath, badge: ext };
  }

  // For Bash - show command description or shortened command
  if (toolLower === 'bash') {
    const cmd = input.command || '';
    const desc = input.description || '';
    const title = desc || (cmd ? cmd.slice(0, 50) + (cmd.length > 50 ? '...' : '') : 'Bash');
    return { title: title || 'Bash', badge: null };
  }

  // For Glob/Grep - show search description
  if (toolLower === 'glob' || toolLower === 'grep') {
    const pattern = input.pattern || '';
    return { title: `Search: ${pattern.slice(0, 40)}`, badge: null };
  }

  // Question tool - show truncated question
  if (toolLower === 'question' || toolLower === 'askuserquestion') {
    const questions = input?.questions || [input];
    const firstQuestion = questions[0]?.question || questions[0]?.text || 'Question';
    const truncated = firstQuestion.slice(0, 50) + (firstQuestion.length > 50 ? '...' : '');
    return { title: truncated, badge: questions.length > 1 ? `${questions.length}` : null };
  }

  return { title: getToolDisplayName(tool), badge: null };
}

// Format tool output based on tool type (Claude Desktop style)
function formatToolOutput(tool, input, output) {
  const toolName = tool.toLowerCase();
  const outputStr = output ? String(output) : '';

  // Edit tool - show old vs new diff from input
  if (toolName === 'edit') {
    return formatEditDiff(input);
  }

  // Write tool - show new content
  if (toolName === 'write') {
    return formatWriteOutput(input);
  }

  // Bash tool - show formatted command output
  if (toolName === 'bash') {
    return formatBashOutput(input, outputStr);
  }

  // Read tool - show file content with line numbers
  if (toolName === 'read') {
    return formatFileOutput(outputStr);
  }

  // Glob tool - show file list with icons
  if (toolName === 'glob') {
    return formatGlobOutput(input, outputStr);
  }

  // Grep tool - show search results with context
  if (toolName === 'grep') {
    return formatGrepOutput(input, outputStr);
  }

  // Question tool - show question and answer
  if (toolName === 'question' || toolName === 'askuserquestion') {
    return formatQuestionOutput(input, outputStr);
  }

  // List/LS tool - show directory listing with icons
  if (toolName === 'list' || toolName === 'ls') {
    return formatListOutput(input, outputStr);
  }

  // Task tool - show sub-agent spawning info
  if (toolName === 'task') {
    return formatTaskOutput(input, outputStr);
  }

  // WebFetch tool - show fetched web content
  if (toolName === 'webfetch') {
    return formatWebfetchOutput(input, outputStr);
  }

  // Todo tools - show todo list
  if (toolName === 'todowrite' || toolName === 'todoread') {
    return formatTodoOutput(input, outputStr);
  }

  // Default - show as plain text
  return formatGenericOutput(outputStr);
}

// Build diff lines array for Edit tool (used by formatEditDiff)
function buildEditDiffLines(input) {
  const oldStr = input.old_string || input.oldString || '';
  const newStr = input.new_string || input.newString || '';
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const diffLines = [];

  // Find common prefix lines (context before)
  let commonPrefixCount = 0;
  while (commonPrefixCount < oldLines.length &&
         commonPrefixCount < newLines.length &&
         oldLines[commonPrefixCount] === newLines[commonPrefixCount]) {
    commonPrefixCount++;
  }

  // Find common suffix lines (context after)
  let commonSuffixCount = 0;
  while (commonSuffixCount < oldLines.length - commonPrefixCount &&
         commonSuffixCount < newLines.length - commonPrefixCount &&
         oldLines[oldLines.length - 1 - commonSuffixCount] === newLines[newLines.length - 1 - commonSuffixCount]) {
    commonSuffixCount++;
  }

  // Context before (max 2 lines)
  const contextBefore = Math.min(commonPrefixCount, 2);
  for (let i = commonPrefixCount - contextBefore; i < commonPrefixCount; i++) {
    diffLines.push({ type: 'context', oldNum: i + 1, newNum: i + 1, content: oldLines[i] });
  }

  // Deletions (changed old lines)
  const oldChangedStart = commonPrefixCount;
  const oldChangedEnd = oldLines.length - commonSuffixCount;
  for (let i = oldChangedStart; i < oldChangedEnd; i++) {
    diffLines.push({ type: 'deletion', oldNum: i + 1, newNum: null, content: oldLines[i] });
  }

  // Additions (changed new lines)
  const newChangedStart = commonPrefixCount;
  const newChangedEnd = newLines.length - commonSuffixCount;
  for (let i = newChangedStart; i < newChangedEnd; i++) {
    diffLines.push({ type: 'addition', oldNum: null, newNum: i + 1, content: newLines[i] });
  }

  // Context after (max 2 lines)
  const contextAfter = Math.min(commonSuffixCount, 2);
  const suffixStart = oldLines.length - commonSuffixCount;
  for (let i = 0; i < contextAfter; i++) {
    const oldLineNum = suffixStart + i + 1;
    const newLineNum = newLines.length - commonSuffixCount + i + 1;
    diffLines.push({ type: 'context', oldNum: oldLineNum, newNum: newLineNum, content: oldLines[suffixStart + i] });
  }

  return diffLines;
}

// Render a single diff line to HTML
function renderDiffLine(line) {
  if (line.type === 'context') {
    return `
      <div class="tool-diff-line context">
        <span class="tool-diff-line-number">${line.oldNum}</span>
        <span class="tool-diff-line-number">${line.newNum}</span>
        <span class="tool-diff-gutter"></span>
        <span class="tool-diff-content">${escapeHtml(line.content)}</span>
      </div>
    `;
  } else if (line.type === 'deletion') {
    return `
      <div class="tool-diff-line deletion">
        <span class="tool-diff-line-number deletion">${line.oldNum}</span>
        <span class="tool-diff-line-number"></span>
        <span class="tool-diff-gutter deletion">-</span>
        <span class="tool-diff-content">${escapeHtml(line.content)}</span>
      </div>
    `;
  } else if (line.type === 'addition') {
    return `
      <div class="tool-diff-line addition">
        <span class="tool-diff-line-number"></span>
        <span class="tool-diff-line-number addition">${line.newNum}</span>
        <span class="tool-diff-gutter addition">+</span>
        <span class="tool-diff-content">${escapeHtml(line.content)}</span>
      </div>
    `;
  }
  return '';
}

// Format Edit tool diff (old_string vs new_string) - Claude Desktop style with truncation
function formatEditDiff(input) {
  if (!input || typeof input !== 'object') {
    return '<div class="tool-output">Edit applied successfully.</div>';
  }

  const oldStr = input.old_string || input.oldString || '';
  const newStr = input.new_string || input.newString || '';

  if (!oldStr && !newStr) {
    return '<div class="tool-output">Edit applied successfully.</div>';
  }

  const diffLines = buildEditDiffLines(input);
  const maxLines = 12; // Show limited lines by default
  const truncated = diffLines.length > maxLines;
  const displayLines = truncated ? diffLines.slice(0, maxLines) : diffLines;

  let html = '<div class="tool-diff-card" data-truncated="' + truncated + '" data-expanded="false">';

  // Truncated view (shown by default)
  html += '<div class="diff-truncated">';
  html += '<div class="tool-diff">';
  displayLines.forEach(line => {
    html += renderDiffLine(line);
  });
  html += '</div>';
  html += '</div>';

  // Full view (hidden initially)
  if (truncated) {
    html += '<div class="diff-full" style="display: none;">';
    html += '<div class="tool-diff">';
    diffLines.forEach(line => {
      html += renderDiffLine(line);
    });
    html += '</div>';
    html += '</div>';

    // Toggle button
    const moreLines = diffLines.length - maxLines;
    html += '<div class="tool-diff-toggle" onclick="toggleDiffOutput(this)">';
    html += '<span class="diff-toggle-text">Show ' + moreLines + ' more lines</span>';
    html += '<span class="diff-toggle-chevron">' + chevronDownSvg + '</span>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// Render a single write line to HTML (all additions)
function renderWriteLine(line, lineNum) {
  return `
    <div class="tool-diff-line addition">
      <span class="tool-diff-line-number new">${lineNum}</span>
      <span class="tool-diff-gutter addition">+</span>
      <span class="tool-diff-content">${escapeHtml(line)}</span>
    </div>
  `;
}

// Format Write tool output (show new content being written) - with truncation
function formatWriteOutput(input) {
  if (!input || typeof input !== 'object') {
    return '<div class="tool-pending-message">Awaiting execution...</div>';
  }

  const content = input.content || '';

  // If no content yet, show pending state
  if (!content) {
    return '<div class="tool-pending-message">Awaiting execution...</div>';
  }
  const lines = content.split('\n');
  const maxLines = 12; // Match Edit tool truncation
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  let html = '<div class="tool-diff-card" data-truncated="' + truncated + '" data-expanded="false">';

  // Truncated view (shown by default)
  html += '<div class="diff-truncated">';
  html += '<div class="tool-diff">';
  displayLines.forEach((line, idx) => {
    html += renderWriteLine(line, idx + 1);
  });
  html += '</div>';
  html += '</div>';

  // Full view (hidden initially)
  if (truncated) {
    html += '<div class="diff-full" style="display: none;">';
    html += '<div class="tool-diff">';
    lines.forEach((line, idx) => {
      html += renderWriteLine(line, idx + 1);
    });
    html += '</div>';
    html += '</div>';

    // Toggle button
    const moreLines = lines.length - maxLines;
    html += '<div class="tool-diff-toggle" onclick="toggleDiffOutput(this)">';
    html += '<span class="diff-toggle-text">Show ' + moreLines + ' more lines</span>';
    html += '<span class="diff-toggle-chevron">' + chevronDownSvg + '</span>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Copy button SVG icon
 */
const copyIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/**
 * Copy text to clipboard and show feedback
 * @param {HTMLElement} btn - The copy button element
 * @param {string} text - Text to copy
 */
function copyToClipboard(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '✓';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove('copied');
    }, 1500);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// Format bash command output (Claude Desktop style) - SEPARATE stacked containers
function formatBashOutput(input, output) {
  const command = input?.command || '';
  const lines = output ? output.split('\n') : [];
  const maxLines = 8; // Show fewer lines by default, with ability to expand
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  let html = '';

  // If no command and no output, show a pending state message
  if (!command && !output?.trim()) {
    return `<div class="tool-pending-message">Awaiting execution...</div>`;
  }

  // Command section - separate rounded container with copy button
  if (command) {
    const escapedCmd = escapeHtml(command).replace(/"/g, '&quot;');
    html += `
      <div class="tool-bash-command-card">
        <div class="tool-bash-label">bash</div>
        <div class="tool-bash-cmd">${formatBashCommand(command)}</div>
        <button class="copy-btn" onclick="copyToClipboard(this, '${escapedCmd}')" title="Copy command">${copyIconSvg}</button>
      </div>
    `;
  }

  // Output section - separate rounded container (stacked below command) with copy button
  if (output.trim()) {
    const escapedOutput = escapeHtml(output).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    html += `<div class="tool-bash-output-card" data-truncated="${truncated}" data-expanded="false">`;
    html += `<div class="tool-bash-label">Output</div>`;
    html += `<button class="copy-btn" onclick="copyToClipboard(this, decodeURIComponent('${encodeURIComponent(output)}'))" title="Copy output">${copyIconSvg}</button>`;

    // Container for truncated view
    html += `<div class="bash-output-truncated">`;
    displayLines.forEach(line => {
      html += formatBashLine(line);
    });
    html += `</div>`;

    // Container for full view (hidden initially)
    if (truncated) {
      html += `<div class="bash-output-full" style="display: none;">`;
      lines.forEach(line => {
        html += formatBashLine(line);
      });
      html += `</div>`;

      // Toggle button
      html += `<div class="tool-bash-toggle" onclick="toggleBashOutput(this)">`;
      html += `<span class="bash-toggle-text">Show ${lines.length - maxLines} more lines</span>`;
      html += `<span class="bash-toggle-chevron">${chevronDownSvg}</span>`;
      html += `</div>`;
    }

    html += '</div>';
  }

  return html;
}

// Format a single bash output line with appropriate styling
function formatBashLine(line) {
  // Detect test results and colorize
  if (line.includes('✓') || line.includes('PASS')) {
    return `<div class="tool-bash-line success">${escapeHtml(line)}</div>`;
  } else if (line.includes('✗') || line.includes('FAIL') || line.includes('Error')) {
    return `<div class="tool-bash-line error">${escapeHtml(line)}</div>`;
  } else if (line.match(/^\d+:/)) {
    // Line number output (like grep results)
    const match = line.match(/^(\d+):(.*)$/);
    if (match) {
      return `<div class="tool-bash-line"><span class="line-num">${match[1]}:</span>${escapeHtml(match[2])}</div>`;
    }
  }
  return `<div class="tool-bash-line">${escapeHtml(line)}</div>`;
}

// Toggle bash output between truncated and full view
function toggleBashOutput(toggleEl) {
  const outputEl = toggleEl.parentElement;
  const truncatedView = outputEl.querySelector('.bash-output-truncated');
  const fullView = outputEl.querySelector('.bash-output-full');
  const toggleText = toggleEl.querySelector('.bash-toggle-text');
  const toggleChevron = toggleEl.querySelector('.bash-toggle-chevron');

  if (!truncatedView || !fullView) return;

  const isExpanded = outputEl.dataset.expanded === 'true';

  if (isExpanded) {
    // Collapse
    truncatedView.style.display = 'block';
    fullView.style.display = 'none';
    outputEl.dataset.expanded = 'false';
    const hiddenCount = fullView.querySelectorAll('.tool-bash-line').length - truncatedView.querySelectorAll('.tool-bash-line').length;
    toggleText.textContent = `Show ${hiddenCount} more lines`;
    toggleChevron.replaceChildren();
    toggleChevron.insertAdjacentHTML('beforeend', chevronDownSvg);
  } else {
    // Expand
    truncatedView.style.display = 'none';
    fullView.style.display = 'block';
    outputEl.dataset.expanded = 'true';
    toggleText.textContent = 'Show less';
    toggleChevron.replaceChildren();
    toggleChevron.insertAdjacentHTML('beforeend', chevronUpSvg);
  }
}

// Toggle diff output between truncated and full view (for Edit/Write tools)
function toggleDiffOutput(toggleEl) {
  const cardEl = toggleEl.parentElement;
  const truncatedView = cardEl.querySelector('.diff-truncated');
  const fullView = cardEl.querySelector('.diff-full');
  const toggleText = toggleEl.querySelector('.diff-toggle-text');
  const toggleChevron = toggleEl.querySelector('.diff-toggle-chevron');

  if (!truncatedView || !fullView) return;

  const isExpanded = cardEl.dataset.expanded === 'true';

  if (isExpanded) {
    // Collapse
    truncatedView.style.display = 'block';
    fullView.style.display = 'none';
    cardEl.dataset.expanded = 'false';
    const hiddenCount = fullView.querySelectorAll('.tool-diff-line').length - truncatedView.querySelectorAll('.tool-diff-line').length;
    toggleText.textContent = `Show ${hiddenCount} more lines`;
    toggleChevron.replaceChildren();
    toggleChevron.insertAdjacentHTML('beforeend', chevronDownSvg);
  } else {
    // Expand
    truncatedView.style.display = 'none';
    fullView.style.display = 'block';
    cardEl.dataset.expanded = 'true';
    toggleText.textContent = 'Show less';
    toggleChevron.replaceChildren();
    toggleChevron.insertAdjacentHTML('beforeend', chevronUpSvg);
  }
}

// Format bash command with syntax highlighting
function formatBashCommand(cmd) {
  // First escape the command
  let result = escapeHtml(cmd);

  // Highlight strings (must do before other replacements)
  result = result.replace(/&quot;([^&]*)&quot;/g, '<span class="bash-string">"$1"</span>');
  result = result.replace(/&#39;([^&]*)&#39;/g, "<span class=\"bash-string\">'$1'</span>");

  // Highlight common commands at the start
  const commands = ['grep', 'find', 'ls', 'cat', 'echo', 'cd', 'mkdir', 'rm', 'cp', 'mv', 'git', 'npm', 'node', 'python', 'curl', 'wget', 'sed', 'awk', 'sort', 'head', 'tail', 'wc'];
  const cmdPattern = new RegExp(`^(${commands.join('|')})\\b`, 'i');
  result = result.replace(cmdPattern, '<span class="bash-cmd">$1</span>');

  // Highlight flags
  result = result.replace(/\s(-{1,2}[a-zA-Z][\w-]*)/g, ' <span class="bash-flag">$1</span>');

  return result;
}

// Format file content with line numbers
function formatFileOutput(output) {
  // Parse the Read tool output format
  // It may contain <file> tags and lines like "00001| content"
  let content = output;

  // Strip XML-like tags
  content = content.replace(/<\/?file[^>]*>/g, '');
  content = content.replace(/\(File has more lines\.[^)]*\)/g, '');

  const lines = content.split('\n').filter(line => line.trim());
  const maxLines = 25;
  const displayLines = lines.slice(0, maxLines);
  const moreLines = lines.length - maxLines;

  let html = '<div class="tool-diff">';

  displayLines.forEach((line) => {
    // Check if line has format "00001| content" or "  123→ content"
    const numberedMatch = line.match(/^\s*(\d+)[|→]\s?(.*)$/);

    if (numberedMatch) {
      const lineNum = parseInt(numberedMatch[1], 10);
      const lineContent = numberedMatch[2];
      html += `
        <div class="tool-diff-line">
          <span class="tool-diff-line-number">${lineNum}</span>
          <span class="tool-diff-content">${escapeHtml(lineContent)}</span>
        </div>
      `;
    } else if (line.trim()) {
      // Line without number
      html += `
        <div class="tool-diff-line">
          <span class="tool-diff-line-number"></span>
          <span class="tool-diff-content">${escapeHtml(line)}</span>
        </div>
      `;
    }
  });

  html += '</div>';

  if (moreLines > 0) {
    html += `<div class="tool-diff-more">Show more (${moreLines} more lines)</div>`;
  }

  return html;
}

// Format generic output
function formatGenericOutput(output) {
  const maxLength = 2000;
  const truncated = output.length > maxLength;
  const displayText = truncated ? output.slice(0, maxLength) : output;

  let html = `<div class="tool-output">${escapeHtml(displayText)}</div>`;

  if (truncated) {
    html += `<div class="tool-output-more">... +${output.length - maxLength} characters</div>`;
  }

  return html;
}

/**
 * Normalize file path to clean relative path
 * Removes any malformed path segments and ensures clean display
 * @param {string} filePath - Raw file path from Glob output
 * @returns {string} Cleaned relative path
 */
function normalizeFilePath(filePath) {
  if (!filePath) return '';

  let cleaned = filePath.trim();

  // Remove common absolute path prefixes
  // e.g., /Users/john_renaldi/claude-code-projects/sidecar/ -> (empty)
  const homeDir = typeof window !== 'undefined' && window.sidecarConfig?.cwd
    ? window.sidecarConfig.cwd
    : '';

  if (homeDir && cleaned.startsWith(homeDir)) {
    cleaned = cleaned.slice(homeDir.length);
  }

  // Remove leading ./ or /
  cleaned = cleaned.replace(/^\.\//, '').replace(/^\//, '');

  // Fix duplicated path segments (e.g., tests/sidecar_renaldi/tests/file.js)
  // Look for repeated directory names
  const parts = cleaned.split('/');
  const seen = new Set();
  const dedupedParts = [];

  for (const part of parts) {
    // Simple dedup - skip if this exact part appears again later in path
    // This handles cases like "tests/foo/tests/file.js" → "tests/foo/file.js"
    if (!seen.has(part) || part === '' || !parts.slice(parts.indexOf(part) + 1).includes(part)) {
      dedupedParts.push(part);
      seen.add(part);
    }
  }

  return dedupedParts.join('/');
}

// Format Glob output - file list with icons
function formatGlobOutput(input, output) {
  if (!output || !output.trim()) {
    return '<div class="tool-output tool-output-empty">No files found</div>';
  }

  // Split and normalize all file paths
  const rawFiles = output.trim().split('\n').filter(f => f.trim());
  const files = rawFiles.map(normalizeFilePath).filter(f => f);

  if (files.length === 0) {
    return '<div class="tool-output tool-output-empty">No files found</div>';
  }

  // Group files by directory for cleaner display
  const filesByDir = {};
  files.forEach(file => {
    const lastSlash = file.lastIndexOf('/');
    const dir = lastSlash > 0 ? file.substring(0, lastSlash) : '.';
    const name = lastSlash > 0 ? file.substring(lastSlash + 1) : file;
    if (!filesByDir[dir]) {
      filesByDir[dir] = [];
    }
    filesByDir[dir].push(name);
  });

  const dirs = Object.keys(filesByDir).sort();
  const maxDisplay = 50;
  let displayCount = 0;

  let html = '<div class="glob-results">';

  for (const dir of dirs) {
    if (displayCount >= maxDisplay) break;

    const dirFiles = filesByDir[dir];
    html += `<div class="glob-dir">`;
    html += `<div class="glob-dir-name">${escapeHtml(dir)}/</div>`;
    html += `<div class="glob-dir-files">`;

    for (const file of dirFiles) {
      if (displayCount >= maxDisplay) break;
      const ext = file.includes('.') ? file.split('.').pop().toLowerCase() : '';
      const icon = getFileIcon(ext);
      html += `<div class="glob-file">${icon}<span class="glob-file-name">${escapeHtml(file)}</span></div>`;
      displayCount++;
    }

    html += `</div></div>`;
  }

  if (files.length > maxDisplay) {
    html += `<div class="glob-more">... and ${files.length - maxDisplay} more files</div>`;
  }

  html += '</div>';
  return html;
}

// Format Grep output - search results with context
function formatGrepOutput(input, output) {
  if (!output || !output.trim()) {
    return '<div class="tool-output tool-output-empty">No matches found</div>';
  }

  const pattern = input?.pattern || '';
  const lines = output.trim().split('\n').filter(l => l.trim());

  if (lines.length === 0) {
    return '<div class="tool-output tool-output-empty">No matches found</div>';
  }

  const maxDisplay = 30;
  let html = '<div class="grep-results">';

  // Group results by file
  const resultsByFile = {};
  let currentFile = null;

  lines.forEach(line => {
    // Try to parse file:line:content or file:line format
    const colonMatch = line.match(/^([^:]+):(\d+)[:.](.*)$/);
    if (colonMatch) {
      const [, file, lineNum, content] = colonMatch;
      if (!resultsByFile[file]) {
        resultsByFile[file] = [];
      }
      resultsByFile[file].push({ lineNum, content: content || '' });
    } else if (line.includes(':')) {
      // File path only (files_with_matches mode)
      const file = line.trim();
      if (!resultsByFile[file]) {
        resultsByFile[file] = [];
      }
    } else {
      // Plain line without file context
      if (!resultsByFile['results']) {
        resultsByFile['results'] = [];
      }
      resultsByFile['results'].push({ lineNum: '', content: line });
    }
  });

  const files = Object.keys(resultsByFile);
  let displayCount = 0;

  for (const file of files) {
    if (displayCount >= maxDisplay) break;

    const matches = resultsByFile[file];
    const ext = file.includes('.') ? file.split('.').pop().toLowerCase() : '';
    const icon = getFileIcon(ext);

    html += `<div class="grep-file">`;
    html += `<div class="grep-file-header">${icon}<span class="grep-file-name">${escapeHtml(file)}</span>`;
    if (matches.length > 0) {
      html += `<span class="grep-match-count">${matches.length} match${matches.length > 1 ? 'es' : ''}</span>`;
    }
    html += `</div>`;

    if (matches.length > 0) {
      html += `<div class="grep-matches">`;
      for (const match of matches.slice(0, 5)) {
        if (displayCount >= maxDisplay) break;
        const lineNumHtml = match.lineNum ? `<span class="grep-line-num">${match.lineNum}</span>` : '';
        // Highlight the search pattern in the content
        const highlightedContent = highlightSearchPattern(match.content, pattern);
        html += `<div class="grep-match">${lineNumHtml}<span class="grep-content">${highlightedContent}</span></div>`;
        displayCount++;
      }
      if (matches.length > 5) {
        html += `<div class="grep-more-matches">... ${matches.length - 5} more matches in this file</div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    displayCount++;
  }

  if (files.length > 10) {
    html += `<div class="grep-more">... and ${files.length - 10} more files</div>`;
  }

  html += '</div>';
  return html;
}

// Get file icon based on extension
function getFileIcon(ext) {
  const icons = {
    js: '<span class="file-icon file-icon-js">JS</span>',
    ts: '<span class="file-icon file-icon-ts">TS</span>',
    jsx: '<span class="file-icon file-icon-jsx">JSX</span>',
    tsx: '<span class="file-icon file-icon-tsx">TSX</span>',
    json: '<span class="file-icon file-icon-json">{}</span>',
    md: '<span class="file-icon file-icon-md">MD</span>',
    css: '<span class="file-icon file-icon-css">#</span>',
    html: '<span class="file-icon file-icon-html">&lt;&gt;</span>',
    py: '<span class="file-icon file-icon-py">PY</span>',
    go: '<span class="file-icon file-icon-go">GO</span>',
    rs: '<span class="file-icon file-icon-rs">RS</span>',
    sh: '<span class="file-icon file-icon-sh">$</span>',
    yml: '<span class="file-icon file-icon-yml">YML</span>',
    yaml: '<span class="file-icon file-icon-yml">YML</span>',
  };
  return icons[ext] || '<span class="file-icon file-icon-default"></span>';
}

// Highlight search pattern in text
function highlightSearchPattern(text, pattern) {
  if (!pattern || !text) return escapeHtml(text);
  try {
    const regex = new RegExp(`(${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapeHtml(text).replace(regex, '<mark class="grep-highlight">$1</mark>');
  } catch (e) {
    return escapeHtml(text);
  }
}

// Format Question tool output - show question, options, and answer
function formatQuestionOutput(input, output) {
  let html = '<div class="question-output">';

  // Show the question
  if (input?.question || input?.questions) {
    const questions = input.questions || [input];
    questions.forEach((q, idx) => {
      const questionText = q.question || q.text || 'Question';
      html += `<div class="question-output-item">`;
      html += `<div class="question-output-label">Question${questions.length > 1 ? ` ${idx + 1}` : ''}:</div>`;
      html += `<div class="question-output-text">${escapeHtml(questionText)}</div>`;

      // Show options if present
      if (q.options && q.options.length > 0) {
        html += `<div class="question-output-options">`;
        q.options.forEach(opt => {
          const label = opt.label || opt;
          const desc = opt.description || '';
          html += `<div class="question-output-option">`;
          html += `<span class="question-option-bullet"></span>`;
          html += `<span class="question-option-label">${escapeHtml(label)}</span>`;
          if (desc) {
            html += `<span class="question-option-desc"> - ${escapeHtml(desc)}</span>`;
          }
          html += `</div>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    });
  }

  // Show the answer/output
  if (output && output.trim()) {
    html += `<div class="question-output-answer">`;
    html += `<div class="question-output-label">Answer:</div>`;
    html += `<div class="question-output-value">${escapeHtml(output)}</div>`;
    html += `</div>`;
  } else if (input?.answer || input?.answers) {
    const answers = input.answers || { '0': input.answer };
    html += `<div class="question-output-answer">`;
    html += `<div class="question-output-label">Answer:</div>`;
    Object.values(answers).forEach(ans => {
      html += `<div class="question-output-value">${escapeHtml(String(ans))}</div>`;
    });
    html += `</div>`;
  }

  if (html === '<div class="question-output">') {
    // No content - show a placeholder
    html += `<div class="question-output-empty">Question completed</div>`;
  }

  html += '</div>';
  return html;
}

/**
 * Format list/ls tool output - directory listing with file type icons
 */
function formatListOutput(input, output) {
  if (!output || !output.trim()) {
    return '<div class="list-output"><div class="list-empty">Empty directory</div></div>';
  }

  const lines = output.split('\n').filter(l => l.trim());
  const maxItems = 50;
  const displayLines = lines.slice(0, maxItems);
  const moreCount = lines.length - maxItems;

  let html = '<div class="list-output">';

  // Group items into directories and files
  const dirs = [];
  const files = [];

  displayLines.forEach(item => {
    const trimmed = item.trim();
    if (!trimmed) return;

    // Check if it's a directory (ends with / or common dir indicators)
    if (trimmed.endsWith('/') || trimmed.includes('node_modules') || trimmed.includes('.git')) {
      dirs.push(trimmed);
    } else {
      files.push(trimmed);
    }
  });

  // Show directories first
  if (dirs.length > 0) {
    html += '<div class="list-section">';
    html += '<div class="list-section-label">Directories</div>';
    dirs.forEach(dir => {
      html += `<div class="list-item list-dir">`;
      html += `<span class="list-icon dir-icon">📁</span>`;
      html += `<span class="list-name">${escapeHtml(dir)}</span>`;
      html += `</div>`;
    });
    html += '</div>';
  }

  // Show files
  if (files.length > 0) {
    html += '<div class="list-section">';
    html += '<div class="list-section-label">Files</div>';
    files.forEach(file => {
      const ext = file.split('.').pop()?.toLowerCase() || '';
      const icon = getFileIcon(ext);
      html += `<div class="list-item list-file">`;
      html += `<span class="list-icon file-icon ${icon.class}">${icon.text}</span>`;
      html += `<span class="list-name">${escapeHtml(file)}</span>`;
      html += `</div>`;
    });
    html += '</div>';
  }

  if (moreCount > 0) {
    html += `<div class="list-more">... and ${moreCount} more items</div>`;
  }

  html += '</div>';
  return html;
}

/**
 * Format task tool output - sub-agent spawning display with nested tools
 * Shows: agent type, task description, nested tool calls, actual results
 */
function formatTaskOutput(input, output) {
  const container = document.createElement('div');
  container.className = 'task-output';

  // Parse output as JSON if possible
  let outputData = null;
  if (output && typeof output === 'string' && output.trim()) {
    try {
      outputData = JSON.parse(output);
    } catch {
      // Not JSON, treat as plain text
    }
  } else if (output && typeof output === 'object') {
    outputData = output;
  }

  // Header row with agent badge, description, status, and duration
  const headerRow = document.createElement('div');
  headerRow.className = 'task-header-row';

  // Agent type badge
  if (input?.subagent_type) {
    const agentBadge = document.createElement('span');
    agentBadge.className = 'task-agent-badge';
    agentBadge.textContent = input.subagent_type;
    headerRow.appendChild(agentBadge);
  }

  // Task description
  const descEl = document.createElement('span');
  descEl.className = 'task-description';
  if (input?.description) {
    descEl.textContent = input.description;
  } else if (input?.prompt) {
    descEl.textContent = input.prompt.length > 80 ? input.prompt.slice(0, 80) + '...' : input.prompt;
  } else {
    descEl.textContent = 'Sub-agent task';
  }
  headerRow.appendChild(descEl);

  // Status badge
  if (outputData?.status) {
    const statusBadge = document.createElement('span');
    const statusClass = outputData.status === 'completed' ? 'success' :
                        outputData.status === 'failed' ? 'error' : 'running';
    statusBadge.className = `task-status-badge ${statusClass}`;
    statusBadge.textContent = outputData.status === 'completed' ? '✓' :
                              outputData.status === 'failed' ? '✗' : '...';
    headerRow.appendChild(statusBadge);
  }

  // Duration if available
  if (outputData?.duration) {
    const durationEl = document.createElement('span');
    durationEl.className = 'task-duration';
    durationEl.textContent = outputData.duration;
    headerRow.appendChild(durationEl);
  }

  container.appendChild(headerRow);

  // Nested tool calls section (if available)
  if (outputData?.toolCalls && outputData.toolCalls.length > 0) {
    const toolsSection = document.createElement('div');
    toolsSection.className = 'task-nested-tools';

    outputData.toolCalls.forEach((tool, index) => {
      const toolLine = document.createElement('div');
      toolLine.className = 'task-nested-tool';

      const prefix = index === outputData.toolCalls.length - 1 ? '└─' : '├─';
      const prefixSpan = document.createElement('span');
      prefixSpan.className = 'task-tree-prefix';
      prefixSpan.textContent = prefix;
      toolLine.appendChild(prefixSpan);

      const toolName = document.createElement('span');
      toolName.className = 'task-nested-tool-name';
      toolName.textContent = tool.name || tool.tool || 'tool';
      toolLine.appendChild(toolName);

      if (tool.summary || tool.result) {
        const toolSummary = document.createElement('span');
        toolSummary.className = 'task-nested-tool-summary';
        toolSummary.textContent = ' → ' + (tool.summary || tool.result);
        toolLine.appendChild(toolSummary);
      }

      toolsSection.appendChild(toolLine);
    });

    container.appendChild(toolsSection);
  }

  // Results section - show actual data found
  const resultContent = outputData?.result || outputData?.results || (!outputData ? output : null);
  if (resultContent) {
    const resultsSection = document.createElement('div');
    resultsSection.className = 'task-results-section';

    const resultsLabel = document.createElement('div');
    resultsLabel.className = 'task-results-label';
    resultsLabel.textContent = 'Results:';
    resultsSection.appendChild(resultsLabel);

    // Handle different result formats
    let displayItems = [];
    if (Array.isArray(resultContent)) {
      displayItems = resultContent;
    } else if (typeof resultContent === 'string') {
      // Try to parse as list (newline separated)
      displayItems = resultContent.split('\n').filter(line => line.trim());
    }

    if (displayItems.length > 0) {
      const resultsContainer = document.createElement('div');
      resultsContainer.className = 'task-results-list';

      // Show first 10 items
      const maxItems = 10;
      const itemsToShow = displayItems.slice(0, maxItems);

      itemsToShow.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'task-result-item';
        itemEl.textContent = typeof item === 'string' ? item : JSON.stringify(item);
        resultsContainer.appendChild(itemEl);
      });

      // Show "more" indicator if truncated
      if (displayItems.length > maxItems) {
        const moreEl = document.createElement('div');
        moreEl.className = 'task-results-more';
        moreEl.textContent = `[+${displayItems.length - maxItems} more]`;
        resultsContainer.appendChild(moreEl);
      }

      resultsSection.appendChild(resultsContainer);
    } else {
      // Show as plain text
      const resultText = document.createElement('div');
      resultText.className = 'task-result-text';
      const displayContent = String(resultContent).slice(0, 500);
      resultText.textContent = displayContent + (String(resultContent).length > 500 ? '...' : '');
      resultsSection.appendChild(resultText);
    }

    container.appendChild(resultsSection);
  }

  // Error section
  if (outputData?.error) {
    const errorSection = document.createElement('div');
    errorSection.className = 'task-error-section';

    const errorLabel = document.createElement('span');
    errorLabel.className = 'task-error-label';
    errorLabel.textContent = 'Error: ';
    errorSection.appendChild(errorLabel);

    const errorText = document.createElement('span');
    errorText.className = 'task-error-text';
    errorText.textContent = outputData.error;
    errorSection.appendChild(errorText);

    container.appendChild(errorSection);
  }

  // Empty state
  if (container.children.length === 1) { // Only header row
    const emptyEl = document.createElement('div');
    emptyEl.className = 'task-empty';
    emptyEl.textContent = 'Task running...';
    container.appendChild(emptyEl);
  }

  // Return as HTML string for compatibility with existing code
  return container.outerHTML;
}

/**
 * Parse HTML content and extract readable text
 * @param {string} html - Raw HTML content
 * @returns {Object} Parsed content with title, description, and text
 */
function parseHtmlContent(html) {
  // Use DOMParser for safe parsing
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Extract title
  const titleEl = doc.querySelector('title');
  const title = titleEl ? titleEl.textContent.trim() : '';

  // Extract meta description
  const metaDesc = doc.querySelector('meta[name="description"]');
  const description = metaDesc ? metaDesc.getAttribute('content') || '' : '';

  // Extract main content - prioritize article, main, or body
  const mainContent = doc.querySelector('article, main, .content, #content, .post, .article');
  const bodyContent = mainContent || doc.body;

  // Remove script, style, nav, header, footer elements
  const elementsToRemove = bodyContent.querySelectorAll('script, style, nav, header, footer, aside, .sidebar, .menu, .navigation, .ad, .advertisement');
  elementsToRemove.forEach(el => el.remove());

  // Get text content and clean it up
  let text = bodyContent ? bodyContent.textContent || '' : '';
  // Collapse multiple whitespace/newlines into single space
  text = text.replace(/\s+/g, ' ').trim();

  return { title, description, text };
}

/**
 * Format webfetch tool output - fetched web content display
 * Parses HTML to show readable content instead of raw markup
 */
function formatWebfetchOutput(input, output) {
  const container = document.createElement('div');
  container.className = 'webfetch-output';

  // Header row with URL
  if (input?.url) {
    const urlRow = document.createElement('div');
    urlRow.className = 'webfetch-url-row';

    const urlLabel = document.createElement('span');
    urlLabel.className = 'webfetch-url-label';
    urlLabel.textContent = 'URL:';
    urlRow.appendChild(urlLabel);

    const urlLink = document.createElement('a');
    urlLink.className = 'webfetch-url-link';
    urlLink.href = input.url;
    urlLink.target = '_blank';
    urlLink.rel = 'noopener noreferrer';
    urlLink.textContent = input.url;
    urlRow.appendChild(urlLink);

    container.appendChild(urlRow);
  }

  // Show the prompt/query used
  if (input?.prompt) {
    const promptRow = document.createElement('div');
    promptRow.className = 'webfetch-prompt';

    const promptLabel = document.createElement('span');
    promptLabel.className = 'webfetch-prompt-label';
    promptLabel.textContent = 'Query:';
    promptRow.appendChild(promptLabel);

    const promptText = document.createElement('span');
    promptText.className = 'webfetch-prompt-text';
    promptText.textContent = input.prompt;
    promptRow.appendChild(promptText);

    container.appendChild(promptRow);
  }

  // Content section
  if (output && output.trim()) {
    const contentSection = document.createElement('div');
    contentSection.className = 'webfetch-content';

    // Check if content looks like HTML (has tags)
    const isHtml = /<[a-z][\s\S]*>/i.test(output);

    if (isHtml) {
      // Parse HTML to extract readable content
      const parsed = parseHtmlContent(output);

      // Show title if found
      if (parsed.title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'webfetch-title';
        titleEl.textContent = parsed.title;
        contentSection.appendChild(titleEl);
      }

      // Show description if found
      if (parsed.description) {
        const descEl = document.createElement('div');
        descEl.className = 'webfetch-description';
        descEl.textContent = parsed.description;
        contentSection.appendChild(descEl);
      }

      // Show extracted text content
      const maxLength = 1000;
      const displayText = parsed.text.length > maxLength
        ? parsed.text.slice(0, maxLength)
        : parsed.text;

      if (displayText) {
        const textEl = document.createElement('div');
        textEl.className = 'webfetch-text';
        textEl.textContent = displayText;
        contentSection.appendChild(textEl);

        if (parsed.text.length > maxLength) {
          const moreEl = document.createElement('div');
          moreEl.className = 'webfetch-more';
          moreEl.textContent = `... ${parsed.text.length - maxLength} more characters`;
          contentSection.appendChild(moreEl);
        }
      }

      // Add "View raw HTML" toggle
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'webfetch-toggle-raw';
      toggleBtn.textContent = 'View raw HTML';

      const rawContent = document.createElement('div');
      rawContent.className = 'webfetch-raw hidden';
      const rawPre = document.createElement('pre');
      const rawCode = document.createElement('code');
      // Show truncated raw HTML
      const rawMaxLen = 2000;
      rawCode.textContent = output.length > rawMaxLen
        ? output.slice(0, rawMaxLen) + '\n... (truncated)'
        : output;
      rawPre.appendChild(rawCode);
      rawContent.appendChild(rawPre);

      toggleBtn.addEventListener('click', () => {
        const isHidden = rawContent.classList.contains('hidden');
        rawContent.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? 'Hide raw HTML' : 'View raw HTML';
      });

      contentSection.appendChild(toggleBtn);
      contentSection.appendChild(rawContent);
    } else {
      // Not HTML - show as plain text
      const maxLength = 1000;
      const displayText = output.length > maxLength ? output.slice(0, maxLength) : output;

      const textEl = document.createElement('div');
      textEl.className = 'webfetch-text';
      textEl.textContent = displayText;
      contentSection.appendChild(textEl);

      if (output.length > maxLength) {
        const moreEl = document.createElement('div');
        moreEl.className = 'webfetch-more';
        moreEl.textContent = `... ${output.length - maxLength} more characters`;
        contentSection.appendChild(moreEl);
      }
    }

    container.appendChild(contentSection);
  } else {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'webfetch-empty';
    emptyEl.textContent = 'Fetching content...';
    container.appendChild(emptyEl);
  }

  return container.outerHTML;
}

/**
 * Format todowrite/todoread tool output - simple checkbox list
 * Per user request: Just checkboxes, no cards, no color bars, strikethrough for completed
 */
function formatTodoOutput(input, output) {
  const container = document.createElement('div');
  container.className = 'todo-output-simple';

  // Try to parse as JSON array first (common format for todo tools)
  if (output && output.trim()) {
    const content = output.trim();
    let todos = null;

    // Try parsing as JSON
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        todos = parsed;
      } else if (parsed.todos && Array.isArray(parsed.todos)) {
        todos = parsed.todos;
      }
    } catch {
      // Not JSON, will handle as markdown below
    }

    // Render JSON todo array as simple checkbox list
    if (todos && todos.length > 0) {
      const list = document.createElement('div');
      list.className = 'todo-list-simple';

      todos.forEach((todo) => {
        const text = todo.content || todo.subject || todo.title || todo.text || 'Task';
        const status = todo.status || 'pending';
        const isCompleted = status === 'completed';
        const isInProgress = status === 'in_progress';

        const item = document.createElement('div');
        item.className = 'todo-item-simple';
        if (isCompleted) item.classList.add('completed');
        if (isInProgress) item.classList.add('in-progress');

        // Simple checkbox character
        const checkbox = document.createElement('span');
        checkbox.className = 'todo-checkbox-simple';
        checkbox.textContent = isCompleted ? '☑' : '☐';

        // Task text
        const textSpan = document.createElement('span');
        textSpan.className = 'todo-text-simple';
        textSpan.textContent = text;

        item.appendChild(checkbox);
        item.appendChild(textSpan);
        list.appendChild(item);
      });

      container.appendChild(list);
    } else if (!todos) {
      // Not JSON, try markdown rendering
      const rendered = document.createElement('div');
      rendered.className = 'todo-content-rendered';
      rendered.innerHTML = formatMarkdownSimple(content);
      container.appendChild(rendered);
    } else {
      const empty = document.createElement('div');
      empty.className = 'todo-empty';
      empty.textContent = 'No tasks';
      container.appendChild(empty);
    }
  } else if (input?.todos && Array.isArray(input.todos)) {
    // TodoWrite input - show what was written
    const list = document.createElement('div');
    list.className = 'todo-list-simple';

    input.todos.forEach((todo) => {
      const text = todo.content || todo.subject || todo.title || todo.text || 'Task';
      const status = todo.status || 'pending';
      const isCompleted = status === 'completed';
      const isInProgress = status === 'in_progress';

      const item = document.createElement('div');
      item.className = 'todo-item-simple';
      if (isCompleted) item.classList.add('completed');
      if (isInProgress) item.classList.add('in-progress');

      const checkbox = document.createElement('span');
      checkbox.className = 'todo-checkbox-simple';
      checkbox.textContent = isCompleted ? '☑' : '☐';

      const textSpan = document.createElement('span');
      textSpan.className = 'todo-text-simple';
      textSpan.textContent = text;

      item.appendChild(checkbox);
      item.appendChild(textSpan);
      list.appendChild(item);
    });

    container.appendChild(list);
  } else if (input?.subject || input?.description) {
    // Legacy single-item format
    const item = document.createElement('div');
    item.className = 'todo-item-simple';

    const checkbox = document.createElement('span');
    checkbox.className = 'todo-checkbox-simple';
    checkbox.textContent = '☐';

    const textSpan = document.createElement('span');
    textSpan.className = 'todo-text-simple';
    textSpan.textContent = input.subject || input.description || 'Task';

    item.appendChild(checkbox);
    item.appendChild(textSpan);
    container.appendChild(item);
  } else {
    const empty = document.createElement('div');
    empty.className = 'todo-empty';
    empty.textContent = 'Todo list updated';
    container.appendChild(empty);
  }

  return container.outerHTML;
}

/**
 * Simple markdown formatting for todo output
 */
function formatMarkdownSimple(text) {
  let html = escapeHtml(text);

  // Convert markdown checkboxes to styled items
  html = html.replace(/^- \[x\] (.+)$/gm, '<div class="todo-item completed"><span class="todo-checkbox">✓</span><span class="todo-text line-through">$1</span></div>');
  html = html.replace(/^- \[ \] (.+)$/gm, '<div class="todo-item pending"><span class="todo-checkbox">○</span><span class="todo-text">$1</span></div>');

  // Convert regular list items
  html = html.replace(/^- (.+)$/gm, '<div class="todo-item"><span class="todo-bullet">•</span><span class="todo-text">$1</span></div>');

  // Convert headers
  html = html.replace(/^### (.+)$/gm, '<div class="todo-header-3">$1</div>');
  html = html.replace(/^## (.+)$/gm, '<div class="todo-header-2">$1</div>');
  html = html.replace(/^# (.+)$/gm, '<div class="todo-header-1">$1</div>');

  // Convert bold text
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Preserve line breaks for readability
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Get meta text for tool (e.g., "10 results", "Show working file")
function getToolMeta(tool, output) {
  if (!output) return '';

  const text = String(output).trim();
  const lines = text.split('\n').filter(l => l.trim());

  // For search/glob results, show count
  if (tool.toLowerCase() === 'glob' || tool.toLowerCase() === 'grep') {
    if (lines.length > 1) {
      return `${lines.length} results`;
    }
  }

  // Read tool has no meta text (not expandable)
  if (tool.toLowerCase() === 'read') {
    return '';
  }

  return '';
}

// Mark current tool group as complete and animate collapse
function finalizeToolGroup() {
  if (currentToolGroup) {
    currentToolGroup.dataset.active = 'false';

    // Animate collapse after a short delay
    const groupToCollapse = currentToolGroup;
    setTimeout(() => {
      collapseToolGroup(groupToCollapse);
    }, 500); // Small delay so user can see final state before collapse

    currentToolGroup = null;
  }
}

// Animate tool group expand
function expandToolGroup(groupEl) {
  if (!groupEl || groupEl.dataset.expanded === 'true') return;

  // Cancel any pending collapse timeout
  if (groupEl._collapseTimeout) {
    clearTimeout(groupEl._collapseTimeout);
    groupEl._collapseTimeout = null;
  }

  const itemsEl = groupEl.querySelector('.tool-group-items');
  const headerEl = groupEl.querySelector('.tool-group-header');
  const countEl = headerEl?.querySelector('.tool-group-count');
  const chevronEl = headerEl?.querySelector('.tool-group-chevron');

  if (!itemsEl) return;

  // Mark as animating
  groupEl._animating = true;

  // Update state first
  groupEl.dataset.expanded = 'true';
  groupEl.classList.add('expanded');

  // Update header with completion status
  updateToolGroupHeader(groupEl);
  if (chevronEl) {
    chevronEl.innerHTML = chevronDownSvg;
  }

  // Get target height
  itemsEl.style.height = 'auto';
  itemsEl.style.display = 'block';
  const targetHeight = itemsEl.scrollHeight;

  // Start from 0
  itemsEl.style.height = '0px';
  itemsEl.style.overflow = 'hidden';
  itemsEl.style.opacity = '0';

  // Force reflow
  itemsEl.offsetHeight;

  // Animate to full height
  itemsEl.style.transition = 'height 0.3s ease-out, opacity 0.2s ease-out';

  requestAnimationFrame(() => {
    itemsEl.style.height = targetHeight + 'px';
    itemsEl.style.opacity = '1';

    // Clean up after animation
    groupEl._expandTimeout = setTimeout(() => {
      groupEl._expandTimeout = null;
      groupEl._animating = false;
      itemsEl.style.height = '';
      itemsEl.style.overflow = '';
      itemsEl.style.transition = '';
      itemsEl.style.opacity = '';
    }, 300);
  });
}

// Animate tool group collapse
function collapseToolGroup(groupEl) {
  if (!groupEl || groupEl.dataset.expanded !== 'true') return;

  // Mark as animating and update state IMMEDIATELY
  groupEl._animating = true;
  groupEl.dataset.expanded = 'false';

  const itemsEl = groupEl.querySelector('.tool-group-items');
  const headerEl = groupEl.querySelector('.tool-group-header');
  const countEl = headerEl?.querySelector('.tool-group-count');
  const chevronEl = headerEl?.querySelector('.tool-group-chevron');

  if (!itemsEl) {
    groupEl._animating = false;
    return;
  }

  // Update header with completion status
  updateToolGroupHeader(groupEl);
  if (chevronEl) {
    chevronEl.innerHTML = chevronRightSvg;
  }

  // Get current height for animation
  const currentHeight = itemsEl.scrollHeight;
  itemsEl.style.height = currentHeight + 'px';
  itemsEl.style.overflow = 'hidden';

  // Force reflow
  itemsEl.offsetHeight;

  // Add transition and collapse
  itemsEl.style.transition = 'height 0.3s ease-out, opacity 0.2s ease-out';
  itemsEl.style.opacity = '1';

  requestAnimationFrame(() => {
    itemsEl.style.height = '0px';
    itemsEl.style.opacity = '0';

    // After animation completes, clean up styles
    groupEl._collapseTimeout = setTimeout(() => {
      groupEl._collapseTimeout = null;
      groupEl._animating = false;
      groupEl.classList.remove('expanded');
      itemsEl.style.height = '';
      itemsEl.style.overflow = '';
      itemsEl.style.transition = '';
      itemsEl.style.opacity = '';
      itemsEl.style.display = 'none';
    }, 300);
  });
}

// Get descriptive title for tool
function getToolTitle(tool, input) {
  if (!input) return tool;

  const toolLower = tool.toLowerCase();

  if (typeof input === 'object') {
    // For Edit/Write, show full file path
    if (toolLower === 'edit' || toolLower === 'write') {
      const filePath = input.file_path || input.filePath || '';
      return filePath || `${tool} file`;
    }
    // For Read, show full file path
    if (toolLower === 'read') {
      const filePath = input.file_path || input.filePath || '';
      return filePath || 'Read file';
    }
    // For Bash, show command
    if (input.command) {
      return input.command.slice(0, 80);
    }
    if (input.path) return input.path;
    if (input.pattern) return `Search: ${input.pattern}`;
  }

  return String(input).slice(0, 60);
}

// Get result summary for tool
function getToolResult(tool, output) {
  if (!output) return '';

  const text = String(output).trim();
  const lines = text.split('\n').filter(l => l.trim());
  const toolLower = tool.toLowerCase();

  // For Read tool, show "Read X lines" format
  if (toolLower === 'read') {
    return `Read ${lines.length} line${lines.length !== 1 ? 's' : ''}`;
  }

  if (lines.length === 1 && text.length < 80) {
    return text;
  }

  // Summarize multi-line output
  if (lines.length > 1) {
    return `${lines.length} lines of output`;
  }

  return text.slice(0, 60) + (text.length > 60 ? '...' : '');
}

// Get line change summary for Edit tool (returns HTML with color coding)
function getEditLineCounts(input) {
  if (!input || typeof input !== 'object') return null;

  const oldStr = input.old_string || input.oldString || '';
  const newStr = input.new_string || input.newString || '';

  if (!oldStr && !newStr) return null;

  const oldLines = oldStr.split('\n').length;
  const newLines = newStr.split('\n').length;

  // Return object with added/removed counts for visual display
  return { added: newLines, removed: oldLines };
}

// Format tool input for display
function formatToolInput(input) {
  if (typeof input === 'string') return input;
  if (typeof input === 'object') {
    return JSON.stringify(input, null, 2);
  }
  return String(input);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Extract short model name from full model ID
 * e.g., "openrouter/google/gemini-3-flash-preview" -> "gemini-3-flash"
 */
function extractShortModelName(modelId) {
  if (!modelId) { return 'unknown'; }
  const parts = modelId.split('/');
  return parts[parts.length - 1]
    .replace(/-preview$/, '')
    .replace(/-latest$/, '');
}

/**
 * Initialize agent-model configuration UI
 */
async function initAgentModelConfigUI() {
  if (typeof window.AgentModelConfig !== 'undefined') {
    try {
      // Get model options from registry if available
      let modelOptions = [];
      if (typeof window.ModelRegistry !== 'undefined') {
        const models = window.ModelRegistry.instance?.getAllModels() || [];
        modelOptions = models.map(m => ({ id: m.id, name: m.name }));
      }

      await window.AgentModelConfig.initAgentModelConfig(modelOptions);
      console.log('[Renderer] Agent-model config initialized');
    } catch (error) {
      console.error('[Renderer] Failed to init agent-model config:', error);
    }
  }
}

// Basic syntax highlighting for code blocks
function highlightCode(code, lang) {
  // First escape the code
  let result = escapeHtml(code);

  // Common keywords across languages
  const keywords = [
    'async', 'await', 'function', 'const', 'let', 'var', 'return', 'if', 'else',
    'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
    'finally', 'throw', 'new', 'class', 'extends', 'import', 'export', 'from',
    'default', 'static', 'public', 'private', 'protected', 'interface', 'type',
    'enum', 'implements', 'abstract', 'fn', 'pub', 'impl', 'struct', 'trait',
    'use', 'mod', 'crate', 'self', 'super', 'where', 'mut', 'ref', 'move',
    'def', 'elif', 'pass', 'with', 'as', 'lambda', 'yield', 'global', 'nonlocal',
    'true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil'
  ];

  // Type keywords
  const types = [
    'string', 'number', 'boolean', 'object', 'any', 'void', 'never', 'unknown',
    'int', 'float', 'double', 'char', 'bool', 'i32', 'i64', 'u32', 'u64',
    'f32', 'f64', 'str', 'String', 'Vec', 'Option', 'Result', 'Box', 'Rc', 'Arc'
  ];

  // Highlight comments first (// and #) - they take priority
  result = result.replace(/(\/\/[^\n]*)/g, '<span class="hl-comment">$1</span>');

  // Highlight strings (double and single quotes only - not template literals to avoid issues)
  result = result.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, '<span class="hl-string">$1</span>');
  result = result.replace(/(&#39;(?:[^&]|&(?!#39;))*?&#39;)/g, '<span class="hl-string">$1</span>');

  // Highlight keywords (word boundary) - but not inside strings/comments
  const keywordPattern = new RegExp(`(?<![\\w])\\b(${keywords.join('|')})\\b(?![\\w])`, 'g');
  result = result.replace(keywordPattern, '<span class="hl-keyword">$1</span>');

  // Highlight types
  const typePattern = new RegExp(`\\b(${types.join('|')})\\b`, 'g');
  result = result.replace(typePattern, '<span class="hl-type">$1</span>');

  // Highlight function calls (word followed by parenthesis)
  result = result.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g, '<span class="hl-function">$1</span>(');

  // Highlight SCREAMING_SNAKE_CASE constants
  result = result.replace(/\b([A-Z][A-Z0-9_]{2,})\b/g, '<span class="hl-constant">$1</span>');

  // Highlight numbers (but not inside other spans)
  result = result.replace(/(?<!["'>])(\b\d+\.?\d*\b)(?![^<]*>)/g, '<span class="hl-number">$1</span>');

  return result;
}

// Get icon for tool type (SVG icons matching Claude Desktop style)
function getToolIcon(tool) {
  const icons = {
    'bash': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6M12 19h8"/></svg>',
    'read': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
    'write': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    'edit': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    'glob': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
    'grep': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
    'list': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    'ls': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    'task': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    'webfetch': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    'question': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    'todowrite': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    'todoread': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
  };
  // Default tool icon (wrench)
  const defaultIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
  return icons[tool.toLowerCase()] || defaultIcon;
}

// Show/update tool status panel
function showToolStatusPanel(tools) {
  if (!toolStatusEl) {
    toolStatusEl = document.createElement('div');
    toolStatusEl.className = 'tool-status-panel';
    messagesContainer.appendChild(toolStatusEl);
  }

  const completed = tools.filter(t => t.status === 'completed').length;
  const running = tools.filter(t => t.status === 'running').length;
  const total = tools.length;

  toolStatusEl.innerHTML = '';

  const countEl = document.createElement('div');
  countEl.className = 'tool-count';
  countEl.textContent = `Tools: ${completed}/${total} completed${running > 0 ? `, ${running} running` : ''}`;
  toolStatusEl.appendChild(countEl);

  // Show each tool
  tools.forEach(tool => {
    const itemEl = document.createElement('div');
    itemEl.className = `tool-item ${tool.status}`;
    itemEl.innerHTML = `<span class="tool-icon">${getToolIcon(tool.name)}</span> ${tool.name}: ${tool.title || tool.status}`;
    toolStatusEl.appendChild(itemEl);
  });

  scrollToBottom();
}

// Remove tool status panel
function removeToolStatusPanel() {
  if (toolStatusEl) {
    toolStatusEl.remove();
    toolStatusEl = null;
  }
}

// Show typing indicator with tool awareness
// Humorous tech sayings for typing indicator
const typingPhrases = [
  'Reticulating splines...',
  'Consulting the neural oracle...',
  'Warming up the tensor cores...',
  'Asking the rubber duck...',
  'Caffeinating the model...',
  'Spinning up hamster wheels...',
  'Summoning the context window...',
  'Negotiating with the GPU...',
  'Doing science...'
];

function getRandomTypingPhrase() {
  return typingPhrases[Math.floor(Math.random() * typingPhrases.length)];
}

function showTypingIndicator(message = null) {
  if (!message) message = getRandomTypingPhrase();
  removeTypingIndicator();

  const indicator = document.createElement('div');
  indicator.className = 'message assistant typing-message';
  indicator.id = 'typing-indicator';

  // Claude thinking logo (animated sparkle/star)
  const logoEl = document.createElement('div');
  logoEl.className = 'claude-thinking-logo';
  logoEl.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" class="claude-sparkle">
      <path d="M12 2L13.09 8.26L19 7L14.74 11.09L21 14L14.74 12.91L13.09 19L12 12.91L5 14L11.26 11.09L5 7L11.26 8.26L12 2Z"
            fill="currentColor"/>
    </svg>
  `;

  const textEl = document.createElement('span');
  textEl.className = 'typing-text';
  textEl.textContent = message;

  indicator.appendChild(logoEl);
  indicator.appendChild(textEl);
  messagesContainer.appendChild(indicator);
  scrollToBottom();
}

// Update typing indicator text
function updateTypingIndicator(message) {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    const textEl = indicator.querySelector('.typing-text');
    if (textEl) {
      textEl.textContent = message;
    }
  }
}

// Remove typing indicator
function removeTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) {
    indicator.remove();
  }
  // Stop the request timer when typing indicator is removed
  stopRequestTimer();
}

// Format elapsed time as M:SS
function formatElapsedTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Start the request timer
function startRequestTimer() {
  requestStartTime = Date.now();
  isCancelMode = true;

  // Update the send button to show cancel button (X icon)
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    sendBtn.classList.remove('loading');
    sendBtn.classList.add('cancel-mode');
    sendBtn.disabled = false;
    sendBtn.title = 'Cancel request';

    // Create X icon SVG elements safely
    const cancelSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cancelSvg.setAttribute('width', '16');
    cancelSvg.setAttribute('height', '16');
    cancelSvg.setAttribute('viewBox', '0 0 24 24');
    cancelSvg.setAttribute('fill', 'none');
    cancelSvg.setAttribute('stroke', 'currentColor');
    cancelSvg.setAttribute('stroke-width', '2.5');
    cancelSvg.setAttribute('stroke-linecap', 'round');

    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '18');
    line1.setAttribute('y1', '6');
    line1.setAttribute('x2', '6');
    line1.setAttribute('y2', '18');

    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '6');
    line2.setAttribute('y1', '6');
    line2.setAttribute('x2', '18');
    line2.setAttribute('y2', '18');

    cancelSvg.appendChild(line1);
    cancelSvg.appendChild(line2);
    sendBtn.textContent = '';
    sendBtn.appendChild(cancelSvg);

    // Add cancel click handler (remove previous one if exists)
    if (cancelClickHandler) {
      sendBtn.removeEventListener('click', cancelClickHandler);
    }
    cancelClickHandler = handleCancelRequest;
    sendBtn.addEventListener('click', cancelClickHandler);
  }

  // Notify main process that a request is in flight
  if (window.electronAPI && window.electronAPI.cancelRequest) {
    // We don't need to call setRequestState here since main.js tracks via IPC
  }

  // Update timer every 100ms for more responsive display
  requestTimerInterval = setInterval(() => {
    if (requestStartTime && currentToolGroup) {
      const timerEl = currentToolGroup.querySelector('.tool-group-timer');
      if (timerEl) {
        const elapsed = Math.floor((Date.now() - requestStartTime) / 1000);
        timerEl.textContent = formatElapsedTime(elapsed);
      }
    }
  }, 100);
}

// Stop the request timer
function stopRequestTimer() {
  // Final timer update before stopping
  if (requestStartTime && currentToolGroup) {
    const timerEl = currentToolGroup.querySelector('.tool-group-timer');
    if (timerEl) {
      const elapsed = Math.floor((Date.now() - requestStartTime) / 1000);
      timerEl.textContent = formatElapsedTime(elapsed);
    }
  }

  if (requestTimerInterval) {
    clearInterval(requestTimerInterval);
    requestTimerInterval = null;
  }
  requestStartTime = null;
  isCancelMode = false;

  // Reset send button to normal state
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    sendBtn.classList.remove('loading');
    sendBtn.classList.remove('cancel-mode');
    sendBtn.title = 'Send';

    // Remove cancel click handler
    if (cancelClickHandler) {
      sendBtn.removeEventListener('click', cancelClickHandler);
      cancelClickHandler = null;
    }

    // Create arrow SVG elements safely
    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.setAttribute('width', '16');
    arrowSvg.setAttribute('height', '16');
    arrowSvg.setAttribute('viewBox', '0 0 24 24');
    arrowSvg.setAttribute('fill', 'none');
    arrowSvg.setAttribute('stroke', 'currentColor');
    arrowSvg.setAttribute('stroke-width', '2.5');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 19V5M5 12l7-7 7 7');

    arrowSvg.appendChild(path);
    sendBtn.textContent = '';
    sendBtn.appendChild(arrowSvg);
  }

  // Timer is now on the tool group, no need to hide title bar timer
}

// Show error message
function showError(message) {
  const errorEl = document.createElement('div');
  errorEl.className = 'error-message';
  errorEl.textContent = message;
  messagesContainer.appendChild(errorEl);
}

// ============================================
// Cancel Request Handling
// ============================================

/**
 * Handle cancel request button click
 * Cancels the in-flight API request and restores UI state
 */
async function handleCancelRequest(event) {
  // Prevent multiple cancel clicks
  if (!isCancelMode) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  console.log('[Sidecar] Cancel request triggered');

  try {
    // Call the IPC to cancel the request
    if (window.electronAPI && window.electronAPI.cancelRequest) {
      const result = await window.electronAPI.cancelRequest();
      console.log('[Sidecar] Cancel result:', result);
    }

    // Stop the request timer and restore UI
    stopRequestTimer();
    removeTypingIndicator();
    finalizeToolGroup();

    // Reset the waiting state
    isWaitingForResponse = false;
    sendBtn.disabled = false;
    messageInput.focus();

    // Show cancellation message
    addMessage('system', 'Request cancelled');

    // Log the cancellation
    if (window.electronAPI && window.electronAPI.logMessage) {
      window.electronAPI.logMessage({
        role: 'system',
        content: 'Request cancelled by user',
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('[Sidecar] Error cancelling request:', error);
    showError('Failed to cancel request: ' + error.message);
  }
}

// ============================================
// Status Indicator
// ============================================

/**
 * Initialize the status indicator
 * Sets up periodic health checks and updates the UI
 */
function initStatusIndicator() {
  const statusIndicator = document.getElementById('status-indicator');
  if (!statusIndicator) {
    return;
  }

  // Initial status check
  checkAndUpdateStatus();

  // Set up periodic status checks
  statusCheckInterval = setInterval(checkAndUpdateStatus, STATUS_CHECK_INTERVAL);
}

/**
 * Check server health and update status indicator
 */
async function checkAndUpdateStatus() {
  const statusIndicator = document.getElementById('status-indicator');
  const statusDot = statusIndicator?.querySelector('.status-dot');
  const statusText = statusIndicator?.querySelector('.status-text');

  if (!statusIndicator || !statusDot || !statusText) {
    return;
  }

  try {
    // Show reconnecting state while checking
    if (lastStatusCheck === null) {
      updateStatusIndicator('reconnecting', 'Connecting...');
    }

    // Check server health via IPC
    if (window.electronAPI && window.electronAPI.checkServerHealth) {
      const result = await window.electronAPI.checkServerHealth();
      lastStatusCheck = result.lastCheck;

      if (result.healthy) {
        updateStatusIndicator('connected', 'Connected');
      } else {
        updateStatusIndicator('disconnected', 'Disconnected');
      }
    } else {
      // Fallback: try to reach the API via IPC proxy (bypasses Chromium network issues)
      if (config && config.apiBase) {
        try {
          const response = await proxyFetch('/config', { method: 'GET' });
          if (response.ok) {
            updateStatusIndicator('connected', 'Connected');
            lastStatusCheck = new Date().toISOString();
          } else {
            updateStatusIndicator('disconnected', 'Disconnected');
          }
        } catch (err) {
          updateStatusIndicator('disconnected', 'Disconnected');
        }
      }
    }
  } catch (error) {
    console.error('[Sidecar] Status check error:', error);
    updateStatusIndicator('disconnected', 'Disconnected');
  }
}

/**
 * Update the status indicator UI
 * @param {string} status - 'connected' | 'reconnecting' | 'disconnected'
 * @param {string} text - Status text to display
 */
function updateStatusIndicator(status, text) {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = statusIndicator?.querySelector('.status-text');

  if (!statusIndicator) {
    return;
  }

  // Remove all status classes
  statusIndicator.classList.remove('connected', 'reconnecting', 'disconnected');

  // Add the new status class
  statusIndicator.classList.add(status);

  // Update text
  if (statusText) {
    statusText.textContent = text;
  }

  // Update tooltip with last check time
  if (lastStatusCheck) {
    const lastCheckDate = new Date(lastStatusCheck);
    const timeAgo = formatTimeAgo(lastCheckDate);
    statusIndicator.title = `Last checked: ${timeAgo}`;
  } else {
    statusIndicator.title = 'Checking connection...';
  }
}

/**
 * Format a date as relative time (e.g., "5s ago", "2m ago")
 * @param {Date} date - The date to format
 * @returns {string} Formatted relative time
 */
function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);

  if (diffSec < 60) {
    return `${diffSec}s ago`;
  } else if (diffMin < 60) {
    return `${diffMin}m ago`;
  } else {
    return date.toLocaleTimeString();
  }
}

/**
 * Stop the status indicator polling
 */
function stopStatusIndicator() {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
    statusCheckInterval = null;
  }
}

// ============================================
// Tool Approval Request Handling
// ============================================

// Track pending tool approval requests
const pendingApprovals = new Map();

/**
 * Show tool approval request UI
 * @param {string} callID - Tool call ID
 * @param {string} toolName - Name of the tool requiring approval
 * @param {Object} toolInput - Tool input/parameters
 * @param {string} [description] - Optional description of what the tool will do
 */
function showToolApprovalUI(callID, toolName, toolInput, description) {
  // Remove any existing approval UI for this callID
  const existingApproval = document.querySelector(`[data-approval-id="${callID}"]`);
  if (existingApproval) {
    existingApproval.remove();
  }

  const container = document.createElement('div');
  container.className = 'tool-approval-card';
  container.dataset.approvalId = callID;

  // Header with warning icon
  const header = document.createElement('div');
  header.className = 'tool-approval-header';

  const iconSpan = document.createElement('span');
  // Create warning triangle SVG using DOM methods
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');

  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute('d', 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z');
  svg.appendChild(path1);

  const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line1.setAttribute('x1', '12');
  line1.setAttribute('y1', '9');
  line1.setAttribute('x2', '12');
  line1.setAttribute('y2', '13');
  svg.appendChild(line1);

  const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line2.setAttribute('x1', '12');
  line2.setAttribute('y1', '17');
  line2.setAttribute('x2', '12.01');
  line2.setAttribute('y2', '17');
  svg.appendChild(line2);

  iconSpan.appendChild(svg);
  header.appendChild(iconSpan);

  const headerText = document.createElement('span');
  headerText.textContent = 'Tool Approval Required';
  header.appendChild(headerText);

  container.appendChild(header);

  // Tool name
  const toolNameEl = document.createElement('div');
  toolNameEl.className = 'tool-approval-tool-name';
  toolNameEl.textContent = toolName;
  container.appendChild(toolNameEl);

  // Tool details (input/parameters)
  if (toolInput) {
    const detailsEl = document.createElement('div');
    detailsEl.className = 'tool-approval-details';

    // Format the input for display
    let inputText = '';
    if (typeof toolInput === 'string') {
      inputText = toolInput;
    } else if (toolInput.command) {
      // Bash command
      inputText = toolInput.command;
    } else if (toolInput.file_path) {
      // File operation
      inputText = toolInput.file_path;
      if (toolInput.content) {
        inputText += '\n\n' + (toolInput.content.length > 200
          ? toolInput.content.slice(0, 200) + '...'
          : toolInput.content);
      }
    } else {
      // Generic JSON display
      inputText = JSON.stringify(toolInput, null, 2);
    }

    detailsEl.textContent = inputText;
    container.appendChild(detailsEl);
  }

  // Description
  if (description) {
    const descEl = document.createElement('div');
    descEl.className = 'tool-approval-description';
    descEl.textContent = description;
    container.appendChild(descEl);
  }

  // Action buttons
  const actionsEl = document.createElement('div');
  actionsEl.className = 'tool-approval-actions';

  const denyBtn = document.createElement('button');
  denyBtn.className = 'tool-approval-deny';
  denyBtn.textContent = 'Deny';
  denyBtn.addEventListener('click', () => {
    handleToolApprovalResponse(callID, false, container);
  });

  const approveBtn = document.createElement('button');
  approveBtn.className = 'tool-approval-approve';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', () => {
    handleToolApprovalResponse(callID, true, container);
  });

  actionsEl.appendChild(denyBtn);
  actionsEl.appendChild(approveBtn);
  container.appendChild(actionsEl);

  // Add to messages container
  const messagesContainer = document.getElementById('messages');
  if (messagesContainer) {
    messagesContainer.appendChild(container);
    scrollToBottom();
  }

  // Track pending approval
  pendingApprovals.set(callID, {
    toolName,
    toolInput,
    container,
  });
}

/**
 * Handle approval/denial response
 * @param {string} callID - Tool call ID
 * @param {boolean} approved - Whether the tool was approved
 * @param {HTMLElement} container - The approval card container
 */
function handleToolApprovalResponse(callID, approved, container) {
  // Update UI to show result
  const actionsEl = container.querySelector('.tool-approval-actions');
  if (actionsEl) {
    actionsEl.remove();
  }

  // Add status indicator
  const statusEl = document.createElement('span');
  statusEl.className = `tool-approval-status ${approved ? 'approved' : 'denied'}`;
  statusEl.textContent = approved ? 'Approved' : 'Denied';

  const header = container.querySelector('.tool-approval-header');
  if (header) {
    header.appendChild(statusEl);
  }

  // Update card styling
  container.classList.add(approved ? 'approved' : 'denied');

  // Remove from pending
  pendingApprovals.delete(callID);

  // Send response to OpenCode (placeholder - needs actual API integration)
  if (typeof window.sendToolApprovalResponse === 'function') {
    window.sendToolApprovalResponse(callID, approved);
  } else {
    console.log(`[Sidecar] Tool ${callID} ${approved ? 'approved' : 'denied'}`);
  }
}

/**
 * Check if a tool requires approval based on current mode and tool type
 * @param {string} toolName - Name of the tool
 * @param {Object} toolInput - Tool input
 * @returns {boolean} Whether approval is required
 */
function requiresToolApproval(toolName, toolInput) {
  // Get current agent/mode
  const currentAgent = window.sidecarConfig?.agent || 'Build';

  // In Plan mode, certain tools require approval
  if (currentAgent === 'Plan') {
    const restrictedTools = ['write', 'edit', 'bash', 'patch'];
    return restrictedTools.includes(toolName.toLowerCase());
  }

  // In Build mode, potentially dangerous operations could require approval
  // This could be expanded based on configuration
  if (toolName.toLowerCase() === 'bash' && toolInput?.command) {
    const dangerousPatterns = [
      /rm\s+-rf/i,
      /rm\s+.*\*/i,
      /drop\s+table/i,
      /truncate\s+table/i,
      /delete\s+from/i,
      /format\s+/i,
    ];
    return dangerousPatterns.some(pattern => pattern.test(toolInput.command));
  }

  return false;
}

// ============================================
// Question Tool Handling
// ============================================

// Track pending question tools
const pendingQuestions = new Map();

// Track answered questions - these should not be re-rendered
const answeredQuestions = new Set();

// Track question request IDs for API replies: callID -> requestID (e.g., "que_xxx")
const questionRequestIds = new Map();

// Track multipart question state: { callID: { questions, currentIndex, answers } }
const questionState = new Map();

// Check if a tool part is a question tool
function isQuestionTool(part) {
  const toolName = part.tool?.toLowerCase();
  return part.type === 'tool' && (toolName === 'question' || toolName === 'askuserquestion');
}

// Create and display question UI with multipart support
function showQuestionUI(callID, questionData) {
  // Remove any existing question UI for this callID
  const existingQuestion = document.querySelector(`[data-question-id="${callID}"]`);
  if (existingQuestion) {
    existingQuestion.remove();
  }

  // Handle both single question format and questions array format
  const questions = questionData.questions || [questionData];
  const totalQuestions = questions.length;

  // Initialize or get question state
  if (!questionState.has(callID)) {
    questionState.set(callID, {
      questions,
      currentIndex: 0,
      answers: {},
      multiSelect: {}
    });
  }

  const state = questionState.get(callID);
  const currentQuestion = questions[state.currentIndex] || questionData;
  const questionTextContent = currentQuestion.question || questionData.question || 'Please provide input:';
  const options = currentQuestion.options || questionData.options || [];
  const isMultiSelect = currentQuestion.multiSelect || false;
  const header_label = currentQuestion.header || '';

  const container = document.createElement('div');
  container.className = 'question-tool-container';
  container.dataset.questionId = callID;

  // Question header with icon and counter
  const header = document.createElement('div');
  header.className = 'question-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'question-header-left';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'question-icon';
  iconSpan.innerHTML = getToolIcon('question');

  const labelSpan = document.createElement('span');
  labelSpan.className = 'question-label';
  labelSpan.textContent = header_label || 'Question';

  headerLeft.appendChild(iconSpan);
  headerLeft.appendChild(labelSpan);
  header.appendChild(headerLeft);

  // Add question counter for multipart questions
  if (totalQuestions > 1) {
    const counter = document.createElement('span');
    counter.className = 'question-counter';
    counter.textContent = `${state.currentIndex + 1}/${totalQuestions}`;
    header.appendChild(counter);
  }

  container.appendChild(header);

  // Question text
  const questionText = document.createElement('div');
  questionText.className = 'question-text';
  questionText.textContent = questionTextContent;
  container.appendChild(questionText);

  // Add hint for multi-select questions
  if (isMultiSelect && options && options.length > 0) {
    const hint = document.createElement('div');
    hint.className = 'question-hint';
    hint.textContent = 'Select all that apply';
    container.appendChild(hint);
  }

  // Options or free-form input
  const inputArea = document.createElement('div');
  inputArea.className = 'question-input-area';

  if (options && options.length > 0) {
    // Initialize multiSelect state for this question
    if (isMultiSelect && !state.multiSelect[state.currentIndex]) {
      state.multiSelect[state.currentIndex] = new Set();
    }

    // Render option buttons
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'question-options';

    options.forEach((option, index) => {
      const btn = document.createElement('button');
      btn.className = 'question-option-btn';
      // Add class to differentiate multi-select from single-select
      if (isMultiSelect) {
        btn.classList.add('multi-select');
      } else {
        btn.classList.add('single-select');
        if (index === 0) {
          btn.classList.add('highlighted');
        }
      }

      // Handle option as string or object with label/description
      const optionLabel = option.label || option;
      const optionDesc = option.description || '';

      // Create selection indicator (checkbox for multi, radio for single)
      const indicator = document.createElement('span');
      indicator.className = isMultiSelect ? 'question-checkbox' : 'question-radio';
      btn.appendChild(indicator);

      // Create option content wrapper
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'question-option-content';

      // Create button content
      const labelSpan = document.createElement('span');
      labelSpan.className = 'question-btn-label';
      labelSpan.textContent = optionLabel;
      contentWrapper.appendChild(labelSpan);

      if (optionDesc) {
        const descSpan = document.createElement('span');
        descSpan.className = 'question-btn-desc';
        descSpan.textContent = optionDesc;
        contentWrapper.appendChild(descSpan);
      }

      btn.appendChild(contentWrapper);

      // Add number badge
      const badge = document.createElement('span');
      badge.className = 'question-option-badge';
      badge.textContent = index + 1;
      btn.appendChild(badge);

      if (isMultiSelect) {
        // Multi-select mode - toggle selection
        btn.addEventListener('click', () => {
          const selected = state.multiSelect[state.currentIndex];
          if (selected.has(optionLabel)) {
            selected.delete(optionLabel);
            btn.classList.remove('selected');
          } else {
            selected.add(optionLabel);
            btn.classList.add('selected');
          }
        });
      } else {
        // Single-select mode - immediate answer
        btn.addEventListener('click', () => {
          handleMultipartQuestionAnswer(callID, optionLabel, container);
        });
      }
      optionsContainer.appendChild(btn);
    });

    // Add "Type something else..." option
    const otherBtn = document.createElement('button');
    otherBtn.className = 'question-option-btn question-other-btn';

    const otherContent = document.createElement('div');
    otherContent.className = 'question-option-content';
    const otherLabel = document.createElement('span');
    otherLabel.className = 'question-btn-label';
    otherLabel.textContent = 'Type something else...';
    otherContent.appendChild(otherLabel);
    otherBtn.appendChild(otherContent);

    otherBtn.addEventListener('click', () => {
      showFreeFormInput(callID, container, optionsContainer, isMultiSelect);
    });
    optionsContainer.appendChild(otherBtn);

    inputArea.appendChild(optionsContainer);

    // For multi-select, add a confirm button
    if (isMultiSelect) {
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'question-confirm-btn';
      confirmBtn.innerHTML = '✓ Submit Selection';
      confirmBtn.addEventListener('click', () => {
        const selected = Array.from(state.multiSelect[state.currentIndex]);
        if (selected.length > 0) {
          handleMultipartQuestionAnswer(callID, selected.join(', '), container);
        }
      });
      inputArea.appendChild(confirmBtn);
    }
  } else {
    // Free-form input only
    const inputWrapper = createFreeFormInput(callID, container, false);
    inputArea.appendChild(inputWrapper);
  }

  container.appendChild(inputArea);

  // Add footer with Skip button
  const footer = document.createElement('div');
  footer.className = 'question-footer';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'question-skip-btn';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', () => {
    handleMultipartQuestionAnswer(callID, '[SKIPPED]', container);
  });
  footer.appendChild(skipBtn);

  container.appendChild(footer);

  // Add to messages container
  messagesContainer.appendChild(container);
  scrollToBottom();

  // Store reference
  pendingQuestions.set(callID, container);

  return container;
}

// Handle answer for multipart questions
function handleMultipartQuestionAnswer(callID, answer, container) {
  const state = questionState.get(callID);
  if (!state) {
    // Fall back to simple response
    handleQuestionResponse(callID, answer, container);
    return;
  }

  // For single questions, submit directly without wrapping in object
  if (state.questions.length === 1) {
    handleQuestionResponse(callID, answer, container);
    questionState.delete(callID);
    return;
  }

  const currentQuestion = state.questions[state.currentIndex];
  const questionKey = currentQuestion.header || `q${state.currentIndex}`;

  // Store the answer
  state.answers[questionKey] = answer;

  // Check if there are more questions
  if (state.currentIndex < state.questions.length - 1) {
    // Move to next question
    state.currentIndex++;

    // Remove current container and show next question
    container.remove();
    pendingQuestions.delete(callID);

    // Show next question with the same callID
    showQuestionUI(callID, { questions: state.questions });
  } else {
    // All questions answered - submit final response
    handleQuestionResponse(callID, state.answers, container);

    // Clean up state
    questionState.delete(callID);
  }
}

// Create free-form input elements
function createFreeFormInput(callID, container, useMultipart = true) {
  const inputWrapper = document.createElement('div');
  inputWrapper.className = 'question-freeform-wrapper';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'question-freeform-input';
  input.placeholder = 'Type your answer...';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'question-submit-btn';
  submitBtn.textContent = 'Submit';
  submitBtn.addEventListener('click', () => {
    const value = input.value.trim();
    if (value) {
      if (useMultipart && questionState.has(callID)) {
        handleMultipartQuestionAnswer(callID, value, container);
      } else {
        handleQuestionResponse(callID, value, container);
      }
    }
  });

  // Handle Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = input.value.trim();
      if (value) {
        if (useMultipart && questionState.has(callID)) {
          handleMultipartQuestionAnswer(callID, value, container);
        } else {
          handleQuestionResponse(callID, value, container);
        }
      }
    }
  });

  inputWrapper.appendChild(input);
  inputWrapper.appendChild(submitBtn);

  // Focus the input
  setTimeout(() => input.focus(), 100);

  return inputWrapper;
}

// Show free-form input when "Other" is clicked
function showFreeFormInput(callID, container, optionsContainer, isMultiSelect = false) {
  // Hide options
  optionsContainer.style.display = 'none';

  // Hide confirm button if present
  const confirmBtn = container.querySelector('.question-confirm-btn');
  if (confirmBtn) {
    confirmBtn.style.display = 'none';
  }

  // Show free-form input
  const inputWrapper = createFreeFormInput(callID, container, true);
  const inputArea = container.querySelector('.question-input-area');
  inputArea.appendChild(inputWrapper);
}

// Handle question response
async function handleQuestionResponse(callID, answer, container) {
  // Disable all inputs
  container.querySelectorAll('button, input').forEach(el => {
    el.disabled = true;
  });

  // Add loading state
  container.classList.add('question-loading');

  // Format answer for display (handle object with multiple answers)
  let displayAnswer;
  if (typeof answer === 'object' && answer !== null) {
    // Format multipart answers
    displayAnswer = Object.entries(answer)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  } else {
    displayAnswer = answer;
  }

  // Show selected answer using safe DOM methods
  const selectedEl = document.createElement('div');
  selectedEl.className = 'question-selected-answer';

  const answerLabel = document.createElement('span');
  answerLabel.className = 'answer-label';
  answerLabel.textContent = 'Your answer: ';

  const answerText = document.createElement('span');
  answerText.textContent = displayAnswer;

  selectedEl.appendChild(answerLabel);
  selectedEl.appendChild(answerText);
  container.appendChild(selectedEl);

  // Mark as answered so polling doesn't re-render it
  answeredQuestions.add(callID);

  // Remove from pending
  pendingQuestions.delete(callID);

  // Mark as completed
  container.classList.remove('question-loading');
  container.classList.add('question-completed');

  // Get the question request ID for the API reply endpoint
  const requestId = questionRequestIds.get(callID);

  if (requestId && window.electronAPI?.proxyApiCall) {
    // Use the dedicated question reply endpoint: POST /question/{requestID}/reply
    // Format: { answers: [["selected_label"]] } - array of arrays for each question
    try {
      console.log('[Sidecar] Sending answer via /question/' + requestId + '/reply endpoint...');

      // Format answer for API - each answer is an array of selected labels
      let apiAnswers;
      if (typeof answer === 'object' && answer !== null) {
        // Multipart answers: convert object values to arrays
        apiAnswers = Object.values(answer).map(v => [String(v)]);
      } else {
        // Single answer: wrap in array
        apiAnswers = [[String(answer)]];
      }

      const result = await window.electronAPI.proxyApiCall({
        method: 'POST',
        endpoint: `/question/${requestId}/reply`,
        body: { answers: apiAnswers }
      });

      console.log('[Sidecar] Question reply result:', result);

      // Clean up the request ID mapping
      questionRequestIds.delete(callID);

      // The model will automatically continue after the question is answered
      // SSE events will deliver the response
    } catch (error) {
      console.error('[Sidecar] Error replying to question via API:', error);
      // Fall back to sending as user message
      await fallbackSendAnswer(answer);
    }
  } else {
    // Fallback: No request ID or API not available - send as user message
    console.log('[Sidecar] No request ID found for callID:', callID, '- falling back to user message');
    await fallbackSendAnswer(answer);
  }
}

// Fallback function to send answer as user message
async function fallbackSendAnswer(answer) {
  let answerTextToSend;
  if (typeof answer === 'object' && answer !== null) {
    const formattedAnswers = Object.entries(answer)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
    answerTextToSend = `[User answered your question]\n\n${formattedAnswers}\n\nPlease continue based on this answer.`;
  } else {
    answerTextToSend = `[User answered your question]\n\nMy answer: ${String(answer)}\n\nPlease continue based on this answer.`;
  }

  try {
    console.log('[Sidecar] Sending answer via streaming API (fallback)...');
    await sendToAPIStreaming(answerTextToSend);
  } catch (error) {
    console.error('[Sidecar] Error continuing after question:', error);
    showError(`Error continuing conversation: ${error.message}`);
  }
}

// ============================================
// Permission Handling
// ============================================

// Track pending permissions: requestId -> container
const pendingPermissions = new Map();

// Track handled permissions to avoid duplicates
const handledPermissions = new Set();

// Track permission request IDs for API replies
const permissionRequestIds = new Map();

/**
 * Handle permission.asked SSE event
 * This event is sent by OpenCode when a tool needs permission to execute
 * @param {object} data - Permission event data
 *
 * Event format:
 * {
 *   id: "per_xxx",                    // Permission request ID
 *   sessionID: "ses_xxx",             // Session ID
 *   permission: "external_directory", // Permission type
 *   patterns: ["/path/to/dir"],       // Affected paths/patterns
 *   always: ["/path*"],               // Suggested "always" patterns
 *   metadata: {},                     // Additional metadata
 *   tool: { messageID, callID }       // Tool that triggered this
 * }
 */
function handlePermissionAsked(data) {
  console.log('[Sidecar] permission.asked event received:', JSON.stringify(data).slice(0, 500));

  // Extract the request ID from the event
  const requestId = data.id;

  // Skip if already handled
  if (!requestId || handledPermissions.has(requestId) || pendingPermissions.has(requestId)) {
    console.log('[Sidecar] permission.asked skipping - already handled:', requestId);
    return;
  }

  // Extract permission details from actual event format
  const permissionType = data.permission || data.type || 'unknown';
  const patterns = data.patterns || [];
  const pattern = patterns.length > 0 ? patterns.join(', ') : '';
  const alwaysPatterns = data.always || [];
  const toolInfo = data.tool || {};
  const metadata = data.metadata || {};

  // Build user-friendly message
  const message = buildPermissionMessage(permissionType, pattern, metadata);

  // Prepare permission data
  const permData = {
    requestId,
    type: permissionType,
    pattern,
    patterns,
    alwaysPatterns,
    message,
    metadata,
    toolInfo
  };

  // Try to attach permission to its triggering tool
  const toolCallId = toolInfo.callID || data.callID;
  if (toolCallId) {
    const toolEl = document.querySelector(`[data-call-id="${toolCallId}"]`);
    if (toolEl) {
      // Tool exists - attach permission accordion directly
      console.log('[Sidecar] Attaching permission to tool:', toolCallId);
      attachPermissionToTool(toolEl, requestId, permData);
      return;
    } else {
      // Tool not created yet - queue permission for when tool is created
      console.log('[Sidecar] Queueing permission for tool:', toolCallId);
      pendingPermissionsForTools.set(toolCallId, permData);
      return;
    }
  }

  // Fallback: show standalone permission UI if no tool association
  console.log('[Sidecar] permission.asked showing standalone UI for:', requestId, permissionType, pattern);
  showPermissionUI(requestId, permData);
}

/**
 * Build a human-readable permission message
 * @param {string} type - Permission type (external_directory, bash, read, edit, write, etc.)
 * @param {string} pattern - The affected path/pattern
 * @param {object} metadata - Additional metadata
 */
function buildPermissionMessage(type, pattern, metadata) {
  switch (type) {
    case 'external_directory':
      return `Allow access to external directory: ${pattern || 'unknown path'}`;
    case 'bash':
      return `Allow running bash command: ${metadata?.command || pattern || 'unknown command'}`;
    case 'read':
      return `Allow reading file: ${pattern || metadata?.path || 'unknown path'}`;
    case 'edit':
      return `Allow editing file: ${pattern || metadata?.path || 'unknown path'}`;
    case 'write':
      return `Allow writing file: ${pattern || metadata?.path || 'unknown path'}`;
    case 'mcp':
      return `Allow MCP tool: ${pattern || 'unknown tool'}`;
    default:
      return `Allow ${type.replace(/_/g, ' ')} operation${pattern ? ': ' + pattern : ''}`;
  }
}

/**
 * Show permission approval UI
 */
function showPermissionUI(requestId, data) {
  // Remove any existing permission UI for this request
  const existingPermission = document.querySelector(`[data-permission-id="${requestId}"]`);
  if (existingPermission) {
    existingPermission.remove();
  }

  const container = document.createElement('div');
  container.className = 'permission-container';
  container.dataset.permissionId = requestId;

  // Header with type badge
  const header = document.createElement('div');
  header.className = 'permission-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'permission-header-left';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'permission-icon';
  iconSpan.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'permission-label';
  labelSpan.textContent = 'Permission Required';

  headerLeft.appendChild(iconSpan);
  headerLeft.appendChild(labelSpan);
  header.appendChild(headerLeft);

  // Add type badge
  if (data.type) {
    const typeBadge = document.createElement('span');
    typeBadge.className = 'permission-type-badge';
    typeBadge.textContent = data.type.replace(/_/g, ' ');
    header.appendChild(typeBadge);
  }

  container.appendChild(header);

  // Message
  const messageDiv = document.createElement('div');
  messageDiv.className = 'permission-message';
  messageDiv.textContent = data.message;
  container.appendChild(messageDiv);

  // Details - show patterns if available
  if (data.patterns && data.patterns.length > 0) {
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'permission-details';
    const codeEl = document.createElement('code');
    codeEl.textContent = data.patterns.join('\n');
    detailsDiv.appendChild(codeEl);
    container.appendChild(detailsDiv);
  } else if (data.metadata && (data.metadata.command || data.metadata.path)) {
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'permission-details';
    const codeEl = document.createElement('code');
    codeEl.textContent = data.metadata.command || data.metadata.path || '';
    detailsDiv.appendChild(codeEl);
    container.appendChild(detailsDiv);
  }

  // Buttons
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'permission-buttons';

  // Reject button
  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'permission-btn permission-btn-reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.onclick = () => handlePermissionResponse(requestId, 'reject', container);

  // Allow Once button
  const allowOnceBtn = document.createElement('button');
  allowOnceBtn.className = 'permission-btn permission-btn-once';
  allowOnceBtn.textContent = 'Allow Once';
  allowOnceBtn.onclick = () => handlePermissionResponse(requestId, 'once', container);

  // Allow Always button
  const allowAlwaysBtn = document.createElement('button');
  allowAlwaysBtn.className = 'permission-btn permission-btn-always';
  allowAlwaysBtn.textContent = 'Allow Always';
  allowAlwaysBtn.onclick = () => handlePermissionResponse(requestId, 'always', container);

  buttonContainer.appendChild(rejectBtn);
  buttonContainer.appendChild(allowOnceBtn);
  buttonContainer.appendChild(allowAlwaysBtn);
  container.appendChild(buttonContainer);

  // Add to messages container
  messagesContainer.appendChild(container);

  // Track pending permission
  pendingPermissions.set(requestId, container);

  // Scroll to the first pending permission (not just bottom)
  // This ensures user sees permissions in order
  scrollToFirstPendingPermission();
}

/**
 * Handle permission response - call the API to approve/reject
 */
async function handlePermissionResponse(requestId, reply, container) {
  console.log('[Sidecar] Permission response:', requestId, reply);

  // Mark as handled
  handledPermissions.add(requestId);
  pendingPermissions.delete(requestId);

  // Get the pattern/path from the container before replacing it
  const detailsEl = container.querySelector('.permission-details code');
  const pattern = detailsEl?.textContent || '';
  const typeBadge = container.querySelector('.permission-type-badge');
  const permType = typeBadge?.textContent || 'permission';

  // Call the permission reply API
  if (window.electronAPI?.proxyApiCall) {
    try {
      console.log('[Sidecar] Sending permission reply via /permission/' + requestId + '/reply endpoint...');

      const result = await window.electronAPI.proxyApiCall({
        method: 'POST',
        endpoint: `/permission/${requestId}/reply`,
        body: { reply: reply }
      });

      console.log('[Sidecar] Permission reply result:', result);

      // Replace the full permission UI with a compact resolved version
      const isGranted = reply !== 'reject';
      const icon = isGranted ? '✓' : '✗';
      const statusText = isGranted ? 'granted' : 'denied';
      const replyText = reply === 'always' ? ' (always)' : reply === 'once' ? ' (once)' : '';

      // Create compact collapsed permission
      container.innerHTML = '';
      container.className = `permission-container permission-collapsed permission-${reply}`;

      const collapsedContent = document.createElement('div');
      collapsedContent.className = 'permission-collapsed-content';
      collapsedContent.innerHTML = `
        <span class="permission-collapsed-icon">${icon}</span>
        <span class="permission-collapsed-text">
          <span class="permission-collapsed-type">${escapeHtml(permType)}</span>
          ${statusText}${replyText}
          ${pattern ? `<span class="permission-collapsed-path">${escapeHtml(pattern.split('\n')[0])}</span>` : ''}
        </span>
      `;
      container.appendChild(collapsedContent);

      // Update the badge after permission resolved
      updatePendingPermissionsBadge();

    } catch (error) {
      console.error('[Sidecar] Error replying to permission via API:', error);
      showError(`Error sending permission response: ${error.message}`);
    }
  } else {
    console.error('[Sidecar] proxyApiCall not available - cannot reply to permission');
    showError('Unable to send permission response - API not available');
  }
}

// Poll for model response after TUI control response
async function pollForModelResponse() {
  const maxPolls = 60; // 60 seconds max
  let pollCount = 0;
  let lastSeenMessageId = null;

  const poll = async () => {
    try {
      // Use the existing fetchLatestAssistantMessage which works
      const latestAssistant = await fetchLatestAssistantMessage();

      if (latestAssistant) {
        // Check if this is a new message (not the one that triggered the question)
        if (lastSeenMessageId && latestAssistant.id !== lastSeenMessageId) {
          // New assistant message - display it
          removeTypingIndicator();

          // Extract text from parts
          let assistantMessage = '';
          if (latestAssistant.parts && Array.isArray(latestAssistant.parts)) {
            for (const part of latestAssistant.parts) {
              if (part.type === 'text' && part.text) {
                assistantMessage += part.text;
              }
            }
          }

          if (assistantMessage) {
            addMessage('assistant', assistantMessage);
            console.log('[Sidecar] Received response after question:', assistantMessage.slice(0, 100));
          }
          return; // Done polling
        }

        // Remember this message ID
        if (!lastSeenMessageId) {
          lastSeenMessageId = latestAssistant.id;
        }
      }

      // Continue polling
      pollCount++;
      if (pollCount < maxPolls) {
        setTimeout(poll, 1000);
      } else {
        removeTypingIndicator();
        console.log('[Sidecar] Polling timeout - session may still be processing');
      }
    } catch (error) {
      console.error('[Sidecar] Error polling for response:', error);
      removeTypingIndicator();
    }
  };

  // Start polling after a short delay
  setTimeout(poll, 500);
}


// Process tool parts and handle question tools
function processQuestionTools(parts) {
  const questionParts = parts.filter(isQuestionTool);

  questionParts.forEach(part => {
    if (part.state?.status === 'pending' && part.state?.input) {
      showQuestionUI(part.callID, part.state.input);
    }
  });

  return questionParts.length > 0;
}

// ============================================
// Todo Tool Handling
// ============================================

// Status icons for todo items
const TODO_STATUS_ICONS = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
};

// Check if a tool part is a todo tool
function isTodoTool(part) {
  return part.type === 'tool' && (part.tool === 'todowrite' || part.tool === 'todoread');
}

// Create and display todo list UI
function showTodoUI(callID, todos, isRead = false) {
  // Remove any existing todo UI
  const existingTodo = document.querySelector('.todo-tool-container');
  if (existingTodo) {
    existingTodo.remove();
  }

  const container = document.createElement('div');
  container.className = 'todo-tool-container';
  container.dataset.todoId = callID;

  // Header
  const header = document.createElement('div');
  header.className = 'todo-header';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'todo-icon';
  iconSpan.innerHTML = getToolIcon(isRead ? 'todoread' : 'todowrite');

  const labelSpan = document.createElement('span');
  labelSpan.className = 'todo-label';
  labelSpan.textContent = 'Task Progress';

  // Progress summary
  const progressSpan = document.createElement('span');
  progressSpan.className = 'todo-progress';
  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgress = todos.filter(t => t.status === 'in_progress').length;
  progressSpan.textContent = `${completed}/${todos.length} completed`;
  if (inProgress > 0) {
    progressSpan.textContent += ` • ${inProgress} in progress`;
  }

  header.appendChild(iconSpan);
  header.appendChild(labelSpan);
  header.appendChild(progressSpan);
  container.appendChild(header);

  // Todo list
  if (todos.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'todo-empty';
    emptyEl.textContent = 'No tasks';
    container.appendChild(emptyEl);
  } else {
    const list = document.createElement('ul');
    list.className = 'todo-list';

    todos.forEach((todo, index) => {
      const item = document.createElement('li');
      item.className = `todo-item todo-${todo.status}`;

      // Status icon
      const statusIcon = document.createElement('span');
      statusIcon.className = 'todo-status-icon';
      statusIcon.textContent = TODO_STATUS_ICONS[todo.status] || '○';

      // Content
      const content = document.createElement('span');
      content.className = 'todo-content';
      content.textContent = todo.content;

      // Active form (for in_progress items)
      if (todo.status === 'in_progress' && todo.activeForm) {
        const activeForm = document.createElement('span');
        activeForm.className = 'todo-active-form';
        activeForm.textContent = todo.activeForm;
        item.appendChild(statusIcon);
        item.appendChild(content);
        item.appendChild(activeForm);
      } else {
        item.appendChild(statusIcon);
        item.appendChild(content);
      }

      list.appendChild(item);
    });

    container.appendChild(list);
  }

  // Add to messages container
  messagesContainer.appendChild(container);
  scrollToBottom();

  return container;
}

// Process todowrite/todoread tool calls
function processTodoTool(part) {
  if (!isTodoTool(part)) {
    return false;
  }

  let todos = [];
  const isRead = part.tool === 'todoread';

  if (isRead && part.state?.output?.todos) {
    todos = part.state.output.todos;
  } else if (!isRead && part.state?.input?.todos) {
    todos = part.state.input.todos;
  }

  if (todos.length > 0 || !isRead) {
    showTodoUI(part.callID, todos, isRead);
    return true;
  }

  return false;
}

// Send message
async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || isWaitingForResponse) return;

  // Check for @agent syntax
  const agentCommand = parseAgentSyntax(content);
  if (agentCommand) {
    // Add user message showing the agent command
    addMessage('user', content);
    messageInput.value = '';
    messageInput.style.height = 'auto';

    // Spawn sub-agent
    await spawnSubagent(agentCommand.agentType, agentCommand.briefing);
    return;
  }

  // Add user message
  addMessage('user', content);
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Send to API - use streaming if available
  if (sseSubscribed && window.electronAPI?.sendMessageAsync) {
    await sendToAPIStreaming(content);
  } else {
    await sendToAPI(content);
  }
}

// Poll session for tool call updates
// Uses IPC proxy to bypass Chromium network service issues
async function pollSessionForUpdates() {
  if (!sessionId) return;

  try {
    const response = await proxyFetch(`/session/${sessionId}`, { method: 'GET' });
    if (!response.ok) return;

    const data = response.data;

    // Check for new activity
    if (data.summary) {
      const activity = [];
      if (data.summary.files > 0) {
        activity.push(`${data.summary.files} file${data.summary.files !== 1 ? 's' : ''}`);
      }
      if (data.summary.additions > 0) {
        activity.push(`${data.summary.additions} added`);
      }
      if (data.summary.deletions > 0) {
        activity.push(`${data.summary.deletions} removed`);
      }
      if (activity.length > 0) {
        updateTypingIndicator(`Working: ${activity.join(', ')}`);
      }
    }
  } catch (err) {
    // Ignore polling errors
  }
}

// Start polling for updates
function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(pollSessionForUpdates, 1000);
}

// Stop polling
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Send to OpenCode API with tool status tracking
// @param {string} content - The user message content
// @param {string} [systemPrompt] - Optional system prompt (only used on first message)
// @param {boolean} [rethrowOnError=false] - If true, re-throw errors instead of just displaying them
async function sendToAPI(content, systemPrompt = null, rethrowOnError = false) {
  if (!sessionId) {
    const error = new Error('No active session');
    showError(error.message);
    if (rethrowOnError) throw error;
    return;
  }

  isWaitingForResponse = true;
  sendBtn.disabled = true;
  showTypingIndicator();
  startRequestTimer();

  // Track this message content so we can filter it from SSE
  userSentMessageContents.add(content.trim());

  // Reset SSE message tracking for this request
  sseMessageAddedForCurrentRequest = false;
  currentStreamingMessageId = null;

  const toolsCalled = [];
  const processedReasoningIds = new Set();
  let lastMessageId = null;

  try {
    // Start polling for intermediate tool calls and reasoning
    const pollForParts = setInterval(async () => {
      try {
        const { tools: toolParts, reasoning: reasoningParts } = await fetchSessionParts(lastMessageId);

        if (toolParts.length > 0) {
          // Count running tools, excluding answered question tools
          const runningToolCount = toolParts.filter(part => {
            // Answered question tools are not "running"
            if (isQuestionTool(part) && answeredQuestions.has(part.callID)) {
              return false;
            }
            // Completed tools are not "running"
            if (part.state?.status === 'completed') {
              return false;
            }
            return true;
          }).length;

          // Only update typing indicator if there are running tools
          // Don't remove it here - let the main API response handler do that
          if (runningToolCount > 0) {
            updateTypingIndicator(`Running ${runningToolCount} tool(s)`);
          }

          // Update tool display
          toolParts.forEach(part => {
            // Check if this is a question tool that needs user interaction
            // Question tools need interactive UI when they have input but no output yet
            if (isQuestionTool(part) && part.state?.input && !part.state?.output) {
              // Skip if already answered or pending
              if (!pendingQuestions.has(part.callID) && !answeredQuestions.has(part.callID)) {
                showQuestionUI(part.callID, part.state.input);
              }
              return;
            }

            if (!toolsCalled.find(t => t.callID === part.callID)) {
              const status = part.state?.status || 'running';
              const input = part.state?.input;
              const output = part.state?.output;
              addToolStatus(part.tool, status, input, output, part.callID);
              toolsCalled.push({
                callID: part.callID,
                name: part.tool,
                status,
                title: part.state?.title || part.tool
              });
            } else {
              // Tool already exists - update its status if changed
              const existing = toolsCalled.find(t => t.callID === part.callID);
              const newStatus = part.state?.status || 'running';
              if (existing && existing.status !== newStatus) {
                updateToolStatus(part.callID, newStatus);
                existing.status = newStatus;
              }
            }
          });
        }

        // Process intermediate reasoning parts
        if (reasoningParts.length > 0) {
          console.log('[Sidecar] Polling found reasoning parts:', reasoningParts.length, reasoningParts);
        }
        reasoningParts.forEach(part => {
          const reasoningId = part.id || `${part._messageID}-${(part.text || '').slice(0, 30)}`;
          console.log('[Sidecar] Processing reasoning part:', { id: reasoningId, text: part.text?.slice(0, 100), type: part.type });
          if (!processedReasoningIds.has(reasoningId)) {
            processedReasoningIds.add(reasoningId);
            const reasoningText = part.text || part.content || '';
            // Skip encrypted/redacted reasoning from OpenRouter (provides no useful content)
            if (reasoningText && reasoningText !== '[REDACTED]') {
              console.log('[Sidecar] Adding reasoning to UI:', reasoningText.slice(0, 100));
              addReasoningToGroup(reasoningText);
            } else {
              console.log('[Sidecar] Skipping reasoning (empty or REDACTED):', reasoningText);
            }
          } else {
            console.log('[Sidecar] Reasoning already processed:', reasoningId);
          }
        });
      } catch (err) {
        // Ignore polling errors
      }
    }, 1000);

    // Build request body with proper system/user separation
    // - system: instruction-level context (only on first message)
    // - parts: the actual user message
    // - model: Format as {providerID, modelID} for OpenCode API
    const modelToUse = currentModel || config.model;
    const modelForAPI = typeof window.ModelPicker !== 'undefined'
      ? window.ModelPicker.formatModelForAPI(modelToUse)
      : { providerID: 'openrouter', modelID: modelToUse.replace('openrouter/', '') };

    const requestBody = {
      model: modelForAPI,
      parts: [{ type: 'text', text: content }]
    };

    // Add agent (mode) if not using the default Build mode
    // Valid agents are: build (default), plan, explore, general
    // OpenCode API expects lowercase agent names
    // We only send agent parameter for non-default modes
    const modeToUse = currentMode || 'build';
    if (modeToUse.toLowerCase() !== 'build') {
      requestBody.agent = modeToUse.toLowerCase();
    }

    // Add system prompt if provided (typically only for the first message)
    if (systemPrompt) {
      requestBody.system = systemPrompt;
      console.log('[Sidecar] Sending with system prompt:', systemPrompt.slice(0, 100) + '...');
    }

    // Add reasoning/thinking configuration
    // Always send reasoning parameter to enable thinking blocks (unless 'none')
    const thinkingToUse = currentThinking || 'medium';
    if (typeof window.ThinkingPicker !== 'undefined') {
      const reasoning = window.ThinkingPicker.formatThinkingForAPI(thinkingToUse);
      if (reasoning) {
        requestBody.reasoning = reasoning;
        console.log('[Sidecar] Sending with reasoning:', reasoning);
      }
    }

    // Log which model, mode, and thinking are being used for this message
    console.log(`[Sidecar] ▶ Sending message with model: ${modelToUse}, mode: ${modeToUse}, thinking: ${thinkingToUse}`);
    console.log('[Sidecar] Full request body:', JSON.stringify(requestBody, null, 2));

    // Use IPC proxy to bypass Chromium network service issues
    const response = await proxyFetch(`/session/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });

    clearInterval(pollForParts);

    if (!response.ok) {
      await reportError('api', `API returned error status: ${response.status}`, {
        endpoint: '/session/message',
        model: modelToUse
      });
      throw new Error(`API error: ${response.status}`);
    }

    removeTypingIndicator();

    // Response data is already parsed by proxy
    const data = response.data;

    if (!data) {
      await reportError('api', 'API returned no data', {
        endpoint: '/session/message',
        model: modelToUse
      });
      throw new Error('Server returned empty response');
    }

    // Log model info from response (OpenCode uses modelID, not model)
    const responseModel = data.info?.modelID || data.modelID || 'unknown';
    console.log(`[Sidecar] ◀ Response received from model: ${responseModel}`);
    console.log('[Sidecar] API response:', data);

    // Track message ID for future polling
    if (data.info?.id) {
      lastMessageId = data.info.id;
    }

    // Check if tools were used (finish === 'tool-calls' or we found tool parts)
    const usedTools = data.info?.finish === 'tool-calls' || toolsCalled.length > 0;

    // Process all parts from the response
    let assistantMessage = '';
    if (data.parts && Array.isArray(data.parts)) {
      console.log('[Sidecar] Response parts:', JSON.stringify(data.parts.map(p => ({ type: p.type, hasText: !!p.text, keys: Object.keys(p) })), null, 2));
      // Log full data for debugging
      console.log('[Sidecar] Full response data:', JSON.stringify(data, null, 2).slice(0, 2000));
      for (const part of data.parts) {
        if (part.type === 'text' && part.text) {
          // Filter out [REDACTED] content
          const cleanText = part.text.replace(/\[REDACTED\]/gi, '').trim();
          if (cleanText) {
            assistantMessage += cleanText;
          }
        } else if (part.type === 'tool') {
          // Check if this is a question tool that needs user interaction
          // Question tools need interactive UI when they have input but no output yet
          if (isQuestionTool(part) && part.state?.input && !part.state?.output) {
            // Skip if already answered
            if (!answeredQuestions.has(part.callID)) {
              showQuestionUI(part.callID, part.state.input);
            }
            // Don't add to toolsCalled - question tools need special handling
            continue;
          }

          // Check if this is a todo tool - display special UI
          if (isTodoTool(part)) {
            processTodoTool(part);
            // Still track it but with special handling
            if (!toolsCalled.find(t => t.callID === part.callID)) {
              toolsCalled.push({
                callID: part.callID,
                name: part.tool,
                status: part.state?.status || 'completed',
                title: 'Task Progress'
              });
            }
            continue;
          }

          // Display tool call from response
          const status = part.state?.status || 'completed';
          const input = part.state?.input;
          const output = part.state?.output;
          const title = part.state?.title || part.tool;

          // Only add if not already tracked
          if (!toolsCalled.find(t => t.callID === part.callID)) {
            addToolStatus(part.tool, status, input, output, part.callID);
            toolsCalled.push({
              callID: part.callID,
              name: part.tool,
              status,
              title
            });
          } else {
            // Tool already exists - update its status if changed
            const existing = toolsCalled.find(t => t.callID === part.callID);
            if (existing && existing.status !== status) {
              updateToolStatus(part.callID, status);
              existing.status = status;
            }
          }
        } else if (part.type === 'reasoning' || part.type === 'thinking') {
          // Deduplicate reasoning (may have been processed during polling)
          const reasoningId = part.id || `${data.info?.id}-${(part.text || '').slice(0, 30)}`;
          if (!processedReasoningIds.has(reasoningId)) {
            processedReasoningIds.add(reasoningId);
            const reasoningText = part.text || part.content || '';
            // Skip encrypted/redacted reasoning from OpenRouter (provides no useful content)
            if (reasoningText && reasoningText !== '[REDACTED]') {
              console.log('[Sidecar] Adding reasoning with text length:', reasoningText.length);
              addReasoningToGroup(reasoningText);
            }
          }
        }
      }
    }

    // Check for errors
    if (data.info && data.info.error) {
      throw new Error(data.info.error.message || 'API error');
    }

    // If tools were used but no text in response, fetch the complete message history
    if (usedTools && !assistantMessage) {
      showTypingIndicator('Processing tool results');
      const { tools: fullToolInfo, reasoning: fullReasoningInfo } = await fetchSessionParts();

      // Update tool displays with final status
      fullToolInfo.forEach(part => {
        // Skip question tools - they have special handling
        // Question tools need interactive UI when they have input but no output yet
        if (isQuestionTool(part) && part.state?.input && !part.state?.output) {
          // Skip if already answered
          if (!answeredQuestions.has(part.callID)) {
            showQuestionUI(part.callID, part.state.input);
          }
          return;
        }

        const existing = toolsCalled.find(t => t.callID === part.callID);
        const newStatus = part.state?.status || 'completed';
        if (existing && existing.status !== newStatus) {
          // Update existing tool status in DOM and tracking
          updateToolStatus(part.callID, newStatus);
          existing.status = newStatus;
        } else if (!existing) {
          addToolStatus(part.tool, newStatus, part.state?.input, part.state?.output, part.callID);
          toolsCalled.push({
            callID: part.callID,
            name: part.tool,
            status: newStatus,
            title: part.state?.title || part.tool
          });
        }
      });

      // Process any remaining reasoning parts
      fullReasoningInfo.forEach(part => {
        const reasoningId = part.id || `${part._messageID}-${(part.text || '').slice(0, 30)}`;
        if (!processedReasoningIds.has(reasoningId)) {
          processedReasoningIds.add(reasoningId);
          const reasoningText = part.text || part.content || '';
          // Skip encrypted/redacted reasoning from OpenRouter (provides no useful content)
          if (reasoningText && reasoningText !== '[REDACTED]') {
            addReasoningToGroup(reasoningText);
          }
        }
      });

      // If still no message, wait for final response
      if (!assistantMessage) {
        await new Promise(r => setTimeout(r, 2000));
        const finalResponse = await fetchLatestAssistantMessage();
        if (finalResponse) {
          assistantMessage = finalResponse;
        }
      }

      removeTypingIndicator();
    }

    // Finalize the tool group now that we have all results
    if (toolsCalled.length > 0) {
      finalizeToolGroup();
    }

    // Display the assistant's response
    // Skip if SSE already added the message
    if (assistantMessage && !sseMessageAddedForCurrentRequest) {
      addMessage('assistant', assistantMessage);
    } else if (sseMessageAddedForCurrentRequest) {
      console.log('[Sidecar] SSE already displayed this message, skipping duplicate');
      // Finalize the SSE streaming message if it's still marked as streaming
      if (streamingMessageEl) {
        streamingMessageEl.classList.remove('streaming');
        streamingMessageEl = null;
      }
    } else if (!toolsCalled.length) {
      console.log('[Sidecar] No text content in response:', data);
    }

    // Reset SSE message flag for next request
    sseMessageAddedForCurrentRequest = false;

  } catch (error) {
    console.error('[Sidecar] API error:', error);
    removeTypingIndicator();
    finalizeToolGroup(); // Close any open tool group on error
    showError(`Error: ${error.message}`);
    if (rethrowOnError) throw error; // Allow retry logic to catch
  } finally {
    console.log('[Sidecar] sendToAPI completed (finally block)');
    isWaitingForResponse = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

// Fetch tool calls and reasoning parts from session messages
// Uses IPC proxy to bypass Chromium network service issues
async function fetchSessionParts(afterMessageId = null) {
  try {
    const response = await proxyFetch(`/session/${sessionId}/message`, { method: 'GET' });
    if (!response.ok) return { tools: [], reasoning: [] };

    const messages = response.data || [];
    const tools = [];
    const reasoning = [];

    // Extract tool and reasoning parts from assistant messages
    for (const msg of messages) {
      if (msg.info?.role === 'assistant' && msg.parts) {
        // Log all part types for debugging
        const partTypes = msg.parts.map(p => p.type);
        if (partTypes.length > 0) {
          console.log('[Sidecar] fetchSessionParts - message parts types:', partTypes);
        }
        for (const part of msg.parts) {
          if (part.type === 'tool') {
            tools.push(part);
          } else if (part.type === 'reasoning' || part.type === 'thinking') {
            // Include part ID and message ID to avoid duplicates
            console.log('[Sidecar] Found reasoning/thinking part:', { type: part.type, hasText: !!part.text, textLength: part.text?.length });
            reasoning.push({ ...part, _messageID: msg.info?.id });
          }
        }
      }
    }

    return { tools, reasoning };
  } catch (err) {
    console.error('[Sidecar] Error fetching session parts:', err);
    return { tools: [], reasoning: [] };
  }
}

// Fetch the latest assistant message from session
// Uses IPC proxy to bypass Chromium network service issues
async function fetchLatestAssistantMessage() {
  try {
    const response = await proxyFetch(`/session/${sessionId}/message`, { method: 'GET' });
    if (!response.ok) return null;

    const messages = response.data || [];

    // Find the latest assistant message with text
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.info?.role === 'assistant' && msg.parts) {
        // Look for text parts
        for (const part of msg.parts) {
          if (part.type === 'text' && part.text) {
            return part.text;
          }
        }
      }
    }
  } catch (err) {
    console.error('[Sidecar] Error fetching latest message:', err);
  }
  return null;
}

// ============================================
// Keyboard Shortcuts
// ============================================

// Initialize global keyboard shortcuts
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl+K - Focus input field
    if (cmdOrCtrl && e.key === 'k') {
      e.preventDefault();
      messageInput.focus();
      return;
    }

    // Cmd/Ctrl+Shift+C - Copy last assistant message
    if (cmdOrCtrl && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      copyLastAssistantMessage();
      return;
    }

    // Escape - Close any open dropdown
    if (e.key === 'Escape') {
      const dropdowns = [
        'model-selector-dropdown',
        'thinking-selector-dropdown',
        'mode-selector-dropdown',
        'mcp-selector-dropdown'
      ];

      let closedAny = false;
      dropdowns.forEach(id => {
        const dropdown = document.getElementById(id);
        if (dropdown && dropdown.classList.contains('visible')) {
          dropdown.classList.remove('visible');
          closedAny = true;
        }
      });

      // If a dropdown was closed, prevent other escape handling
      if (closedAny) {
        e.preventDefault();
        return;
      }
    }
  });
}

// Copy the last assistant message to clipboard
async function copyLastAssistantMessage() {
  const messages = messagesContainer.querySelectorAll('.message.assistant');
  if (messages.length === 0) return;

  const lastMessage = messages[messages.length - 1];
  const rawContent = lastMessage.dataset.rawContent;

  if (rawContent) {
    try {
      await navigator.clipboard.writeText(rawContent);

      // Show visual feedback on the copy button if it exists
      const copyBtn = lastMessage.querySelector('.message-copy-btn');
      if (copyBtn) {
        copyBtn.classList.add('copied');
        let tooltip = copyBtn.querySelector('.copy-tooltip');
        if (!tooltip) {
          tooltip = document.createElement('span');
          tooltip.className = 'copy-tooltip';
          tooltip.textContent = 'Copied!';
          copyBtn.appendChild(tooltip);
        }
        tooltip.classList.add('visible');

        setTimeout(() => {
          copyBtn.classList.remove('copied');
          tooltip.classList.remove('visible');
        }, 1500);
      }
    } catch (err) {
      console.error('[Sidecar] Failed to copy to clipboard:', err);
    }
  }
}

// Handle FOLD button click
async function handleFold() {
  foldBtn.disabled = true;
  foldBtn.textContent = 'Folding...';

  // Request summary from the model
  const summaryPrompt = `Generate a concise handoff summary of our conversation. Format as:

## Sidecar Results

**Task:** [What was requested]
**Findings:** [Key discoveries]
**Recommendations:** [Suggested actions]
**Files:** [Any files mentioned]

Be concise but complete enough to act on immediately.`;

  addMessage('system', 'Generating summary...');
  await sendToAPI(summaryPrompt);

  // Wait a moment for the response
  await new Promise(r => setTimeout(r, 1000));

  // Trigger Electron's fold handler
  if (window.electronAPI && window.electronAPI.fold) {
    window.electronAPI.fold();
  } else {
    console.error('[Sidecar] electronAPI.fold not available');
    foldBtn.textContent = 'FOLD';
    foldBtn.disabled = false;
  }
}

// ============================================
// Model Picker Functions
// ============================================

// Initialize the model selector UI
async function initModelSelector() {
  // Initialize ModelRegistry for dynamic model data
  if (typeof window.ModelRegistry !== 'undefined') {
    try {
      await window.ModelRegistry.instance.fetchModels();
    } catch (e) {
      console.warn('[Sidecar] Failed to fetch models from API, using fallback:', e.message);
    }
  }

  // Initialize state manager from model-picker.js
  if (typeof window.ModelPicker !== 'undefined') {
    modelPickerState = new window.ModelPicker.ModelPickerState();

    // Listen for model changes
    modelPickerState.onChange(({ previousModel, currentModel: newModel }) => {
      // Update displays
      updateModelDisplay();

      // Update thinking picker for new model's supported levels
      updateThinkingForModel(newModel);

      // Show system message about model switch
      if (previousModel) {
        const modelInfo = window.ModelPicker.findModelById(newModel);
        const modelName = modelInfo ? modelInfo.name : window.ModelPicker.extractModelName(newModel);
        addModelSwitchNotice(`Model switched to ${modelName}`);
      }
    });
  }

  // Set initial model from config
  if (config && config.model) {
    currentModel = config.model;
    if (modelPickerState) {
      modelPickerState.setCurrentModel(config.model);
    }
  }

  // Populate dropdown
  populateModelDropdown();

  // Update display
  updateModelDisplay();

  // Initialize thinking picker for current model
  if (currentModel) {
    updateThinkingForModel(currentModel);
  }

  // Set up event listeners
  const selectorDisplay = document.getElementById('model-selector-display');
  if (selectorDisplay) {
    selectorDisplay.addEventListener('click', toggleModelDropdown);
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const selector = document.getElementById('model-selector');
    if (selector && !selector.contains(e.target)) {
      closeModelDropdown();
    }
  });
}

// Update thinking picker when model changes
function updateThinkingForModel(modelId) {
  if (typeof window.ThinkingPicker === 'undefined') return;

  // Check if model supports reasoning
  const supportsReasoning = window.ModelPicker?.supportsReasoning(modelId) ?? true;
  const thinkingSelector = document.getElementById('thinking-selector');

  if (!supportsReasoning) {
    // Hide thinking selector for models that don't support it
    if (thinkingSelector) {
      thinkingSelector.style.display = 'none';
    }
    return;
  }

  // Show thinking selector
  if (thinkingSelector) {
    thinkingSelector.style.display = '';
  }

  // Update thinkingPickerState with new model
  if (thinkingPickerState && thinkingPickerState.setModel) {
    thinkingPickerState.setModel(modelId);
  }

  // Re-populate thinking dropdown with model-specific levels
  populateThinkingDropdown();
}

// State for expanded provider sections
let expandedProviders = new Set();

// Populate the model dropdown with starred models first, then grouped providers
function populateModelDropdown() {
  const dropdown = document.getElementById('model-selector-dropdown');
  if (!dropdown || typeof window.ModelPicker === 'undefined') return;

  dropdown.innerHTML = '';

  // Get starred/favorite models
  const starredModels = window.ModelPicker.getStarredModels();

  // Create starred models section (shown directly, no header)
  if (starredModels && starredModels.length > 0) {
    starredModels.forEach(model => {
      const option = createModelOption(model, true);
      dropdown.appendChild(option);
    });

    // Add separator before "More models"
    const separator = document.createElement('div');
    separator.className = 'model-dropdown-separator';
    dropdown.appendChild(separator);
  }

  // Add "More models" expandable section
  const moreLink = document.createElement('div');
  moreLink.className = 'model-more-link';
  moreLink.dataset.expanded = 'false';

  const moreLinkText = document.createElement('span');
  moreLinkText.textContent = 'More models';
  moreLink.appendChild(moreLinkText);

  // Chevron arrow (rotates when expanded)
  const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevronSvg.setAttribute('class', 'more-chevron');
  chevronSvg.setAttribute('width', '16');
  chevronSvg.setAttribute('height', '16');
  chevronSvg.setAttribute('viewBox', '0 0 24 24');
  chevronSvg.setAttribute('fill', 'none');
  chevronSvg.setAttribute('stroke', 'currentColor');
  chevronSvg.setAttribute('stroke-width', '2');
  const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  chevronPath.setAttribute('d', 'M6 9l6 6 6-6');
  chevronSvg.appendChild(chevronPath);
  moreLink.appendChild(chevronSvg);

  // Container for grouped models (hidden by default)
  const moreContainer = document.createElement('div');
  moreContainer.className = 'model-more-container';
  moreContainer.style.display = 'none';

  moreLink.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = moreLink.dataset.expanded === 'true';
    moreLink.dataset.expanded = isExpanded ? 'false' : 'true';
    moreContainer.style.display = isExpanded ? 'none' : 'block';
    chevronSvg.style.transform = isExpanded ? '' : 'rotate(180deg)';
  });

  dropdown.appendChild(moreLink);
  dropdown.appendChild(moreContainer);

  // Populate grouped models by provider
  populateGroupedModels(moreContainer);
}

// Populate models grouped by provider
function populateGroupedModels(container) {
  const groupedModels = window.ModelPicker.getGroupedModels(true); // Exclude starred

  // Provider display order
  const providerOrder = ['google', 'openai', 'anthropic', 'x-ai', 'deepseek', 'meta', 'mistralai', 'qwen', 'cohere', 'perplexity'];

  // Sort providers by preferred order
  const sortedProviders = Object.keys(groupedModels).sort((a, b) => {
    const aIdx = providerOrder.indexOf(a);
    const bIdx = providerOrder.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  sortedProviders.forEach(providerKey => {
    const group = groupedModels[providerKey];
    if (!group || !group.models || group.models.length === 0) return;

    // Create provider header (expandable)
    const providerHeader = document.createElement('div');
    providerHeader.className = 'model-provider-header';
    providerHeader.dataset.provider = providerKey;
    providerHeader.dataset.expanded = expandedProviders.has(providerKey) ? 'true' : 'false';

    const providerName = document.createElement('span');
    providerName.className = 'provider-name';
    providerName.textContent = group.name || window.ModelPicker.getCategoryDisplayName(providerKey);
    providerHeader.appendChild(providerName);

    const providerCount = document.createElement('span');
    providerCount.className = 'provider-count';
    providerCount.textContent = `(${group.models.length})`;
    providerHeader.appendChild(providerCount);

    // Chevron for expand/collapse
    const headerChevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    headerChevron.setAttribute('class', 'provider-chevron');
    headerChevron.setAttribute('width', '12');
    headerChevron.setAttribute('height', '12');
    headerChevron.setAttribute('viewBox', '0 0 24 24');
    headerChevron.setAttribute('fill', 'none');
    headerChevron.setAttribute('stroke', 'currentColor');
    headerChevron.setAttribute('stroke-width', '2');
    const headerChevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    headerChevronPath.setAttribute('d', 'M6 9l6 6 6-6');
    headerChevron.appendChild(headerChevronPath);
    if (expandedProviders.has(providerKey)) {
      headerChevron.style.transform = 'rotate(180deg)';
    }
    providerHeader.appendChild(headerChevron);

    // Container for provider's models
    const providerModels = document.createElement('div');
    providerModels.className = 'provider-models';
    providerModels.style.display = expandedProviders.has(providerKey) ? 'block' : 'none';

    // Add models for this provider
    group.models.forEach(model => {
      const option = createModelOption(model, false);
      providerModels.appendChild(option);
    });

    // Toggle expand/collapse on header click
    providerHeader.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = providerHeader.dataset.expanded === 'true';
      providerHeader.dataset.expanded = isExpanded ? 'false' : 'true';
      providerModels.style.display = isExpanded ? 'none' : 'block';
      headerChevron.style.transform = isExpanded ? '' : 'rotate(180deg)';

      // Remember expansion state
      if (isExpanded) {
        expandedProviders.delete(providerKey);
      } else {
        expandedProviders.add(providerKey);
      }
    });

    container.appendChild(providerHeader);
    container.appendChild(providerModels);
  });
}

// Create a model option element
function createModelOption(model, _showStar = false) {
  const option = document.createElement('div');
  option.className = 'model-option';
  option.dataset.modelId = model.id;

  // Check if this is the current model
  if (model.id === currentModel) {
    option.classList.add('selected');
  }

  // Always show star button for favoriting
  const isStarred = window.ModelPicker && window.ModelPicker.isStarred(model.id);
  const starBtn = document.createElement('button');
  starBtn.className = 'model-star-btn' + (isStarred ? ' starred' : '');
  starBtn.title = isStarred ? 'Remove from favorites' : 'Add to favorites';
  // Filled star for starred, outline for unstarred
  starBtn.innerHTML = isStarred
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>`;
  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.ModelPicker) {
      window.ModelPicker.toggleStar(model.id);
      populateModelDropdown(); // Refresh
    }
  });
  option.appendChild(starBtn);

  // Content wrapper
  const content = document.createElement('div');
  content.className = 'model-option-content';

  // Name row with provider badge
  const nameRow = document.createElement('div');
  nameRow.className = 'model-name-row';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'model-name-display';
  nameSpan.textContent = model.name;
  nameRow.appendChild(nameSpan);

  // Cost badge if available
  if (model.costString) {
    const costBadge = document.createElement('span');
    costBadge.className = 'model-cost-badge';
    costBadge.textContent = model.costString;
    costBadge.title = 'Cost per 1M tokens';
    nameRow.appendChild(costBadge);
  }

  content.appendChild(nameRow);

  // Description with context size
  const descSpan = document.createElement('div');
  descSpan.className = 'model-description';

  // Build description: context + description text
  const descParts = [];
  if (model.contextSize) {
    descParts.push(model.contextSize + ' context');
  }
  if (model.description) {
    descParts.push(model.description);
  }
  descSpan.textContent = descParts.join(' · ') || 'No description';

  // Show thinking support indicator
  if (model.supportsReasoning === false) {
    descSpan.textContent += ' · No reasoning';
  }

  content.appendChild(descSpan);
  option.appendChild(content);

  // Checkmark SVG (shows when selected)
  const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  checkSvg.setAttribute('class', 'model-option-check');
  checkSvg.setAttribute('width', '20');
  checkSvg.setAttribute('height', '20');
  checkSvg.setAttribute('viewBox', '0 0 24 24');
  checkSvg.setAttribute('fill', 'none');
  checkSvg.setAttribute('stroke', 'currentColor');
  checkSvg.setAttribute('stroke-width', '2.5');
  const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  checkPath.setAttribute('d', 'M5 12l5 5L20 7');
  checkSvg.appendChild(checkPath);
  option.appendChild(checkSvg);

  // Click to select model
  option.addEventListener('click', (e) => {
    e.stopPropagation();
    selectModel(model.id);
  });

  return option;
}

// Toggle dropdown visibility
function toggleModelDropdown() {
  const dropdown = document.getElementById('model-selector-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('visible');
  }
}

// Close the dropdown
function closeModelDropdown() {
  const dropdown = document.getElementById('model-selector-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
  }
}

// Select a model
function selectModel(modelId) {
  // Update local state
  currentModel = modelId;

  // Update state manager
  if (modelPickerState) {
    modelPickerState.setCurrentModel(modelId);
  }

  // Update dropdown selection
  const dropdown = document.getElementById('model-selector-dropdown');
  if (dropdown) {
    dropdown.querySelectorAll('.model-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.modelId === modelId);
    });
  }

  // Close dropdown
  closeModelDropdown();

  // Update display
  updateModelDisplay();
}

// Update the model display in selector and title bar
function updateModelDisplay() {
  const modelToShow = currentModel || (config && config.model);
  if (!modelToShow) return;

  // Get model info
  let shortName;
  if (typeof window.ModelPicker !== 'undefined') {
    const modelInfo = window.ModelPicker.findModelById(modelToShow);
    shortName = modelInfo ? modelInfo.name : window.ModelPicker.extractModelName(modelToShow);
  } else {
    // Fallback: extract from path
    const parts = modelToShow.split('/');
    shortName = parts[parts.length - 1];
  }

  // Update button text display
  const modelDisplayName = document.querySelector('.model-display-name');
  if (modelDisplayName) {
    modelDisplayName.textContent = shortName;
  }

  // Update button tooltip
  const selectorBtn = document.getElementById('model-selector-display');
  if (selectorBtn) {
    selectorBtn.title = `Model: ${shortName}`;
  }

  // Update title bar
  if (modelNameEl) {
    modelNameEl.textContent = shortName;
  }
}

// Add a system message for model switch notifications
function addModelSwitchNotice(text) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message system model-switch-notice';

  // Create SVG icon using DOM
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '14');
  iconSvg.setAttribute('height', '14');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');

  // Simple switch icon path
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M16 3h5v5M4 20L21 3M21 16v5h-5M4 4l17 17');
  iconSvg.appendChild(path);

  const textSpan = document.createElement('span');
  textSpan.textContent = text;

  messageEl.appendChild(iconSvg);
  messageEl.appendChild(textSpan);
  messagesContainer.appendChild(messageEl);
  scrollToBottom();
}

// ============================================
// Mode Picker Functions
// ============================================

// Initialize the mode selector UI (cycle on click)
function initModeSelector() {
  // Initialize state manager from mode-picker.js
  if (typeof window.ModePicker !== 'undefined') {
    modePickerState = new window.ModePicker.ModePickerState();

    // Listen for mode changes
    modePickerState.onChange(({ previousMode, currentMode: newMode }) => {
      // Update displays
      updateModeDisplay();

      // Show system message about mode switch
      if (previousMode) {
        const modeInfo = window.ModePicker.findModeById(newMode);
        const modeName = modeInfo ? modeInfo.name : newMode;
        addModeSwitchNotice(`Switched to ${modeName}`);
      }
    });
  }

  // Set initial mode from config (default to 'build')
  // OpenCode API expects lowercase agent names
  if (config && config.agent) {
    // Normalize 'code' to 'build' for backward compatibility
    currentMode = config.agent === 'code' ? 'build' : config.agent.toLowerCase();
  } else {
    currentMode = 'build';
  }

  if (modePickerState) {
    modePickerState.setCurrentMode(currentMode);
  }

  // Update display
  updateModeDisplay();

  // Set up click handler to cycle through modes
  const selectorBtn = document.getElementById('mode-selector-display');
  if (selectorBtn) {
    selectorBtn.addEventListener('click', cycleMode);
  }
}

// Cycle through modes: Build → Plan → Build
function cycleMode() {
  if (typeof window.ModePicker === 'undefined') return;

  const modes = window.ModePicker.AVAILABLE_MODES.map(m => m.id);
  // Normalize currentMode to find it in the list (handle legacy 'code' value)
  const normalizedCurrent = currentMode === 'code' ? 'Build' : currentMode;
  const currentIndex = modes.findIndex(m => m.toLowerCase() === normalizedCurrent.toLowerCase());
  const nextIndex = (currentIndex + 1) % modes.length;
  const nextMode = modes[nextIndex];

  selectMode(nextMode);
}

// Populate the mode dropdown with options
function populateModeDropdown() {
  const dropdown = document.getElementById('mode-selector-dropdown');
  if (!dropdown || typeof window.ModePicker === 'undefined') return;

  dropdown.innerHTML = '';

  window.ModePicker.AVAILABLE_MODES.forEach(mode => {
    const option = document.createElement('div');
    option.className = 'mode-option';
    option.dataset.modeId = mode.id;

    if (mode.id === currentMode) {
      option.classList.add('selected');
    }

    // Content wrapper
    const content = document.createElement('div');
    content.className = 'mode-option-content';

    const header = document.createElement('div');
    header.className = 'mode-option-header';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'mode-icon';
    iconSpan.innerHTML = window.ModePicker.getModeIcon(mode.id);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'mode-name';
    nameSpan.textContent = mode.name;

    header.appendChild(iconSpan);
    header.appendChild(nameSpan);
    content.appendChild(header);

    const descSpan = document.createElement('div');
    descSpan.className = 'mode-description';
    descSpan.textContent = mode.description;
    content.appendChild(descSpan);

    option.appendChild(content);

    // Checkmark SVG
    const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    checkSvg.setAttribute('class', 'mode-option-check');
    checkSvg.setAttribute('width', '20');
    checkSvg.setAttribute('height', '20');
    checkSvg.setAttribute('viewBox', '0 0 24 24');
    checkSvg.setAttribute('fill', 'none');
    checkSvg.setAttribute('stroke', 'currentColor');
    checkSvg.setAttribute('stroke-width', '3');
    const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    checkPath.setAttribute('d', 'M5 12l5 5L20 7');
    checkSvg.appendChild(checkPath);
    option.appendChild(checkSvg);

    option.addEventListener('click', (e) => {
      e.stopPropagation();
      selectMode(mode.id);
    });

    dropdown.appendChild(option);
  });
}

// Toggle mode dropdown visibility
function toggleModeDropdown() {
  const dropdown = document.getElementById('mode-selector-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('visible');
  }
}

// Close the mode dropdown
function closeModeDropdown() {
  const dropdown = document.getElementById('mode-selector-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
  }
}

// Select a mode
async function selectMode(modeId) {
  const previousMode = currentMode;

  // Update local state
  currentMode = modeId;

  // Update state manager
  if (modePickerState) {
    modePickerState.setCurrentMode(modeId);
  }

  // Update dropdown selection
  const dropdown = document.getElementById('mode-selector-dropdown');
  if (dropdown) {
    dropdown.querySelectorAll('.mode-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.modeId === modeId);
    });
  }

  // Close dropdown
  closeModeDropdown();

  // Update display
  updateModeDisplay();

  // If mode actually changed and we have a session, send mode change instruction to the model
  if (previousMode && previousMode !== modeId && sessionId) {
    await sendModeChangeInstruction(modeId);
  }
}

// Send mode change instruction to update the model's understanding
async function sendModeChangeInstruction(newMode) {
  const modeInstructions = getModeInstructions(newMode);

  // Send as a system-level instruction via a user message
  // This tells the model about the new tool restrictions
  const modeChangeMessage = `[SYSTEM MODE CHANGE]

${modeInstructions}

Acknowledge this mode change briefly.`;

  try {
    // Show mode change being processed
    showTypingIndicator('Updating mode restrictions...');

    // Get model for API
    const modelToUse = currentModel || config.model;
    const modelForAPI = typeof window.ModelPicker !== 'undefined'
      ? window.ModelPicker.formatModelForAPI(modelToUse)
      : { providerID: 'openrouter', modelID: modelToUse.replace('openrouter/', '') };

    const requestBody = {
      model: modelForAPI,
      parts: [{ type: 'text', text: modeChangeMessage }]
    };

    // Include agent parameter (build is the default full-access mode)
    // OpenCode API expects lowercase agent names
    const normalizedNewMode = newMode === 'code' ? 'build' : newMode.toLowerCase();
    if (normalizedNewMode !== 'build') {
      requestBody.agent = normalizedNewMode;
    }

    // Use IPC proxy to bypass Chromium network service issues
    const response = await proxyFetch(`/session/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });

    removeTypingIndicator();

    if (response.ok) {
      const data = response.data;
      // Display the model's acknowledgment
      if (data && data.parts) {
        for (const part of data.parts) {
          if (part.type === 'text' && part.text) {
            addAssistantMessage(part.text);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error('[Sidecar] Failed to send mode change instruction:', err);
    removeTypingIndicator();
  }
}

// Get mode-specific instructions for the model
function getModeInstructions(mode) {
  const normalizedMode = mode?.toLowerCase() || 'build';
  if (normalizedMode === 'plan') {
    return `You are now in PLAN MODE.

CRITICAL RESTRICTION: You MUST NOT make any changes to files or execute commands that modify the system.

Tools you CAN use:
- read: Read file contents
- glob: Search for files by pattern
- grep: Search file contents
- list: List directory contents
- webfetch: Fetch web content for research
- question: Ask the user clarifying questions
- task: Create and manage planning tasks
- todowrite: Write to the task/todo list
- todoread: Read the task/todo list
- skill: Invoke informational skills

Tools you MUST NOT use (PROHIBITED):
- bash (no shell command execution)
- write (no file creation)
- edit (no file modification)
- patch (no file patching)

If asked to make changes, REFUSE and explain you are in plan mode. Provide recommendations instead.`;
  } else if (normalizedMode === 'ask') {
    return `You are now in ASK MODE.

In this mode, you should ASK FOR APPROVAL before taking any action that modifies files or runs commands.

Before using these tools, describe what you plan to do and ask for confirmation:
- bash: Execute shell commands
- write: Create or overwrite files
- edit: Modify existing files
- patch: Apply patches

You CAN use these tools without asking:
- read: Read file contents
- glob: Search for files
- grep: Search file contents
- list: List directory contents
- webfetch: Fetch web content
- question: Ask clarifying questions

Always explain your intent before executing changes.`;
  } else {
    return `You are now in CODE MODE with full tool access.

You CAN use all available tools:
- bash: Execute shell commands
- read: Read file contents
- write: Create or overwrite files
- edit: Modify existing files
- glob: Search for files
- grep: Search file contents
- webfetch: Fetch web content
- question: Ask clarifying questions
- task/todowrite/todoread: Manage tasks
- skill: Invoke skills

You may now execute changes, create files, and run commands as requested.`;
  }
}

// Update the mode display (button with icon and label)
function updateModeDisplay() {
  // Normalize 'code' to 'Build' and ensure we have a valid mode
  let modeToShow = currentMode || 'Build';
  if (modeToShow === 'code') modeToShow = 'Build';

  // Get mode info
  let modeName = modeToShow;
  let modeIcon = '';
  if (typeof window.ModePicker !== 'undefined') {
    const modeInfo = window.ModePicker.findModeById(modeToShow);
    modeName = modeInfo ? modeInfo.name : modeToShow;
    modeIcon = window.ModePicker.getModeIcon(modeToShow);
  }

  // Update icon
  const iconDisplay = document.querySelector('#mode-selector-display .mode-icon');
  if (iconDisplay && modeIcon) {
    iconDisplay.innerHTML = modeIcon;
  }

  // Update label
  const labelDisplay = document.querySelector('#mode-selector-display .mode-label');
  if (labelDisplay) {
    labelDisplay.textContent = modeName;
  }

  // Update button with data-mode attribute for CSS styling and tooltip
  const selectorBtn = document.getElementById('mode-selector-display');
  if (selectorBtn) {
    selectorBtn.dataset.mode = modeToShow;
    selectorBtn.title = `${modeName} (click to cycle)`;
  }
}

// Add a system message for mode switch notifications
function addModeSwitchNotice(text) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message system mode-switch-notice';

  // Create SVG icon using DOM (wrench for mode change)
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '14');
  iconSvg.setAttribute('height', '14');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z');
  iconSvg.appendChild(path);

  const textSpan = document.createElement('span');
  textSpan.textContent = text;

  messageEl.appendChild(iconSvg);
  messageEl.appendChild(textSpan);
  messagesContainer.appendChild(messageEl);
  scrollToBottom();
}

// ============================================
// Thinking Picker Functions
// ============================================

// Initialize the thinking selector UI
function initThinkingSelector() {
  // Initialize state manager from thinking-picker.js
  if (typeof window.ThinkingPicker !== 'undefined') {
    thinkingPickerState = new window.ThinkingPicker.ThinkingPickerState();

    // Listen for thinking changes
    thinkingPickerState.onChange(({ previousLevel, currentLevel: newLevel }) => {
      // Update displays
      updateThinkingDisplay();

      // Show system message about thinking switch
      if (previousLevel) {
        const levelInfo = window.ThinkingPicker.findLevelById(newLevel);
        const levelName = levelInfo ? levelInfo.name : newLevel;
        addThinkingSwitchNotice(`Thinking intensity set to ${levelName}`);
      }
    });
  }

  // Set initial thinking from config or default
  if (config && config.thinking) {
    currentThinking = config.thinking;
    if (thinkingPickerState) {
      thinkingPickerState.setCurrentLevel(config.thinking);
    }
  }

  // Populate dropdown
  populateThinkingDropdown();

  // Update display
  updateThinkingDisplay();

  // Set up event listeners
  const selectorDisplay = document.getElementById('thinking-selector-display');
  if (selectorDisplay) {
    selectorDisplay.addEventListener('click', toggleThinkingDropdown);
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const selector = document.getElementById('thinking-selector');
    if (selector && !selector.contains(e.target)) {
      closeThinkingDropdown();
    }
  });
}

// Populate the thinking dropdown with options (filtered for current model)
function populateThinkingDropdown() {
  const dropdown = document.getElementById('thinking-selector-dropdown');
  if (!dropdown || typeof window.ThinkingPicker === 'undefined') return;

  // Clear existing content safely
  while (dropdown.firstChild) {
    dropdown.removeChild(dropdown.firstChild);
  }

  // Add header
  const header = document.createElement('div');
  header.className = 'thinking-dropdown-header';
  header.textContent = 'Thinking Intensity';
  dropdown.appendChild(header);

  // Get thinking levels filtered for current model
  const levels = thinkingPickerState && thinkingPickerState.getAvailableLevels
    ? thinkingPickerState.getAvailableLevels()
    : window.ThinkingPicker.getLevelsForModel(currentModel);

  // Create level options
  levels.forEach(level => {
    const option = document.createElement('div');
    option.className = 'thinking-option';
    option.dataset.levelId = level.id;

    // Check if this is the current level
    if (level.id === currentThinking) {
      option.classList.add('selected');
    }

    // Content wrapper
    const content = document.createElement('div');
    content.className = 'thinking-option-content';

    const nameSpan = document.createElement('div');
    nameSpan.className = 'thinking-name';
    nameSpan.textContent = level.name;
    content.appendChild(nameSpan);

    const descSpan = document.createElement('div');
    descSpan.className = 'thinking-description';
    descSpan.textContent = level.description;
    content.appendChild(descSpan);

    option.appendChild(content);

    // Checkmark SVG
    const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    checkSvg.setAttribute('class', 'thinking-option-check');
    checkSvg.setAttribute('width', '16');
    checkSvg.setAttribute('height', '16');
    checkSvg.setAttribute('viewBox', '0 0 24 24');
    checkSvg.setAttribute('fill', 'none');
    checkSvg.setAttribute('stroke', 'currentColor');
    checkSvg.setAttribute('stroke-width', '2.5');
    const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    checkPath.setAttribute('d', 'M5 12l5 5L20 7');
    checkSvg.appendChild(checkPath);
    option.appendChild(checkSvg);

    option.addEventListener('click', (e) => {
      e.stopPropagation();
      selectThinking(level.id);
    });

    dropdown.appendChild(option);
  });
}

// Toggle thinking dropdown visibility
function toggleThinkingDropdown(e) {
  e.stopPropagation();
  const dropdown = document.getElementById('thinking-selector-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('visible');
  }
}

// Close thinking dropdown
function closeThinkingDropdown() {
  const dropdown = document.getElementById('thinking-selector-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
  }
}

// Select a thinking level
function selectThinking(levelId) {
  currentThinking = levelId;

  // Update state manager
  if (thinkingPickerState) {
    thinkingPickerState.setCurrentLevel(levelId);
  }

  // Update dropdown selection state
  const dropdown = document.getElementById('thinking-selector-dropdown');
  if (dropdown) {
    dropdown.querySelectorAll('.thinking-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.levelId === levelId);
    });
  }

  // Close dropdown
  closeThinkingDropdown();

  // Update display
  updateThinkingDisplay();
}

// Update the thinking display in selector
function updateThinkingDisplay() {
  const levelToShow = currentThinking || 'medium';

  // Get level info
  let shortName;
  if (typeof window.ThinkingPicker !== 'undefined') {
    const levelInfo = window.ThinkingPicker.findLevelById(levelToShow);
    shortName = levelInfo ? levelInfo.name : levelToShow;
  } else {
    shortName = levelToShow.charAt(0).toUpperCase() + levelToShow.slice(1);
  }

  // Update button text display
  const thinkingDisplayName = document.querySelector('.thinking-display-name');
  if (thinkingDisplayName) {
    thinkingDisplayName.textContent = shortName;
  }

  // Update button tooltip
  const selectorBtn = document.getElementById('thinking-selector-display');
  if (selectorBtn) {
    selectorBtn.title = `Thinking: ${shortName}`;
  }
}

// Add a system message for thinking switch notifications
function addThinkingSwitchNotice(text) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message system thinking-switch-notice';

  // Create SVG icon using DOM (clock for thinking)
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '14');
  iconSvg.setAttribute('height', '14');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  iconSvg.appendChild(circle);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 6v6l4 2');
  iconSvg.appendChild(path);

  const textSpan = document.createElement('span');
  textSpan.textContent = text;

  messageEl.appendChild(iconSvg);
  messageEl.appendChild(textSpan);
  messagesContainer.appendChild(messageEl);
  scrollToBottom();
}

// ============================================
// Autocomplete Functions
// ============================================

/**
 * Initialize the autocomplete manager for @ files and / commands
 */
function initAutocomplete() {
  // Check if autocomplete modules are loaded
  if (typeof window.Autocomplete === 'undefined') {
    console.warn('[Sidecar] Autocomplete module not loaded');
    return;
  }

  if (typeof window.FileAutocomplete === 'undefined') {
    console.warn('[Sidecar] FileAutocomplete module not loaded');
    return;
  }

  if (typeof window.CommandAutocomplete === 'undefined') {
    console.warn('[Sidecar] CommandAutocomplete module not loaded');
    return;
  }

  // Create file autocomplete provider (@ trigger)
  const fileProvider = window.FileAutocomplete.createFileAutocompleteProvider({
    apiBase: config.apiBase || 'http://localhost:4096',
    maxResults: 10,
    debounceMs: 200
  });

  // Create command autocomplete provider (/ trigger)
  const commandProvider = window.CommandAutocomplete.createCommandAutocompleteProvider({
    includeSubagents: true,
    debounceMs: 50
  });

  // Get the input wrapper element for positioning
  const inputWrapper = document.getElementById('input-wrapper');
  if (!inputWrapper) {
    console.warn('[Sidecar] Input wrapper not found for autocomplete');
    return;
  }

  // Create and initialize autocomplete manager
  autocompleteManager = new window.Autocomplete.AutocompleteManager({
    inputElement: messageInput,
    containerElement: inputWrapper,
    providers: [fileProvider, commandProvider]
  });

  autocompleteManager.init();
  console.log('[Sidecar] Autocomplete initialized with @ file and / command providers');
}

// ============================================
// MCP Manager Functions
// ============================================

// Initialize the MCP selector UI
function initMcpSelector() {
  // Initialize state manager from mcp-manager.js
  if (typeof window.McpManager !== 'undefined') {
    mcpManagerState = new window.McpManager.McpManagerState();

    // Listen for MCP changes
    mcpManagerState.onChange((event) => {
      updateMcpDisplay();

      // Show notice for significant changes
      if (event.action === 'add') {
        addMcpNotice(`MCP server "${event.name}" added`);
      } else if (event.action === 'remove') {
        addMcpNotice(`MCP server "${event.name}" removed`);
      } else if (event.action === 'toggle') {
        const status = event.enabled ? 'enabled' : 'disabled';
        addMcpNotice(`MCP server "${event.name}" ${status}`);
      }
    });

    // Load initial config if available
    if (config && config.mcp) {
      mcpManagerState.loadConfig(config.mcp);
    }
  }

  // Populate dropdown
  populateMcpDropdown();

  // Update display
  updateMcpDisplay();

  // Set up event listeners
  const selectorDisplay = document.getElementById('mcp-selector-display');
  if (selectorDisplay) {
    selectorDisplay.addEventListener('click', toggleMcpDropdown);
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const selector = document.getElementById('mcp-selector');
    if (selector && !selector.contains(e.target)) {
      closeMcpDropdown();
    }
  });
}

// Populate the MCP dropdown with server list and add form
function populateMcpDropdown() {
  const dropdown = document.getElementById('mcp-selector-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = '';

  // Add server list
  const serverList = document.createElement('div');
  serverList.className = 'mcp-server-list';

  if (mcpManagerState) {
    const servers = mcpManagerState.getServers();
    const serverNames = Object.keys(servers);

    if (serverNames.length === 0) {
      // Empty state
      const emptyState = document.createElement('div');
      emptyState.className = 'mcp-empty-state';
      emptyState.textContent = 'No MCP servers configured';
      serverList.appendChild(emptyState);
    } else {
      serverNames.forEach(name => {
        const serverConfig = servers[name];
        const serverItem = createMcpServerItem(name, serverConfig);
        serverList.appendChild(serverItem);
      });
    }
  }

  dropdown.appendChild(serverList);

  // Add divider
  const divider = document.createElement('div');
  divider.className = 'mcp-divider';
  dropdown.appendChild(divider);

  // Add server form
  const addForm = createMcpAddForm();
  dropdown.appendChild(addForm);
}

// Create a server list item
function createMcpServerItem(name, serverConfig) {
  const item = document.createElement('div');
  item.className = 'mcp-server-item';
  item.dataset.serverName = name;

  if (serverConfig.enabled === false) {
    item.classList.add('disabled');
  }

  // Toggle switch
  const toggle = document.createElement('label');
  toggle.className = 'mcp-toggle';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = serverConfig.enabled !== false;
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    toggleMcpServer(name);
  });

  const slider = document.createElement('span');
  slider.className = 'mcp-toggle-slider';

  toggle.appendChild(checkbox);
  toggle.appendChild(slider);
  item.appendChild(toggle);

  // Server icon
  const iconSpan = document.createElement('span');
  iconSpan.className = 'mcp-server-icon';
  if (typeof window.McpManager !== 'undefined') {
    iconSpan.innerHTML = window.McpManager.getMcpIcon(serverConfig.type);
  }
  item.appendChild(iconSpan);

  // Server info
  const info = document.createElement('div');
  info.className = 'mcp-server-info';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'mcp-server-name';
  nameSpan.textContent = name;
  info.appendChild(nameSpan);

  if (typeof window.McpManager !== 'undefined') {
    const display = window.McpManager.formatServerForDisplay(serverConfig);
    const detailSpan = document.createElement('span');
    detailSpan.className = 'mcp-server-detail';
    detailSpan.textContent = `${display.typeLabel} · ${display.detail}`;
    info.appendChild(detailSpan);
  }

  item.appendChild(info);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'mcp-remove-btn';
  removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  removeBtn.title = 'Remove server';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeMcpServer(name);
  });
  item.appendChild(removeBtn);

  return item;
}

// Create the add server form
function createMcpAddForm() {
  const form = document.createElement('div');
  form.className = 'mcp-add-form';

  // Form header
  const header = document.createElement('div');
  header.className = 'mcp-add-header';
  header.textContent = 'Add Server';
  form.appendChild(header);

  // Name input
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'mcp-input';
  nameInput.placeholder = 'Server name';
  nameInput.id = 'mcp-add-name';
  form.appendChild(nameInput);

  // Value input (URL or command)
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'mcp-input';
  valueInput.placeholder = 'URL or command';
  valueInput.id = 'mcp-add-value';
  form.appendChild(valueInput);

  // Error message
  const errorEl = document.createElement('div');
  errorEl.className = 'mcp-add-error';
  errorEl.id = 'mcp-add-error';
  form.appendChild(errorEl);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'mcp-add-actions';

  const addBtn = document.createElement('button');
  addBtn.className = 'mcp-add-btn';
  addBtn.textContent = 'Add';
  addBtn.addEventListener('click', () => handleMcpAddServer());

  actions.appendChild(addBtn);
  form.appendChild(actions);

  // Handle enter key in inputs
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      valueInput.focus();
    }
  });

  valueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleMcpAddServer();
    }
  });

  return form;
}

// Handle adding a new server
function handleMcpAddServer() {
  const nameInput = document.getElementById('mcp-add-name');
  const valueInput = document.getElementById('mcp-add-value');
  const errorEl = document.getElementById('mcp-add-error');

  if (!nameInput || !valueInput || !errorEl) return;

  const name = nameInput.value.trim();
  const value = valueInput.value.trim();

  // Validate
  if (typeof window.McpManager !== 'undefined') {
    const validation = window.McpManager.validateServerInput(name, value);
    if (!validation.valid) {
      errorEl.textContent = validation.error;
      return;
    }

    // Parse and add
    const serverConfig = window.McpManager.parseServerSpec(name, value);
    if (mcpManagerState) {
      mcpManagerState.addServer(name, serverConfig);
    }
  }

  // Clear form
  nameInput.value = '';
  valueInput.value = '';
  errorEl.textContent = '';

  // Refresh dropdown
  populateMcpDropdown();
}

// Toggle MCP server enabled state
function toggleMcpServer(name) {
  if (mcpManagerState) {
    mcpManagerState.toggleServer(name);
    populateMcpDropdown();
  }
}

// Remove MCP server
function removeMcpServer(name) {
  if (mcpManagerState) {
    mcpManagerState.removeServer(name);
    populateMcpDropdown();
  }
}

// Toggle MCP dropdown visibility
function toggleMcpDropdown() {
  const dropdown = document.getElementById('mcp-selector-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('visible');
  }
}

// Close the MCP dropdown
function closeMcpDropdown() {
  const dropdown = document.getElementById('mcp-selector-dropdown');
  if (dropdown) {
    dropdown.classList.remove('visible');
  }
}

// Update the MCP display (count badge and tooltip)
function updateMcpDisplay() {
  let count = 0;
  if (mcpManagerState) {
    count = mcpManagerState.getEnabledCount();
  }

  // Update badge
  const badge = document.getElementById('mcp-badge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  }

  // Update tooltip
  const selectorBtn = document.getElementById('mcp-selector-display');
  if (selectorBtn) {
    selectorBtn.title = count > 0 ? `MCP Servers (${count} active)` : 'MCP Servers';
  }

  // Update button active state
  if (selectorBtn) {
    selectorBtn.classList.toggle('active', count > 0);
  }
}

// Add a system message for MCP change notifications
function addMcpNotice(text) {
  const messageEl = document.createElement('div');
  messageEl.className = 'message system mcp-notice';

  // Create SVG icon (plug icon for MCP)
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '14');
  iconSvg.setAttribute('height', '14');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 2v6M12 18v4M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M18 12h4M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24');
  iconSvg.appendChild(path);

  const textSpan = document.createElement('span');
  textSpan.textContent = text;

  messageEl.appendChild(iconSvg);
  messageEl.appendChild(textSpan);
  messagesContainer.appendChild(messageEl);
  scrollToBottom();
}

// ============================================================================
// Context Panel Functions
// ============================================================================

/**
 * Initialize the context panel UI
 */
function initContextPanel() {
  // Initialize state manager from context-panel.js
  if (typeof window.ContextPanel !== 'undefined') {
    contextPanelState = new window.ContextPanel.ContextPanelState();

    // Listen for context changes to update UI
    contextPanelState.onChange(updateContextDisplay);

    // Initial setup after config is loaded
    if (config?.model) {
      contextPanelState.setModel(config.model);
    }
    if (config?.systemPrompt) {
      contextPanelState.setSystemPrompt(config.systemPrompt);
    }
  } else {
    console.warn('[Sidecar] ContextPanel module not loaded');
  }

  // Set up click handlers
  const contextBtn = document.getElementById('context-btn');
  if (contextBtn) {
    contextBtn.addEventListener('click', openContextModal);
  }

  const closeBtn = document.getElementById('context-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeContextModal);
  }

  // Close modal when clicking backdrop
  const modal = document.getElementById('context-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeContextModal();
      }
    });
  }

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && contextModalVisible) {
      closeContextModal();
    }
  });

  // Listen for model changes
  if (modelPickerState) {
    modelPickerState.onChange((change) => {
      if (contextPanelState && change.currentModel) {
        contextPanelState.setModel(change.currentModel);
      }
    });
  }
}

/**
 * Recalculate context usage from current messages
 */
async function recalculateContext() {
  if (!contextPanelState || !sessionId) {
    return;
  }

  try {
    // Fetch current messages from session
    const response = await proxyFetch(`/session/${sessionId}/message`);
    if (response.ok && response.data) {
      const messages = response.data.messages || response.data || [];
      contextPanelState.calculateFromMessages(messages);
    }
  } catch (err) {
    console.warn('[Sidecar] Failed to recalculate context:', err.message);
  }
}

/**
 * Update context display UI (called on state change)
 * @param {object} contextInfo - Context information from state
 */
function updateContextDisplay(contextInfo) {
  // Update ring progress indicator
  const ringFill = document.querySelector('.context-ring-fill');
  if (ringFill) {
    const circumference = 2 * Math.PI * 15; // r=15
    const dashLength = (contextInfo.usedPercentage / 100) * circumference;
    ringFill.style.strokeDasharray = `${dashLength} ${circumference}`;

    // Update color based on usage
    ringFill.classList.remove('warning', 'critical');
    if (contextInfo.usedPercentage >= 90) {
      ringFill.classList.add('critical');
    } else if (contextInfo.usedPercentage >= 75) {
      ringFill.classList.add('warning');
    }
  }

  // Update percentage text on button
  const percentEl = document.querySelector('.context-percentage');
  if (percentEl) {
    percentEl.textContent = `${Math.round(contextInfo.usedPercentage)}%`;
  }

  // Update progress bar in modal
  const progressFill = document.querySelector('.context-progress-fill');
  if (progressFill) {
    progressFill.style.width = `${contextInfo.usedPercentage}%`;
    progressFill.classList.remove('warning', 'critical');
    if (contextInfo.usedPercentage >= 90) {
      progressFill.classList.add('critical');
    } else if (contextInfo.usedPercentage >= 75) {
      progressFill.classList.add('warning');
    }
  }

  // Update text values
  const usedEl = document.getElementById('context-used');
  if (usedEl) {
    usedEl.textContent = formatTokens(contextInfo.totalTokens) + ' tokens';
  }

  const limitEl = document.getElementById('context-limit');
  if (limitEl) {
    limitEl.textContent = `/ ${formatTokens(contextInfo.contextLimit)} limit`;
  }

  const turnsEl = document.getElementById('context-turns');
  if (turnsEl) {
    turnsEl.textContent = contextInfo.turnCount;
  }

  const messagesEl = document.getElementById('context-messages');
  if (messagesEl) {
    messagesEl.textContent = contextInfo.messageCount;
  }

  const remainingEl = document.getElementById('context-remaining');
  if (remainingEl) {
    remainingEl.textContent = formatTokens(contextInfo.remainingTokens);
  }

  // Update breakdown bars
  const categories = ['systemPrompt', 'userMessages', 'assistantMessages', 'toolCalls', 'reasoning'];
  const maxBreakdown = Math.max(...categories.map(c => contextInfo.breakdown[c] || 0), 1);

  for (const cat of categories) {
    const item = document.querySelector(`[data-category="${cat}"]`);
    if (item) {
      const value = contextInfo.breakdown[cat] || 0;
      const bar = item.querySelector('.breakdown-bar');
      const valueEl = item.querySelector('.breakdown-value');

      if (bar) {
        const percent = (value / maxBreakdown) * 100;
        bar.style.width = `${percent}%`;
      }
      if (valueEl) {
        valueEl.textContent = formatTokens(value);
      }
    }
  }

  // Update cache stats
  const cacheReadEl = document.getElementById('cache-read');
  if (cacheReadEl) {
    cacheReadEl.textContent = formatTokens(contextInfo.usage.cacheReadTokens);
  }

  const cacheWriteEl = document.getElementById('cache-write');
  if (cacheWriteEl) {
    cacheWriteEl.textContent = formatTokens(contextInfo.usage.cacheWriteTokens);
  }

  const cacheSavingsEl = document.getElementById('cache-savings');
  if (cacheSavingsEl) {
    const totalInput = contextInfo.usage.inputTokens || 0;
    const cacheRead = contextInfo.usage.cacheReadTokens || 0;
    const savingsPercent = totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;
    cacheSavingsEl.textContent = `${savingsPercent}%`;
  }
}

/**
 * Format token count for display
 * @param {number} tokens - Token count
 * @returns {string} Formatted string (e.g., "1.2M", "128K", "500")
 */
function formatTokens(tokens) {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return tokens.toString();
}

/**
 * Open the context modal
 */
function openContextModal() {
  const modal = document.getElementById('context-modal');
  if (modal) {
    contextModalVisible = true;
    modal.classList.add('visible');

    // Recalculate on open for fresh data
    recalculateContext();
  }
}

/**
 * Close the context modal
 */
function closeContextModal() {
  const modal = document.getElementById('context-modal');
  if (modal) {
    contextModalVisible = false;
    modal.classList.remove('visible');
  }
}

/**
 * Update context with usage data from SSE event
 * @param {object} usageData - Usage data from API response
 */
function updateContextUsage(usageData) {
  if (contextPanelState && usageData) {
    contextPanelState.updateUsage(usageData);
  }
}

// Initialize when called by main process after config injection
// Note: Don't use DOMContentLoaded as config may not be available yet
// The main process will call init() after injecting sidecarConfig
