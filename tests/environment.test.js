/**
 * Environment Detection Tests
 *
 * Tests for inferClient(), getSessionRoot(), and detectEnvironment()
 * which detect the client type, display availability, and session
 * root directory based on platform and CLI arguments.
 */

const path = require('path');
const os = require('os');

// Module under test
const {
  inferClient,
  getSessionRoot,
  detectEnvironment,
  VALID_CLIENTS
} = require('../src/environment');

describe('Environment Detection', () => {

  describe('VALID_CLIENTS', () => {
    it('should export the valid client types', () => {
      expect(VALID_CLIENTS).toEqual(['code-local', 'code-web', 'cowork', 'mcp-app']);
    });
  });

  describe('inferClient', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      // Clear display-related env vars for clean tests
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return explicit --client when provided and valid', () => {
      const result = inferClient({ client: 'cowork' }, 'darwin');
      expect(result).toBe('cowork');
    });

    it('should return explicit --client code-web when provided', () => {
      const result = inferClient({ client: 'code-web' }, 'darwin');
      expect(result).toBe('code-web');
    });

    it('should return explicit --client code-local when provided', () => {
      const result = inferClient({ client: 'code-local' }, 'linux');
      expect(result).toBe('code-local');
    });

    it('should throw for invalid --client value', () => {
      expect(() => inferClient({ client: 'invalid' }, 'darwin'))
        .toThrow(/invalid client/i);
    });

    it('should detect code-local on macOS (darwin)', () => {
      const result = inferClient({}, 'darwin');
      expect(result).toBe('code-local');
    });

    it('should detect code-local when DISPLAY is set on linux', () => {
      process.env.DISPLAY = ':0';
      const result = inferClient({}, 'linux');
      expect(result).toBe('code-local');
    });

    it('should detect code-local when WAYLAND_DISPLAY is set on linux', () => {
      process.env.WAYLAND_DISPLAY = 'wayland-0';
      const result = inferClient({}, 'linux');
      expect(result).toBe('code-local');
    });

    it('should detect code-web when no display on linux', () => {
      const result = inferClient({}, 'linux');
      expect(result).toBe('code-web');
    });

    it('should detect code-web on unknown platform without display', () => {
      const result = inferClient({}, 'freebsd');
      expect(result).toBe('code-web');
    });
  });

  describe('getSessionRoot', () => {
    const homedir = os.homedir();

    it('should return --session-dir when provided', () => {
      const customDir = '/tmp/my-sessions';
      const result = getSessionRoot(
        { sessionDir: customDir, client: 'code-local' },
        'darwin'
      );
      expect(result).toBe(customDir);
    });

    it('should return Claude Code path for code-local', () => {
      const cwd = '/Users/john/projects/myapp';
      const result = getSessionRoot(
        { client: 'code-local', cwd },
        'darwin'
      );

      // cwd with / replaced by -
      const encodedPath = '-Users-john-projects-myapp';
      const expected = path.join(homedir, '.claude', 'projects', encodedPath);
      expect(result).toBe(expected);
    });

    it('should encode cwd path separators as dashes for code-local', () => {
      const cwd = '/home/user/my_project';
      const result = getSessionRoot(
        { client: 'code-local', cwd },
        'linux'
      );

      // / and _ replaced by -
      const encodedPath = '-home-user-my-project';
      const expected = path.join(homedir, '.claude', 'projects', encodedPath);
      expect(result).toBe(expected);
    });

    it('should use process.cwd() when cwd not provided for code-local', () => {
      const result = getSessionRoot(
        { client: 'code-local' },
        'darwin'
      );

      const currentCwd = process.cwd();
      const encodedPath = currentCwd.replace(/[/\\_]/g, '-');
      const expected = path.join(homedir, '.claude', 'projects', encodedPath);
      expect(result).toBe(expected);
    });

    it('should throw for code-web without --session-dir', () => {
      expect(() => getSessionRoot({ client: 'code-web' }, 'linux'))
        .toThrow('--session-dir is required when --client is code-web');
    });

    it('should return code-web session-dir when provided', () => {
      const result = getSessionRoot(
        { client: 'code-web', sessionDir: '/tmp/web-sessions' },
        'linux'
      );
      expect(result).toBe('/tmp/web-sessions');
    });

    it('should return Cowork path for cowork on macOS', () => {
      const result = getSessionRoot({ client: 'cowork' }, 'darwin');
      const expected = path.join(homedir, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
      expect(result).toBe(expected);
    });

    it('should return Cowork path for cowork on Windows', () => {
      const originalAppdata = process.env.APPDATA;
      process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';

      const result = getSessionRoot({ client: 'cowork' }, 'win32');
      const expected = path.join('C:\\Users\\test\\AppData\\Roaming', 'Claude', 'local-agent-mode-sessions');
      expect(result).toBe(expected);

      process.env.APPDATA = originalAppdata;
    });

    it('should return Cowork path for cowork on Linux', () => {
      const result = getSessionRoot({ client: 'cowork' }, 'linux');
      const expected = path.join(homedir, '.config', 'Claude', 'local-agent-mode-sessions');
      expect(result).toBe(expected);
    });
  });

  describe('detectEnvironment', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return client, hasDisplay, and sessionRoot', () => {
      const result = detectEnvironment(
        { client: 'code-local', cwd: '/tmp/test' },
        'darwin'
      );

      expect(result).toHaveProperty('client');
      expect(result).toHaveProperty('hasDisplay');
      expect(result).toHaveProperty('sessionRoot');
    });

    it('should set hasDisplay=false for code-web', () => {
      const result = detectEnvironment(
        { client: 'code-web', sessionDir: '/tmp/sessions' },
        'linux'
      );

      expect(result.client).toBe('code-web');
      expect(result.hasDisplay).toBe(false);
    });

    it('should set hasDisplay=true for code-local', () => {
      const result = detectEnvironment(
        { client: 'code-local', cwd: '/tmp/test' },
        'darwin'
      );

      expect(result.client).toBe('code-local');
      expect(result.hasDisplay).toBe(true);
    });

    it('should set hasDisplay=true for cowork', () => {
      const result = detectEnvironment(
        { client: 'cowork' },
        'darwin'
      );

      expect(result.client).toBe('cowork');
      expect(result.hasDisplay).toBe(true);
    });

    it('should infer client when not explicitly provided', () => {
      const result = detectEnvironment(
        { cwd: '/tmp/test' },
        'darwin'
      );

      expect(result.client).toBe('code-local');
      expect(result.hasDisplay).toBe(true);
    });

    it('should compute sessionRoot based on inferred client', () => {
      const result = detectEnvironment(
        { cwd: '/tmp/test' },
        'darwin'
      );

      const encodedPath = '-tmp-test';
      const expected = path.join(os.homedir(), '.claude', 'projects', encodedPath);
      expect(result.sessionRoot).toBe(expected);
    });
  });
});
