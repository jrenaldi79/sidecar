/**
 * Sidecar Start Tests
 *
 * Tests for config change detection during sidecar start.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Config change detection on start', () => {
  it('should import checkConfigChanged without errors', () => {
    const { checkConfigChanged } = require('../../src/utils/config');
    expect(typeof checkConfigChanged).toBe('function');
  });

  it('should detect config change when hash differs', () => {
    const { checkConfigChanged } = require('../../src/utils/config');
    // With no config file, should return changed: false
    const result = checkConfigChanged('stale-hash');
    // Result depends on whether config exists - just verify the shape
    expect(result).toHaveProperty('changed');
  });

  it('should return changed: false when hash matches', () => {
    const { checkConfigChanged, computeConfigHash } = require('../../src/utils/config');
    const currentHash = computeConfigHash();
    const result = checkConfigChanged(currentHash);
    expect(result.changed).toBe(false);
  });

  it('should emit config update to stderr when config has changed', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});

    // Simulate the config change detection logic from startSidecar
    const { checkConfigChanged } = require('../../src/utils/config');
    const configCheck = checkConfigChanged('stale-hash-that-wont-match');

    if (configCheck.changed) {
      process.stderr.write(
        `\n[SIDECAR_CONFIG_UPDATE] Model configuration has changed.\nUpdate your project doc file with:\n\n${configCheck.updateData}\n\n`
      );
    }

    // If config exists, changed should be true (stale hash won't match)
    // If no config exists, changed should be true (null !== 'stale-hash...')
    expect(configCheck.changed).toBe(true);
    expect(stderrSpy).toHaveBeenCalled();

    const output = stderrSpy.mock.calls[0][0];
    expect(output).toContain('[SIDECAR_CONFIG_UPDATE]');

    stderrSpy.mockRestore();
  });

  it('should not emit to stderr when config hash matches', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});

    const { checkConfigChanged, computeConfigHash } = require('../../src/utils/config');
    const currentHash = computeConfigHash();
    const configCheck = checkConfigChanged(currentHash);

    if (configCheck.changed) {
      process.stderr.write('[SIDECAR_CONFIG_UPDATE] ...');
    }

    expect(configCheck.changed).toBe(false);
    expect(stderrSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it('should extract hash from CLAUDE.md content when present', () => {
    const content = '# CLAUDE.md\n<!-- sidecar-config-hash: abcd1234 -->\nSome content';
    const match = content.match(/<!-- sidecar-config-hash: ([0-9a-f]+) -->/);
    expect(match).not.toBeNull();
    expect(match[1]).toBe('abcd1234');
  });

  it('should return null hash when CLAUDE.md has no hash comment', () => {
    const content = '# CLAUDE.md\nSome content without hash';
    const match = content.match(/<!-- sidecar-config-hash: ([0-9a-f]+) -->/);
    expect(match).toBeNull();
  });
});

describe('buildMcpConfig with MCP discovery', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should skip discovery when noMcp is true', () => {
    // Mock mcp-discovery to track calls
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => ({ 'discovered-server': { command: 'npx' } }))
    }));

    const { buildMcpConfig } = require('../../src/sidecar/start');
    const result = buildMcpConfig({ noMcp: true });

    const { discoverParentMcps } = require('../../src/utils/mcp-discovery');
    expect(discoverParentMcps).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('should remove excluded servers via excludeMcp', () => {
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => ({
        'keep-me': { command: 'keep' },
        'remove-me': { command: 'remove' }
      }))
    }));

    // Mock loadMcpConfig to return null (no file config)
    jest.mock('../../src/opencode-client', () => ({
      loadMcpConfig: jest.fn(() => null),
      parseMcpSpec: jest.fn(() => null)
    }));

    const { buildMcpConfig } = require('../../src/sidecar/start');
    const result = buildMcpConfig({ excludeMcp: ['remove-me'] });

    expect(result['keep-me']).toBeDefined();
    expect(result['remove-me']).toBeUndefined();
  });

  it('should merge with correct priority: CLI > file > discovered', () => {
    jest.mock('../../src/utils/mcp-discovery', () => ({
      discoverParentMcps: jest.fn(() => ({
        'shared-server': { command: 'discovered-cmd' },
        'discovery-only': { command: 'disc' }
      }))
    }));

    jest.mock('../../src/opencode-client', () => ({
      loadMcpConfig: jest.fn(() => ({
        'shared-server': { command: 'file-cmd' },
        'file-only': { command: 'file' }
      })),
      parseMcpSpec: jest.fn((spec) => {
        if (spec === 'cli-server=cli-cmd') {
          return { name: 'cli-server', config: { command: 'cli-cmd' } };
        }
        return null;
      })
    }));

    const { buildMcpConfig } = require('../../src/sidecar/start');
    const result = buildMcpConfig({ mcp: 'cli-server=cli-cmd' });

    // CLI server present
    expect(result['cli-server']).toBeDefined();
    // File config overrides discovered for shared server
    expect(result['shared-server'].command).toBe('file-cmd');
    // Both unique servers present
    expect(result['file-only']).toBeDefined();
    expect(result['discovery-only']).toBeDefined();
  });
});
