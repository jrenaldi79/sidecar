/* eslint-env browser */
/**
 * Shared render engine for MCP App.
 * Provides the poll → fingerprint → render → streaming cycle
 * used by both the production mcp-app and the interactive test harness.
 *
 * Platform-specific concerns (how messages are fetched, how messages are sent,
 * how questions are answered) are injected via the `transport` parameter.
 *
 * @module render-engine
 */
import { renderMessage } from './renderers.js';
import { setupAutoScroll } from './auto-scroll.js';
import { setupQuestionHandlers } from './question-handler.js';

const MAX_PART_LEN = 2000;
const POLL_INTERVAL = 300;
const STALE_CHECK_POLLS = 30;

/** Content-aware fingerprint: detects both new parts and in-place text growth. */
function contentFingerprint(msgs) {
  let parts = 0;
  let textLen = 0;
  for (const m of msgs) {
    const p = m.parts || m.content;
    if (Array.isArray(p)) {
      parts += p.length;
      for (const part of p) {
        if (part.type === 'text' && part.text) { textLen += part.text.length; }
        if (part.type === 'reasoning' && part.text) { textLen += part.text.length; }
        if (part.type === 'tool' && part.state?.output) { textLen += part.state.output.length; }
      }
    } else {
      parts += 1;
    }
  }
  return `${msgs.length}:${parts}:${textLen}`;
}

/** Trim long tool outputs and text parts to keep rendering fast. */
function trimParts(msgs) {
  return msgs.map(msg => {
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
}

/**
 * Create a render engine instance.
 *
 * @param {Object} elements - DOM element references
 * @param {HTMLElement} elements.container - Messages container
 * @param {HTMLElement} elements.input - Chat input field
 * @param {HTMLElement} elements.sendBtn - Send button
 * @param {HTMLElement} elements.timerEl - Timer display
 * @param {HTMLElement} elements.statusDot - Connection status dot
 *
 * @param {Object} transport - Platform-specific implementations
 * @param {Function} transport.fetchMessages - async () => { messages, done } | null
 * @param {Function} transport.sendMessage - async (text) => void
 * @param {Function} transport.answerQuestion - async ({ name, arguments }) => void
 * @param {Function} transport.getTaskId - () => string | null
 * @param {Function} [transport.getModel] - () => string (model name for assistant bubbles)
 * @param {Function} [transport.isFolded] - () => boolean
 * @param {Function} [transport.onBeforeSend] - () => void (e.g. remove loading indicator)
 * @returns {{ startPolling: Function, stopPolling: Function, destroy: Function }}
 */
function createRenderEngine(elements, transport) {
  const { container, input, sendBtn, timerEl, statusDot } = elements;
  const autoScroll = setupAutoScroll(container);
  const isFolded = transport.isFolded || (() => false);

  let lastCursor = '0:0';
  let polling = false;
  let waitingForResponse = false;
  let staleCount = 0;
  const startTime = Date.now();

  // ---- Timer ----
  const timerInterval = setInterval(() => {
    if (isFolded()) { return; }
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    timerEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }, 1000);

  // ---- Merge consecutive assistant messages ----
  // OpenCode often splits one logical turn into multiple messages
  // (e.g. reasoning+tools in one, reasoning+text in another).
  // Merging them produces a single coherent render group.
  function mergeConsecutiveAssistant(msgs) {
    const merged = [];
    for (const msg of msgs) {
      const role = msg.info?.role || msg.role || 'assistant';
      const prev = merged[merged.length - 1];
      const prevRole = prev ? (prev.info?.role || prev.role || 'assistant') : null;

      if (role === 'assistant' && prevRole === 'assistant') {
        // Merge parts arrays
        const prevParts = Array.isArray(prev.parts) ? prev.parts : (Array.isArray(prev.content) ? prev.content : []);
        const curParts = Array.isArray(msg.parts) ? msg.parts : (Array.isArray(msg.content) ? msg.content : []);
        merged[merged.length - 1] = { ...prev, parts: [...prevParts, ...curParts] };
      } else {
        merged.push(msg);
      }
    }
    return merged;
  }

  // ---- Render messages with grouping ----
  function renderMessages(msgs, sessionDone) {
    const renderOpts = {};
    if (transport.getModel) { renderOpts.model = transport.getModel(); }

    const grouped = mergeConsecutiveAssistant(msgs);

    while (container.firstChild) { container.removeChild(container.firstChild); }
    for (const msg of grouped) {
      const el = renderMessage(msg, renderOpts);
      if (el) {
        const role = msg.info?.role || msg.role || 'assistant';
        const group = document.createElement('div');
        group.className = `msg-group ${role}-group`;
        group.appendChild(el);
        container.appendChild(group);
      }
    }
    // Streaming cursor on last assistant bubble while still generating
    if (!sessionDone) {
      const lastBubble = container.querySelector('.msg-group:last-child .msg.assistant:last-child');
      if (lastBubble) { lastBubble.classList.add('streaming'); }
    }
  }

  // ---- Mark session complete ----
  function markComplete() {
    polling = false;
    waitingForResponse = false;
    statusDot.classList.remove('connected');
    input.placeholder = 'Session complete. Type to continue...';
  }

  // ---- Polling loop ----
  async function pollOnce() {
    if (isFolded()) { return; }
    try {
      const result = await transport.fetchMessages();
      if (!result) { return; }

      const { messages, done } = result;
      const cursor = contentFingerprint(messages);

      if (cursor === lastCursor) {
        staleCount++;
        if (staleCount >= STALE_CHECK_POLLS && done) {
          markComplete();
        }
        return;
      }
      staleCount = 0;

      if (waitingForResponse) { waitingForResponse = false; }

      const trimmed = trimParts(messages);
      renderMessages(trimmed, done);
      lastCursor = cursor;

      if (done && !waitingForResponse) {
        markComplete();
      }
    } catch {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  async function startPolling() {
    if (polling) { return; }
    polling = true;
    statusDot.classList.add('connected');
    while (polling && !isFolded()) {
      await pollOnce();
      if (polling) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    }
  }

  function stopPolling() {
    polling = false;
  }

  // ---- Send message ----
  async function handleSend() {
    const text = input.value.trim();
    if (!text || isFolded()) { return; }
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    transport.onBeforeSend?.();

    // Optimistic user bubble
    const userDiv = document.createElement('div');
    userDiv.className = 'msg user';
    userDiv.textContent = text;
    container.appendChild(userDiv);

    try {
      waitingForResponse = true;
      await transport.sendMessage(text);
      if (!polling) {
        lastCursor = ''; // Force re-render on next poll
        input.placeholder = 'Send a message...';
        startPolling();
      }
    } catch {
      waitingForResponse = false;
    }
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // ---- Question handlers ----
  setupQuestionHandlers(container, {
    getTaskId: () => transport.getTaskId(),
    isFolded,
    callServerTool: (params) => transport.answerQuestion(params),
  });

  return {
    startPolling,
    stopPolling,
    destroy() {
      clearInterval(timerInterval);
      polling = false;
      autoScroll.destroy();
    },
  };
}

module.exports = { createRenderEngine, contentFingerprint, trimParts };
