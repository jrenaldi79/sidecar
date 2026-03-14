#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Interactive harness dev server.
 * Starts OpenCode + Vite, proxies /api/* to the OpenCode HTTP API.
 *
 * Usage:
 *   node src/mcp-app/dev-server.mjs --model gemini --prompt "Hello"
 *   npm run dev:ui -- --model gemini --prompt "Hello"
 */
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { startServer, createSession, sendPrompt } from '../opencode-client.js';
import { tryResolveModel } from '../utils/config.js';

const { values: args } = parseArgs({
  options: {
    model: { type: 'string', short: 'm' },
    prompt: { type: 'string', short: 'p' },
    agent: { type: 'string', short: 'a' },
    thinking: { type: 'string', short: 't' },
  },
});

if (!args.prompt) {
  console.error('Usage: node src/mcp-app/dev-server.mjs --model <alias> --prompt "<text>"');
  process.exit(1);
}

// Resolve model alias (e.g. "gemini" -> full model ID)
const modelResult = args.model ? tryResolveModel(args.model) : {};
if (modelResult.error) {
  console.error(`Model error: ${modelResult.error}`);
  process.exit(1);
}
const resolvedModel = modelResult.model;

// 1. Start OpenCode server (pass client: 'mcp-app' for production agent setup)
console.log(`Starting OpenCode server${resolvedModel ? ` (${args.model})` : ''}...`);
const { client, server } = await startServer({ model: resolvedModel, client: 'mcp-app' });
const opencodePort = new URL(server.url).port;
console.log(`OpenCode running on port ${opencodePort}`);

// 2. Create session + send initial prompt
const sessionId = await createSession(client);
console.log(`Session: ${sessionId}`);

await sendPrompt(client, sessionId, {
  model: resolvedModel,
  parts: [{ type: 'text', text: args.prompt }],
  ...(args.agent && { agent: args.agent }),
  ...(args.thinking && { reasoning: { effort: args.thinking } }),
});
console.log('Prompt sent.');

// 3. Start Vite dev server with proxy
// Inline plugin converts CJS patterns (require/module.exports) to ESM for Vite dev mode.
// @rollup/plugin-commonjs only works during Rollup builds, not Vite's dev transform pipeline.
const vite = await import('vite');
function cjsToEsm() {
  return {
    name: 'cjs-to-esm',
    transform(code, id) {
      if (!id.endsWith('.js') || !id.includes('/mcp-app/')) { return null; }
      if (!code.includes('module.exports') && !code.includes('require(')) { return null; }
      let out = code;
      // Convert: const { X, Y } = require('./file')  ->  import { X, Y } from './file'
      out = out.replace(
        /const\s+(\{[^}]+\})\s*=\s*require\((['"][^'"]+['"])\);?/g,
        'import $1 from $2;',
      );
      // Convert: const X = require('./file')  ->  import X from './file'
      out = out.replace(
        /const\s+(\w+)\s*=\s*require\((['"][^'"]+['"])\);?/g,
        'import $1 from $2;',
      );
      // Convert: module.exports = { X, Y }  ->  export { X, Y }
      out = out.replace(
        /module\.exports\s*=\s*\{([^}]+)\};?/g,
        (_match, inner) => `export { ${inner.trim()} };`,
      );
      if (out === code) { return null; }
      return { code: out, map: null };
    },
  };
}
const viteServer = await vite.createServer({
  root: 'src/mcp-app',
  plugins: [cjsToEsm()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: `http://localhost:${opencodePort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  define: {
    __SIDECAR_TASK_ID__: JSON.stringify(`dev-${Date.now()}`),
    __SIDECAR_MODEL__: JSON.stringify(resolvedModel || args.model || 'unknown'),
    __SIDECAR_SESSION_ID__: JSON.stringify(sessionId),
  },
});
await viteServer.listen();

const url = 'http://localhost:5174/interactive-harness.html';
console.log(`\nInteractive harness: ${url}`);
console.log('Press Ctrl+C to stop the server (closing the browser tab does not stop it).\n');

// 4. Open browser (macOS; dev-only tool)
execFile('open', [url]);

// 5. Clean shutdown on Ctrl+C
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await viteServer.close();
  await server.close();
  process.exit(0);
});
