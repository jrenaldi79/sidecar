const os = require('os');
const fs = require('fs');
const path = require('path');

describe('getProjectDir', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('returns explicit project path when valid directory', () => {
    const { getProjectDir } = require('../src/mcp-server');
    const result = getProjectDir(os.tmpdir());
    expect(result).toBe(os.tmpdir());
  });

  test('ignores explicit project path when directory does not exist', () => {
    const { getProjectDir } = require('../src/mcp-server');
    const result = getProjectDir('/nonexistent/path/that/does/not/exist');
    expect(result).not.toBe('/nonexistent/path/that/does/not/exist');
  });

  test('falls back to $HOME when cwd is root /', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/';
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir();
      expect(result).toBe(os.homedir());
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('uses cwd when it is a valid writable directory', () => {
    const originalCwd = process.cwd;
    process.cwd = () => os.tmpdir();
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir();
      expect(result).toBe(os.tmpdir());
    } finally {
      process.cwd = originalCwd;
    }
  });

  test('returns $HOME when no explicit project and cwd is root', () => {
    const originalCwd = process.cwd;
    process.cwd = () => '/';
    try {
      jest.resetModules();
      const { getProjectDir } = require('../src/mcp-server');
      const result = getProjectDir(undefined);
      expect(result).toBe(os.homedir());
    } finally {
      process.cwd = originalCwd;
    }
  });
});
