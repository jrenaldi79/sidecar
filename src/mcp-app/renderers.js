/* eslint-env browser */
/**
 * Message rendering functions for MCP App.
 * Uses DOMParser for safe HTML-to-DOM conversion (no innerHTML per security hook).
 */
import { formatToolOutput } from './tool-output.js';
import { renderMarkdown } from './markdown.js';

/** Convert an HTML string to a DocumentFragment safely (no innerHTML). */
function htmlToFragment(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const frag = document.createDocumentFragment();
  while (doc.body.firstChild) {
    frag.appendChild(doc.body.firstChild);
  }
  return frag;
}

/** Compact one-line thinking indicator with expand/collapse */
export function makeThinkingIndicator(text, isDone) {
  const frag = document.createDocumentFragment();

  const row = document.createElement('div');
  row.className = `thinking-row${isDone ? ' done' : ''}`;

  const spinner = document.createElement('div');
  spinner.className = 'thinking-spinner';
  row.appendChild(spinner);

  const label = document.createElement('span');
  label.className = 'thinking-label';
  label.textContent = isDone ? 'Thought' : 'Thinking...';
  row.appendChild(label);

  const preview = document.createElement('span');
  preview.className = 'thinking-preview';
  const clean = text.replace(/\n+/g, ' ').trim();
  preview.textContent = clean.length > 60 ? clean.slice(0, 60) + '...' : clean;
  row.appendChild(preview);

  const chevron = document.createElement('span');
  chevron.className = 'thinking-chevron';
  chevron.textContent = '\u25B6';
  row.appendChild(chevron);

  const content = document.createElement('div');
  content.className = 'thinking-content';
  content.textContent = text;

  row.addEventListener('click', () => {
    const open = row.classList.toggle('expanded');
    content.classList.toggle('visible', open);
  });

  frag.appendChild(row);
  frag.appendChild(content);
  return frag;
}

/** Tool block: clickable summary indicator + expandable formatted output */
export function makeToolBlock(part) {
  const toolId = (part.tool || part.toolName || '').toLowerCase();
  const displayName = part.state?.input?.description || toolId || 'tool';
  const status = part.state?.status || 'done';
  const frag = document.createDocumentFragment();

  const row = document.createElement('div');
  row.className = 'msg tool-indicator';
  const icon = status === 'completed' ? '\u2713' : status === 'running' ? '\u25CF' : '\u2026';

  const label = document.createElement('span');
  label.textContent = `${icon} ${displayName}`;
  row.appendChild(label);

  const chevron = document.createElement('span');
  chevron.className = 'tool-chevron';
  chevron.textContent = '\u25B6';
  row.appendChild(chevron);

  frag.appendChild(row);

  const output = part.state?.output;
  const isQuestion = toolId === 'question' || toolId === 'askuserquestion';
  // Render detail panel if output exists, or if it's a question tool (show interactive UI even when pending)
  if (output !== undefined && output !== null || isQuestion) {
    const html = formatToolOutput(toolId, part.state?.input, output);
    const detail = document.createElement('div');
    detail.className = 'tool-detail';
    detail.appendChild(htmlToFragment(html));

    row.addEventListener('click', () => {
      const open = row.classList.toggle('expanded');
      detail.classList.toggle('visible', open);
    });

    frag.appendChild(detail);
  }

  return frag;
}

/** Message bubble with role label. Assistant text is rendered as markdown. */
export function makeBubble(cssClass, roleLabel, text) {
  const div = document.createElement('div');
  div.className = `msg ${cssClass}`;
  const label = document.createElement('div');
  label.className = 'msg-role';
  label.textContent = roleLabel;
  div.appendChild(label);
  const content = document.createElement('div');
  content.className = 'msg-content';
  if (cssClass === 'assistant') {
    const rendered = renderMarkdown(text);
    content.appendChild(htmlToFragment(rendered));
  } else {
    content.textContent = text;
  }
  div.appendChild(content);
  return div;
}

/** Render a full OpenCode message into DOM elements */
export function renderMessage(msg) {
  const role = msg.info?.role || msg.role || 'assistant';
  const parts = msg.parts || msg.content || [];

  if (typeof parts === 'string') {
    return makeBubble(role, role, parts);
  }
  if (!Array.isArray(parts)) { return null; }

  const textChunks = [];
  const reasoningChunks = [];
  const toolParts = [];

  for (const p of parts) {
    if (p.type === 'text' && p.text) {
      textChunks.push(p.text);
    } else if (p.type === 'reasoning' && p.text && p.text !== '[REDACTED]') {
      reasoningChunks.push(p.text);
    } else if (p.type === 'tool') {
      toolParts.push(p);
    }
  }

  if (!textChunks.length && !reasoningChunks.length && !toolParts.length) {
    if (msg.text) { return makeBubble(role, role, msg.text); }
    return null;
  }

  const frag = document.createDocumentFragment();

  if (reasoningChunks.length) {
    const isDone = textChunks.length > 0 || toolParts.length > 0;
    frag.appendChild(makeThinkingIndicator(reasoningChunks.join('\n\n'), isDone));
  }
  if (toolParts.length) {
    for (const p of toolParts) {
      frag.appendChild(makeToolBlock(p));
    }
  }
  if (textChunks.length) {
    frag.appendChild(makeBubble(role, role, textChunks.join('\n\n')));
  }

  return frag;
}
