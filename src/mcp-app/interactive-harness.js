/* eslint-env browser */
/**
 * Interactive harness client for Sidecar MCP App.
 * Replaces ext-apps SDK with direct fetch() to OpenCode HTTP API.
 * Reads config from Vite-injected globals.
 */
import { renderMessage } from './renderers.js';
import { setupAutoScroll } from './auto-scroll.js';

/* global __SIDECAR_SESSION_ID__, __SIDECAR_MODEL__ */
const sessionId = __SIDECAR_SESSION_ID__;
const model = __SIDECAR_MODEL__;

const container = document.getElementById('messages-container');
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const timerEl = document.getElementById('timer');
const modelBadge = document.getElementById('model-badge');
const statusDot = document.getElementById('status-dot');

setupAutoScroll(container);

modelBadge.textContent = model || 'unknown';
statusDot.classList.add('connected');

const startTime = Date.now();
let lastCursor = '0:0';
let polling = false;

// ---- Timer ----
setInterval(() => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  timerEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
}, 1000);

// ---- Fingerprint (replicates mcp-server.js:342-349) ----
function fingerprint(msgs) {
  let parts = 0;
  for (const m of msgs) {
    const p = m.parts || m.content;
    parts += Array.isArray(p) ? p.length : 1;
  }
  return `${msgs.length}:${parts}`;
}

// ---- Trim long outputs (replicates mcp-server.js:383-394) ----
const MAX_PART_LEN = 2000;
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

// ---- Completion detection ----
function isCompleted(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const role = msgs[i].info?.role || msgs[i].role;
    if (role === 'assistant') {
      return msgs[i].info?.time?.completed === true;
    }
  }
  return false;
}

// ---- Session status fallback ----
let pollCount = 0;
async function checkSessionStatus() {
  try {
    const res = await fetch(`/api/session/${sessionId}`);
    if (!res.ok) { return false; }
    const data = await res.json();
    const status = data?.metadata?.status || data?.status;
    return status === 'completed' || status === 'error';
  } catch { return false; }
}

// ---- Polling loop ----
async function pollOnce() {
  try {
    const res = await fetch(`/api/session/${sessionId}/message`);
    if (!res.ok) { return; }
    let msgs = await res.json();
    if (!Array.isArray(msgs)) { msgs = []; }

    const cursor = fingerprint(msgs);
    if (cursor === lastCursor) {
      // Every 30 polls (~9s) with no cursor change, check session status as fallback
      pollCount++;
      if (pollCount >= 30) {
        pollCount = 0;
        if (await checkSessionStatus()) {
          polling = false;
          statusDot.classList.remove('connected');
          input.placeholder = 'Session complete. Type to continue...';
        }
      }
      return;
    }
    pollCount = 0;

    msgs = trimParts(msgs);

    // Full DOM rebuild (same pattern as mcp-app.js)
    while (container.firstChild) { container.removeChild(container.firstChild); }
    for (const msg of msgs) {
      const el = renderMessage(msg);
      if (el) { container.appendChild(el); }
    }
    lastCursor = cursor;

    if (isCompleted(msgs)) {
      polling = false;
      statusDot.classList.remove('connected');
      input.placeholder = 'Session complete. Type to continue...';
    }
  } catch {
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function startPolling() {
  if (polling) { return; }
  polling = true;
  while (polling) {
    await pollOnce();
    if (polling) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

// ---- Send message ----
async function sendMessage() {
  const text = input.value.trim();
  if (!text) { return; }
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  // Optimistic user bubble
  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.textContent = text;
  container.appendChild(userDiv);

  try {
    await fetch(`/api/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
    });
    // Restart polling if it stopped (session was complete)
    if (!polling) {
      statusDot.classList.add('connected');
      input.placeholder = 'Send a message...';
      startPolling();
    }
  } catch {
    // Send failed, message shown optimistically
  }
  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ---- Start immediately ----
startPolling();
