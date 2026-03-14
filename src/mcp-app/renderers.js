/* eslint-env browser */
/**
 * Message rendering functions for MCP App.
 * Uses DOMParser for safe HTML-to-DOM conversion (no innerHTML per security hook).
 */
import { formatToolOutput } from './tool-output.js';
import { renderMarkdown } from './markdown.js';
import { getToolIcon } from './icons.js';
import { getModelLogo } from './logos.js';
import { getToolTitleInfo } from './tool-titles.js';

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

/** Tool block: clickable row with icon, title, subtitle + expandable detail */
export function makeToolBlock(part) {
  const toolId = (part.tool || part.toolName || '').toLowerCase();
  const status = part.state?.status || 'done';
  const { title, subtitle } = getToolTitleInfo(toolId, part.state?.input);
  const frag = document.createDocumentFragment();

  const item = document.createElement('div');
  item.className = `tool-item tool-status-${status}`;

  // Tool row: icon + title + subtitle + chevron
  const row = document.createElement('div');
  row.className = 'tool-item-row';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'tool-item-icon';
  iconSpan.appendChild(htmlToFragment(getToolIcon(toolId)));
  row.appendChild(iconSpan);

  const titleSpan = document.createElement('span');
  titleSpan.className = 'tool-item-title';
  titleSpan.textContent = title;
  row.appendChild(titleSpan);

  if (subtitle) {
    const subtitleSpan = document.createElement('span');
    subtitleSpan.className = 'tool-item-subtitle';
    subtitleSpan.textContent = subtitle;
    row.appendChild(subtitleSpan);
  }

  const chevron = document.createElement('span');
  chevron.className = 'tool-item-chevron';
  chevron.textContent = '\u25B6';
  row.appendChild(chevron);

  item.appendChild(row);

  // Expandable detail panel
  const html = formatToolOutput(toolId, part.state?.input, part.state?.output);
  const detail = document.createElement('div');
  detail.className = 'tool-detail';
  detail.appendChild(htmlToFragment(html));

  row.addEventListener('click', () => {
    const open = item.classList.toggle('expanded');
    detail.classList.toggle('visible', open);
  });

  // Auto-expand question tools
  const isQuestion = toolId === 'question' || toolId === 'askuserquestion';
  if (isQuestion) {
    item.classList.add('expanded');
    detail.classList.add('visible');
  }

  // Copy button handlers (bash tool)
  detail.addEventListener('click', (e) => {
    const btn = e.target.closest('.bash-copy-btn');
    if (!btn) { return; }
    e.stopPropagation();
    const text = btn.dataset.copy;
    if (text && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1500);
      });
    }
  });

  item.appendChild(detail);
  frag.appendChild(item);
  return frag;
}

/** Build tool group container with collapsible header.
 * @param {Array} toolParts - Tool part objects
 * @param {string} [reasoningText] - Optional reasoning text for header description
 */
function makeToolGroup(toolParts, reasoningText) {
  const group = document.createElement('div');
  group.className = 'tool-group';
  group.dataset.expanded = 'true';

  // Header: icon + chevron + description/count
  const header = document.createElement('div');
  header.className = 'tool-group-header';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'tool-group-icon';
  iconSpan.appendChild(htmlToFragment(getToolIcon('_default')));
  header.appendChild(iconSpan);

  const chevron = document.createElement('span');
  chevron.className = 'tool-group-chevron';
  chevron.textContent = '\u25B6';
  header.appendChild(chevron);

  const label = document.createElement('span');
  label.className = 'tool-group-count';
  if (reasoningText) {
    // Extract a short summary from reasoning for the header
    const clean = reasoningText.replace(/\*\*[^*]+\*\*/g, '').replace(/\n+/g, ' ').trim();
    const summary = clean.length > 80 ? clean.slice(0, 80) + '...' : clean;
    label.textContent = summary;
  } else {
    const n = toolParts.length;
    label.textContent = `${n} tool call${n !== 1 ? 's' : ''}`;
  }
  header.appendChild(label);

  group.appendChild(header);

  // Items container
  const items = document.createElement('div');
  items.className = 'tool-group-items';
  for (const p of toolParts) {
    items.appendChild(makeToolBlock(p));
  }
  group.appendChild(items);

  // Toggle collapse/expand
  header.addEventListener('click', () => {
    const isExpanded = group.dataset.expanded === 'true';
    group.dataset.expanded = isExpanded ? 'false' : 'true';
  });

  return group;
}

/** Message bubble with role label. Assistant text is rendered as markdown. */
export function makeBubble(cssClass, roleLabel, text, options = {}) {
  const div = document.createElement('div');
  div.className = `msg ${cssClass}`;

  const label = document.createElement('div');
  label.className = 'msg-role';

  if (cssClass === 'assistant' && options.model) {
    const logoSpan = document.createElement('span');
    logoSpan.className = 'msg-role-logo';
    logoSpan.appendChild(htmlToFragment(getModelLogo(options.model)));
    label.appendChild(logoSpan);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = options.model;
    label.appendChild(nameSpan);
  } else {
    label.textContent = roleLabel;
  }
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

/** Render a full OpenCode message into DOM elements. */
export function renderMessage(msg, options = {}) {
  const role = msg.info?.role || msg.role || 'assistant';
  const parts = msg.parts || msg.content || [];

  if (typeof parts === 'string') {
    return makeBubble(role, role, parts, options);
  }
  if (!Array.isArray(parts)) { return null; }

  // Collect parts preserving order to split reasoning before/after tools
  const preToolReasoning = [];
  const postToolReasoning = [];
  const toolParts = [];
  const textChunks = [];
  let seenTool = false;

  for (const p of parts) {
    if (p.type === 'text' && p.text) {
      textChunks.push(p.text);
    } else if (p.type === 'reasoning' && p.text && p.text !== '[REDACTED]') {
      if (seenTool) {
        postToolReasoning.push(p.text);
      } else {
        preToolReasoning.push(p.text);
      }
    } else if (p.type === 'tool') {
      seenTool = true;
      toolParts.push(p);
    }
  }

  const allReasoning = [...preToolReasoning, ...postToolReasoning];
  if (!textChunks.length && !allReasoning.length && !toolParts.length) {
    if (msg.text) { return makeBubble(role, role, msg.text, options); }
    return null;
  }

  const frag = document.createDocumentFragment();

  // Pre-tool reasoning: fold into tool group header if tools exist, else standalone
  const preText = preToolReasoning.length ? preToolReasoning.join('\n\n') : null;
  if (preText && !toolParts.length) {
    const isDone = textChunks.length > 0;
    frag.appendChild(makeThinkingIndicator(preText, isDone));
  }

  // Tool group with pre-tool reasoning as header description
  if (toolParts.length) {
    frag.appendChild(makeToolGroup(toolParts, preText));
  }

  // Post-tool reasoning: standalone thinking indicator
  if (postToolReasoning.length) {
    const postText = postToolReasoning.join('\n\n');
    frag.appendChild(makeThinkingIndicator(postText, textChunks.length > 0));
  }

  if (textChunks.length) {
    frag.appendChild(makeBubble(role, role, textChunks.join('\n\n'), options));
  }

  return frag;
}
