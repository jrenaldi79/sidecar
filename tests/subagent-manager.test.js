/**
 * Tests for subagent-manager.js
 * TDD Red Phase - Writing failing tests first
 *
 * Tests the sub-agent lifecycle management including:
 * - Spawning sub-agents with concurrency limits
 * - Tracking sub-agent status
 * - Reading sub-agent results
 * - Auto-folding results back to parent
 */

const EventEmitter = require('events');

// Mock the opencode-client module
jest.mock('../src/opencode-client', () => ({
  createClient: jest.fn(),
  createSession: jest.fn(),
  sendPrompt: jest.fn(),
  getMessages: jest.fn(),
  parseModelString: jest.fn(model => ({ providerID: 'openrouter', modelID: model }))
}));

const {
  SubagentManager,
  MAX_CONCURRENT,
  SUBAGENT_STATUS
} = require('../src/subagent-manager');

const opencodeClient = require('../src/opencode-client');

describe('subagent-manager', () => {
  let manager;
  let mockClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock client
    mockClient = {
      session: {
        create: jest.fn(),
        prompt: jest.fn(),
        messages: jest.fn(),
        children: jest.fn(),
        status: jest.fn()
      }
    };

    opencodeClient.createClient.mockResolvedValue(mockClient);
    opencodeClient.createSession.mockResolvedValue('child-session-123');
    opencodeClient.sendPrompt.mockResolvedValue({ data: { status: 'completed' } });
    opencodeClient.getMessages.mockResolvedValue([]);

    manager = new SubagentManager({
      client: mockClient,
      parentSessionId: 'parent-session-456'
    });
  });

  afterEach(() => {
    if (manager) {
      manager.destroy();
    }
  });

  describe('constants', () => {
    it('should export MAX_CONCURRENT constant', () => {
      expect(MAX_CONCURRENT).toBeDefined();
      expect(MAX_CONCURRENT).toBe(5);
    });

    it('should export SUBAGENT_STATUS constants', () => {
      expect(SUBAGENT_STATUS).toBeDefined();
      expect(SUBAGENT_STATUS.PENDING).toBe('pending');
      expect(SUBAGENT_STATUS.RUNNING).toBe('running');
      expect(SUBAGENT_STATUS.COMPLETED).toBe('completed');
      expect(SUBAGENT_STATUS.FAILED).toBe('failed');
    });
  });

  describe('constructor', () => {
    it('should create a new SubagentManager instance', () => {
      expect(manager).toBeInstanceOf(SubagentManager);
    });

    it('should be an EventEmitter', () => {
      expect(manager).toBeInstanceOf(EventEmitter);
    });

    it('should store the parent session ID', () => {
      expect(manager.parentSessionId).toBe('parent-session-456');
    });

    it('should initialize with empty subagents map', () => {
      expect(manager.getSubagents()).toEqual([]);
    });

    it('should initialize with zero active count', () => {
      expect(manager.getActiveCount()).toBe(0);
    });
  });

  describe('spawnSubagent', () => {
    it('should spawn a new subagent with valid agent type', async () => {
      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      // Agent type is normalized to OpenCode format (General, Explore)
      expect(result.agentType).toBe('General');
      expect(result.briefing).toBe('Test task');
    });

    it('should reject invalid agent types', async () => {
      await expect(manager.spawnSubagent({
        agentType: 'invalid-type',
        briefing: 'Test task'
      })).rejects.toThrow('Invalid agent type: invalid-type');
    });

    it('should require a briefing', async () => {
      await expect(manager.spawnSubagent({
        agentType: 'general'
      })).rejects.toThrow('Briefing is required');
    });

    it('should create child session via SDK', async () => {
      await manager.spawnSubagent({
        agentType: 'explore',
        briefing: 'Explore the codebase'
      });

      expect(opencodeClient.createSession).toHaveBeenCalled();
    });

    it('should send initial prompt to child session', async () => {
      await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Review the code'
      });

      expect(opencodeClient.sendPrompt).toHaveBeenCalled();
    });

    it('should emit "spawned" event', async () => {
      const spawnedHandler = jest.fn();
      manager.on('spawned', spawnedHandler);

      await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      expect(spawnedHandler).toHaveBeenCalled();
    });

    it('should track the subagent', async () => {
      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      const subagents = manager.getSubagents();
      expect(subagents.length).toBe(1);
      expect(subagents[0].id).toBe(result.id);
    });
  });

  describe('concurrency limits', () => {
    it('should allow up to MAX_CONCURRENT concurrent subagents', async () => {
      // Spawn MAX_CONCURRENT subagents
      const promises = [];
      for (let i = 0; i < MAX_CONCURRENT; i++) {
        promises.push(manager.spawnSubagent({
          agentType: 'general',
          briefing: `Task ${i}`
        }));
      }

      await Promise.all(promises);
      expect(manager.getActiveCount()).toBeLessThanOrEqual(MAX_CONCURRENT);
    });

    it('should queue subagents beyond MAX_CONCURRENT', async () => {
      // Make spawn slow so agents stay active
      opencodeClient.sendPrompt.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ data: {} }), 100))
      );

      // Spawn more than MAX_CONCURRENT
      const promises = [];
      for (let i = 0; i < MAX_CONCURRENT + 2; i++) {
        promises.push(manager.spawnSubagent({
          agentType: 'general',
          briefing: `Task ${i}`
        }));
      }

      // Check queue has items
      expect(manager.getQueueLength()).toBeGreaterThan(0);
    });

    it('should process queue when subagent completes', async () => {
      const queueHandler = jest.fn();
      manager.on('queue-processed', queueHandler);

      // Fill up to max
      for (let i = 0; i < MAX_CONCURRENT; i++) {
        await manager.spawnSubagent({
          agentType: 'general',
          briefing: `Task ${i}`
        });
      }

      // Complete one subagent
      const subagents = manager.getSubagents();
      manager.markCompleted(subagents[0].id, 'Result text');

      // Add another to queue and process
      await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Queued task'
      });

      // Queue should be processed eventually
      expect(manager.getSubagents().length).toBe(MAX_CONCURRENT + 1);
    });
  });

  describe('getSubagent', () => {
    it('should return subagent by ID', async () => {
      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      const subagent = manager.getSubagent(result.id);
      expect(subagent).toBeDefined();
      expect(subagent.id).toBe(result.id);
    });

    it('should return null for non-existent ID', () => {
      const subagent = manager.getSubagent('non-existent');
      expect(subagent).toBeNull();
    });
  });

  describe('getSubagents', () => {
    it('should return all subagents', async () => {
      await manager.spawnSubagent({ agentType: 'general', briefing: 'Task 1' });
      await manager.spawnSubagent({ agentType: 'explore', briefing: 'Task 2' });

      const subagents = manager.getSubagents();
      expect(subagents.length).toBe(2);
    });

    it('should filter by status', async () => {
      const result1 = await manager.spawnSubagent({ agentType: 'general', briefing: 'Task 1' });
      await manager.spawnSubagent({ agentType: 'explore', briefing: 'Task 2' });

      manager.markCompleted(result1.id, 'Done');

      const completed = manager.getSubagents({ status: SUBAGENT_STATUS.COMPLETED });
      expect(completed.length).toBe(1);
      expect(completed[0].id).toBe(result1.id);
    });

    it('should filter by agent type', async () => {
      await manager.spawnSubagent({ agentType: 'general', briefing: 'Task 1' });
      await manager.spawnSubagent({ agentType: 'explore', briefing: 'Task 2' });

      // Filter uses normalized agent type
      const explores = manager.getSubagents({ agentType: 'explore' });
      expect(explores.length).toBe(1);
      expect(explores[0].agentType).toBe('Explore'); // Normalized to OpenCode format
    });
  });

  describe('markCompleted', () => {
    it('should mark subagent as completed', async () => {
      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      manager.markCompleted(result.id, 'Task completed successfully');

      const subagent = manager.getSubagent(result.id);
      expect(subagent.status).toBe(SUBAGENT_STATUS.COMPLETED);
      expect(subagent.result).toBe('Task completed successfully');
    });

    it('should emit "completed" event', async () => {
      const completedHandler = jest.fn();
      manager.on('completed', completedHandler);

      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      manager.markCompleted(result.id, 'Done');

      expect(completedHandler).toHaveBeenCalledWith(expect.objectContaining({
        id: result.id,
        result: 'Done'
      }));
    });

    it('should decrement active count', async () => {
      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      const countBefore = manager.getActiveCount();
      manager.markCompleted(result.id, 'Done');
      const countAfter = manager.getActiveCount();

      expect(countAfter).toBe(countBefore - 1);
    });
  });

  describe('markFailed', () => {
    it('should mark subagent as failed', async () => {
      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      manager.markFailed(result.id, new Error('Something went wrong'));

      const subagent = manager.getSubagent(result.id);
      expect(subagent.status).toBe(SUBAGENT_STATUS.FAILED);
      expect(subagent.error).toBeDefined();
    });

    it('should emit "failed" event', async () => {
      const failedHandler = jest.fn();
      manager.on('failed', failedHandler);

      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      manager.markFailed(result.id, new Error('Error'));

      expect(failedHandler).toHaveBeenCalled();
    });
  });

  describe('readResults', () => {
    it('should read results from completed subagent', async () => {
      opencodeClient.getMessages.mockResolvedValue([
        { role: 'assistant', content: 'Here is my analysis...' }
      ]);

      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      manager.markCompleted(result.id, 'Done');

      const messages = await manager.readResults(result.id);
      expect(messages).toBeDefined();
      expect(Array.isArray(messages)).toBe(true);
    });

    it('should throw for non-existent subagent', async () => {
      await expect(manager.readResults('non-existent'))
        .rejects.toThrow('Subagent not found: non-existent');
    });
  });

  describe('autoFold', () => {
    it('should auto-fold results when subagent completes', async () => {
      const foldHandler = jest.fn();
      manager.on('fold', foldHandler);

      opencodeClient.getMessages.mockResolvedValue([
        { role: 'assistant', content: 'Analysis complete. Found 3 issues.' }
      ]);

      const result = await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      manager.markCompleted(result.id, 'Analysis complete. Found 3 issues.');

      // Auto-fold should be triggered
      expect(foldHandler).toHaveBeenCalledWith(expect.objectContaining({
        subagentId: result.id,
        summary: expect.any(String)
      }));
    });

    it('should format fold summary with agent type and briefing', async () => {
      const foldHandler = jest.fn();
      manager.on('fold', foldHandler);

      const result = await manager.spawnSubagent({
        agentType: 'explore',
        briefing: 'Find all API endpoints'
      });

      manager.markCompleted(result.id, 'Found 15 endpoints in 3 files.');

      expect(foldHandler).toHaveBeenCalled();
      const foldData = foldHandler.mock.calls[0][0];
      // Uses normalized OpenCode agent name
      expect(foldData.summary).toContain('Explore');
      expect(foldData.summary).toContain('Find all API endpoints');
    });
  });

  describe('destroy', () => {
    it('should clean up resources', async () => {
      await manager.spawnSubagent({
        agentType: 'general',
        briefing: 'Test task'
      });

      manager.destroy();

      expect(manager.getSubagents()).toEqual([]);
      expect(manager.getActiveCount()).toBe(0);
    });

    it('should clear the queue', async () => {
      manager.destroy();
      expect(manager.getQueueLength()).toBe(0);
    });
  });

  describe('getActiveCount', () => {
    it('should return count of running subagents', async () => {
      await manager.spawnSubagent({ agentType: 'general', briefing: 'Task 1' });
      await manager.spawnSubagent({ agentType: 'general', briefing: 'Task 2' });

      expect(manager.getActiveCount()).toBeGreaterThan(0);
    });
  });

  describe('getQueueLength', () => {
    it('should return length of pending queue', () => {
      expect(manager.getQueueLength()).toBe(0);
    });
  });
});
