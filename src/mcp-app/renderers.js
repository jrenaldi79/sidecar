/* eslint-env browser */
/**
 * Message rendering functions for MCP App.
 * Pure DOM-building functions (no innerHTML per security hook).
 */

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

/** Single-line tool status indicator */
export function makeToolIndicator(name, status) {
  const div = document.createElement('div');
  div.className = 'msg tool-indicator';
  const icon = status === 'completed' ? '\u2713' : status === 'running' ? '\u25CF' : '\u2026';
  div.textContent = `${icon} ${name}`;
  return div;
}

/** Message bubble with role label */
export function makeBubble(cssClass, roleLabel, text) {
  const div = document.createElement('div');
  div.className = `msg ${cssClass}`;
  const label = document.createElement('div');
  label.className = 'msg-role';
  label.textContent = roleLabel;
  div.appendChild(label);
  const content = document.createElement('div');
  content.textContent = text;
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
  const toolNames = [];

  for (const p of parts) {
    if (p.type === 'text' && p.text) {
      textChunks.push(p.text);
    } else if (p.type === 'reasoning' && p.text) {
      reasoningChunks.push(p.text);
    } else if (p.type === 'tool') {
      const name = p.toolName || p.state?.input?.description || 'tool';
      const status = p.state?.status || 'done';
      toolNames.push({ name, status });
    }
  }

  if (!textChunks.length && !reasoningChunks.length && !toolNames.length) {
    if (msg.text) { return makeBubble(role, role, msg.text); }
    return null;
  }

  const frag = document.createDocumentFragment();

  if (reasoningChunks.length) {
    const isDone = textChunks.length > 0 || toolNames.length > 0;
    frag.appendChild(makeThinkingIndicator(reasoningChunks.join('\n\n'), isDone));
  }
  if (toolNames.length) {
    for (const t of toolNames) {
      frag.appendChild(makeToolIndicator(t.name, t.status));
    }
  }
  if (textChunks.length) {
    frag.appendChild(makeBubble(role, role, textChunks.join('\n\n')));
  }

  return frag;
}
