/**
 * Tests for model-router.js - TDD Red Phase
 *
 * Model routing logic for subagents. Routes Explore agents to cheaper models
 * while Plan and General agents inherit the parent model.
 */

const path = require('path');

// Will be implemented after tests are written
let modelRouter;

describe('model-router', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear require cache to reset module state
    jest.resetModules();
    // Reset env vars
    delete process.env.SIDECAR_EXPLORE_MODEL;
    delete process.env.SIDECAR_DISABLE_MODEL_ROUTING;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  beforeAll(() => {
    // Load module (will fail until implemented)
    modelRouter = require('../src/utils/model-router');
  });

  describe('resolveModel', () => {
    describe('explicit model override', () => {
      it('should use explicit model when provided for Explore agent', () => {
        const result = modelRouter.resolveModel({
          agentType: 'Explore',
          explicitModel: 'custom/expensive-model',
          parentModel: 'openrouter/gemini-pro'
        });

        expect(result.model).toBe('custom/expensive-model');
        expect(result.wasRouted).toBe(false);
        expect(result.reason).toBe('explicit_override');
      });

      it('should use explicit model when provided for General agent', () => {
        const result = modelRouter.resolveModel({
          agentType: 'General',
          explicitModel: 'custom/special-model',
          parentModel: 'openrouter/claude-opus'
        });

        expect(result.model).toBe('custom/special-model');
        expect(result.wasRouted).toBe(false);
        expect(result.reason).toBe('explicit_override');
      });
    });

    describe('Explore agent routing', () => {
      it('should route Explore subagents to cheap model by default', () => {
        const result = modelRouter.resolveModel({
          agentType: 'Explore',
          parentModel: 'openrouter/claude-3-opus'
        });

        expect(result.model).toBe(modelRouter.DEFAULT_CHEAP_MODEL);
        expect(result.wasRouted).toBe(true);
        expect(result.reason).toBe('routed_explore');
      });

      it('should use SIDECAR_EXPLORE_MODEL env var when set', () => {
        process.env.SIDECAR_EXPLORE_MODEL = 'openrouter/custom/cheap-model';
        // Reload module to pick up env var
        jest.resetModules();
        const freshModule = require('../src/utils/model-router');

        const result = freshModule.resolveModel({
          agentType: 'Explore',
          parentModel: 'openrouter/expensive'
        });

        expect(result.model).toBe('openrouter/custom/cheap-model');
        expect(result.wasRouted).toBe(true);
      });

      it('should be case-insensitive for Explore agent type', () => {
        const result1 = modelRouter.resolveModel({ agentType: 'explore', parentModel: 'x' });
        const result2 = modelRouter.resolveModel({ agentType: 'EXPLORE', parentModel: 'x' });
        const result3 = modelRouter.resolveModel({ agentType: 'Explore', parentModel: 'x' });

        expect(result1.wasRouted).toBe(true);
        expect(result2.wasRouted).toBe(true);
        expect(result3.wasRouted).toBe(true);
      });
    });

    describe('Plan agent inheritance', () => {
      it('should NOT route Plan subagents - inherit parent model', () => {
        const result = modelRouter.resolveModel({
          agentType: 'Plan',
          parentModel: 'openrouter/o3'
        });

        expect(result.model).toBe('openrouter/o3');
        expect(result.wasRouted).toBe(false);
        expect(result.reason).toBe('inherited_parent');
      });

      it('should be case-insensitive for Plan agent type', () => {
        const result1 = modelRouter.resolveModel({ agentType: 'plan', parentModel: 'parent-model' });
        const result2 = modelRouter.resolveModel({ agentType: 'PLAN', parentModel: 'parent-model' });

        expect(result1.model).toBe('parent-model');
        expect(result2.model).toBe('parent-model');
        expect(result1.wasRouted).toBe(false);
        expect(result2.wasRouted).toBe(false);
      });
    });

    describe('General agent inheritance', () => {
      it('should NOT route General subagents - inherit parent model', () => {
        const result = modelRouter.resolveModel({
          agentType: 'General',
          parentModel: 'openrouter/claude-3-opus'
        });

        expect(result.model).toBe('openrouter/claude-3-opus');
        expect(result.wasRouted).toBe(false);
        expect(result.reason).toBe('inherited_parent');
      });

      it('should be case-insensitive for General agent type', () => {
        const result = modelRouter.resolveModel({ agentType: 'general', parentModel: 'parent-model' });

        expect(result.model).toBe('parent-model');
        expect(result.wasRouted).toBe(false);
      });
    });

    describe('top-level sessions', () => {
      it('should NOT route top-level sessions even for Explore', () => {
        const result = modelRouter.resolveModel({
          agentType: 'Explore',
          parentModel: 'openrouter/gemini-pro',
          isSubagent: false
        });

        expect(result.model).toBe('openrouter/gemini-pro');
        expect(result.wasRouted).toBe(false);
        expect(result.reason).toBe('top_level_session');
      });

      it('should default isSubagent to true', () => {
        const result = modelRouter.resolveModel({
          agentType: 'Explore',
          parentModel: 'openrouter/expensive'
        });

        // Should route because isSubagent defaults to true
        expect(result.wasRouted).toBe(true);
      });
    });

    describe('routing disabled', () => {
      it('should inherit parent model when routing is disabled', () => {
        process.env.SIDECAR_DISABLE_MODEL_ROUTING = 'true';
        jest.resetModules();
        const freshModule = require('../src/utils/model-router');

        const result = freshModule.resolveModel({
          agentType: 'Explore',
          parentModel: 'openrouter/expensive'
        });

        expect(result.model).toBe('openrouter/expensive');
        expect(result.wasRouted).toBe(false);
        expect(result.reason).toBe('routing_disabled');
      });
    });

    describe('edge cases', () => {
      it('should handle null agentType by inheriting parent', () => {
        const result = modelRouter.resolveModel({
          agentType: null,
          parentModel: 'parent-model'
        });

        expect(result.model).toBe('parent-model');
        expect(result.wasRouted).toBe(false);
      });

      it('should handle undefined agentType by inheriting parent', () => {
        const result = modelRouter.resolveModel({
          parentModel: 'parent-model'
        });

        expect(result.model).toBe('parent-model');
        expect(result.wasRouted).toBe(false);
      });

      it('should handle unknown agent types by inheriting parent', () => {
        const result = modelRouter.resolveModel({
          agentType: 'CustomAgent',
          parentModel: 'parent-model'
        });

        expect(result.model).toBe('parent-model');
        expect(result.wasRouted).toBe(false);
        expect(result.reason).toBe('inherited_parent');
      });
    });
  });

  describe('getConfiguredCheapModel', () => {
    it('should return DEFAULT_CHEAP_MODEL when no env var set', () => {
      const result = modelRouter.getConfiguredCheapModel();
      expect(result).toBe(modelRouter.DEFAULT_CHEAP_MODEL);
    });

    it('should return SIDECAR_EXPLORE_MODEL when set', () => {
      process.env.SIDECAR_EXPLORE_MODEL = 'custom/cheap';
      jest.resetModules();
      const freshModule = require('../src/utils/model-router');

      const result = freshModule.getConfiguredCheapModel();
      expect(result).toBe('custom/cheap');
    });
  });

  describe('isRoutingEnabled', () => {
    it('should return true by default', () => {
      expect(modelRouter.isRoutingEnabled()).toBe(true);
    });

    it('should return false when SIDECAR_DISABLE_MODEL_ROUTING is true', () => {
      process.env.SIDECAR_DISABLE_MODEL_ROUTING = 'true';
      jest.resetModules();
      const freshModule = require('../src/utils/model-router');

      expect(freshModule.isRoutingEnabled()).toBe(false);
    });

    it('should return true when SIDECAR_DISABLE_MODEL_ROUTING is false', () => {
      process.env.SIDECAR_DISABLE_MODEL_ROUTING = 'false';
      jest.resetModules();
      const freshModule = require('../src/utils/model-router');

      expect(freshModule.isRoutingEnabled()).toBe(true);
    });
  });

  describe('constants', () => {
    it('should export DEFAULT_CHEAP_MODEL', () => {
      expect(modelRouter.DEFAULT_CHEAP_MODEL).toBeDefined();
      expect(typeof modelRouter.DEFAULT_CHEAP_MODEL).toBe('string');
      expect(modelRouter.DEFAULT_CHEAP_MODEL).toContain('gemini');
    });
  });
});
