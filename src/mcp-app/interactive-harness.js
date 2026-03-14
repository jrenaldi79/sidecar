/* eslint-env browser */
/**
 * Interactive harness client for Sidecar MCP App.
 * Uses the shared render-engine with direct fetch() to OpenCode HTTP API.
 * Reads config from Vite-injected globals.
 *
 * This is the test harness counterpart to mcp-app.js. Both use the same
 * render engine for identical streaming, grouping, and rendering behavior.
 */
import { createRenderEngine } from './render-engine.js';

/* global __SIDECAR_SESSION_ID__, __SIDECAR_MODEL__ */
const sessionId = __SIDECAR_SESSION_ID__;
const model = __SIDECAR_MODEL__;

const container = document.getElementById('messages-container');
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const timerEl = document.getElementById('timer');
const modelBadge = document.getElementById('model-badge');
const statusDot = document.getElementById('status-dot');

modelBadge.textContent = model || 'unknown';

// ---- Session status check for completion detection ----
async function checkSessionStatus() {
  try {
    const res = await fetch(`/api/session/${sessionId}`);
    if (!res.ok) { return 'unknown'; }
    const data = await res.json();
    return data?.metadata?.status || data?.status || 'unknown';
  } catch { return 'unknown'; }
}

// ---- HTTP transport ----
const transport = {
  getTaskId: () => sessionId,
  getModel: () => model || 'assistant',

  fetchMessages: async () => {
    const res = await fetch(`/api/session/${sessionId}/message`);
    if (!res.ok) { return null; }
    const msgs = await res.json();
    if (!Array.isArray(msgs)) { return { messages: [], done: false }; }

    // Check completion efficiently: only hit session endpoint
    // when the last assistant message reports completed
    let done = false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if ((msgs[i].info?.role || msgs[i].role) === 'assistant') {
        if (msgs[i].info?.time?.completed) {
          const status = await checkSessionStatus();
          done = status === 'completed' || status === 'error';
        }
        break;
      }
    }

    return { messages: msgs, done };
  },

  sendMessage: async (text) => {
    await fetch(`/api/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
    });
  },

  answerQuestion: async (params) => {
    const { name, arguments: args } = params;
    if (name === 'sidecar_app_answer_question') {
      const questions = await fetch('/api/question').then(r => r.json());
      const pending = Array.isArray(questions)
        ? questions.filter(q => q.sessionID === sessionId)
        : [];
      if (pending.length === 0) {
        // Fallback: send as regular message
        await fetch(`/api/session/${sessionId}/prompt_async`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parts: [{ type: 'text', text: args.answer }] }),
        });
        return;
      }
      await fetch(`/api/question/${pending[0].id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [[args.answer]] }),
      });
    } else if (name === 'sidecar_app_skip_question') {
      const questions = await fetch('/api/question').then(r => r.json());
      const pending = Array.isArray(questions)
        ? questions.filter(q => q.sessionID === sessionId)
        : [];
      if (pending.length > 0) {
        await fetch(`/api/question/${pending[0].id}/reject`, { method: 'POST' });
      }
    }
  },
};

// ---- Render engine (same as production mcp-app) ----
const engine = createRenderEngine(
  { container, input, sendBtn, timerEl, statusDot },
  transport,
);

// Start immediately (session ID known from Vite globals)
engine.startPolling();
