/**
 * Spawn Stdio Configuration Tests
 *
 * Verifies the fix for Bug #4 from the Sidecar MCP RCA: headless mode
 * hangs when spawned as a detached child because nobody reads the piped
 * stderr, causing a pipe buffer deadlock.
 *
 * Root cause: spawnSidecarProcess() used stdio: ['ignore', 'pipe', 'pipe']
 * but never read from the pipes. When the child (OpenCode Go binary + MCP
 * servers) wrote >64KB to stderr, the pipe buffer filled and the child's
 * write() syscall blocked, deadlocking the entire process.
 *
 * Fix: Use stdio: ['ignore', 'ignore', 'ignore'] since the parent never
 * reads the pipes. Session data is persisted to disk files, not stdout.
 */

const path = require('path');
const fs = require('fs');

describe('spawnSidecarProcess stdio configuration (Bug #4 fix)', () => {
  it('does not use unread pipe for stdout or stderr', () => {
    const spawnSrc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'mcp-server.js'), 'utf-8'
    );

    // Find the spawn() call in spawnSidecarProcess
    const fnMatch = spawnSrc.match(/function spawnSidecarProcess[\s\S]*?^}/m);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch[0];

    // The stdio config should NOT use 'pipe' — nobody reads the pipes
    expect(fnBody).not.toMatch(/stdio:.*'pipe'/);
    expect(fnBody).not.toMatch(/stdio:.*"pipe"/);
  });

  it('uses ignore for all stdio streams in detached spawn', () => {
    const spawnSrc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'mcp-server.js'), 'utf-8'
    );

    // Find the stdio config
    const stdioParts = spawnSrc.match(/stdio:\s*\[([^\]]+)\]/);
    expect(stdioParts).toBeTruthy();

    // All three streams should be 'ignore' (stdin, stdout, stderr)
    const parts = stdioParts[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    expect(parts).toEqual(['ignore', 'ignore', 'ignore']);
  });

  it('spawns as detached with unref for fire-and-forget behavior', () => {
    const spawnSrc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'mcp-server.js'), 'utf-8'
    );

    const fnMatch = spawnSrc.match(/function spawnSidecarProcess[\s\S]*?^}/m);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch[0];

    expect(fnBody).toContain('detached: true');
    expect(fnBody).toContain('child.unref()');
  });
});
