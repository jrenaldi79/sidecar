/**
 * MCP Tool Definitions Tests
 *
 * Tests for tool schema structure, required tools, input schema validation,
 * and the sidecar_guide text content.
 */

const { TOOLS, getGuideText, safeTaskId, safeModel } = require('../src/mcp-tools');

describe('MCP Tool Definitions', () => {
  test('exports TOOLS array with correct structure', () => {
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS.length).toBeGreaterThan(0);

    for (const tool of TOOLS) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.inputSchema).toBe('object');
    }
  });

  test('has all required tools', () => {
    const names = TOOLS.map(t => t.name);

    expect(names).toContain('sidecar_start');
    expect(names).toContain('sidecar_status');
    expect(names).toContain('sidecar_read');
    expect(names).toContain('sidecar_list');
    expect(names).toContain('sidecar_resume');
    expect(names).toContain('sidecar_continue');
    expect(names).toContain('sidecar_setup');
    expect(names).toContain('sidecar_guide');
    expect(names).toContain('sidecar_abort');
  });

  test('has exactly 9 tools', () => {
    expect(TOOLS).toHaveLength(9);
  });

  test('tool names are unique', () => {
    const names = TOOLS.map(t => t.name);
    const uniqueNames = [...new Set(names)];
    expect(names).toHaveLength(uniqueNames.length);
  });

  test('all tool names use snake_case with sidecar_ prefix', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^sidecar_[a-z_]+$/);
    }
  });

  test('all descriptions are non-empty', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  describe('sidecar_start', () => {
    let startTool;

    beforeAll(() => {
      startTool = TOOLS.find(t => t.name === 'sidecar_start');
    });

    test('has prompt in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('prompt');
    });

    test('has model in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('model');
    });

    test('has agent in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('agent');
    });

    test('has noUi in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('noUi');
    });

    test('has thinking in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('thinking');
    });

    test('has timeout in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('timeout');
    });

    test('has contextTurns in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('contextTurns');
    });

    test('has contextSince in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('contextSince');
    });

    test('has contextMaxTokens in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('contextMaxTokens');
    });

    test('has summaryLength in input schema', () => {
      expect(startTool.inputSchema).toHaveProperty('summaryLength');
    });
  });

  describe('sidecar_status', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_status');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });
  });

  describe('sidecar_read', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_read');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('has mode in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_read');
      expect(tool.inputSchema).toHaveProperty('mode');
    });
  });

  describe('sidecar_list', () => {
    test('has status in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_list');
      expect(tool.inputSchema).toHaveProperty('status');
    });
  });

  describe('sidecar_resume', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_resume');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('has noUi in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_resume');
      expect(tool.inputSchema).toHaveProperty('noUi');
    });

    test('has timeout in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_resume');
      expect(tool.inputSchema).toHaveProperty('timeout');
    });
  });

  describe('sidecar_continue', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_continue');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('has prompt in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_continue');
      expect(tool.inputSchema).toHaveProperty('prompt');
    });

    test('has model in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_continue');
      expect(tool.inputSchema).toHaveProperty('model');
    });

    test('has noUi in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_continue');
      expect(tool.inputSchema).toHaveProperty('noUi');
    });

    test('has timeout in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_continue');
      expect(tool.inputSchema).toHaveProperty('timeout');
    });

    test('has contextTurns in input schema with correct description', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_continue');
      expect(tool.inputSchema.contextTurns.description).toContain('Default: 80000 tokens.');
    });

    test('has contextMaxTokens in input schema with correct description', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_continue');
      expect(tool.inputSchema.contextMaxTokens.description).toContain('Default: 80000.');
    });
  });

  describe('sidecar_setup', () => {
    test('has empty input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_setup');
      expect(Object.keys(tool.inputSchema)).toHaveLength(0);
    });
  });

  describe('sidecar_guide', () => {
    test('has empty input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_guide');
      expect(Object.keys(tool.inputSchema)).toHaveLength(0);
    });
  });

  describe('sidecar_abort', () => {
    test('has taskId in input schema', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_abort');
      expect(tool.inputSchema).toHaveProperty('taskId');
    });

    test('description mentions abort', () => {
      const tool = TOOLS.find(t => t.name === 'sidecar_abort');
      expect(tool.description.toLowerCase()).toContain('abort');
    });
  });

  describe('getGuideText', () => {
    test('returns non-empty string with key sections', () => {
      const guide = getGuideText();
      expect(typeof guide).toBe('string');
      expect(guide.length).toBeGreaterThan(100);
      expect(guide).toContain('sidecar');
    });

    test('contains workflow instructions', () => {
      const guide = getGuideText();
      expect(guide).toContain('sidecar_start');
      expect(guide).toContain('sidecar_status');
      expect(guide).toContain('sidecar_read');
    });

    test('contains agent selection guidance', () => {
      const guide = getGuideText();
      expect(guide).toContain('Chat');
      expect(guide).toContain('Plan');
      expect(guide).toContain('Build');
    });

    test('contains briefing guidance', () => {
      const guide = getGuideText();
      expect(guide.toLowerCase()).toContain('briefing');
    });
  });

  describe('Input Validation (Security)', () => {
    test('safeTaskId accepts valid IDs', () => {
      expect(safeTaskId.parse('abc-123')).toBe('abc-123');
      expect(safeTaskId.parse('task_001')).toBe('task_001');
      expect(safeTaskId.parse('a'.repeat(64))).toBe('a'.repeat(64));
    });

    test('safeTaskId rejects path traversal', () => {
      expect(() => safeTaskId.parse('../etc/passwd')).toThrow();
      expect(() => safeTaskId.parse('task/../../../etc')).toThrow();
      expect(() => safeTaskId.parse('../../..')).toThrow();
    });

    test('safeTaskId rejects empty and too-long IDs', () => {
      expect(() => safeTaskId.parse('')).toThrow();
      expect(() => safeTaskId.parse('a'.repeat(65))).toThrow();
    });

    test('safeTaskId rejects special characters', () => {
      expect(() => safeTaskId.parse('task;rm -rf /')).toThrow();
      expect(() => safeTaskId.parse('task$(evil)')).toThrow();
    });

    test('safeModel accepts valid model strings', () => {
      expect(safeModel.parse('gemini')).toBe('gemini');
      expect(safeModel.parse('openrouter/google/gemini-3-flash-preview')).toBe('openrouter/google/gemini-3-flash-preview');
      expect(safeModel.parse('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    });

    test('safeModel rejects flag injection', () => {
      expect(() => safeModel.parse('--malicious')).toThrow();
      expect(() => safeModel.parse('-flag')).toThrow();
    });

    test('safeModel rejects shell metacharacters', () => {
      expect(() => safeModel.parse('model;rm -rf /')).toThrow();
      expect(() => safeModel.parse('model$(evil)')).toThrow();
    });
  });
});
