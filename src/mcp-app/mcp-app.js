/* eslint-env browser */
/**
 * MCP App client-side module for Sidecar.
 * Bundled by Vite into the single-file HTML resource.
 * Uses the ext-apps App class for host communication.
 */
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';
import { renderMessage } from './renderers.js';
import { setupAutoScroll } from './auto-scroll.js';

const container = document.getElementById('messages-container');
const loading = document.getElementById('loading-indicator');
const loadingText = loading?.querySelector('.loading-text');
const loadingSub = loading?.querySelector('.loading-sub');
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const foldBtn = document.getElementById('fold-btn');
const timerEl = document.getElementById('timer');
const modelBadge = document.getElementById('model-badge');
const taskIdDisplay = document.getElementById('task-id-display');
const statusDot = document.getElementById('status-dot');
const overlay = document.getElementById('fold-overlay');
const foldStatusText = document.getElementById('fold-status-text');

const autoScroll = setupAutoScroll(container);

let taskId = null;
let folded = false;
const startTime = Date.now();
let lastCursor = '0:0';
let polling = false;

const app = new App({ name: 'Sidecar', version: '1.0.0' });

// ---- Theme ----
function applyTheme(ctx) {
  if (ctx?.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx?.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx?.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
}

app.onhostcontextchanged = (ctx) => { applyTheme(ctx); };

// Timer
setInterval(() => {
  if (folded) { return; }
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  timerEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
}, 1000);

// Tool input: fires when sidecar_start is called (before result)
app.ontoolinput = (params) => {
  const args = params.arguments || {};
  if (args.model) {
    modelBadge.textContent = args.model;
  }
  if (loadingText) { loadingText.textContent = `Starting sidecar${args.model ? ` with ${args.model}` : ''}...`; }
  if (loadingSub) { loadingSub.textContent = 'Initializing model connection'; }
};

// Tool result: fires when sidecar_start returns (we get taskId here)
app.ontoolresult = (params) => {
  try {
    const content = params.structuredContent || params;
    const text = content?.content?.[0]?.text;
    if (text) {
      const data = JSON.parse(text);
      if (data.taskId) {
        taskId = data.taskId;
        taskIdDisplay.textContent = taskId;
        if (loadingText) { loadingText.textContent = 'Connected'; }
        if (loadingSub) { loadingSub.textContent = 'Waiting for messages...'; }
        if (statusDot) { statusDot.classList.add('connected'); }
        startPolling();
      }
    }
  } catch {
    if (loadingText) { loadingText.textContent = 'Connected.'; }
  }
};

/** Extract text from a callServerTool result. */
function extractResultText(result) {
  if (!result) { return null; }
  if (result.isError) { return null; }
  if (result.structuredContent) {
    const sc = result.structuredContent;
    if (Array.isArray(sc.content)) {
      const t = sc.content.find((p) => p.type === 'text');
      if (t?.text) { return t.text; }
    }
    if (typeof sc === 'string') { return sc; }
  }
  if (Array.isArray(result.content)) {
    const t = result.content.find((p) => p.type === 'text');
    if (t?.text) { return t.text; }
  }
  if (typeof result.content === 'string') { return result.content; }
  return null;
}

// Long-poll loop: server holds request up to ~8s when no new data,
// returns immediately when content changes. Cursor is a fingerprint
// of messageCount:totalParts so we detect in-place part additions.
async function pollOnce() {
  if (!taskId || folded) { return; }
  try {
    const result = await app.callServerTool({
      name: 'sidecar_app_messages',
      arguments: { taskId, cursor: lastCursor },
    });

    const text = extractResultText(result);
    if (!text) { return; }

    const data = JSON.parse(text);
    const msgs = data.messages || [];
    const newCursor = data.cursor || '0:0';

    // Re-render whenever fingerprint changes (new messages OR new parts)
    if (newCursor !== lastCursor) {
      if (loading?.parentNode) { loading.remove(); }
      while (container.firstChild) { container.removeChild(container.firstChild); }
      for (const msg of msgs) {
        const el = renderMessage(msg);
        if (el) { container.appendChild(el); }
      }
      lastCursor = newCursor;
    }

    if (data.status === 'completed' || data.status === 'error') {
      polling = false;
      return;
    }
  } catch {
    // On error, pause briefly before retry
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function startPolling() {
  if (polling) { return; }
  polling = true;
  while (polling && !folded) {
    await pollOnce();
    // Brief pause between long-polls to avoid hammering
    if (polling) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

// Send message
async function sendMessage() {
  const text = input.value.trim();
  if (!text || !taskId || folded) { return; }
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  if (loading?.parentNode) { loading.remove(); }
  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.textContent = text;
  container.appendChild(userDiv);

  try {
    await app.callServerTool({
      name: 'sidecar_app_send',
      arguments: { taskId, message: text },
    });
  } catch {
    // Send failed, message already shown optimistically
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

// Fold
async function triggerFold() {
  if (!taskId || folded) { return; }
  folded = true;
  polling = false;
  autoScroll.destroy();
  foldBtn.disabled = true;
  foldBtn.textContent = 'Folding...';
  overlay.classList.add('visible');

  try {
    const result = await app.callServerTool({
      name: 'sidecar_app_fold',
      arguments: { taskId },
    });
    const text = extractResultText(result);
    const data = text ? JSON.parse(text) : {};

    if (data.summary) {
      await app.updateModelContext({
        content: [{ type: 'text', text: data.summary }],
      });
      foldStatusText.textContent = 'Summary sent to Claude';
      foldBtn.textContent = 'Folded \u2713';
      foldBtn.classList.add('folded');
    } else {
      foldStatusText.textContent = 'Summary generation failed';
      foldBtn.textContent = 'Fold \u23CE';
      foldBtn.disabled = false;
      folded = false;
    }
  } catch (err) {
    foldStatusText.textContent = `Fold error: ${err.message}`;
    foldBtn.textContent = 'Fold \u23CE';
    foldBtn.disabled = false;
    folded = false;
  }

  setTimeout(() => { overlay.classList.remove('visible'); }, 2000);
}

foldBtn.addEventListener('click', triggerFold);

// Connect to host, then apply initial theme
await app.connect();
const hostCtx = app.getHostContext();
applyTheme(hostCtx);
