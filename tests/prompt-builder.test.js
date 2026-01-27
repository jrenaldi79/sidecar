/**
 * Prompt Builder Tests
 *
 * Spec Reference: §6 Fold Mechanism, §9 Implementation
 * Tests the system prompt construction for both interactive and headless modes.
 */

const { buildSystemPrompt, buildPrompts, getSummaryTemplate, SUMMARY_TEMPLATE, buildEnvironmentSection } = require('../src/prompt-builder');

describe('Prompt Builder', () => {
  describe('buildSystemPrompt', () => {
    const defaultBriefing = 'Debug the authentication race condition';
    const defaultContext = '[User @ 10:30 AM] Can you look at the auth service?';
    const defaultProject = '/Users/john/myproject';

    it('should include TASK BRIEFING section with briefing content', () => {
      const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

      expect(prompt).toContain('## TASK BRIEFING');
      expect(prompt).toContain(defaultBriefing);
    });

    it('should include CONVERSATION CONTEXT section with context content', () => {
      const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

      expect(prompt).toContain('## CONVERSATION CONTEXT');
      expect(prompt).toContain(defaultContext);
    });

    it('should include ENVIRONMENT section with project path', () => {
      const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

      expect(prompt).toContain('## ENVIRONMENT');
      expect(prompt).toContain(defaultProject);
      // Tool permissions are now handled by OpenCode's agent framework
      expect(prompt).toContain('OpenCode agent framework');
    });

    it('should have sidecar session header', () => {
      const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

      expect(prompt).toContain('# SIDECAR SESSION');
      expect(prompt).toContain('sidecar agent');
    });

    describe('Interactive Mode (headless=false)', () => {
      it('should include INTERACTIVE MODE section', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

        expect(prompt).toContain('## INTERACTIVE MODE');
      });

      it('should mention Fold button', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

        expect(prompt).toContain('Fold');
      });

      it('should mention summary generation', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

        expect(prompt).toContain('summary');
      });

      it('should NOT include HEADLESS MODE section', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

        expect(prompt).not.toContain('## HEADLESS MODE');
        expect(prompt).not.toContain('[SIDECAR_COMPLETE]');
      });

      it('should NOT include "Do NOT ask questions"', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, false);

        expect(prompt).not.toContain('Do NOT ask questions');
      });
    });

    describe('Headless Mode (headless=true)', () => {
      it('should include HEADLESS MODE section', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, true);

        expect(prompt).toContain('## HEADLESS MODE');
      });

      it('should include [SIDECAR_COMPLETE] marker instruction per spec §6.2', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, true);

        expect(prompt).toContain('[SIDECAR_COMPLETE]');
      });

      it('should include "Do NOT ask questions. Work independently." per spec §6.2', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, true);

        expect(prompt).toContain('Do NOT ask questions');
        expect(prompt).toContain('Work independently');
      });

      it('should instruct to make reasonable assumptions', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, true);

        expect(prompt).toContain('assumptions');
        expect(prompt).toContain('document');
      });

      it('should instruct to output summary when done', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, true);

        expect(prompt).toContain('summary');
        expect(prompt).toContain('[SIDECAR_COMPLETE]');
      });

      it('should include blocker handling instructions', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, true);

        expect(prompt).toContain('blocker');
        expect(prompt).toContain('partial');
      });

      it('should NOT include INTERACTIVE MODE section', () => {
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, defaultProject, true);

        expect(prompt).not.toContain('## INTERACTIVE MODE');
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty context', () => {
        const prompt = buildSystemPrompt(defaultBriefing, '', defaultProject, false);

        expect(prompt).toContain('## CONVERSATION CONTEXT');
        expect(prompt).toContain(defaultBriefing);
      });

      it('should handle empty briefing', () => {
        const prompt = buildSystemPrompt('', defaultContext, defaultProject, false);

        expect(prompt).toContain('## TASK BRIEFING');
        expect(prompt).toContain(defaultContext);
      });

      it('should handle special characters in briefing', () => {
        const specialBriefing = 'Fix the bug with "quotes" and `backticks` and $variables';
        const prompt = buildSystemPrompt(specialBriefing, defaultContext, defaultProject, false);

        expect(prompt).toContain(specialBriefing);
      });

      it('should handle multiline context', () => {
        const multilineContext = '[User @ 10:30 AM] First message\n\n[Assistant @ 10:31 AM] Second message\n\n[Tool: Read file.ts]';
        const prompt = buildSystemPrompt(defaultBriefing, multilineContext, defaultProject, false);

        expect(prompt).toContain(multilineContext);
      });

      it('should handle Windows-style paths', () => {
        const windowsPath = 'C:\\Users\\john\\myproject';
        const prompt = buildSystemPrompt(defaultBriefing, defaultContext, windowsPath, false);

        expect(prompt).toContain(windowsPath);
      });
    });
  });

  describe('SUMMARY_TEMPLATE', () => {
    it('should be exported', () => {
      expect(SUMMARY_TEMPLATE).toBeDefined();
      expect(typeof SUMMARY_TEMPLATE).toBe('string');
    });

    it('should include all required sections per spec §6.1', () => {
      // Required sections from spec
      expect(SUMMARY_TEMPLATE).toContain('## Sidecar Results: [Brief Title]');
      expect(SUMMARY_TEMPLATE).toContain('**Task:**');
      expect(SUMMARY_TEMPLATE).toContain('**Findings:**');
      expect(SUMMARY_TEMPLATE).toContain('**Attempted Approaches:**');
      expect(SUMMARY_TEMPLATE).toContain('**Recommendations:**');
      expect(SUMMARY_TEMPLATE).toContain('**Code Changes:**');
      expect(SUMMARY_TEMPLATE).toContain('**Files Modified/Created:**');
      expect(SUMMARY_TEMPLATE).toContain('**Assumptions Made:**');
      expect(SUMMARY_TEMPLATE).toContain('**Open Questions:**');
    });

    it('should have explanation for Attempted Approaches (prevents repeating failed attempts)', () => {
      // The spec mentions this is valuable to prevent main session from repeating failed attempts
      expect(SUMMARY_TEMPLATE).toContain("didn't work");
    });
  });

  describe('getSummaryTemplate', () => {
    it('should return the summary template', () => {
      const template = getSummaryTemplate();

      expect(template).toBe(SUMMARY_TEMPLATE);
    });

    it('should be usable as a fold prompt', () => {
      const template = getSummaryTemplate();

      // Should be suitable for injecting as a prompt
      expect(template).toContain('summary');
      expect(template).toContain('handoff');
    });
  });

  describe('OpenCode Agent Framework Integration', () => {
    const defaultProject = '/Users/john/myproject';

    describe('buildEnvironmentSection - tool permissions delegated to OpenCode', () => {
      // Tool restrictions are now handled by OpenCode's native agent framework
      // The environment section only provides project context
      // OpenCode enforces permissions based on the agent type passed to the API

      it('should include project path in all modes', () => {
        expect(buildEnvironmentSection(defaultProject, 'build')).toContain(defaultProject);
        expect(buildEnvironmentSection(defaultProject, 'plan')).toContain(defaultProject);
        expect(buildEnvironmentSection(defaultProject)).toContain(defaultProject);
      });

      it('should note that permissions are managed by OpenCode', () => {
        const section = buildEnvironmentSection(defaultProject, 'plan');

        expect(section).toContain('OpenCode agent framework');
        expect(section).toContain('agent type');
      });

      it('should not include mode-specific tool lists (OpenCode handles this)', () => {
        // These detailed tool lists are no longer in the prompt
        // OpenCode's agent framework handles tool permissions:
        //   - Build: Full tool access
        //   - Plan: Read-only access
        //   - Explore: Read-only subagent
        //   - General: Full-access subagent

        const section = buildEnvironmentSection(defaultProject, 'plan');

        // Should NOT have explicit tool lists anymore
        expect(section).not.toContain('**bash**');
        expect(section).not.toContain('**write**');
        expect(section).not.toContain('PROHIBITED');
      });
    });

    describe('buildPrompts with mode parameter', () => {
      it('should pass mode to environment section (for reference)', () => {
        const { system } = buildPrompts(
          'Review the code',
          'context',
          defaultProject,
          false,
          'plan'
        );

        // Environment section should mention OpenCode handles permissions
        expect(system).toContain('OpenCode agent framework');
      });

      it('should include project path regardless of mode', () => {
        const { system: planSystem } = buildPrompts('Review', 'context', defaultProject, false, 'plan');
        const { system: buildSystem } = buildPrompts('Fix', 'context', defaultProject, false, 'build');

        expect(planSystem).toContain(defaultProject);
        expect(buildSystem).toContain(defaultProject);
      });
    });

    describe('buildSystemPrompt with mode parameter', () => {
      it('should delegate tool restrictions to OpenCode', () => {
        const prompt = buildSystemPrompt(
          'Review code',
          'context',
          defaultProject,
          false,
          'plan'
        );

        // Should reference OpenCode's agent framework
        expect(prompt).toContain('OpenCode');
        // Should NOT have inline tool restrictions
        expect(prompt).not.toContain('**bash**');
      });

      it('should work with all modes (tool handling is external)', () => {
        const modes = ['build', 'plan', 'code', 'explore', 'general'];

        modes.forEach(mode => {
          const prompt = buildSystemPrompt('Task', 'ctx', defaultProject, false, mode);
          expect(prompt).toContain(defaultProject);
          expect(prompt).toContain('## ENVIRONMENT');
        });
      });
    });
  });
});
