/* eslint-env browser */
/**
 * Static test harness: renders mock messages for every tool type.
 * No API dependency -- all data is inline.
 *
 * Uses DOMParser for all HTML-to-DOM conversion (no direct innerHTML).
 */
import { renderMessage } from './renderers.js';
import { setupAutoScroll } from './auto-scroll.js';

const container = document.getElementById('messages-container');
setupAutoScroll(container);

// ---- Helpers ----

/** Parse an HTML string into DOM nodes via DOMParser (safe, no innerHTML). */
function htmlToDOM(html, parent) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  while (doc.body.firstChild) { parent.appendChild(doc.body.firstChild); }
}

// ---- Theme & size controls ----

document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
});

document.querySelectorAll('[data-width]').forEach(btn => {
  btn.addEventListener('click', () => {
    const app = document.getElementById('sidecar-app');
    app.style.maxWidth = btn.dataset.width + 'px';
    document.querySelectorAll('[data-width]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ---- Coverage panel ----

async function loadCoverage() {
  const panel = document.getElementById('coverage-content');
  try {
    const res = await fetch('./tool-coverage.json');
    if (!res.ok) { throw new Error('not found'); }
    const data = await res.json();
    let html = '';
    for (const t of data.handled || []) {
      html += `<div class="coverage-item coverage-handled">\u2713 ${t}</div>`;
    }
    for (const t of data.missing || []) {
      html += `<div class="coverage-item coverage-missing">\u2717 ${t}</div>`;
    }
    if (data.generated) {
      html += `<div class="coverage-note">Generated: ${data.generated}</div>`;
    }
    panel.textContent = '';
    htmlToDOM(html, panel);
  } catch {
    panel.textContent = '';
    htmlToDOM(
      '<div class="coverage-note">Run the coverage test to generate data:<br>' +
      '<code>npm test tests/mcp-app/tool-coverage-e2e.integration.test.js</code></div>',
      panel
    );
  }
}
loadCoverage();

// ---- Mock messages ----

/** Helper: create an assistant message with tool parts */
function toolMsg(parts) {
  return { info: { role: 'assistant' }, parts };
}

/** Helper: create a single tool part */
function toolPart(tool, input, output, status = 'completed') {
  return {
    type: 'tool',
    tool,
    state: { status, input, output },
  };
}

const mockMessages = [
  // User message
  { info: { role: 'user' }, parts: [{ type: 'text', text: 'Show me all the tool renderers.' }] },

  // Reasoning block (standalone)
  {
    info: { role: 'assistant' },
    parts: [
      { type: 'reasoning', text: 'The user wants to see all tool renderers. I should demonstrate each tool type with realistic mock data to verify the UI rendering pipeline.' },
      { type: 'text', text: 'Here are all the tool renderers:' },
    ],
  },

  // 1. bash
  toolMsg([toolPart('bash',
    { command: 'ls -la src/mcp-app/tools/', description: 'List tool formatter files' },
    'total 48\ndrwxr-xr-x  14 user  staff   448 Mar 14 10:00 .\n-rw-r--r--   1 user  staff  1234 Mar 14 09:55 bash.js\n-rw-r--r--   1 user  staff   890 Mar 14 09:55 edit.js\n-rw-r--r--   1 user  staff   456 Mar 14 09:55 generic.js\n-rw-r--r--   1 user  staff   678 Mar 14 09:55 glob.js\n-rw-r--r--   1 user  staff   567 Mar 14 09:55 grep.js\n-rw-r--r--   1 user  staff   345 Mar 14 09:55 list.js\n-rw-r--r--   1 user  staff   234 Mar 14 09:55 question.js\n-rw-r--r--   1 user  staff   456 Mar 14 09:55 read.js\n-rw-r--r--   1 user  staff   345 Mar 14 09:55 task.js\n-rw-r--r--   1 user  staff   234 Mar 14 09:55 todo.js\n-rw-r--r--   1 user  staff   567 Mar 14 09:55 webfetch.js\n-rw-r--r--   1 user  staff   456 Mar 14 09:55 write.js'
  )]),

  // 2. bash (running -- no output yet)
  toolMsg([toolPart('bash',
    { command: 'npm test', description: 'Run test suite' },
    null,
    'running'
  )]),

  // 3. read
  toolMsg([toolPart('read',
    { file_path: 'package.json' },
    '     1\t{\n     2\t  "name": "claude-sidecar",\n     3\t  "version": "0.4.0",\n     4\t  "description": "A parallel AI window for Claude Code.",\n     5\t  "main": "src/index.js"\n     6\t}'
  )]),

  // 4. write
  toolMsg([toolPart('write',
    { file_path: 'src/utils/rateLimit.js', content: 'const RATE_LIMIT = 100;\nmodule.exports = { RATE_LIMIT };' },
    'Successfully wrote to src/utils/rateLimit.js'
  )]),

  // 5. edit
  toolMsg([toolPart('edit',
    { file_path: 'package.json', old_string: '"test": "jest"', new_string: '"test": "jest --verbose",\n    "start": "node bin/sidecar.js"' },
    'Successfully edited package.json'
  )]),

  // 6. glob
  toolMsg([toolPart('glob',
    { pattern: 'src/mcp-app/tools/*.js' },
    'src/mcp-app/tools/bash.js\nsrc/mcp-app/tools/edit.js\nsrc/mcp-app/tools/generic.js\nsrc/mcp-app/tools/glob.js\nsrc/mcp-app/tools/grep.js\nsrc/mcp-app/tools/list.js\nsrc/mcp-app/tools/question.js\nsrc/mcp-app/tools/read.js\nsrc/mcp-app/tools/task.js\nsrc/mcp-app/tools/todo.js\nsrc/mcp-app/tools/webfetch.js\nsrc/mcp-app/tools/write.js'
  )]),

  // 7. grep
  toolMsg([toolPart('grep',
    { pattern: 'TODO', path: 'src/' },
    'src/mcp-app/tool-output.js:15:  // TODO: add websearch renderer\nsrc/headless.js:42:  // TODO: configurable timeout\nsrc/context.js:88:  // TODO: handle edge case for empty sessions'
  )]),

  // 8. question
  toolMsg([toolPart('question',
    { question: 'Which deployment target should I use for the staging environment?' },
    'Use the us-east-1 staging cluster.'
  )]),

  // 9. list / ls
  toolMsg([toolPart('list',
    { path: 'src/mcp-app/' },
    'auto-scroll.js\nchat-resource.js\ndev-server.mjs\nhighlight.js\nicons.js\ninteractive-harness.html\ninteractive-harness.js\nlogos.js\nmarkdown.js\nmcp-app.html\nmcp-app.js\nrenderers.js\nstyles.css\ntest-harness.html\ntest-harness.js\ntool-output.js\ntools/\nutils.js'
  )]),

  // 10. task
  toolMsg([toolPart('task',
    { id: 'task-abc123' },
    'Task task-abc123 created successfully.'
  )]),

  // 11. webfetch
  toolMsg([toolPart('webfetch',
    { url: 'https://example.com/api/status' },
    '{"status":"healthy","version":"2.1.0","uptime":"14d 3h 22m"}'
  )]),

  // 12. todowrite
  toolMsg([toolPart('todowrite',
    { todos: [{ id: '1', content: 'Fix tool routing bug', status: 'completed' }, { id: '2', content: 'Build static test harness', status: 'in_progress' }] },
    'Updated 2 todos.'
  )]),

  // 13. generic fallback (unknown tool)
  toolMsg([toolPart('unknowntool',
    { foo: 'bar', baz: 42 },
    'Some raw output from an unknown tool'
  )]),

  // 14. error state
  toolMsg([{
    type: 'tool',
    tool: 'bash',
    state: {
      status: 'error',
      input: { command: 'rm -rf /nonexistent', description: 'Delete nonexistent path' },
      output: 'rm: /nonexistent: No such file or directory',
    },
  }]),

  // Inline reasoning before tool call
  {
    info: { role: 'assistant' },
    parts: [
      { type: 'reasoning', text: 'I need to check the file before editing it to make sure the line exists.' },
      toolPart('read', { file_path: 'src/mcp-app/renderers.js' }, '     1\t/* eslint-env browser */\n     2\t/**\n     3\t * Message rendering functions.'),
      { type: 'text', text: 'I found the file. The rendering pipeline is working correctly.' },
    ],
  },
];

// ---- Render all mock messages ----

for (const msg of mockMessages) {
  const fragment = renderMessage(msg);
  if (fragment) {
    container.appendChild(fragment);
  }
}
