/**
 * Command Autocomplete Provider Module
 *
 * Provides / command autocomplete functionality for OpenCode slash commands
 * and subagent commands. Includes built-in commands and configurable custom commands.
 *
 * Usage:
 *   const provider = createCommandAutocompleteProvider({
 *     includeSubagents: true
 *   });
 */

/**
 * Built-in OpenCode slash commands
 * Reference: https://opencode.ai/docs/commands/
 */
const BUILTIN_COMMANDS = [
  {
    id: 'init',
    name: '/init',
    description: 'Initialize a new session with context',
    category: 'builtin'
  },
  {
    id: 'undo',
    name: '/undo',
    description: 'Undo the last action',
    category: 'builtin'
  },
  {
    id: 'redo',
    name: '/redo',
    description: 'Redo a previously undone action',
    category: 'builtin'
  },
  {
    id: 'share',
    name: '/share',
    description: 'Share the conversation',
    category: 'builtin'
  },
  {
    id: 'help',
    name: '/help',
    description: 'Show available commands and help',
    category: 'builtin'
  }
];

/**
 * Subagent commands (OpenCode native agents)
 */
const SUBAGENT_COMMANDS = [
  {
    id: 'explore',
    name: '@explore',
    description: 'Read-only exploration subagent',
    category: 'subagent'
  },
  {
    id: 'general',
    name: '@general',
    description: 'Full-access subagent for complex tasks',
    category: 'subagent'
  }
];

/**
 * Command category icons
 */
const COMMAND_ICONS = {
  builtin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b9bf8" stroke-width="2"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
  subagent: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>',
  custom: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  default: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>'
};

/**
 * Get command icon SVG based on category
 * @param {string} category - Command category
 * @returns {string} SVG markup for the icon
 */
function getCommandIcon(category) {
  return COMMAND_ICONS[category] || COMMAND_ICONS.default;
}

/**
 * Filter commands by query (case-insensitive)
 * @param {Array} commands - Commands to filter
 * @param {string} query - Search query
 * @returns {Array} Filtered commands
 */
function filterCommands(commands, query) {
  if (!query) {
    return commands;
  }

  const lowerQuery = query.toLowerCase();
  return commands.filter(cmd => {
    const name = cmd.name.toLowerCase().replace(/^[@/]/, '');
    return name.includes(lowerQuery);
  });
}

/**
 * Sort commands by relevance (exact match first)
 * @param {Array} commands - Commands to sort
 * @param {string} query - Search query
 * @returns {Array} Sorted commands
 */
function sortByRelevance(commands, query) {
  if (!query) {
    return commands;
  }

  const lowerQuery = query.toLowerCase();
  return [...commands].sort((a, b) => {
    const aName = a.name.toLowerCase().replace(/^[@/]/, '');
    const bName = b.name.toLowerCase().replace(/^[@/]/, '');

    // Exact match first
    if (aName === lowerQuery && bName !== lowerQuery) {
      return -1;
    }
    if (bName === lowerQuery && aName !== lowerQuery) {
      return 1;
    }

    // Starts with query
    if (aName.startsWith(lowerQuery) && !bName.startsWith(lowerQuery)) {
      return -1;
    }
    if (bName.startsWith(lowerQuery) && !aName.startsWith(lowerQuery)) {
      return 1;
    }

    // Alphabetical
    return aName.localeCompare(bName);
  });
}

/**
 * Create a command autocomplete provider
 * @param {Object} config - Provider configuration
 * @param {boolean} [config.includeSubagents=true] - Include subagent commands
 * @param {Array} [config.customCommands=[]] - Additional custom commands
 * @param {number} [config.debounceMs=50] - Debounce delay (fast for commands)
 * @returns {Object} Autocomplete provider
 */
function createCommandAutocompleteProvider(config = {}) {
  const {
    includeSubagents = true,
    customCommands = [],
    debounceMs = 50
  } = config;

  return {
    trigger: '/',
    name: 'command',
    debounceMs,
    minChars: 0,

    /**
     * Search for commands matching the query
     * @param {string} query - Search query
     * @returns {Promise<Array>} Array of matching command items
     */
    async search(query) {
      // Combine all commands
      let allCommands = [...BUILTIN_COMMANDS];

      if (includeSubagents) {
        allCommands = [...allCommands, ...SUBAGENT_COMMANDS];
      }

      if (customCommands.length > 0) {
        allCommands = [...allCommands, ...customCommands];
      }

      // Filter by query
      const filtered = filterCommands(allCommands, query);

      // Sort by relevance
      const sorted = sortByRelevance(filtered, query);

      // Format for autocomplete
      return sorted.map(cmd => ({
        id: cmd.id,
        label: cmd.name,
        description: cmd.description,
        icon: getCommandIcon(cmd.category),
        category: cmd.category
      }));
    },

    /**
     * Get the text to insert when item is selected
     * @param {Object} item - Selected item
     * @param {string} _query - Original query (unused)
     * @returns {string} Text to insert
     */
    getInsertText(item, _query) {
      return `${item.label} `;
    }
  };
}

// Export for both browser and Node.js (tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createCommandAutocompleteProvider,
    BUILTIN_COMMANDS,
    SUBAGENT_COMMANDS,
    getCommandIcon,
    filterCommands,
    sortByRelevance
  };
}

// Browser global
if (typeof window !== 'undefined') {
  window.CommandAutocomplete = {
    createCommandAutocompleteProvider,
    BUILTIN_COMMANDS,
    SUBAGENT_COMMANDS,
    getCommandIcon
  };
}
