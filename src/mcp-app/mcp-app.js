/* eslint-env browser */
/**
 * MCP App client-side module for Sidecar.
 * Bundled by Vite into the single-file HTML resource.
 * Uses the ext-apps App class for host communication.
 *
 * Rendering, polling, and streaming are handled by the shared render-engine.
 * This file only handles: ext-apps lifecycle, theme, fold, and MCP transport.
 */
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from '@modelcontextprotocol/ext-apps';
import { createRenderEngine } from './render-engine.js';

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

let taskId = null;
let folded = false;

const app = new App({ name: 'Sidecar', version: '1.0.0' });

// ---- Theme ----
function applyTheme(ctx) {
  if (ctx?.theme) { applyDocumentTheme(ctx.theme); }
  if (ctx?.styles?.variables) { applyHostStyleVariables(ctx.styles.variables); }
  if (ctx?.styles?.css?.fonts) { applyHostFonts(ctx.styles.css.fonts); }
}

app.onhostcontextchanged = (ctx) => { applyTheme(ctx); };

// ---- Extract text from MCP tool result ----
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

// ---- MCP transport ----
let serverCursor = '0:0';

const transport = {
  getTaskId: () => taskId,
  getModel: () => modelBadge.textContent || 'assistant',
  isFolded: () => folded,

  fetchMessages: async () => {
    if (!taskId || folded) { return null; }
    const result = await app.callServerTool({
      name: 'sidecar_app_messages',
      arguments: { taskId, cursor: serverCursor },
    });
    const text = extractResultText(result);
    if (!text) { return null; }
    const data = JSON.parse(text);
    serverCursor = data.cursor || '0:0';
    return {
      messages: data.messages || [],
      done: data.status === 'completed' || data.status === 'error',
    };
  },

  sendMessage: async (text) => {
    await app.callServerTool({
      name: 'sidecar_app_send',
      arguments: { taskId, message: text },
    });
  },

  answerQuestion: (params) => app.callServerTool(params),

  onBeforeSend: () => {
    if (loading?.parentNode) { loading.remove(); }
  },
};

// ---- Render engine ----
const engine = createRenderEngine(
  { container, input, sendBtn, timerEl, statusDot },
  transport,
);

// ---- ext-apps lifecycle ----
app.ontoolinput = (params) => {
  const args = params.arguments || {};
  if (args.model) { modelBadge.textContent = args.model; }
  if (loadingText) { loadingText.textContent = `Starting sidecar${args.model ? ` with ${args.model}` : ''}...`; }
  if (loadingSub) { loadingSub.textContent = 'Initializing model connection'; }
};

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
        engine.startPolling();
      }
    }
  } catch {
    if (loadingText) { loadingText.textContent = 'Connected.'; }
  }
};

// ---- Fold (production only, no equivalent in test harness) ----
async function triggerFold() {
  if (!taskId || folded) { return; }
  folded = true;
  engine.destroy();
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

// ---- Connect to host ----
await app.connect();
const hostCtx = app.getHostContext();
applyTheme(hostCtx);
