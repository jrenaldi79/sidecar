/**
 * Vite config for the static test harness.
 * Uses the cjsToEsm() plugin to handle CJS source files (tool-output.js, etc.)
 * No proxy or define globals needed -- all data is static mocks.
 */

/** Inline plugin: convert CJS patterns to ESM for Vite dev mode. */
function cjsToEsm() {
  return {
    name: 'cjs-to-esm',
    transform(code, id) {
      if (!id.endsWith('.js') || !id.includes('/mcp-app/')) { return null; }
      if (!code.includes('module.exports') && !code.includes('require(')) { return null; }
      let out = code;
      out = out.replace(
        /const\s+(\{[^}]+\})\s*=\s*require\((['"][^'"]+['"])\);?/g,
        'import $1 from $2;',
      );
      out = out.replace(
        /const\s+(\w+)\s*=\s*require\((['"][^'"]+['"])\);?/g,
        'import $1 from $2;',
      );
      out = out.replace(
        /module\.exports\s*=\s*\{([^}]+)\};?/g,
        (_match, inner) => `export { ${inner.trim()} };`,
      );
      if (out === code) { return null; }
      return { code: out, map: null };
    },
  };
}

export default {
  root: 'src/mcp-app',
  plugins: [cjsToEsm()],
  server: { port: 5175 },
};
