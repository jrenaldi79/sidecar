/**
 * Build the HTML resource for ui://sidecar/chat.
 * Reads the Vite-bundled single-file HTML from dist/.
 *
 * Build with: npx vite build --config vite.config.mcp-app.mjs
 *
 * @module mcp-app/chat-resource
 */

const fs = require('fs');
const path = require('path');

const DIST_PATH = path.join(__dirname, '..', '..', 'dist', 'mcp-app.html');

function buildChatResource() {
  return fs.readFileSync(DIST_PATH, 'utf-8');
}

module.exports = { buildChatResource };
