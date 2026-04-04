/**
 * MCP Normalization E2E Integration Test
 *
 * Tests the full pipeline: MCP config file → buildMcpConfig() → buildServerOptions()
 * using real filesystem fixtures and real sidecar sessions. Verifies that MCP servers
 * defined in various input formats (stdio, http, sse, Claude Desktop) survive
 * normalization and reach the OpenCode SDK without errors.
 *
 * Part 1: Config pipeline test (no API key needed)
 * Part 2: Live sidecar session test (requires OPENROUTER_API_KEY)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SIDECAR_BIN = path.join(__dirname, '..', 'bin', 'sidecar.js');
const NODE = process.execPath;

// --- Part 1: Config pipeline (no API key) ---

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const { buildServerOptions, loadMcpConfig } = require('../src/opencode-client');

describe('MCP normalization pipeline (config file → buildServerOptions)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-norm-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads mixed-format MCP config from file and normalizes all entries', () => {
    // Write an opencode.json with every input format
    const configPath = path.join(tmpDir, 'opencode.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcp: {
        'local-stdio': {
          type: 'stdio',
          command: 'node',
          args: ['server.js', '--port', '3000']
        },
        'local-desktop': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem']
        },
        'remote-http': {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: { Authorization: 'Bearer secret-token' },
          timeout: 30
        },
        'remote-sse': {
          type: 'sse',
          url: 'https://stream.example.com/events',
          enabled: false
        },
        'already-local': {
          type: 'local',
          enabled: true,
          command: ['python', '-m', 'mcp_server']
        },
        'already-remote': {
          type: 'remote',
          enabled: true,
          url: 'https://already.example.com/mcp'
        }
      }
    }));

    // Step 1: Load from file (simulates Layer 2 of buildMcpConfig)
    const loaded = loadMcpConfig(configPath);
    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded)).toHaveLength(6);

    // Step 2: Normalize through buildServerOptions
    const opts = buildServerOptions({ mcp: loaded });
    const mcp = opts.config.mcp;

    // Verify stdio → local
    expect(mcp['local-stdio']).toEqual({
      type: 'local',
      enabled: true,
      command: ['node', 'server.js', '--port', '3000']
    });

    // Verify Claude Desktop (no type) → local
    expect(mcp['local-desktop']).toEqual({
      type: 'local',
      enabled: true,
      command: ['npx', '-y', '@modelcontextprotocol/server-filesystem']
    });

    // Verify http → remote, with headers preserved
    expect(mcp['remote-http']).toEqual({
      type: 'remote',
      enabled: true,
      url: 'https://api.example.com/mcp',
      headers: { Authorization: 'Bearer secret-token' },
      timeout: 30
    });

    // Verify sse → remote, with enabled:false preserved
    expect(mcp['remote-sse']).toEqual({
      type: 'remote',
      enabled: false,
      url: 'https://stream.example.com/events'
    });

    // Verify pass-through for already-normalized entries
    expect(mcp['already-local']).toEqual({
      type: 'local',
      enabled: true,
      command: ['python', '-m', 'mcp_server']
    });
    expect(mcp['already-remote']).toEqual({
      type: 'remote',
      enabled: true,
      url: 'https://already.example.com/mcp'
    });
  });

  it('skips malformed entries and normalizes the rest', () => {
    const configPath = path.join(tmpDir, 'opencode.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcp: {
        'bad-stdio': { type: 'stdio' },
        'bad-http': { type: 'http' },
        'good-stdio': { type: 'stdio', command: 'node', args: ['ok.js'] },
        'good-http': { type: 'http', url: 'https://ok.example.com' }
      }
    }));

    const loaded = loadMcpConfig(configPath);
    const opts = buildServerOptions({ mcp: loaded });
    const mcp = opts.config.mcp;

    // Malformed entries skipped
    expect(mcp['bad-stdio']).toBeUndefined();
    expect(mcp['bad-http']).toBeUndefined();

    // Valid entries normalized
    expect(mcp['good-stdio'].type).toBe('local');
    expect(mcp['good-http'].type).toBe('remote');
  });

  it('preserves oauth config on remote servers', () => {
    const opts = buildServerOptions({
      mcp: {
        oauth: {
          type: 'http',
          url: 'https://secure.example.com/mcp',
          oauth: {
            clientId: 'test-client',
            authUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token'
          }
        }
      }
    });

    expect(opts.config.mcp.oauth).toEqual({
      type: 'remote',
      enabled: true,
      url: 'https://secure.example.com/mcp',
      oauth: {
        clientId: 'test-client',
        authUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token'
      }
    });
  });
});

// --- Part 2: Live sidecar session with MCP configs (requires API key) ---

const HAS_API_KEY = !!(
  process.env.OPENROUTER_API_KEY ||
  (() => {
    try {
      const envPath = path.join(os.homedir(), '.config', 'sidecar', '.env');
      const content = fs.readFileSync(envPath, 'utf-8');
      return content.includes('OPENROUTER_API_KEY=');
    } catch { return false; }
  })()
);

const describeE2E = HAS_API_KEY ? describe : describe.skip;

describeE2E('MCP normalization live sidecar session', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-norm-live-'));
  });

  afterEach(() => {
    if (tmpDir) {
      process.stderr.write(`  [mcp-norm-e2e] Session dir: ${tmpDir}\n`);
    }
  });

  it('starts a headless sidecar with mixed MCP config without ConfigInvalidError', async () => {
    // Write an opencode.json with configs that need normalization
    const configPath = path.join(tmpDir, 'opencode.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcp: {
        // stdio format → should be normalized to local
        'test-echo': {
          type: 'stdio',
          command: 'echo',
          args: ['mcp-test-ok']
        },
        // Claude Desktop format (no type) → should be normalized to local
        'test-desktop': {
          command: 'echo',
          args: ['desktop-format-ok']
        }
      }
    }));

    // Start sidecar with --mcp-config pointing to our test config
    const result = await new Promise((resolve, reject) => {
      const child = spawn(NODE, [
        SIDECAR_BIN, 'start',
        '--prompt', 'Say exactly: MCP_NORM_OK',
        '--model', 'gemini-flash',
        '--no-ui',
        '--timeout', '2',
        '--mcp-config', configPath,
        '--no-mcp',
        '--cwd', tmpDir
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        timeout: 120000
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });

      child.on('error', reject);

      setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ code: -1, stdout, stderr: stderr + '\n[TIMEOUT]' });
      }, 90000);
    });

    // The key assertion: no ConfigInvalidError from bad MCP format
    expect(result.stderr).not.toContain('ConfigInvalidError');
    expect(result.stderr).not.toContain('Invalid config');

    // Sidecar should have started (may timeout on LLM, but config should be valid)
    process.stderr.write(`  [mcp-norm-e2e] exit=${result.code} stderr=${result.stderr.slice(0, 500)}\n`);
  }, 120000);
});
