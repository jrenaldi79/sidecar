/**
 * Build the HTML resource for ui://sidecar/chat.
 * Served by the MCP server as an inline HTML resource.
 *
 * Architecture:
 *   - Outer div: full viewport, flex column
 *   - Inner iframe: loads OpenCode web UI at localhost
 *   - Toolbar div: branding, timer, chat input, fold button
 *   - JS: communicates via App.callTool / App.updateContext
 *
 * @module mcp-app/chat-resource
 */

const { CHAT_STYLES } = require('./chat-styles');
const { CHAT_SCRIPT } = require('./chat-script');

function buildChatResource() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CHAT_STYLES}</style>
</head>
<body>
<div id="sidecar-app" style="position: relative;">
  <iframe id="opencode-frame" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>

  <div id="fold-overlay">
    <div class="fold-spinner"></div>
    <div class="fold-status" id="fold-status-text">Generating summary...</div>
  </div>

  <div id="sidecar-toolbar">
    <div class="toolbar-info">
      <span class="toolbar-brand">Sidecar</span>
      <span class="toolbar-sep">&middot;</span>
      <span id="model-badge"></span>
      <span class="toolbar-sep">&middot;</span>
      <span class="toolbar-task-id" id="task-id-display"></span>
      <span class="toolbar-sep">&middot;</span>
      <span id="timer">0:00</span>
    </div>
    <div class="toolbar-input-area">
      <input type="text" id="chat-input" placeholder="Message..." autocomplete="off">
      <button id="send-btn">&uarr;</button>
    </div>
    <div class="toolbar-divider"></div>
    <button id="fold-btn">Fold &#9166;</button>
  </div>
</div>
<script>${CHAT_SCRIPT}</script>
</body>
</html>`;
}

module.exports = { buildChatResource };
