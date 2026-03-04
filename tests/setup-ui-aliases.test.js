/**
 * Tests for electron/setup-ui-aliases.js (Alias Editor)
 *
 * Verifies ALIAS_GROUPS coverage and buildAliasEditorHTML output.
 */

const { getDefaultAliases } = require('../src/utils/config');
const { ALIAS_GROUPS, buildAliasEditorHTML } = require('../electron/setup-ui-aliases');
const { buildAliasScript } = require('../electron/setup-ui-alias-script');

describe('setup-ui-aliases', () => {
  describe('ALIAS_GROUPS', () => {
    it('should cover all 21 DEFAULT_ALIASES keys', () => {
      const defaultKeys = Object.keys(getDefaultAliases());
      const groupedKeys = ALIAS_GROUPS.flatMap(g => g.keys);
      expect(groupedKeys.sort()).toEqual(defaultKeys.sort());
    });

    it('should have no duplicate keys across groups', () => {
      const allKeys = ALIAS_GROUPS.flatMap(g => g.keys);
      expect(new Set(allKeys).size).toBe(allKeys.length);
    });

    it('should have 7 groups', () => {
      expect(ALIAS_GROUPS).toHaveLength(7);
    });

    it('should have named groups with non-empty keys arrays', () => {
      ALIAS_GROUPS.forEach(g => {
        expect(g.name).toBeTruthy();
        expect(g.keys.length).toBeGreaterThan(0);
      });
    });
  });

  describe('buildAliasEditorHTML', () => {
    let html;

    beforeAll(() => {
      html = buildAliasEditorHTML(getDefaultAliases());
    });

    it('should return a string', () => {
      expect(typeof html).toBe('string');
    });

    it('should contain a search input with id alias-search', () => {
      expect(html).toContain('id="alias-search"');
    });

    it('should render 7 details groups', () => {
      const matches = html.match(/<details class="alias-group"/g);
      expect(matches).toHaveLength(7);
    });

    it('should render all 21 alias rows with data-alias attributes', () => {
      const defaultKeys = Object.keys(getDefaultAliases());
      defaultKeys.forEach(key => {
        expect(html).toContain(`data-alias="${key}"`);
      });
    });

    it('should contain alias names in each row', () => {
      expect(html).toContain('class="alias-name"');
      expect(html).toContain('>gemini<');
      expect(html).toContain('>gpt<');
      expect(html).toContain('>opus<');
    });

    it('should contain model strings in each row', () => {
      expect(html).toContain('class="alias-model"');
      expect(html).toContain('openrouter/google/gemini-3-flash-preview');
      expect(html).toContain('openrouter/openai/gpt-5.2-chat');
    });

    it('should contain arrow separators', () => {
      expect(html).toContain('class="alias-arrow"');
    });

    it('should contain delete buttons', () => {
      expect(html).toContain('class="alias-delete"');
    });

    it('should contain an Add Custom Route button', () => {
      expect(html).toContain('id="alias-add-btn"');
      expect(html).toContain('Add Custom Route');
    });

    it('should contain group summary elements with counts', () => {
      // Each group summary shows name and count
      expect(html).toContain('Gemini');
      expect(html).toContain('GPT');
      expect(html).toContain('Claude');
      expect(html).toContain('DeepSeek');
      expect(html).toContain('Qwen');
      expect(html).toContain('Mistral');
      expect(html).toContain('Other');
    });

    it('should have a step-content wrapper', () => {
      expect(html).toContain('class="step-content"');
    });

    it('should have an alias-editor wrapper', () => {
      expect(html).toContain('class="alias-editor"');
    });

    it('should have a Model Routing heading', () => {
      expect(html).toContain('<h1>Model Routing</h1>');
    });

    it('should have a subtitle with explanation', () => {
      expect(html).toContain('class="subtitle"');
      expect(html).toContain('which LLM to collaborate with');
    });

    it('should have a routing example box', () => {
      expect(html).toContain('class="routing-example"');
      expect(html).toContain('--model gemini');
      expect(html).toContain('routes to');
    });

    it('should NOT have an alias-divider', () => {
      expect(html).not.toContain('class="alias-divider"');
    });
  });

  describe('buildAliasScript – null alias guard', () => {
    let script;

    beforeAll(() => {
      script = buildAliasScript();
    });

    it('should guard against null/empty alias in delete handler', () => {
      // The general delete click handler must skip when data-alias is null
      expect(script).toContain('if (!alias)');
    });

    it('should use delete for custom alias cleanup instead of null assignment', () => {
      // When a custom alias (not in defaultAliases) is deleted, remove the
      // key from aliasEdits rather than setting it to null
      expect(script).toContain('delete aliasEdits[');
    });

    it('should clean up aliasEdits when removing a committed custom row', () => {
      // The custom add row's delete handler should remove aliasEdits entry
      // for committed aliases (those with a data-alias attribute)
      expect(script).toMatch(/row\.getAttribute\(['"]data-alias['"]\)/);
    });
  });

  describe('buildAliasScript – model dropdown filtering', () => {
    let script;

    beforeAll(() => {
      script = buildAliasScript();
    });

    it('should pass alias name as filterKeyword to buildModelSelect on inline edit', () => {
      // When clicking a model span, buildModelSelect receives origAlias as filter
      expect(script).toContain('buildModelSelect(origValue, \'alias-model-select\', origAlias)');
    });

    it('should contain filterModels helper that filters by keyword', () => {
      expect(script).toContain('function filterModels(');
    });

    it('should match keyword against model id and name case-insensitively', () => {
      expect(script).toContain('.toLowerCase()');
      expect(script).toContain('m.id.toLowerCase()');
    });

    it('should fall back to all models when no matches found', () => {
      // If filtered list is empty, return the original unfiltered groups
      expect(script).toContain('filtered.length === 0');
    });
  });
});
